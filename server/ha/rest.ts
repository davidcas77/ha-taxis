// A tiny Home Assistant REST client, for one job: reading and writing the
// config of automations, scripts and scenes made in the UI, so a renamed entity
// id can be replaced in them. (Dashboards go over the WebSocket API.)
// https://developers.home-assistant.io/docs/api/rest
//
// Like the WebSocket client, what may be sent is enforced here: only GET and
// POST of /config/(automation|script|scene)/config/<id>, nothing else. DELETE
// of a config exists in Home Assistant's API; Taxis never sends it.

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

const ALLOWED_PATH = /^\/config\/(automation|script|scene)\/config\/[A-Za-z0-9_-]{1,255}$/;

export function assertRestRequest(method: string, path: string): void {
  if (method !== "GET" && method !== "POST") {
    throw new Error(`Refusing to send ${method} to Home Assistant: Taxis only reads and replaces configs.`);
  }
  if (!ALLOWED_PATH.test(path)) {
    throw new Error(`Refusing to send a request to "${path.slice(0, 80)}": it isn't an automation, script or scene config.`);
  }
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
    assertRestRequest(method, path);
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
