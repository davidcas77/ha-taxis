import { afterEach, describe, expect, it, vi } from "vitest";

import { buildMockRegistry } from "../scripts/mock-ha-core.ts";
import type { ApplyResponse, ChangeInput, ChangesResponse } from "../shared/types.ts";
import { createApp } from "./app.ts";
import { applyHistory } from "./changes/history.ts";
import { changeStore } from "./changes/store.ts";
import type { AppDeps } from "./context.ts";
import { backupHomeAssistant } from "./ha/supervisor.ts";
import { testStore } from "./ai/test-store.ts";
import { fakeHa } from "./references/fake-ha.ts";
import { settingsStore } from "./settings.ts";

// The HTTP app, end to end, against the fake Home Assistant: the Apply route and
// what guards it. Each test says what was written to Home Assistant as well as
// what came back, because "nothing was written" is the property that matters.

const TOKEN = "supervisor-secret-token-123";
const INGRESS = { incoming: { socket: { remoteAddress: "172.30.32.2" } } };

const AREA_RENAME: ChangeInput = { kind: "area", op: "update", targetId: "kitchen", fields: { name: "Cooking" } };
const OTHER_RENAME: ChangeInput = { kind: "area", op: "update", targetId: "study", fields: { name: "Office" } };

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

type Backup = AppDeps["backup"];

function setup(options: { mode?: "app" | "dev"; backup?: Backup; configured?: boolean } = {}) {
  const mode = options.mode ?? "dev";
  const { store, close } = testStore();
  cleanups.push(close);
  const fake = fakeHa(buildMockRegistry());
  const settings = settingsStore(store.db);
  const changes = changeStore(store.db);
  const history = applyHistory(store.db);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const snapshots: unknown[] = [];
  const backupNames: string[] = [];
  const backup: Backup = options.backup ?? (async (name) => ({ ok: true, name, slug: "slug1" }));
  const configured = options.configured ?? true;

  const app = createApp({
    mode,
    version: "test",
    target: configured
      ? { ok: true, target: { wsUrl: "ws://ha.test/api/websocket", restUrl: "http://ha.test/api", token: TOKEN, mode } }
      : { ok: false, reason: "HA_URL and HA_TOKEN are not set." },
    ha: configured ? fake.ha : null,
    rest: configured ? fake.api : null,
    backup: async (name) => {
      backupNames.push(name);
      return backup(name);
    },
    db: store.db,
    settings,
    changes,
    history,
    saveSnapshot: (input) => snapshots.push(input),
    clock: Date.now,
    logger,
    webRoot: null,
  });

  // App mode answers only Ingress, so its requests carry that peer.
  const env = mode === "app" ? INGRESS : undefined;
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(
      path,
      {
        method,
        headers: { "x-taxis-request": "1", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
  const post = (path: string, body?: unknown) => call("POST", path, body ?? {});
  const get = (path: string) => call("GET", path);

  const queue = async (input: ChangeInput) => {
    const res = await post("/api/changes", input);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    return (await res.json()) as ChangesResponse & { ok: true };
  };
  const version = () => changes.version();
  const apply = async (body: Record<string, unknown> = {}) => {
    const res = await post("/api/apply", { version: version(), ...body });
    return { status: res.status, body: (await res.json()) as ApplyResponse };
  };
  const writeTypes = () => fake.writes().ws.map((w) => w.type);

  return { app, fake, changes, history, settings, logger, snapshots, backupNames, call, get, post, queue, apply, version, writeTypes, env, store };
}

const nothingWritten = (t: ReturnType<typeof setup>) => {
  expect(t.fake.writes()).toEqual({ ws: [], rest: [] });
};

describe("Apply in app mode (a backup comes first)", () => {
  it("backs up, applies, returns the results and clears what was done", async () => {
    const t = setup({ mode: "app" });
    await t.queue(AREA_RENAME);

    const { status, body } = await t.apply();

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.backup).toEqual({ made: true, name: "Taxis before applying 1 change", slug: "slug1" });
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ ok: true, status: "verified" });
    expect(t.backupNames).toEqual(["Taxis before applying 1 change"]);
    expect(t.writeTypes()).toEqual(["config/area_registry/update"]);
    expect(t.fake.home.areas.find((a) => a.area_id === "kitchen")?.name).toBe("Cooking");
    // The done change left the list, and the run is on record.
    expect(t.changes.list()).toEqual([]);
    expect(t.history.runs()[0]).toMatchObject({ status: "completed", backup: { made: true, slug: "slug1" } });
  });

  it("does not write anything when the backup fails", async () => {
    const t = setup({ mode: "app", backup: async () => ({ ok: false, reason: "The Supervisor didn't make the backup (HTTP 500)." }) });
    await t.queue(AREA_RENAME);

    const { status, body } = await t.apply();

    expect(status).toBe(502);
    expect(body).toEqual({ ok: false, error: "Nothing was changed. The Supervisor didn't make the backup (HTTP 500)." });
    nothingWritten(t);
    expect(t.changes.list()).toHaveLength(1);
    expect(t.history.runs()[0]).toMatchObject({ status: "failed" });
  });

  it("does not write anything when the Supervisor can't be reached", async () => {
    const down = (async () => {
      throw new Error(`connect ECONNREFUSED (Authorization: Bearer ${TOKEN})`);
    }) as unknown as typeof fetch;
    const t = setup({ mode: "app", backup: (name) => backupHomeAssistant(TOKEN, name, down) });
    await t.queue(AREA_RENAME);

    const { status, body } = await t.apply();

    expect(status).toBe(502);
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toMatch(/Couldn't reach the Supervisor/);
    // The token never reaches the browser, even when the failing call repeated it.
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    nothingWritten(t);
    expect(t.changes.list()).toHaveLength(1);
  });

  it("does not write anything when the backup times out", async () => {
    const hang = (async (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })) as typeof fetch;
    const t = setup({ mode: "app", backup: (name) => backupHomeAssistant(TOKEN, name, hang, 20) });
    await t.queue(AREA_RENAME);

    const { status, body } = await t.apply();

    expect(status).toBe(502);
    expect(body.ok).toBe(false);
    nothingWritten(t);
    expect(t.changes.list()).toHaveLength(1);
  });

  it("ignores allowWithoutBackup: the backup is required", async () => {
    const t = setup({ mode: "app", backup: async () => ({ ok: false, reason: "no" }) });
    await t.queue(AREA_RENAME);
    const { status } = await t.apply({ allowWithoutBackup: true });
    expect(status).toBe(502);
    nothingWritten(t);
  });
});

