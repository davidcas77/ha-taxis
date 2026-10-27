import { ANNOUNCE_PATH, BLUEPRINT_PATH_RE } from "../../shared/blueprints.ts";
import { DAY_KEYS, MAX_RANGES_PER_DAY } from "../../shared/periods.ts";

// Minimal Home Assistant WebSocket client.
// https://developers.home-assistant.io/docs/api/websocket
//
// Protocol: the server sends auth_required, we answer with the token, it
// replies auth_ok or auth_invalid. After that every command carries an id and
// gets exactly one {type:"result", id, success, result | error} back.
//
// What may be sent is enforced here rather than by convention: command() sends
// only READ_COMMANDS; write() sends only WRITE_COMMANDS, and only the Apply step
// calls write(). Services are never called and nothing is ever deleted: devices
// and entities are only updated. Registry edits are most of the writes. Besides
// those, Apply edits the contents of dashboards (lovelace/config/save) and, via
// the REST client in rest.ts (which has its own fixed allowlist), of
// automations, scripts and scenes, to replace a renamed entity id in them and
// to make a recipe's automation. The same REST client also creates the canonical helpers (a group or a
// min/max, through Home Assistant's config flows) and updates a group's members;
// the new helper is then placed with the registry edits below (its entity id,
// its area, and an area's temperature or humidity sensor).
//
// Recipes add four writes: blueprint/save, which is checked here (automation
// blueprints at taxis/<name>.yaml, plus the one script blueprint at
// taxis/announce.yaml, never anywhere else), and timer/create,
// timer/update and input_boolean/create, the calls Home Assistant's own Helpers
// page makes for a timer and a toggle. The recipe's automations go through the
// REST client. One read is added with them, blueprint/list, to see which Taxis
// blueprints are there and at what version. Area climate adds two more,
// schedule/create and schedule/update, the calls the same page makes for a
// schedule helper (checked here: a name, an optional icon, and the seven days'
// periods, nothing else); there is no schedule read, so the periods Taxis wrote
// are checked against the answer to the write.

export const READ_COMMANDS = new Set([
  "get_config",
  "get_states",
  "config/floor_registry/list",
  "config/area_registry/list",
  "config/device_registry/list",
  "config/entity_registry/list",
  "config/label_registry/list",
  "config/category_registry/list",
  // Where an entity is used, for renames: {item_type: "entity", item_id}.
  "search/related",
  // The blueprints of a domain, to see which Taxis blueprints exist and their
  // version: {domain: "automation"}.
  "blueprint/list",
  // Dashboards other than the default one, and a dashboard's stored config.
  "lovelace/dashboards/list",
  "lovelace/config",
  // Whether a dashboard is stored ("storage") or written in YAML ("yaml"); with
  // no url_path, the default dashboard.
  "lovelace/info",
  // The integrations and helpers set up in Home Assistant and whether each works
  // (domain, title, state, reason, disabled_by); only those fields are kept
  // (server/model/hierarchy.ts). Never an entry's settings: the list has none.
  "config_entries/get",
]);

export function assertReadCommand(type: string): void {
  if (!READ_COMMANDS.has(type)) {
    throw new Error(`Refusing to send "${type}" to Home Assistant: it isn't a read.`);
  }
}

// Edits Apply can make: registry edits from the change list (entities and
// devices are only ever updated, never removed), and dashboard contents.
export const WRITE_COMMANDS = new Set([
  "config/floor_registry/create",
  "config/floor_registry/update",
  "config/floor_registry/delete",
  "config/area_registry/create",
  "config/area_registry/update",
  "config/area_registry/delete",
  "config/label_registry/create",
  "config/label_registry/update",
  "config/label_registry/delete",
  "config/category_registry/create",
  "config/category_registry/update",
  "config/category_registry/delete",
  "config/device_registry/update",
  "config/entity_registry/update",
  // Dashboard contents, only ever to replace a renamed entity id in them.
  "lovelace/config/save",
  // Recipes: a Taxis blueprint (path and domain are checked below), and the
  // helpers a recipe needs that Home Assistant offers only as these calls.
  "blueprint/save",
  "timer/create",
  "timer/update",
  "input_boolean/create",
  // Area climate's schedule helper: its comfort periods.
  "schedule/create",
  "schedule/update",
]);

const BLUEPRINT_SAVE_KEYS = new Set(["domain", "path", "yaml", "source_url", "allow_override"]);

