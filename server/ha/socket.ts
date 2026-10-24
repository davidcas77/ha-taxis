// Minimal Home Assistant WebSocket client.
// https://developers.home-assistant.io/docs/api/websocket
//
// Protocol: the server sends auth_required, we answer with the token, it
// replies auth_ok or auth_invalid. After that every command carries an id and
// gets exactly one {type:"result", id, success, result | error} back.
//
// This version of Taxis only reads, and that is enforced here rather than by
// convention: only the commands in READ_COMMANDS can be sent.

export const READ_COMMANDS = new Set([
  "get_config",
  "get_states",
  "config/floor_registry/list",
  "config/area_registry/list",
  "config/device_registry/list",
  "config/entity_registry/list",
  "config/label_registry/list",
]);

export function assertReadCommand(type: string): void {
  if (!READ_COMMANDS.has(type)) {
    throw new Error(`Refusing to send "${type}" to Home Assistant: this version of Taxis only reads.`);
  }
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
  error?: { message?: string };
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
          else p.reject(new Error(msg.error?.message ?? "Home Assistant returned an error."));
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