describe("Apply in dev mode (no Supervisor)", () => {
  it("asks for explicit confirmation and writes nothing without it", async () => {
    const t = setup({ mode: "dev" });
    await t.queue(AREA_RENAME);

    const { status, body } = await t.apply();

    expect(status).toBe(409);
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toMatch(/Confirm to apply without one/);
    expect(t.backupNames).toEqual([]);
    nothingWritten(t);
    expect(t.changes.list()).toHaveLength(1);
  });

  it("applies when the user confirms, and says no backup was made", async () => {
    const t = setup({ mode: "dev" });
    await t.queue(AREA_RENAME);

    const { status, body } = await t.apply({ allowWithoutBackup: true });

    expect(status).toBe(200);
    expect(body.ok && body.backup).toMatchObject({ made: false });
    expect(t.backupNames).toEqual([]);
    expect(t.writeTypes()).toEqual(["config/area_registry/update"]);
    expect(t.changes.list()).toEqual([]);
  });
});

describe("what Apply refuses before it writes", () => {
  it("refuses a list that changed since the user looked (wrong or missing version)", async () => {
    const t = setup();
    await t.queue(AREA_RENAME);

    const stale = await t.post("/api/apply", { version: "0000000000000000", allowWithoutBackup: true });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: string }).error).toMatch(/changed since you looked/);

    const missing = await t.post("/api/apply", { allowWithoutBackup: true });
    expect(missing.status).toBe(409);

    nothingWritten(t);
    expect(t.changes.list()).toHaveLength(1);
  });

  it("refuses when there is nothing to apply", async () => {
    const t = setup();
    const { status, body } = await t.apply({ allowWithoutBackup: true });
    expect(status).toBe(400);
    expect(body.ok === false && body.error).toMatch(/no changes/);
    nothingWritten(t);
  });

  it("says so when Home Assistant is not configured", async () => {
    const t = setup({ configured: false });
    const res = await t.post("/api/apply", { version: "x" });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("HA_URL and HA_TOKEN are not set.");
  });

  describe("`only` must be a short list of integers", () => {
    const bad: [string, unknown][] = [
      ["not an array", "1"],
      ["an object", { 0: 1 }],
      ["empty", []],
      ["more than 500", Array.from({ length: 501 }, (_, i) => i + 1)],
      ["a non-integer", [1.5]],
      ["a string id", ["1"]],
      ["null", null],
    ];
    for (const [name, only] of bad) {
      it(`rejects ${name} with 400 and writes nothing`, async () => {
        const t = setup();
        await t.queue(AREA_RENAME);
        const res = await t.post("/api/apply", { version: t.version(), allowWithoutBackup: true, only });
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toMatch(/weren't readable/);
        nothingWritten(t);
        expect(t.changes.list()).toHaveLength(1);
      });
    }

    it("accepts exactly 500 ids (ids that match nothing apply nothing)", async () => {
      const t = setup();
      await t.queue(AREA_RENAME);
      const res = await t.post("/api/apply", { version: t.version(), allowWithoutBackup: true, only: Array.from({ length: 500 }, (_, i) => i + 1000) });
      // Valid shape, but none of them is in the list.
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/no changes to apply/);
      nothingWritten(t);
    });
  });

  it("stops before the backup and before any write when the naming preflight fails", async () => {
    const t = setup({ mode: "app" });
    // A helper planned while the area codes were fine...
    await t.queue({
      kind: "helper",
      op: "create",
      fields: {
        helper: "group",
        group_type: "light",
        name: "Living zone lights",
        entity_id: "light.living_zone_all",
        entities: ["light.living_spots"],
        area_id: "living_room",
      },
    });
    // ...then Home Assistant gains a second area whose inferred code is the same.
    t.fake.home.areas.push({ area_id: "living_annex", name: "Living annex" });
    t.fake.home.entities.push({ entity_id: "light.living_side_lamp", area_id: "living_annex", platform: "demo" });

    const { status, body } = await t.apply();

    expect(status).toBe(409);
    expect(body.ok === false && body.error).toMatch(/duplicate area codes/);
    expect(t.backupNames).toEqual([]);
    nothingWritten(t);
    expect(t.changes.list()).toHaveLength(1);
    expect(t.history.runs()[0]).toMatchObject({ status: "failed" });
  });
});