// blueprint/save writes a file into Home Assistant's blueprints folder, so what
// it may write is fixed here: an automation blueprint at taxis/<name>.yaml, and
// the script blueprint at taxis/announce.yaml (the only script Taxis makes).
function assertBlueprintSave(payload: Record<string, unknown>): void {
  const stray = Object.keys(payload).find((k) => !BLUEPRINT_SAVE_KEYS.has(k));
  if (stray) throw new Error(`Refusing to save a blueprint with "${stray.slice(0, 40)}": it isn't something Taxis sends.`);
  if (payload.domain !== "automation" && payload.domain !== "script") {
    throw new Error(`Refusing to save a blueprint for "${String(payload.domain).slice(0, 40)}": Taxis writes automation blueprints, and one script blueprint.`);
  }
  if (typeof payload.path !== "string" || !BLUEPRINT_PATH_RE.test(payload.path)) {
    throw new Error(`Refusing to save a blueprint at "${String(payload.path).slice(0, 80)}": Taxis writes only to taxis/<name>.yaml.`);
  }
  // A script blueprint is the announce one and nothing else; announce is not an automation.
  if ((payload.domain === "script") !== (payload.path === ANNOUNCE_PATH)) {
    throw new Error(`Refusing to save a ${String(payload.domain)} blueprint at "${payload.path.slice(0, 80)}": the only script blueprint Taxis writes is ${ANNOUNCE_PATH}.`);
  }
  if (typeof payload.yaml !== "string" || payload.yaml.length === 0 || payload.yaml.length > 64 * 1024) throw new Error("Refusing to save a blueprint with no text or too much of it.");
}

const SCHEDULE_KEYS = new Set(["name", "icon", "schedule_id", ...DAY_KEYS]);
const SCHEDULE_TIME = /^([01]\d|2[0-3]):[0-5]\d:00$/;

// schedule/create and schedule/update: a name (and for an update the id of the
// schedule), an optional icon and the seven days, each a short list of from/to
// times. Nothing else rides along.
function assertScheduleWrite(type: string, payload: Record<string, unknown>): void {
  const stray = Object.keys(payload).find((k) => !SCHEDULE_KEYS.has(k));
  if (stray) throw new Error(`Refusing to send a schedule with "${stray.slice(0, 40)}": it isn't something Taxis sends.`);
  if (typeof payload.name !== "string" || payload.name.trim() === "" || payload.name.length > 255) throw new Error("Refusing to send a schedule with no name.");
  if (payload.icon !== undefined && (typeof payload.icon !== "string" || !/^[a-z0-9]+:[a-z0-9-]+$/.test(payload.icon))) throw new Error("Refusing to send a schedule with an icon that isn't one.");
  if (type === "schedule/update" ? typeof payload.schedule_id !== "string" || !/^[a-z0-9_]{1,80}$/.test(payload.schedule_id) : "schedule_id" in payload) {
    throw new Error(type === "schedule/update" ? "Refusing to update a schedule without saying which." : "Refusing to create a schedule with an id.");
  }
  for (const day of DAY_KEYS) {
    const ranges = payload[day];
    if (!Array.isArray(ranges) || ranges.length > MAX_RANGES_PER_DAY) throw new Error(`Refusing to send a schedule whose ${day} isn't a short list of periods.`);
    for (const r of ranges as unknown[]) {
      const keys = r && typeof r === "object" ? Object.keys(r) : [];
      const { from, to } = (r ?? {}) as { from?: unknown; to?: unknown };
      const ok = keys.length === 2 && typeof from === "string" && typeof to === "string" && SCHEDULE_TIME.test(from) && SCHEDULE_TIME.test(to) && from < to;
      if (!ok) throw new Error(`Refusing to send a schedule with a period on ${day} that isn't from/to times.`);
    }
  }
}

export function assertWriteCommand(type: string, payload: Record<string, unknown> = {}): void {
  if (!WRITE_COMMANDS.has(type)) {
    throw new Error(`Refusing to send "${type}" to Home Assistant: Taxis doesn't make that change.`);
  }
  if (type === "blueprint/save") assertBlueprintSave(payload);
  if (type === "schedule/create" || type === "schedule/update") assertScheduleWrite(type, payload);
}

// The subset of the WebSocket API this client uses, so tests can pass a fake.
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
}
export type SocketFactory = (url: string) => SocketLike;

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Incoming = {
  type?: string;
  id?: number;
  success?: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
  message?: string;
};

