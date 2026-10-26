// A tiny Home Assistant REST client, for three jobs:
//
//   - reading and writing the config of automations, scripts and scenes made in
//     the UI, so a renamed entity id can be replaced in them. (Dashboards go over
//     the WebSocket API.)
//   - the config flows that create a helper (a group, a min/max, a template
//     sensor) and change the members of a group, which Home Assistant offers only
//     over REST. The template flow is for one thing: a recipe's "occupied"
//     sensor, whose template the change list restricts.
//   - making and replacing the automation of a recipe (taxis_<recipe>_<area>):
//     the same config path as the first job, with an id Taxis chooses.
//
// https://developers.home-assistant.io/docs/api/rest
//
// Like the WebSocket client, what may be sent is enforced here, by method and
// path (and, for starting a flow, by what it starts), nothing else:
//
//   GET, POST  /config/(automation|script|scene)/config/<id>
//   POST       /config/config_entries/flow                  handler "group", "min_max" or "template" only
//   POST       /config/config_entries/flow/<flow_id>
//   POST       /config/config_entries/options/flow         handler: a config entry id
//   POST       /config/config_entries/options/flow/<flow_id>
//
// DELETE exists in Home Assistant's API (for configs, and to abandon a flow);
// Taxis never sends it. No service is ever called.

import { redact } from "../config.ts";

export type ConfigKind = "automation" | "script" | "scene";
export type HaConfig = Record<string, unknown>;

// The two calls Taxis makes. Tests pass fakes of this.
export interface RestApi {
  /** The stored config, or null when Home Assistant has none to edit (404: YAML). */
  get(kind: ConfigKind, id: string): Promise<HaConfig | null>;
  /** Replaces the stored config. */
  post(kind: ConfigKind, id: string, config: HaConfig): Promise<void>;
}

const CONFIG_PATH = /^\/config\/(automation|script|scene)\/config\/[A-Za-z0-9_-]{1,255}$/;
// Flow ids are 32 hex characters in Home Assistant; config entry ids are 26
// letters and digits. Either way, letters and digits only.
const FLOW_ID = "[A-Za-z0-9]{8,64}";
const FLOW_START = "/config/config_entries/flow";
const FLOW_STEP = new RegExp(`^/config/config_entries/flow/${FLOW_ID}$`);
const OPTIONS_START = "/config/config_entries/options/flow";
const OPTIONS_STEP = new RegExp(`^/config/config_entries/options/flow/${FLOW_ID}$`);
const ENTRY_ID = new RegExp(`^${FLOW_ID}$`);

// The helpers Taxis starts a config flow for.
export const FLOW_HANDLERS = ["group", "min_max", "template"] as const;

const handlerOf = (body: unknown): unknown => (body && typeof body === "object" && !Array.isArray(body) ? (body as { handler?: unknown }).handler : undefined);

export function assertRestRequest(method: string, path: string, body?: unknown): void {
  if (method !== "GET" && method !== "POST") {
    throw new Error(`Refusing to send ${method} to Home Assistant: Taxis only reads and replaces configs and steps through helper flows.`);
  }
  if (CONFIG_PATH.test(path)) return;
  if (method === "POST") {
    if (path === FLOW_START) {
      const handler = handlerOf(body);
      if (!(FLOW_HANDLERS as readonly unknown[]).includes(handler)) {
        throw new Error(`Refusing to start a config flow for "${String(handler).slice(0, 40)}": Taxis only creates groups, min/max helpers and template sensors.`);
      }
      return;
    }
    if (path === OPTIONS_START) {
      const handler = handlerOf(body);
      if (typeof handler !== "string" || !ENTRY_ID.test(handler)) throw new Error("Refusing to start an options flow: it needs a config entry id.");
      return;
    }
    if (FLOW_STEP.test(path) || OPTIONS_STEP.test(path)) return;
  }
  throw new Error(`Refusing to send a request to "${path.slice(0, 80)}": it isn't an automation, script or scene config, or a step of a helper flow.`);
}

export class HaRest implements RestApi {
  constructor(
    // e.g. http://supervisor/core/api (no trailing slash).
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 20_000,
  ) {}

  /** One request. `path` is relative to the API base, e.g. /config/script/config/movie_time. */
  async request(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    assertRestRequest(method, path, body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const parsed: unknown = await res.json().catch(() => null);
      return { status: res.status, body: parsed };
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      const why = aborted ? `no answer within ${this.timeoutMs / 1000}s` : (e as Error).message;
      throw new Error(redact(`Couldn't reach Home Assistant's REST API (${why}).`, this.token));
    } finally {
      clearTimeout(timer);
    }
  }

  private failure(what: string, status: number, body: unknown): Error {
    const message = body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string" ? `: ${(body as { message: string }).message}` : "";
    return new Error(redact(`Home Assistant refused to ${what} (HTTP ${status}${message}).`, this.token));
  }

  async get(kind: ConfigKind, id: string): Promise<HaConfig | null> {
    const res = await this.request("GET", `/config/${kind}/config/${id}`);
    // 404: no stored config. The item exists (it has a state) but is written in
    // YAML, so the UI can't edit it.
    if (res.status === 404) return null;
    if (res.status < 200 || res.status >= 300) throw this.failure(`read the ${kind}`, res.status, res.body);
    if (!res.body || typeof res.body !== "object" || Array.isArray(res.body)) {
      throw new Error(`Home Assistant sent a ${kind} config Taxis couldn't read.`);
    }
    return res.body as HaConfig;
  }

  async post(kind: ConfigKind, id: string, config: HaConfig): Promise<void> {
    const res = await this.request("POST", `/config/${kind}/config/${id}`, config);
    if (res.status === 404) throw new Error(`Home Assistant has no ${kind} config to replace: it isn't editable in the UI.`);
    if (res.status < 200 || res.status >= 300) throw this.failure(`save the ${kind}`, res.status, res.body);
  }
}
