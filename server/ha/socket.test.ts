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

const blueprint = (over: Record<string, unknown> = {}) => ({ domain: "automation", path: "taxis/occupancy.yaml", yaml: "blueprint: {}\n", allow_override: true, ...over });

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const week = (over: Record<string, unknown> = {}) => ({ ...Object.fromEntries(DAYS.map((d) => [d, []])), monday: [{ from: "06:30:00", to: "08:30:00" }], ...over });
const schedule = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ name: "Living room climate", ...week(), ...over });
const scheduleUpdate = (over: Record<string, unknown> = {}): Record<string, unknown> => schedule({ schedule_id: "living_room_climate", ...over });
const payloadFor = (t: string) => (t === "blueprint/save" ? blueprint() : t === "schedule/create" ? schedule() : t === "schedule/update" ? scheduleUpdate() : {});

describe("read-only guard", () => {
  it("allows only registry and state reads", () => {
    for (const t of READ_COMMANDS) expect(() => assertReadCommand(t)).not.toThrow();
    for (const t of ["call_service", "config/area_registry/create", "config/entity_registry/update", "config/device_registry/remove_config_entry"]) {
      expect(() => assertReadCommand(t)).toThrow(/isn.t a read/);
    }
  });

  it("reads the list of integrations, and no other command for config entries", () => {
    expect(READ_COMMANDS.has("config_entries/get")).toBe(true);
    for (const t of ["config_entries/delete", "config_entries/disable", "config_entries/update", "config_entries/reload", "config_entries/flow/progress", "config_entries/subentries/list"]) {
      expect(READ_COMMANDS.has(t), t).toBe(false);
      expect(() => assertReadCommand(t), t).toThrow(/isn.t a read/);
      expect(WRITE_COMMANDS.has(t), t).toBe(false);
    }
  });

  it("write() sends only registry edits: no services, no removing devices or entities", async () => {
    const ha = fakeHa();
    const client = new HaSocket("ws://x", "good", ha.factory);
    for (const t of ["call_service", "config/entity_registry/remove", "config/device_registry/remove_config_entry", "get_states"]) {
      await expect(client.write(t, {})).rejects.toThrow(/doesn't make that change/);
    }
    expect(ha.opened()).toBe(0);
    for (const t of WRITE_COMMANDS) expect(() => assertWriteCommand(t, payloadFor(t))).not.toThrow();
  });

  it("never deletes a device or an entity: deletes are only for floors, areas, labels and categories", () => {
    const removals = [...WRITE_COMMANDS].filter((t) => /(^|\/)(delete|remove)/.test(t));
    expect(removals.sort()).toEqual([
      "config/area_registry/delete",
      "config/category_registry/delete",
      "config/floor_registry/delete",
      "config/label_registry/delete",
    ]);
    // A device or entity registry command may only update.
    const registry = [...WRITE_COMMANDS].filter((t) => t.startsWith("config/device_registry/") || t.startsWith("config/entity_registry/"));
    expect(registry.sort()).toEqual(["config/device_registry/update", "config/entity_registry/update"]);
    // The usual names for taking a device or entity out of Home Assistant stay refused.
    for (const t of ["config/device_registry/remove_config_entry", "config/device_registry/delete", "config/device_registry/remove", "config/entity_registry/remove", "config/entity_registry/delete", "config/entity_registry/remove_orphaned", "config_entries/delete", "call_service"]) {
      expect(WRITE_COMMANDS.has(t), t).toBe(false);
      expect(() => assertWriteCommand(t), t).toThrow(/doesn't make that change/);
    }
  });

  it("allows the recipe writes and the blueprint read, and no other timer, helper or blueprint command", () => {
    for (const t of ["blueprint/save", "timer/create", "timer/update", "input_boolean/create", "schedule/create", "schedule/update"]) expect(WRITE_COMMANDS.has(t), t).toBe(true);
    expect(READ_COMMANDS.has("blueprint/list")).toBe(true);
    // The writes and reads recipes add are exactly these, and nothing next to them.
    for (const t of ["blueprint/delete", "blueprint/import", "blueprint/substitute", "timer/delete", "timer/start", "timer/list", "input_boolean/delete", "input_boolean/update", "input_number/create", "input_select/create", "input_datetime/create", "schedule/delete", "schedule/list", "counter/create"]) {
      expect(WRITE_COMMANDS.has(t), t).toBe(false);
      expect(READ_COMMANDS.has(t), t).toBe(false);
      expect(() => assertWriteCommand(t)).toThrow(/doesn't make that change/);
    }
  });

  it("saves a blueprint for the automation domain at taxis/<name>.yaml, and for the script domain at taxis/announce.yaml only", () => {
    expect(() => assertWriteCommand("blueprint/save", blueprint())).not.toThrow();
    expect(() => assertWriteCommand("blueprint/save", blueprint({ source_url: "https://example.test/x.yaml", allow_override: false }))).not.toThrow();
    for (const domain of ["template", "Automation", "Script", "scene", "", undefined, null, ["automation"], ["script"]]) {
      expect(() => assertWriteCommand("blueprint/save", blueprint({ domain })), String(domain)).toThrow(/automation blueprints, and one script blueprint/);
    }
    // The one script blueprint, and nowhere else.
    expect(() => assertWriteCommand("blueprint/save", blueprint({ domain: "script", path: "taxis/announce.yaml" }))).not.toThrow();
    for (const path of ["taxis/occupancy.yaml", "taxis/announce2.yaml", "taxis/other.yaml", "taxis/a.yaml"]) {
      expect(() => assertWriteCommand("blueprint/save", blueprint({ domain: "script", path })), path).toThrow(/the only script blueprint Taxis writes is taxis\/announce\.yaml/);
    }
    // ...and announce is not an automation blueprint.
    expect(() => assertWriteCommand("blueprint/save", blueprint({ domain: "automation", path: "taxis/announce.yaml" }))).toThrow(/the only script blueprint/);
    expect(() => assertWriteCommand("blueprint/save", blueprint({ domain: "script", path: "taxis/../announce.yaml" }))).toThrow(/only to taxis/);
    expect(() => assertWriteCommand("blueprint/save", blueprint({ domain: "script", path: "other/announce.yaml" }))).toThrow(/only to taxis/);
    const paths = [
      "other/x.yaml",
      "x.yaml",
      "taxis/x.yml",
      "taxis/X.yaml",
      "taxis/sub/x.yaml",
      "taxis/../x.yaml",
      "../taxis/x.yaml",
      "/taxis/x.yaml",
      "taxis/x.yaml/",
      "taxis/x.yaml\n",
      "taxis/ x.yaml",
      "taxis\\x.yaml",
      "homeassistant/motion_light.yaml",
      "",
      undefined,
      null,
      42,
    ];
    for (const path of paths) expect(() => assertWriteCommand("blueprint/save", blueprint({ path })), String(path)).toThrow(/only to taxis/);
    // No text, or far too much of it.
    expect(() => assertWriteCommand("blueprint/save", blueprint({ yaml: "" }))).toThrow(/no text or too much/);
    expect(() => assertWriteCommand("blueprint/save", blueprint({ yaml: undefined }))).toThrow(/no text or too much/);
    expect(() => assertWriteCommand("blueprint/save", blueprint({ yaml: "x".repeat(64 * 1024 + 1) }))).toThrow(/no text or too much/);
    // Nothing else rides along, and it needs a payload at all.
    expect(() => assertWriteCommand("blueprint/save", blueprint({ extra: 1 }))).toThrow(/isn't something Taxis sends/);
    expect(() => assertWriteCommand("blueprint/save")).toThrow(/automation blueprints, and one script blueprint/);
  });

  it("write() checks a blueprint's payload before anything is sent", async () => {
    const ha = fakeHa();
    const client = new HaSocket("ws://x", "good", ha.factory);
    await expect(client.write("blueprint/save", blueprint({ domain: "scene" }))).rejects.toThrow(/automation blueprints, and one script blueprint/);
    await expect(client.write("blueprint/save", blueprint({ domain: "script" }))).rejects.toThrow(/only script blueprint/);
    await expect(client.write("blueprint/save", blueprint({ path: "taxis/../../x.yaml" }))).rejects.toThrow(/only to taxis/);
    expect(ha.opened()).toBe(0);
    await client.write("blueprint/save", blueprint());
    expect(ha.sent.at(-1)).toMatchObject({ type: "blueprint/save", domain: "automation", path: "taxis/occupancy.yaml", allow_override: true });
  });

  it("makes and updates a schedule with a name, an optional icon and seven days of from/to times, and nothing else", () => {
    expect(() => assertWriteCommand("schedule/create", schedule())).not.toThrow();
    expect(() => assertWriteCommand("schedule/create", schedule({ icon: "mdi:radiator" }))).not.toThrow();
    expect(() => assertWriteCommand("schedule/update", scheduleUpdate())).not.toThrow();
    // Several periods in a day, touching ones too.
    expect(() => assertWriteCommand("schedule/create", schedule({ friday: [{ from: "06:30:00", to: "08:30:00" }, { from: "17:00:00", to: "23:59:00" }] }))).not.toThrow();

    // An id belongs to an update, never a creation; an update needs one.
    expect(() => assertWriteCommand("schedule/create", scheduleUpdate())).toThrow(/with an id/);
    const { schedule_id: _id, ...noId } = scheduleUpdate();
    expect(() => assertWriteCommand("schedule/update", noId)).toThrow(/without saying which/);
    expect(() => assertWriteCommand("schedule/update", scheduleUpdate({ schedule_id: "../x" }))).toThrow(/without saying which/);

    // The name and the icon.
    for (const name of ["", "  ", undefined, 5, "x".repeat(256)]) expect(() => assertWriteCommand("schedule/create", schedule({ name })), String(name)).toThrow(/no name/);
    for (const icon of ["radiator", "MDI:x", 5, ""]) expect(() => assertWriteCommand("schedule/create", schedule({ icon })), String(icon)).toThrow(/icon/);

    // Nothing else rides along: not in the payload, not in a period.
    expect(() => assertWriteCommand("schedule/create", schedule({ extra: 1 }))).toThrow(/isn't something Taxis sends/);
    expect(() => assertWriteCommand("schedule/create", schedule({ monday: [{ from: "06:30:00", to: "08:30:00", data: { x: 1 } }] }))).toThrow(/from\/to times/);

    // All seven days, each a short list of well-formed periods that end after they start.
    const { sunday: _sunday, ...short } = schedule();
    expect(() => assertWriteCommand("schedule/create", short)).toThrow(/sunday/);
    expect(() => assertWriteCommand("schedule/create", schedule({ sunday: "none" }))).toThrow(/sunday/);
    expect(() => assertWriteCommand("schedule/create", schedule({ sunday: Array.from({ length: 9 }, () => ({ from: "01:00:00", to: "02:00:00" })) }))).toThrow(/short list/);
    for (const bad of [
      { from: "6:30:00", to: "08:30:00" },
      { from: "06:30", to: "08:30" },
      { from: "06:30:00", to: "24:00:00" },
      { from: "08:30:00", to: "06:30:00" },
      { from: "08:30:00", to: "08:30:00" },
      { from: "08:30:30", to: "09:30:00" },
      { from: 1, to: 2 },
      null,
      "06:30-08:30",
    ]) {
      expect(() => assertWriteCommand("schedule/create", schedule({ tuesday: [bad] })), JSON.stringify(bad)).toThrow(/from\/to times/);
    }
  });

  it("write() checks a schedule's payload before anything is sent", async () => {
    const ha = fakeHa();
    const client = new HaSocket("ws://x", "good", ha.factory);
    await expect(client.write("schedule/create", schedule({ extra: 1 }))).rejects.toThrow(/isn't something Taxis sends/);
    await expect(client.write("schedule/update", schedule())).rejects.toThrow(/without saying which/);
    expect(ha.opened()).toBe(0);
    await client.write("schedule/create", schedule());
    expect(ha.sent.at(-1)).toMatchObject({ type: "schedule/create", name: "Living room climate" });
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

describe("allowlists for renames", () => {
  it("reads: where an entity is used, and dashboards; never a dashboard save", () => {
    for (const t of ["search/related", "lovelace/dashboards/list", "lovelace/config", "lovelace/info"]) expect(() => assertReadCommand(t)).not.toThrow();
    for (const t of ["lovelace/config/save", "lovelace/config/delete", "lovelace/dashboards/create", "lovelace/dashboards/delete", "call_service"]) {
      expect(() => assertReadCommand(t)).toThrow(/isn.t a read/);
    }
  });

  it("writes: a dashboard's contents can be saved, never deleted or created; services are never called", async () => {
    expect(() => assertWriteCommand("lovelace/config/save")).not.toThrow();
    const ha = fakeHa();
    const client = new HaSocket("ws://x", "good", ha.factory);
    for (const t of ["lovelace/config/delete", "lovelace/dashboards/create", "lovelace/dashboards/delete", "lovelace/config", "search/related", "call_service", "config/entity_registry/remove", "config/automation/delete"]) {
      await expect(client.write(t, {})).rejects.toThrow(/doesn't make that change/);
    }
    expect(ha.opened()).toBe(0);
    // And the only entity change a rename needs is the update that is already allowed.
    expect(WRITE_COMMANDS.has("config/entity_registry/update")).toBe(true);
    expect([...WRITE_COMMANDS].filter((t) => /remove|delete/.test(t) && !/^config\/(floor|area|label|category)_registry\/delete$/.test(t))).toEqual([]);
  });

  it("keeps Home Assistant's error code on a rejected command, so 'no config found' can be told apart", async () => {
    const ha = fakeHa({ answer: (m) => ({ type: "result", id: m.id, success: false, error: { code: "config_not_found", message: "No config found." } }) });
    const client = new HaSocket("ws://x", "good", ha.factory);
    const error = await client.command("lovelace/config", { url_path: "auto" }).catch((e: Error) => e);
    expect(error).toMatchObject({ message: "No config found.", code: "config_not_found" });
  });
});