describe("`only`", () => {
  it("applies just those changes and leaves the rest pending", async () => {
    const t = setup();
    await t.queue(AREA_RENAME);
    await t.queue(OTHER_RENAME);
    const [first, second] = t.changes.list();

    const { status, body } = await t.apply({ allowWithoutBackup: true, only: [first.id] });

    expect(status).toBe(200);
    expect(body.ok && body.results.map((r) => r.changeId)).toEqual([first.id]);
    expect(t.fake.home.areas.find((a) => a.area_id === "kitchen")?.name).toBe("Cooking");
    expect(t.fake.home.areas.find((a) => a.area_id === "study")?.name).not.toBe("Office");
    expect(t.fake.writes().ws).toHaveLength(1);
    expect(t.changes.list().map((c) => c.id)).toEqual([second.id]);
  });

  it("brings along the change it needs (a device moved into a new area)", async () => {
    const t = setup();
    await t.queue({ kind: "area", op: "create", fields: { name: "Games room", floor_id: "ground" } });
    const area = t.changes.list()[0];
    await t.queue({ kind: "device", op: "update", targetId: "hub", fields: { area_id: area.targetId } });
    await t.queue(OTHER_RENAME);
    const move = t.changes.list().find((c) => c.kind === "device")!;
    const unrelated = t.changes.list().find((c) => c.targetId === "study")!;

    const { status, body } = await t.apply({ allowWithoutBackup: true, only: [move.id] });

    expect(status).toBe(200);
    expect(body.ok && body.results.map((r) => r.changeId).sort()).toEqual([area.id, move.id].sort());
    expect(t.writeTypes()).toEqual(["config/area_registry/create", "config/device_registry/update"]);
    expect(t.changes.list().map((c) => c.id)).toEqual([unrelated.id]);
  });
});

