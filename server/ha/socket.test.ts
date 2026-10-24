import { describe, expect, it } from "vitest";

import { HaSocket, READ_COMMANDS, WRITE_COMMANDS, assertReadCommand, assertWriteCommand, type SocketLike } from "./socket.ts";

// A fake Home Assistant on the other end of the socket. `answer` decides how it
// replies to each command; everything sent is recorded.
function fakeHa(opts: { token?: string; answer?: (msg: { id: number; type: string }) => unknown } = {}) {
  const sent: Record<string, unknown>[] = [];
  let opened = 0;
  const factory = () => {
    opened += 1;
    const sock: SocketLike = {
      readyState: 1,
      send(data) {
        const msg = JSON.parse(data) as Record<string, unknown>;
        sent.push(msg);
        queueMicrotask(() => {
          if (msg.type === "auth") {
            const ok = msg.access_token === (opts.token ?? "good");
            sock.onmessage?.({ data: JSON.stringify(ok ? { type: "auth_ok" } : { type: "auth_invalid", message: "Invalid access token" }) });
            if (!ok) sock.onclose?.({});
            return;
          }
          const reply = opts.answer?.(msg as { id: number; type: string }) ?? { type: "result", id: msg.id, success: true, result: [] };
          sock.onmessage?.({ data: JSON.stringify(reply) });
        });
      },
      close() {
        this.readyState = 3;
        this.onclose?.({});
      },
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };
    queueMicrotask(() => sock.onmessage?.({ data: JSON.stringify({ type: "auth_required" }) }));
    return sock;
  };
  return { factory, sent, opened: () => opened };
}

describe("read-only guard", () => {
  it("allows only registry and state reads", () => {
    for (const t of READ_COMMANDS) expect(() => assertReadCommand(t)).not.toThrow();
    for (const t of ["call_service", "config/area_registry/create", "config/entity_registry/update", "config/device_registry/remove_config_entry"]) {
      expect(() => assertReadCommand(t)).toThrow(/isn.t a read/);
    }
  });

  it("write() sends only registry edits: no services, no removing devices or entities", async () => {
    const ha = fakeHa();
    const client = new HaSocket("ws://x", "good", ha.factory);
    for (const t of ["call_service", "config/entity_registry/remove", "config/device_registry/remove_config_entry", "get_states"]) {
      await expect(client.write(t, {})).rejects.toThrow(/doesn't make that change/);
    }
    expect(ha.opened()).toBe(0);
    for (const t of WRITE_COMMANDS) expect(() => assertWriteCommand(t)).not.toThrow();
  });

  it("refuses a write command before anything is sent", async () => {
    const ha = fakeHa();
    const client = new HaSocket("ws://x", "good", ha.factory);
    await expect(client.command("call_service", { domain: "light" })).rejects.toThrow(/isn.t a read/);
    expect(ha.opened()).toBe(0);
  });
});

describe("HaSocket", () => {
  it("authenticates with the token, then sends commands with increasing ids", async () => {
    const ha = fakeHa({
      answer: (m) => ({ type: "result", id: m.id, success: true, result: { echo: m.type } }),
    });
    const client = new HaSocket("ws://x", "good", ha.factory);
    const [a, b] = await Promise.all([client.command("get_config"), client.command("get_states")]);
    expect(a).toEqual({ echo: "get_config" });
    expect(b).toEqual({ echo: "get_states" });
    expect(ha.sent[0]).toEqual({ type: "auth", access_token: "good" });
    expect(ha.sent.slice(1).map((m) => m.id)).toEqual([1, 2]);
    expect(ha.opened()).toBe(1);
  });

  it("rejects with a clear message when the token is wrong", async () => {
    const ha = fakeHa();
    const client = new HaSocket("ws://x", "bad", ha.factory);
    await expect(client.command("get_config")).rejects.toThrow(/rejected the token/);
  });

  it("surfaces Home Assistant's error message", async () => {
    const ha = fakeHa({ answer: (m) => ({ type: "result", id: m.id, success: false, error: { code: "unknown_command", message: "Unknown command." } }) });
    const client = new HaSocket("ws://x", "good", ha.factory);
    await expect(client.command("get_config")).rejects.toThrow("Unknown command.");
  });

  it("times out a command Home Assistant never answers", async () => {
    const ha = fakeHa({ answer: () => ({ type: "event" }) });
    const client = new HaSocket("ws://x", "good", ha.factory, 50);
    await expect(client.command("get_states")).rejects.toThrow(/did not answer "get_states"/);
  });

  it("a late close from an old socket doesn't fail commands on the new one", async () => {
    // Socket 1 never finishes the handshake; its close arrives after socket 2 is up.
    const sockets: SocketLike[] = [];
    const factory = () => {
      const index = sockets.length;
      const sock: SocketLike = {
        readyState: 1,
        send(data) {
          const msg = JSON.parse(data) as { type: string; id: number };
          if (index === 0) return; // the slow, stuck connection
          if (msg.type === "auth") {
            queueMicrotask(() => sock.onmessage?.({ data: JSON.stringify({ type: "auth_ok" }) }));
          } else {
            // Answer only after socket 1's late close (30 ms) has arrived.
            setTimeout(() => sock.onmessage?.({ data: JSON.stringify({ type: "result", id: msg.id, success: true, result: "ok" }) }), 50);
          }
        },
        close() {
          // closing is acknowledged later, as a real socket does
          this.readyState = 3;
          setTimeout(() => sock.onclose?.({}), 30);
        },
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
      };
      sockets.push(sock);
      queueMicrotask(() => sock.onmessage?.({ data: JSON.stringify({ type: "auth_required" }) }));
      return sock;
    };
    const client = new HaSocket("ws://x", "good", factory, 100);
    await expect(client.command("get_config")).rejects.toThrow(/did not answer within/);
    // Socket 1's close is still in flight when the next request opens socket 2.
    const result = client.command("get_states");
    await expect(result).resolves.toBe("ok");
    await new Promise((r) => setTimeout(r, 80));
    expect(sockets).toHaveLength(2);
  });

  it("drops a connection that stops answering, so the next request starts fresh", async () => {
    let calls = 0;
    const ha = fakeHa({
      answer: (m) => {
        calls += 1;
        return calls === 1 ? { type: "event" } : { type: "result", id: m.id, success: true, result: "fresh" };
      },
    });
    const client = new HaSocket("ws://x", "good", ha.factory, 50);
    await expect(client.command("get_states")).rejects.toThrow(/did not answer/);
    await expect(client.command("get_states")).resolves.toBe("fresh");
    expect(ha.opened()).toBe(2);
  });

  it("doesn't retry a rejected token right away, to stay clear of Home Assistant's IP ban", async () => {
    let now = 1_000_000;
    const ha = fakeHa();
    const client = new HaSocket("ws://x", "bad", ha.factory, 20_000, () => now);
    await expect(client.command("get_config")).rejects.toThrow(/rejected the token/);
    await expect(client.command("get_config")).rejects.toThrow(/rejected the token/);
    expect(ha.opened()).toBe(1);
    now += 61_000;
    await expect(client.command("get_config")).rejects.toThrow(/rejected the token/);
    expect(ha.opened()).toBe(2);
  });

  it("reconnects after the connection drops", async () => {
    const ha = fakeHa();
    const client = new HaSocket("ws://x", "good", ha.factory);
    await client.command("get_config");
    client.close();
    await client.command("get_config");
    expect(ha.opened()).toBe(2);
  });
});
