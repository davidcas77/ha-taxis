import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { buildMockRegistry } from "../../scripts/mock-ha-core.ts";
import { EMPTY_INVENTORY } from "../../shared/inventory.ts";
import { DEFAULT_NAMING } from "../../shared/naming.ts";
import { EMPTY_PARAMETERS } from "../../shared/parameters.ts";
import { planRecipes, recipeChangeInputs } from "../../shared/recipes.ts";
import { buildHierarchy } from "../model/hierarchy.ts";
import { fakeHa } from "../references/fake-ha.ts";
import { updateReferences } from "../references/update.ts";
import { applyAll } from "./all.ts";
import { createApp } from "../app.ts";
import { testStore } from "../ai/test-store.ts";
import { settingsStore } from "../settings.ts";
import { applyHistory } from "./history.ts";
import { changeStore } from "./store.ts";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE changes (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, op TEXT NOT NULL, target_id TEXT NOT NULL, scope TEXT, before TEXT NOT NULL, after TEXT NOT NULL, created_at TEXT NOT NULL)`,
  );
  const store = changeStore(db);
  const fake = fakeHa(buildMockRegistry());
  const live = () => buildHierarchy(structuredClone(fake.home), "now");
  const plan = () =>
    planRecipes(
      live(),
      EMPTY_INVENTORY,
      DEFAULT_NAMING,
      EMPTY_PARAMETERS,
      { blueprints: {}, automations: {}, scripts: {}, timers: {}, controllers: {} },
      store.list(),
    );
  const inputs = () => recipeChangeInputs([plan().find((c) => c.recipe === "occupancy" && c.areaId === "study")!]);
  const apply = () => applyAll(store.list(), { ha: fake.ha, rest: fake.api, readFresh: fake.readFresh, sleep: async () => {} });
  return { store, fake, live, inputs, apply };
}

describe("recipe configuration safeguards", () => {
  it("refuses to overwrite a configuration created after planning", async () => {
    const t = fixture();
    for (const input of t.inputs()) expect(t.store.add(input, t.live(), input.kind === "automation" ? null : undefined)).toBeNull();
    t.fake.home.automations.taxis_occupancy_study = { id: "taxis_occupancy_study", alias: "Someone else's automation", trigger: [] };
    const result = await t.apply();
    expect(result.results.find((r) => r.changeId === t.store.list().find((c) => c.kind === "automation")!.id)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/changed in Home Assistant/),
    });
    expect(t.fake.home.automations.taxis_occupancy_study.alias).toBe("Someone else's automation");
    expect(t.fake.rest.some((c) => c.method === "POST" && c.path.endsWith("/taxis_occupancy_study"))).toBe(false);
  });

  it("remaps a saved baseline after a rename and can retry a failed recipe update", async () => {
    const t = fixture();
    const inputs = t.inputs();
    for (const input of inputs) expect(t.store.add(input, t.live(), input.kind === "automation" ? null : undefined)).toBeNull();
    const installed = await t.apply();
    expect(installed.results.every((r) => r.ok)).toBe(true);
    t.store.settle(installed);
    const original = structuredClone(t.fake.home.automations.taxis_occupancy_study);
    const automation = inputs.find((x) => x.kind === "automation")!;
    expect(t.store.add({ ...automation, op: "update", fields: { ...automation.fields, alias: "Updated occupancy" } }, t.live(), original)).toBeNull();
    expect(
      t.store.add(
        { kind: "entity", op: "update", targetId: "binary_sensor.study_presence", fields: { new_entity_id: "binary_sensor.study_presence_new" } },
        t.live(),
      ),
    ).toBeNull();
    let writes = 0;
    t.fake.restStatus = (method, path) => (method === "POST" && path.endsWith("/taxis_occupancy_study") && ++writes === 2 ? 500 : null);
    const partial = await t.apply();
    const queued = t.store.list().find((c) => c.kind === "automation")!;
    expect(partial.results.find((r) => r.changeId === queued.id)?.ok).toBe(false);
    expect(partial.renamed.get("binary_sensor.study_presence")).toBe("binary_sensor.study_presence_new");
    t.store.settle(partial);
    t.fake.restStatus = null;
    const retried = await t.apply();
    expect(retried.results).toMatchObject([{ ok: true }]);
    expect(t.fake.home.automations.taxis_occupancy_study.alias).toBe("Updated occupancy");
  });

  it("queues a recipe for a pending area and resolves its ID during Apply", async () => {
    const t = fixture();
    expect(t.store.add({ kind: "area", op: "create", fields: { name: "Attic" } }, t.live())).toBeNull();
    const area = t.store.list()[0].targetId;
    for (const input of t.inputs()) {
      if (input.kind === "automation") input.fields = { ...input.fields, area_id: area };
      expect(t.store.add(input, t.live(), input.kind === "automation" ? null : undefined)).toBeNull();
    }
    const result = await t.apply();
    const automation = t.store.list().find((c) => c.kind === "automation")!;
    expect(result.results.find((r) => r.changeId === automation.id)).toMatchObject({ ok: true });
    expect(result.realIds.has(area)).toBe(true);
  });
});

describe("reference readback", () => {
  it("reports a missing config after save as unverified", async () => {
    const config = { entity_id: "light.old" };
    let reads = 0;
    const details = await updateReferences(
      {
        ha: { command: async () => null as never, write: async () => null as never },
        rest: { get: async () => (++reads === 1 ? config : null), post: async () => {} },
      },
      {
        takenAt: 0,
        items: [{ kind: "automation", id: "one", entityId: null, name: "One", urlPath: null, editable: true, yaml: false, config }],
        notes: [],
        names: new Map(),
        entryOf: new Map(),
        entryNames: new Map(),
      },
      [{ changeId: 1, oldId: "light.old", newId: "light.new" }],
    );
    expect(details.get(1)).toEqual([expect.stringMatching(/^Not updated:.*no longer readable/)]);
  });
});

describe("recipe route baseline", () => {
  it("captures the server configuration, rejects changes after queueing, and ignores client supplied before", async () => {
    const { store: db, close } = testStore();
    try {
      const fake = fakeHa(buildMockRegistry());
      const changes = changeStore(db.db);
      const app = createApp({
        mode: "dev",
        version: "test",
        target: { ok: true, target: { wsUrl: "ws://ha.test", restUrl: "http://ha.test", token: "secret", mode: "dev" } },
        ha: fake.ha,
        rest: fake.api,
        backup: async (name) => ({ ok: true, name, slug: "test" }),
        db: db.db,
        settings: settingsStore(db.db),
        changes,
        history: applyHistory(db.db),
        saveSnapshot: () => {},
        clock: Date.now,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        webRoot: null,
      });
      const input = fixture()
        .inputs()
        .find((x) => x.kind === "automation")!;
      const existing = { id: "taxis_occupancy_study", alias: "Original", trigger: [], private_marker: "INTERNAL_CONFIG_SENTINEL" };
      fake.home.automations.taxis_occupancy_study = structuredClone(existing);
      const response = await app.request("/api/changes", {
        method: "POST",
        headers: { "content-type": "application/json", "x-taxis-request": "1" },
        body: JSON.stringify({ ...input, before: { configSnapshot: null } }),
      });
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain("INTERNAL_CONFIG_SENTINEL");
      expect(changes.list()[0].before).toEqual({ configSnapshot: existing });
      const version = changes.version();
      const list = await app.request("/api/changes", { headers: { "x-taxis-request": "1" } });
      const listBody = await list.json();
      expect(JSON.stringify(listBody)).not.toContain("INTERNAL_CONFIG_SENTINEL");
      expect(listBody.version).toBe(version);
      applyHistory(db.db).begin(changes.list());
      const history = await app.request("/api/history", { headers: { "x-taxis-request": "1" } });
      expect(await history.text()).not.toContain("INTERNAL_CONFIG_SENTINEL");
      expect(changes.list()[0].before).toEqual({ configSnapshot: existing });
      fake.home.automations.taxis_occupancy_study.alias = "Changed elsewhere";
      const result = await applyAll(changes.list(), { ha: fake.ha, rest: fake.api, readFresh: fake.readFresh, sleep: async () => {} });
      // This particular automation may first fail its missing-entity check. Its baseline remains server-owned.
      expect(result.results[0].ok).toBe(false);
      expect(fake.home.automations.taxis_occupancy_study.alias).toBe("Changed elsewhere");
    } finally {
      close();
    }
  });
});
