// For tests: the fake Home Assistant (scripts/mock-ha-core.ts) wired to the
// interfaces the server uses, recording every call so a test can say what was
// read and, as important, what was NOT written. Not a test file itself, so
// vitest doesn't collect it.

import { buildMockRegistry, handleMock, handleMockRest, type MockHome } from "../../scripts/mock-ha-core.ts";
import { HaRest } from "../ha/rest.ts";
import { assertReadCommand, assertWriteCommand } from "../ha/socket.ts";
import type { RawRegistry } from "../model/hierarchy.ts";

export type WsCall = { kind: "read" | "write"; type: string; payload: Record<string, unknown> };
export type RestCall = { method: string; path: string; body: unknown; status: number };

export function fakeHa(home: MockHome = buildMockRegistry()) {
  const t = {
    home,
    ws: [] as WsCall[],
    rest: [] as RestCall[],
    // Called after every call has been answered, e.g. to change the house
    // between Taxis reading a config and writing it.
    after: null as null | ((call: { ws?: WsCall; rest?: RestCall }) => void),
    // Makes every call take a while, to see how many run at once.
    delayMs: 0,
    inFlight: 0,
    maxInFlight: 0,
    // A status to answer a REST request with instead of the fake's own.
    restStatus: null as null | ((method: string, path: string) => number | null),
    // Fails WebSocket reads of these types.
    failRead: new Set<string>(),
  };

  const track = async <T>(fn: () => T): Promise<T> => {
    t.inFlight += 1;
    t.maxInFlight = Math.max(t.maxInFlight, t.inFlight);
    try {
      if (t.delayMs) await new Promise((r) => setTimeout(r, t.delayMs));
      return fn();
    } finally {
      t.inFlight -= 1;
    }
  };

  const send = <T>(kind: "read" | "write", type: string, payload: Record<string, unknown>): Promise<T> =>
    track(() => {
      // The same guards the real client has.
      if (kind === "read") assertReadCommand(type);
      else assertWriteCommand(type);
      const call: WsCall = { kind, type, payload };
      t.ws.push(call);
      if (t.failRead.has(type)) throw new Error(`forced failure of ${type}`);
      const reply = handleMock(home, type, payload);
      t.after?.({ ws: call });
      if (!reply.success) {
        throw Object.assign(new Error(reply.message), { code: reply.message === "No config found." ? "config_not_found" : "invalid_info" });
      }
      return reply.result as T;
    });

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    return track(() => {
      const forced = t.restStatus?.(method, url.pathname) ?? null;
      const reply = forced === null ? handleMockRest(home, method, url.pathname, body) : { status: forced, body: { message: `forced ${forced}` } };
      const call: RestCall = { method, path: url.pathname, body, status: reply.status };
      t.rest.push(call);
      t.after?.({ rest: call });
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
    });
  }) as typeof fetch;

  return Object.assign(t, {
    ha: {
      command: <T>(type: string, payload: Record<string, unknown> = {}) => send<T>("read", type, payload),
      write: <T>(type: string, payload: Record<string, unknown> = {}) => send<T>("write", type, payload),
    },
    api: new HaRest("http://ha.test/api", "secret-token", fetchImpl),
    fetchImpl,
    readFresh: async () => structuredClone(home) as RawRegistry,
    /** Every write made so far: registry edits and dashboards, and REST posts. */
    writes: () => ({ ws: t.ws.filter((c) => c.kind === "write"), rest: t.rest.filter((c) => c.method !== "GET") }),
  });
}