describe("a mixed list, checked with partial reads", () => {
  it("renames an entity (and what uses it), creates a group, and verifies each step", async () => {
    const t = setup();
    await t.queue({ kind: "entity", op: "update", targetId: "light.desk", fields: { new_entity_id: "light.study_desk" } });
    await t.queue({
      kind: "helper",
      op: "create",
      fields: { helper: "group", group_type: "light", name: "Study lights", entity_id: "light.study_all", entities: ["light.desk"], area_id: "study" },
    });

    const { status, body } = await t.apply({ allowWithoutBackup: true });

    expect(status).toBe(200);
    expect(body.ok && body.results.map((r) => r.ok), JSON.stringify(body)).toEqual([true, true]);
    expect(t.fake.home.entities.some((e) => e.entity_id === "light.study_desk")).toBe(true);
    expect(t.fake.home.entities.some((e) => e.entity_id === "light.study_all")).toBe(true);
    expect(t.changes.list()).toEqual([]);
    // Every check read only the part of Home Assistant it looks at. The home's
    // name and version come only with a full read: one when the changes were
    // queued, one that ends the Apply.
    expect(t.fake.ws.filter((c) => c.type === "get_config")).toHaveLength(1 + 1);
  });
});

describe("one Apply at a time", () => {
  it("refuses a second Apply, and edits to the list, while one is running", async () => {
    // The first Apply waits in its backup until the test lets it go.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const t = setup({
      mode: "app",
      backup: async (name) => {
        await held;
        return { ok: true, name, slug: "late" };
      },
    });
    await t.queue(AREA_RENAME);
    const version = t.version();

    const first = t.post("/api/apply", { version });
    await vi.waitFor(() => expect(t.backupNames).toHaveLength(1));

    const second = await t.post("/api/apply", { version });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toMatch(/already being applied/);

    const edit = await t.post("/api/changes", OTHER_RENAME);
    expect(edit.status).toBe(409);
    const discard = await t.call("DELETE", "/api/changes");
    expect(discard.status).toBe(409);
    expect(t.changes.list()).toHaveLength(1);
    nothingWritten(t);

    release();
    const done = await first;
    expect(done.status).toBe(200);
    expect(t.writeTypes()).toEqual(["config/area_registry/update"]);

    // The lock is released: a new edit is accepted again.
    const again = await t.post("/api/changes", OTHER_RENAME);
    expect(again.status).toBe(200);
  });

  it("releases the lock after a failed Apply", async () => {
    const t = setup({ mode: "app", backup: async () => ({ ok: false, reason: "no" }) });
    await t.queue(AREA_RENAME);
    expect((await t.apply()).status).toBe(502);
    expect((await t.post("/api/changes", OTHER_RENAME)).status).toBe(200);
  });
});