// One physical connection. Commands are tracked per connection, so a late
// close event from an old socket can never fail commands sent on a new one.
type Connection = {
  socket: SocketLike;
  ready: Promise<void>;
  authed: boolean;
  pending: Map<number, Pending>;
};

const OPEN = 1;

// Host only, for messages: never the full URL.
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the configured address";
  }
}
// Home Assistant counts failed WebSocket logins towards its IP ban. After a
// rejected token, don't try again for a while.
const AUTH_RETRY_MS = 60_000;

export class HaSocket {
  private conn: Connection | null = null;
  private nextId = 1;
  private authFailure: { at: number; error: Error } | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly factory: SocketFactory = (u) => new WebSocket(u) as unknown as SocketLike,
    private readonly timeoutMs = 20_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Connects and authenticates once; reconnects lazily after a drop. */
  connect(): Promise<void> {
    if (this.conn && (this.conn.socket.readyState === OPEN || !this.conn.authed)) return this.conn.ready;
    if (this.authFailure && this.now() - this.authFailure.at < AUTH_RETRY_MS) {
      return Promise.reject(this.authFailure.error);
    }
    let socket: SocketLike;
    try {
      socket = this.factory(this.url);
    } catch (e) {
      return Promise.reject(new Error(`Could not open a connection to Home Assistant: ${(e as Error).message}`));
    }
    this.conn = this.open(socket);
    return this.conn.ready;
  }

  private open(socket: SocketLike): Connection {
    const conn: Connection = { socket, ready: Promise.resolve(), authed: false, pending: new Map() };
    conn.ready = new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        this.forget(conn);
        reject(err);
      };
      const timer = setTimeout(() => {
        fail(new Error(`Home Assistant did not answer within ${this.timeoutMs / 1000}s.`));
        socket.close();
      }, this.timeoutMs);

      socket.onmessage = (ev) => {
        let msg: Incoming;
        try {
          msg = JSON.parse(String(ev.data)) as Incoming;
        } catch {
          return;
        }
        if (msg.type === "auth_required") {
          socket.send(JSON.stringify({ type: "auth", access_token: this.token }));
        } else if (msg.type === "auth_ok") {
          clearTimeout(timer);
          conn.authed = true;
          this.authFailure = null;
          settled = true;
          resolve();
        } else if (msg.type === "auth_invalid") {
          clearTimeout(timer);
          const err = new Error(`Home Assistant rejected the token (${msg.message ?? "auth_invalid"}).`);
          this.authFailure = { at: this.now(), error: err };
          fail(err);
          socket.close();
        } else if (msg.type === "result" && typeof msg.id === "number") {
          const p = conn.pending.get(msg.id);
          if (!p) return;
          conn.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.success) p.resolve(msg.result);
          else p.reject(Object.assign(new Error(msg.error?.message ?? "Home Assistant returned an error."), { code: msg.error?.code }));
        }
      };
      socket.onerror = () => {
        clearTimeout(timer);
        fail(new Error(`The connection to Home Assistant at ${hostOf(this.url)} failed.`));
      };
      socket.onclose = () => {
        clearTimeout(timer);
        fail(new Error("Home Assistant closed the connection before it was ready."));
        this.forget(conn);
        for (const p of conn.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("The connection to Home Assistant closed."));
        }
        conn.pending.clear();
      };
    });
    // A failed handshake is reported to whoever awaits it; don't also raise it
    // as an unhandled rejection.
    conn.ready.catch(() => {});
    return conn;
  }

  private forget(conn: Connection) {
    if (this.conn === conn) this.conn = null;
  }

  /** Sends one read command and resolves with its result. */
  async command<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    assertReadCommand(type);
    return this.send<T>(type, payload);
  }

  /** Sends one registry edit. Only the Apply step calls this. */
  async write<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    assertWriteCommand(type, payload);
    return this.send<T>(type, payload);
  }

  private async send<T>(type: string, payload: Record<string, unknown>): Promise<T> {
    await this.connect();
    const conn = this.conn;
    if (!conn || conn.socket.readyState !== OPEN) throw new Error("The connection to Home Assistant closed.");
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.pending.delete(id);
        reject(new Error(`Home Assistant did not answer "${type}" within ${this.timeoutMs / 1000}s.`));
        // A connection that stops answering may be half-open: drop it so the
        // next request starts a fresh one instead of waiting again.
        this.forget(conn);
        conn.socket.close();
      }, this.timeoutMs);
      conn.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      conn.socket.send(JSON.stringify({ ...payload, id, type }));
    });
  }

  close(): void {
    this.conn?.socket.close();
  }
}