describe("adding several changes at once", () => {
  const MISSING: ChangeInput = { kind: "area", op: "update", targetId: "no_such_area", fields: { name: "Nowhere" } };
  const batch = (t: ReturnType<typeof setup>, changes: unknown) => t.post("/api/changes/batch", { changes });

  it("stores them all, folded like one-by-one edits", async () => {
    const t = setup();
    const res = await batch(t, [AREA_RENAME, OTHER_RENAME, { kind: "area", op: "update", targetId: "kitchen", fields: { name: "Cooking 2" } }]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChangesResponse & { ok: true };
    // The third edit folds into the first, as if added separately.
    expect(body.changes.map((c) => [c.targetId, c.after])).toEqual([
      ["kitchen", { name: "Cooking 2" }],
      ["study", { name: "Office" }],
    ]);
    expect(t.changes.list()).toHaveLength(2);
    nothingWritten(t);
  });

  it("keeps nothing when one is invalid", async () => {
    const t = setup();
    const res = await batch(t, [AREA_RENAME, { kind: "bogus", op: "update", targetId: "x", fields: {} }]);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Change 2 of 2: Unknown kind.*Nothing was added/);
    expect(t.changes.list()).toEqual([]);
  });

  it("keeps nothing when one is refused, even after earlier ones were stored", async () => {
    const t = setup();
    await t.queue(OTHER_RENAME);
    const before = t.version();
    const res = await batch(t, [AREA_RENAME, MISSING]);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/Change 2 of 2: .*Nothing was added/);
    expect(t.version()).toBe(before);
    expect(t.changes.list()).toHaveLength(1);
  });

  it("refuses an empty, oversized or malformed batch", async () => {
    const t = setup();
    expect((await batch(t, [])).status).toBe(400);
    expect((await batch(t, "nope")).status).toBe(400);
    expect((await batch(t, [null])).status).toBe(400);
    expect((await t.post("/api/changes/batch", [AREA_RENAME])).status).toBe(400);
    expect(
      (
        await batch(
          t,
          Array.from({ length: 501 }, () => AREA_RENAME),
        )
      ).status,
    ).toBe(400);
    expect(t.changes.list()).toEqual([]);
  });

  it("refuses while an Apply is running", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const t = setup({
      mode: "app",
      backup: async (name) => {
        await held;
        return { ok: true, name, slug: "late" };
      },
    });
    await t.queue(AREA_RENAME);
    const first = t.post("/api/apply", { version: t.version() });
    await vi.waitFor(() => expect(t.backupNames).toHaveLength(1));
    const res = await batch(t, [OTHER_RENAME]);
    expect(res.status).toBe(409);
    expect(t.changes.list()).toHaveLength(1);
    release();
    await first;
  });
});

describe("who may talk to the app", () => {
  it("refuses a peer other than Ingress in app mode, before anything else", async () => {
    const t = setup({ mode: "app" });
    for (const remoteAddress of ["10.0.0.5", "127.0.0.1", "::1", "172.30.32.3"]) {
      const res = await t.app.request("/api/changes", { headers: { "x-taxis-request": "1" } }, { incoming: { socket: { remoteAddress } } });
      expect(res.status).toBe(403);
    }
    // No peer at all is refused too.
    expect((await t.app.request("/api/changes")).status).toBe(403);
    // A refused POST writes nothing and doesn't even reach Apply.
    const post = await t.app.request(
      "/api/apply",
      { method: "POST", headers: { "x-taxis-request": "1", "content-type": "application/json" }, body: JSON.stringify({ version: "x" }) },
      { incoming: { socket: { remoteAddress: "10.0.0.5" } } },
    );
    expect(post.status).toBe(403);
    nothingWritten(t);
  });

  it("answers Ingress, also when the address comes IPv4-mapped", async () => {
    const t = setup({ mode: "app" });
    expect((await t.app.request("/api/changes", {}, INGRESS)).status).toBe(200);
    expect((await t.app.request("/api/changes", {}, { incoming: { socket: { remoteAddress: "::ffff:172.30.32.2" } } })).status).toBe(200);
  });

  it("answers any peer in dev mode", async () => {
    const t = setup({ mode: "dev" });
    expect((await t.app.request("/api/changes", {}, { incoming: { socket: { remoteAddress: "192.168.1.9" } } })).status).toBe(200);
  });

  it("refuses a request that changes something without the Taxis header", async () => {
    const t = setup({ mode: "dev" });
    const res = await t.app.request("/api/apply", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(400);
    nothingWritten(t);
  });
});

describe("how much of Home Assistant one Apply reads", () => {
  const readsOf = (t: ReturnType<typeof setup>, type: string) => t.fake.ws.filter((c) => c.kind === "read" && c.type === type).length;

  it("reads the home in full once, at the end, and the rest in parts", async () => {
    const t = setup();
    await t.queue(AREA_RENAME);
    // The queue itself read the home once (a cold read), to check the change.
    const before = { states: readsOf(t, "get_states"), config: readsOf(t, "get_config"), entries: readsOf(t, "config_entries/get") };
    expect(before).toEqual({ states: 1, config: 1, entries: 1 });

    await t.apply({ allowWithoutBackup: true });

    // Apply read the states for its first check, and once more in the full read
    // that finishes it. Not after the registry edits: a registry check doesn't
    // need them.
    expect(readsOf(t, "get_states") - before.states).toBe(2);
    // get_config and the integration list are only ever part of a full read.
    expect(readsOf(t, "get_config") - before.config).toBe(1);
    expect(readsOf(t, "config_entries/get") - before.entries).toBe(1);
  });

  // The WebSocket commands one Apply sent, by type, from the moment it starts.
  async function commandsDuringApply(t: ReturnType<typeof setup>, inputs: ChangeInput[]) {
    for (const input of inputs) await t.queue(input);
    const first = t.fake.ws.length;
    const { status, body } = await t.apply({ allowWithoutBackup: true });
    expect(status, JSON.stringify(body)).toBe(200);
    const counts: Record<string, number> = {};
    for (const call of t.fake.ws.slice(first)) if (call.kind === "read") counts[call.type] = (counts[call.type] ?? 0) + 1;
    return counts;
  }
  const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

  it("a registry edit: one read for the check, one for the result, one full read to finish", async () => {
    const counts = await commandsDuringApply(setup(), [AREA_RENAME]);
    // hierarchy (10) + registries (9) + full (12). A full read before every
    // check, as Apply used to do, would be 2 x 12 here and another 12 on the next view.
    expect(total(counts)).toBe(31);
    expect(counts.get_states).toBe(2);
  });

  it("helpers only: no registry step read, and the preflight and checks read parts", async () => {
    const counts = await commandsDuringApply(setup(), [
      {
        kind: "helper",
        op: "create",
        fields: { helper: "group", group_type: "light", name: "Study lights", entity_id: "light.study_all", entities: ["light.desk"], area_id: "study" },
      },
    ]);
    // preflight hierarchy (10) + helpers before (3) + one poll of the entity
    // registry while the new group appears (1) + after (3) + full (12). The old
    // Apply made four full reads for this (one of them a registry read with
    // nothing to check): 48, and 12 more on the next view.
    expect(total(counts)).toBe(29);
  });

  it("keeps a snapshot after Apply and on an explicit Refresh only", async () => {
    const t = setup();
    // Ordinary reads (opening the page, queueing a change) keep none.
    expect((await t.get("/api/hierarchy")).status).toBe(200);
    await t.queue(AREA_RENAME);
    expect((await t.get("/api/hierarchy")).status).toBe(200);
    expect(t.snapshots).toHaveLength(0);

    expect((await t.get("/api/hierarchy?refresh=1")).status).toBe(200);
    expect(t.snapshots).toHaveLength(1);

    await t.apply({ allowWithoutBackup: true });
    expect(t.snapshots).toHaveLength(2);
    // A snapshot holds the registries, not the states.
    expect(Object.keys((t.snapshots[1] as { raw: object }).raw)).not.toContain("states");
  });

  it("shows the new home right after Apply without another read from the browser", async () => {
    const t = setup();
    await t.queue(AREA_RENAME);
    await t.apply({ allowWithoutBackup: true });
    const before = readsOf(t, "get_states");

    const res = await t.get("/api/hierarchy");
    const body = (await res.json()) as { ok: true; hierarchy: { areas: Record<string, { name: string }> }; cached: boolean };
    expect(body.hierarchy.areas.kitchen.name).toBe("Cooking");
    expect(body.cached).toBe(true);
    expect(readsOf(t, "get_states")).toBe(before);
  });
});

describe("errors stay readable and secret-free", () => {
  it("answers a failed read with 502 and never repeats the token", async () => {
    const t = setup();
    // The failing call repeats the token in its message; the answer must not.
    const original = t.fake.ha.command;
    t.fake.ha.command = ((type: string, payload?: Record<string, unknown>) =>
      type === "get_config" ? Promise.reject(new Error(`boom ${TOKEN}`)) : original(type, payload)) as typeof original;

    const res = await t.get("/api/hierarchy?refresh=1");
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain(TOKEN);
    expect(t.logger.error).toHaveBeenCalled();
  });
});
