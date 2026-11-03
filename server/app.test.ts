import { afterEach, describe, expect, it, vi } from "vitest";

import { buildMockRegistry, withButtonDemo, withSmartDemo } from "../scripts/mock-ha-core.ts";
import { setCounts } from "../shared/inventory.ts";
import { blueprintForRecipe } from "../shared/blueprints.ts";
import { buildHierarchy } from "./model/hierarchy.ts";
import type { ApplyResponse, ChangeInput, ChangesResponse } from "../shared/types.ts";
import { createApp } from "./app.ts";
import { applyHistory } from "./changes/history.ts";
import { changeStore } from "./changes/store.ts";
import type { AppDeps } from "./context.ts";
import { testStore } from "./ai/test-store.ts";
import { fakeHa } from "./references/fake-ha.ts";
import { settingsStore } from "./settings.ts";
import { helperChangeInputs, planHelpers, planSpaceLightGroup } from "../shared/helpers.ts";
import { resolveSpaces } from "../shared/spaces.ts";
import { planHouseRecipes } from "../shared/recipes-house.ts";
import { planRecipes } from "../shared/recipes.ts";
import { setParameter } from "../shared/parameters.ts";
import { readInstalled } from "./changes/recipes.ts";

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

type Backup = NonNullable<AppDeps["backup"]>;

function setup(options: { mode?: "app" | "dev"; onApplyRead?: () => void | Promise<void>; backup?: Backup; configured?: boolean } = {}) {
  const mode = options.mode ?? "dev";
  const { store, close } = testStore();
  cleanups.push(close);
  const fake = fakeHa(buildMockRegistry());
  const settings = settingsStore(store.db);
  const changes = changeStore(store.db);
  const history = applyHistory(store.db);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const snapshots: unknown[] = [];
  const applyReads: string[] = [];
  const backup: Backup = options.backup ?? (async (name) => ({ ok: true, name, slug: "slug1" }));
  let applyReadPending = false;
  const begin = history.begin.bind(history);
  history.begin = (pending) => {
    applyReadPending = true;
    return begin(pending);
  };
  const command = fake.ha.command;
  fake.ha.command = async (type, payload) => {
    if (applyReadPending && options.onApplyRead) {
      applyReadPending = false;
      applyReads.push("read");
      await options.onApplyRead();
    }
    return command(type, payload);
  };
  const configured = options.configured ?? true;

  const app = createApp({
    mode,
    version: "test",
    target: configured
      ? { ok: true, target: { wsUrl: "ws://ha.test/api/websocket", restUrl: "http://ha.test/api", token: TOKEN, mode } }
      : { ok: false, reason: "HA_URL and HA_TOKEN are not set." },
    ha: configured ? fake.ha : null,
    rest: configured ? fake.api : null,
    backup,
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

  return { app, fake, changes, history, settings, logger, snapshots, applyReads, call, get, post, queue, apply, version, writeTypes, env, store };
}

const nothingWritten = (t: ReturnType<typeof setup>) => {
  expect(t.fake.writes()).toEqual({ ws: [], rest: [] });
};

describe("Apply in app mode", () => {
  for (const mode of ["queued", "direct"] as const) {
    it(`does not place or overwrite a timer that appeared after review in ${mode} mode`, async () => {
      let t: ReturnType<typeof setup>;
      t = setup({
        mode: "app",
        onApplyRead: async () => {
          t.fake.home.entities.push({ entity_id: "timer.kitchen_hold", platform: "timer", unique_id: "kitchen_hold", area_id: "study" });
          t.fake.home.states.push({ entity_id: "timer.kitchen_hold", state: "idle", attributes: { duration: "0:04:00" } });
        },
      });
      const input: ChangeInput = {
        kind: "helper",
        op: "create",
        fields: { helper: "timer", name: "Kitchen hold", entity_id: "timer.kitchen_hold", area_id: "kitchen", duration: 180 },
      };
      let result: ApplyResponse;
      if (mode === "queued") {
        await t.queue(input);
        result = (await t.apply()).body;
      } else {
        expect((await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" })).status).toBe(200);
        const request = { changes: [input], settingsRevision: "1" };
        const preview = await t.post("/api/direct-preview", request);
        expect(preview.status).toBe(200);
        const token = ((await preview.json()) as { previewVersion: string }).previewVersion;
        result = (await (await t.post("/api/direct-changes", { ...request, previewVersion: token })).json()) as ApplyResponse;
      }
      expect(result.ok && result.results[0]).toMatchObject({ ok: false, message: expect.stringContaining("timer appeared or changed") });
      nothingWritten(t);
    });
    it(`does not overwrite a timer changed after review in ${mode} mode`, async () => {
      let t: ReturnType<typeof setup>;
      t = setup({
        mode: "app",
        onApplyRead: async () => {
          t.fake.home.states.find((state) => state.entity_id === "timer.kitchen_hold")!.attributes!.duration = "0:04:00";
        },
      });
      t.fake.home.entities.push({ entity_id: "timer.kitchen_hold", platform: "timer", unique_id: "kitchen_hold", area_id: "kitchen" });
      t.fake.home.states.push({ entity_id: "timer.kitchen_hold", state: "idle", attributes: { duration: "0:02:00" } });
      const input: ChangeInput = { kind: "helper", op: "update", targetId: "timer.kitchen_hold", fields: { duration: 180 } };
      let result: ApplyResponse;
      if (mode === "queued") {
        await t.queue(input);
        result = (await t.apply()).body;
      } else {
        expect((await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" })).status).toBe(200);
        const request = { changes: [input], settingsRevision: "1" };
        const preview = await t.post("/api/direct-preview", request);
        expect(preview.status).toBe(200);
        const token = ((await preview.json()) as { previewVersion: string }).previewVersion;
        result = (await (await t.post("/api/direct-changes", { ...request, previewVersion: token })).json()) as ApplyResponse;
      }
      expect(result.ok && result.results[0]).toMatchObject({ ok: false, message: expect.stringContaining("timer duration changed") });
      nothingWritten(t);
      expect(t.changes.list()[0].before.duration).toBe(120);
    });
  }
  it("refuses a legacy timer change without a baseline unless already applied", async () => {
    const t = setup({ mode: "app" });
    t.fake.home.entities.push({ entity_id: "timer.kitchen_hold", platform: "timer", unique_id: "kitchen_hold", area_id: "kitchen" });
    t.fake.home.states.push({ entity_id: "timer.kitchen_hold", state: "idle", attributes: { duration: "0:02:00" } });
    await t.queue({ kind: "helper", op: "update", targetId: "timer.kitchen_hold", fields: { duration: 180 } });
    t.store.db.prepare("UPDATE changes SET before = ? WHERE kind = ?").run("{}", "helper");
    const first = await t.apply();
    expect(first.body.ok && first.body.results[0]).toMatchObject({ ok: false, message: expect.stringContaining("could not be verified") });
    nothingWritten(t);
    t.fake.home.states.find((state) => state.entity_id === "timer.kitchen_hold")!.attributes!.duration = "0:03:00";
    const retry = await t.apply();
    expect(retry.body.ok && retry.body.results[0]).toMatchObject({ ok: true });
    nothingWritten(t);
  });
  it("adopts an existing verified helper in its Space", async () => {
    const t = setup({ mode: "app" });
    t.fake.home.labels.push({ label_id: "office", name: "Space: Office" });
    t.fake.home.areas.find((area) => area.area_id === "hallway")!.labels = ["office"];
    const h = buildHierarchy(structuredClone(t.fake.home), "");
    const row = planHelpers(h, t.settings.inventory(), t.settings.naming()).find((item) => item.areaId === "hallway" && item.key === "lights")!;
    expect(row.status, JSON.stringify(row)).toBe("adopt");
    const inputs = helperChangeInputs(row);
    const response = await t.post("/api/changes/batch", { changes: inputs });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const result = await t.apply();
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.ok && result.body.results.every((item) => item.ok)).toBe(true);
    expect(t.fake.home.entities.some((entity) => entity.entity_id === row.canonicalId)).toBe(true);
  });
  it("adopts a scoped helper and updates its safe members in one reviewed batch", async () => {
    const t = setup({ mode: "app" });
    t.fake.home.labels.push({ label_id: "office", name: "Space: Office" });
    t.fake.home.areas.find((area) => area.area_id === "hallway")!.labels = ["office"];
    t.fake.home.states.find((state) => state.entity_id === "light.hall_lights")!.attributes!.entity_id = ["light.hall_ceiling"];
    const h = buildHierarchy(structuredClone(t.fake.home), "");
    const row = planHelpers(h, t.settings.inventory(), t.settings.naming()).find((item) => item.areaId === "hallway" && item.key === "lights")!;
    expect(row.status).toBe("adopt");
    const inputs = helperChangeInputs(row);
    expect(inputs).toHaveLength(2);
    const queued = await t.post("/api/changes/batch", { changes: inputs });
    expect(queued.status, JSON.stringify(await queued.clone().json())).toBe(200);
    const result = await t.apply();
    expect(result.body.ok && result.body.results.every((item) => item.ok), JSON.stringify(result.body)).toBe(true);
  });
  it("rejects a scoped adoption when its members move outside the Space", async () => {
    const t = setup({ mode: "app" });
    t.fake.home.labels.push({ label_id: "office", name: "Space: Office" });
    t.fake.home.areas.find((area) => area.area_id === "hallway")!.labels = ["office"];
    const h = buildHierarchy(structuredClone(t.fake.home), "");
    const row = planHelpers(h, t.settings.inventory(), t.settings.naming()).find((item) => item.areaId === "hallway" && item.key === "lights")!;
    const inputs = helperChangeInputs(row);
    t.fake.home.states.find((state) => state.entity_id === "light.hall_lights")!.attributes!.entity_id = ["light.desk"];
    const response = await t.post("/api/changes/batch", { changes: inputs });
    expect(response.status).toBe(409);
    nothingWritten(t);
  });
  it("rejects an update to a timer belonging to another Space", async () => {
    const t = setup({ mode: "app" });
    t.fake.home.labels.push({ label_id: "office", name: "Space: Office" }, { label_id: "studio", name: "Space: Studio" });
    t.fake.home.areas.find((area) => area.area_id === "study")!.labels = ["office"];
    t.fake.home.areas.find((area) => area.area_id === "kitchen")!.labels = ["studio"];
    t.fake.home.entities.push({ entity_id: "timer.kitchen_hold", platform: "timer", unique_id: "kitchen_hold", area_id: "kitchen" });
    t.fake.home.states.push({ entity_id: "timer.kitchen_hold", state: "idle", attributes: { duration: "00:05:00" } });
    const response = await t.post("/api/changes", {
      kind: "helper",
      op: "update",
      targetId: "timer.kitchen_hold",
      fields: { duration: 480 },
      space: { labelId: "office", areaIds: ["study"] },
    });
    expect(response.status).toBe(409);
    nothingWritten(t);
  });
  it("sets a scoped area's verified canonical temperature sensor", async () => {
    const t = setup({ mode: "app" });
    t.fake.home.labels.push({ label_id: "office", name: "Space: Office" });
    t.fake.home.areas.find((area) => area.area_id === "study")!.labels = ["office"];
    t.fake.home.entities.push({ entity_id: "sensor.study_temperature", platform: "min_max", unique_id: "study_temperature", area_id: "study" });
    t.fake.home.states.push({
      entity_id: "sensor.study_temperature",
      state: "21",
      attributes: { device_class: "temperature", entity_id: ["sensor.study_climate_temperature"] },
    });
    const h = buildHierarchy(structuredClone(t.fake.home), "");
    const row = planHelpers(h, t.settings.inventory(), t.settings.naming()).find((item) => item.areaId === "study" && item.key === "temperature")!;
    const inputs = helperChangeInputs(row);
    expect(
      inputs.some((input) => input.kind === "area"),
      JSON.stringify(row),
    ).toBe(true);
    const response = await t.post("/api/changes/batch", { changes: inputs });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const result = await t.apply();
    expect(result.body.ok && result.body.results.every((item) => item.ok), JSON.stringify(result.body)).toBe(true);
    expect(t.fake.home.areas.find((area) => area.area_id === "study")?.temperature_entity_id).toBe("sensor.study_temperature");
  });
  it("refuses a scoped area sensor whose source has moved to another Space", async () => {
    const t = setup({ mode: "app" });
    t.fake.home.labels.push({ label_id: "office", name: "Space: Office" }, { label_id: "studio", name: "Space: Studio" });
    t.fake.home.areas.find((area) => area.area_id === "study")!.labels = ["office"];
    t.fake.home.areas.find((area) => area.area_id === "kitchen")!.labels = ["studio"];
    t.fake.home.entities.push({ entity_id: "sensor.study_temperature", platform: "min_max", unique_id: "study_temperature", area_id: "study" });
    t.fake.home.states.push({
      entity_id: "sensor.study_temperature",
      state: "21",
      attributes: { device_class: "temperature", entity_id: ["sensor.study_climate_temperature"] },
    });
    const h = buildHierarchy(structuredClone(t.fake.home), "");
    const row = planHelpers(h, t.settings.inventory(), t.settings.naming()).find((item) => item.areaId === "study" && item.key === "temperature")!;
    const inputs = helperChangeInputs(row);
    expect(inputs.length).toBeGreaterThan(0);
    t.fake.home.entities.find((entity) => entity.entity_id === "sensor.study_climate_temperature")!.area_id = "kitchen";
    const response = await t.post("/api/changes/batch", { changes: inputs });
    expect(response.status).toBe(409);
    nothingWritten(t);
  });
  it("installs a scoped Goodbye after its verified Space light group", async () => {
    const t = setup({ mode: "app" });
    withSmartDemo(t.fake.home);
    t.fake.home.labels.push({ label_id: "studio", name: "Space: Studio" });
    t.fake.home.areas.find((area) => area.area_id === "living_room")!.labels = ["studio"];
    let h = buildHierarchy(structuredClone(t.fake.home), "");
    const group = planSpaceLightGroup(h, t.settings.inventory(), t.settings.naming(), [], resolveSpaces(h)[0]);
    await t.queue(group.inputs[0]);
    expect((await t.apply()).status).toBe(200);
    h = buildHierarchy(structuredClone(t.fake.home), "");
    const installed = await readInstalled({ ha: t.fake.ha, rest: t.fake.api }, t.fake.home, [], []);
    const cell = planHouseRecipes(h, t.settings.inventory(), t.settings.naming(), t.settings.parameters(), installed, [], false, {
      kind: "space",
      space: resolveSpaces(h)[0],
    }).find((item) => item.recipe === "goodbye")!;
    expect(cell.status, cell.missing.join(", ")).toBe("ready");
    const response = await t.post("/api/changes/batch", { changes: cell.inputs });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const result = await t.apply();
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toMatchObject({ ok: true });
    if (result.body.ok) expect(result.body.results.every((item) => item.ok)).toBe(true);
    expect(t.fake.home.scripts[cell.targetId!]).toBeDefined();
  });
  it("installs a scoped area notification with only its own sensor", async () => {
    const t = setup({ mode: "app" });
    t.fake.home.labels.push({ label_id: "office", name: "Space: Office" });
    t.fake.home.areas.find((area) => area.area_id === "study")!.labels = ["office"];
    const h = buildHierarchy(structuredClone(t.fake.home), "");
    const installed = await readInstalled({ ha: t.fake.ha, rest: t.fake.api }, t.fake.home, [], []);
    const cell = planRecipes(h, t.settings.inventory(), t.settings.naming(), t.settings.parameters(), installed, []).find(
      (item) => item.areaId === "study" && item.recipe === "left_open",
    )!;
    expect(cell.status, cell.missing.join(", ")).toBe("ready");
    const response = await t.post("/api/changes/batch", { changes: cell.inputs });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const result = await t.apply();
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.ok && result.body.results.every((item) => item.ok)).toBe(true);
  });
  for (const mode of ["app", "dev"] as const)
    it(`updates a scoped occupancy timer through a reviewed direct setting in ${mode} without backup`, async () => {
      const backup = vi.fn(async () => ({ ok: false as const, reason: "must not run" }));
      const t = setup({ mode, backup });
      t.fake.home.labels.push({ label_id: "office", name: "Space: Office" });
      t.fake.home.areas.find((area) => area.area_id === "study")!.labels = ["office"];
      const h = buildHierarchy(structuredClone(t.fake.home), "");
      const installed = await readInstalled({ ha: t.fake.ha, rest: t.fake.api }, t.fake.home, [], []);
      const cell = planRecipes(h, t.settings.inventory(), t.settings.naming(), t.settings.parameters(), installed, []).find(
        (item) => item.areaId === "study" && item.recipe === "occupancy",
      )!;
      expect(cell.status, cell.missing.join(", ")).toBe("ready");
      const queued = await t.post("/api/changes/batch", { changes: cell.inputs });
      expect(queued.status, JSON.stringify(await queued.clone().json())).toBe(200);
      const first = await t.apply();
      expect(first.body.ok && first.body.results.every((item) => item.ok), JSON.stringify(first.body)).toBe(true);
      expect((await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" })).status).toBe(200);
      const after = setParameter(t.settings.parameters(), { level: "area", id: "study" }, "hold_timeout", 8);
      const request = { kind: "parameters", value: after, revision: "0", settingsRevision: "1" };
      const preview = await t.post("/api/direct-settings-preview", request);
      expect(preview.status, JSON.stringify(await preview.clone().json())).toBe(200);
      const token = ((await preview.json()) as { previewVersion: string }).previewVersion;
      const response = await t.post("/api/direct-settings", { ...request, previewVersion: token });
      const result = (await response.json()) as { ok: boolean; apply?: ApplyResponse };
      expect(response.status, JSON.stringify(result)).toBe(200);
      expect(result.apply?.ok && result.apply.results.every((item) => item.ok), JSON.stringify(result)).toBe(true);
      expect(result.apply?.ok && result.apply.backup.made).toBe(false);
      expect(backup).not.toHaveBeenCalled();
    });
  it("does not overwrite a scoped timer changed after direct setting review", async () => {
    let t: ReturnType<typeof setup>;
    let changeTimer = false;
    t = setup({
      mode: "app",
      onApplyRead: async () => {
        if (changeTimer) {
          const timer = t.fake.home.states.find((state) => state.entity_id.startsWith("timer.") && state.entity_id.includes("study"))!;
          timer.attributes!.duration = "0:11:00";
        }
      },
    });
    t.fake.home.labels.push({ label_id: "office", name: "Space: Office" });
    t.fake.home.areas.find((area) => area.area_id === "study")!.labels = ["office"];
    const h = buildHierarchy(structuredClone(t.fake.home), "");
    const installed = await readInstalled({ ha: t.fake.ha, rest: t.fake.api }, t.fake.home, [], []);
    const cell = planRecipes(h, t.settings.inventory(), t.settings.naming(), t.settings.parameters(), installed, []).find(
      (item) => item.areaId === "study" && item.recipe === "occupancy",
    )!;
    expect((await t.post("/api/changes/batch", { changes: cell.inputs })).status).toBe(200);
    const initial = await t.apply();
    expect(initial.body.ok && initial.body.results.every((item) => item.ok), JSON.stringify(initial.body)).toBe(true);
    expect((await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" })).status).toBe(200);
    const request = {
      kind: "parameters",
      value: setParameter(t.settings.parameters(), { level: "area", id: "study" }, "hold_timeout", 8),
      revision: "0",
      settingsRevision: "1",
    };
    const preview = await t.post("/api/direct-settings-preview", request);
    expect(preview.status).toBe(200);
    const token = ((await preview.json()) as { previewVersion: string }).previewVersion;
    const timerWrites = t.fake.writes().ws.filter((write) => write.type === "timer/update").length;
    changeTimer = true;
    const response = await t.post("/api/direct-settings", { ...request, previewVersion: token });
    const result = (await response.json()) as { ok: boolean; apply?: ApplyResponse };
    expect(result.apply?.ok && result.apply.results.find((item) => !item.ok)).toMatchObject({ message: expect.stringContaining("timer duration changed") });
    expect(t.fake.writes().ws.filter((write) => write.type === "timer/update")).toHaveLength(timerWrites);
  });
  it("previews and directly installs a scoped Goodbye without touching other Spaces", async () => {
    const t = setup({ mode: "app" });
    withSmartDemo(t.fake.home);
    t.fake.home.labels.push({ label_id: "studio", name: "Space: Studio" }, { label_id: "other", name: "Space: Other" });
    t.fake.home.areas.find((area) => area.area_id === "living_room")!.labels = ["studio"];
    t.fake.home.areas.find((area) => area.area_id === "study")!.labels = ["other"];
    let h = buildHierarchy(structuredClone(t.fake.home), "");
    const group = planSpaceLightGroup(
      h,
      t.settings.inventory(),
      t.settings.naming(),
      [],
      resolveSpaces(h).find((space) => space.id === "studio")!,
    );
    await t.queue(group.inputs[0]);
    expect((await t.apply()).status).toBe(200);
    h = buildHierarchy(structuredClone(t.fake.home), "");
    const installed = await readInstalled({ ha: t.fake.ha, rest: t.fake.api }, t.fake.home, [], []);
    const cell = planHouseRecipes(h, t.settings.inventory(), t.settings.naming(), t.settings.parameters(), installed, [], false, {
      kind: "space",
      space: resolveSpaces(h).find((space) => space.id === "studio")!,
    }).find((item) => item.recipe === "goodbye")!;
    expect(cell.status, cell.missing.join(", ")).toBe("ready");
    expect((await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" })).status).toBe(200);
    const request = { changes: cell.inputs, settingsRevision: "1" };
    const preview = await t.post("/api/direct-preview", request);
    expect(preview.status, JSON.stringify(await preview.clone().json())).toBe(200);
    const token = ((await preview.json()) as { previewVersion: string }).previewVersion;
    const result = await t.post("/api/direct-changes", { ...request, previewVersion: token });
    expect(result.status, JSON.stringify(await result.clone().json())).toBe(200);
    const body = (await result.json()) as ApplyResponse;
    expect(body.ok && body.results.every((item) => item.ok)).toBe(true);
    expect(t.fake.home.scripts[cell.targetId!]).toBeDefined();
    expect(t.fake.home.scripts["taxis_goodbye"]).toBeUndefined();
  });
  it("rejects a direct Space preview after membership changes, with no HA writes", async () => {
    const t = setup({ mode: "app" });
    withSmartDemo(t.fake.home);
    t.fake.home.labels.push({ label_id: "studio", name: "Space: Studio" });
    t.fake.home.areas.find((area) => area.area_id === "living_room")!.labels = ["studio"];
    const h = buildHierarchy(structuredClone(t.fake.home), "");
    const group = planSpaceLightGroup(h, t.settings.inventory(), t.settings.naming(), [], resolveSpaces(h)[0]);
    expect((await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" })).status).toBe(200);
    const request = { changes: group.inputs, settingsRevision: "1" };
    const preview = await t.post("/api/direct-preview", request);
    expect(preview.status, JSON.stringify(await preview.clone().json())).toBe(200);
    const token = ((await preview.json()) as { previewVersion: string }).previewVersion;
    t.fake.home.areas.find((area) => area.area_id === "study")!.labels = ["studio"];
    const result = await t.post("/api/direct-changes", { ...request, previewVersion: token });
    expect(result.status).toBe(409);
    nothingWritten(t);
  });
  it("applies a verified Space light group when its membership stays unchanged", async () => {
    const t = setup({ mode: "app" });
    withSmartDemo(t.fake.home);
    t.fake.home.labels.push({ label_id: "studio", name: "Space: Studio" });
    t.fake.home.areas.find((area) => area.area_id === "living_room")!.labels = ["studio"];
    const h = buildHierarchy(structuredClone(t.fake.home), "");
    const plan = planSpaceLightGroup(h, t.settings.inventory(), t.settings.naming(), [], resolveSpaces(h)[0]);
    await t.queue(plan.inputs[0]);
    const result = await t.apply();
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toMatchObject({ ok: true, results: [{ ok: true }] });
  });
  it("updates an editable Space light group whose current and planned members are safe", async () => {
    const t = setup({ mode: "app" });
    withSmartDemo(t.fake.home);
    t.fake.home.labels.push({ label_id: "studio", name: "Space: Studio" });
    t.fake.home.areas.find((area) => area.area_id === "living_room")!.labels = ["studio"];
    let h = buildHierarchy(structuredClone(t.fake.home), "");
    const create = planSpaceLightGroup(h, t.settings.inventory(), t.settings.naming(), [], resolveSpaces(h)[0]);
    await t.queue(create.inputs[0]);
    expect((await t.apply()).status).toBe(200);
    t.fake.home.states.find((state) => state.entity_id === create.id)!.attributes!.entity_id = ["light.living_spots"];
    h = buildHierarchy(structuredClone(t.fake.home), "");
    const update = planSpaceLightGroup(h, t.settings.inventory(), t.settings.naming(), [], resolveSpaces(h)[0]);
    expect(update.status).toBe("update");
    await t.queue(update.inputs[0]);
    const result = await t.apply();
    expect(result.body.ok && result.body.results.every((item) => item.ok), JSON.stringify(result.body)).toBe(true);
  });
  it("fences Space light-group ownership changes after review", async () => {
    let t: ReturnType<typeof setup>;
    t = setup({
      mode: "app",
      onApplyRead: async () => {
        t.fake.home.entities.find((entity) => entity.entity_id === "light.living_spots")!.area_id = "study";
      },
    });
    withSmartDemo(t.fake.home);
    t.fake.home.labels.push({ label_id: "studio", name: "Space: Studio" });
    t.fake.home.areas.find((area) => area.area_id === "living_room")!.labels = ["studio"];
    const h = buildHierarchy(structuredClone(t.fake.home), "");
    const plan = planSpaceLightGroup(h, t.settings.inventory(), t.settings.naming(), [], resolveSpaces(h)[0]);
    expect(plan.status).toBe("create");
    await t.queue(plan.inputs[0]);
    const result = await t.apply();
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ ok: false, error: expect.stringContaining("ownership changed") });
    nothingWritten(t);
  });
  it("writes nothing if an area gains a Space label after review", async () => {
    let t: ReturnType<typeof setup>;
    t = setup({
      mode: "app",
      onApplyRead: async () => {
        t.fake.home.labels.push({ label_id: "studio", name: "Space: Studio" });
        t.fake.home.areas.find((area) => area.area_id === "kitchen")!.labels = ["studio"];
      },
    });
    await t.queue({
      kind: "helper",
      op: "create",
      fields: { helper: "timer", name: "Kitchen test", entity_id: "timer.kitchen_test", area_id: "kitchen", duration: 60 },
    });
    const result = await t.apply();
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ ok: false, error: expect.stringContaining("Space") });
    nothingWritten(t);
  });
  it("applies without backup, returns the results and clears what was done", async () => {
    const t = setup({ mode: "app" });
    await t.queue(AREA_RENAME);

    const { status, body } = await t.apply();

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.backup).toEqual({ made: false, reason: "Taxis did not make a backup." });
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ ok: true, status: "verified" });
    expect(t.applyReads).toEqual([]);
    expect(t.writeTypes()).toEqual(["config/area_registry/update"]);
    expect(t.fake.home.areas.find((a) => a.area_id === "kitchen")?.name).toBe("Cooking");
    // The done change left the list, and the run is on record.
    expect(t.changes.list()).toEqual([]);
    expect(t.history.runs()[0]).toMatchObject({ status: "completed", backup: { made: false } });
  });

  for (const mode of ["app", "dev"] as const) {
    it(`applies in ${mode} mode without calling the backup callback`, async () => {
      const backup = vi.fn(async () => ({ ok: false as const, reason: "must not run" }));
      const t = setup({ mode, backup });
      await t.queue(AREA_RENAME);
      const result = await t.apply();
      expect(result.status).toBe(200);
      expect(result.body.ok && result.body.backup.made).toBe(false);
      expect(backup).not.toHaveBeenCalled();
    });
  }
});

describe("Apply in dev mode", () => {
  it("applies when the user confirms, and says no backup was made", async () => {
    const t = setup({ mode: "dev" });
    await t.queue(AREA_RENAME);

    const { status, body } = await t.apply({ allowWithoutBackup: true });

    expect(status).toBe(200);
    expect(body.ok && body.backup).toMatchObject({ made: false });
    expect(t.applyReads).toEqual([]);
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

  it("stops before any write when the naming preflight fails", async () => {
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
    expect(t.applyReads).toEqual([]);
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
    // The first Apply waits at an HA read until the test lets it go.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const t = setup({
      mode: "app",
      onApplyRead: async () => {
        await held;
      },
    });
    await t.queue(AREA_RENAME);
    const version = t.version();

    const first = t.post("/api/apply", { version });
    await vi.waitFor(() => expect(t.applyReads).toHaveLength(1));

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
    const t = setup({ mode: "app" });
    await t.queue(AREA_RENAME);
    t.fake.failRead.add("config/area_registry/list");
    expect((await t.apply()).status).toBe(502);
    t.fake.failRead.clear();
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
      onApplyRead: async () => {
        await held;
      },
    });
    await t.queue(AREA_RENAME);
    const first = t.post("/api/apply", { version: t.version() });
    await vi.waitFor(() => expect(t.applyReads).toHaveLength(1));
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
    // Preflight and pre-write Space membership checks each read the hierarchy
    // (10 each), then helpers before (3), one poll (1), after (3), and full (12).
    expect(total(counts)).toBe(39);
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

describe("direct changes and general settings", () => {
  const save = (t: ReturnType<typeof setup>, review: boolean, revision = "0") =>
    t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: review }, { "If-Match": revision });
  const direct = async (t: ReturnType<typeof setup>, inputs: ChangeInput[], revision = "1") => {
    const response = await t.post("/api/direct-preview", { changes: inputs, settingsRevision: revision });
    if (!response.ok) return response;
    const preview = (await response.json()) as { previewVersion: string };
    return t.post("/api/direct-changes", { changes: inputs, settingsRevision: revision, previewVersion: preview.previewVersion });
  };

  it("defaults to review, persists a strict revisioned setting, and never writes HA when saving", async () => {
    const t = setup();
    expect(await (await t.get("/api/settings/general")).json()).toMatchObject({ general: { reviewChangesBeforeApplying: true }, revision: "0" });
    expect((await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false, extra: 1 }, { "If-Match": "0" })).status).toBe(400);
    expect((await save(t, false)).status).toBe(200);
    expect(t.settings.general().reviewChangesBeforeApplying).toBe(false);
    expect((await save(t, true)).status).toBe(409);
    expect((await t.post("/api/changes", AREA_RENAME)).status).toBe(409);
    expect((await t.post("/api/changes/batch", { changes: [AREA_RENAME] })).status).toBe(409);
    nothingWritten(t);
  });

  it("refuses a mode switch with a pending queue and never applies old changes", async () => {
    const t = setup();
    await t.queue(OTHER_RENAME);
    expect((await save(t, false)).status).toBe(409);
    expect((await direct(t, [AREA_RENAME], "0")).status).toBe(409);
    expect(t.changes.list()).toHaveLength(1);
    nothingWritten(t);
  });

  it("requires the current setting revision", async () => {
    const t = setup();
    await save(t, false);
    expect((await direct(t, [AREA_RENAME], "0")).status).toBe(409);
    expect((await t.post("/api/direct-changes", { changes: [AREA_RENAME], settingsRevision: "1", allowWithoutBackup: "yes" })).status).toBe(400);
    expect(t.changes.list()).toEqual([]);
    nothingWritten(t);
  });

  for (const mode of ["app", "dev"] as const)
    it(`applies direct changes in ${mode} without backup and preserves batch dependencies`, async () => {
      const backup = vi.fn(async () => ({ ok: false as const, reason: "must not run" }));
      const t = setup({ mode, backup });
      await save(t, false);
      const res = await direct(t, [
        {
          kind: "helper",
          op: "create",
          fields: { helper: "group", group_type: "light", name: "Study lights", entity_id: "light.study_all", entities: ["light.desk"], area_id: "study" },
        },
        {
          kind: "helper",
          op: "create",
          fields: {
            helper: "group",
            group_type: "light",
            name: "Study total",
            entity_id: "light.study_total",
            entities: ["light.study_all"],
            area_id: "study",
          },
        },
      ]);
      expect(res.status).toBe(200);
      expect((await res.json()) as ApplyResponse).toMatchObject({ ok: true, results: [{ ok: true }, { ok: true }] });
      expect(t.fake.home.entities.some((e) => e.entity_id === "light.study_all")).toBe(true);
      expect(t.changes.list()).toEqual([]);
      expect(t.history.runs()[0]).toMatchObject({ status: "completed" });
      expect(t.snapshots).toHaveLength(1);
      expect(backup).not.toHaveBeenCalled();
    });

  it("keeps a recovery queue after an HA read failure and blocks future direct edits", async () => {
    const t = setup({
      mode: "app",
      onApplyRead: async () => {
        throw new Error("HA read failed");
      },
    });
    await save(t, false);
    expect((await direct(t, [AREA_RENAME])).status).toBe(502);
    expect(t.changes.list()).toHaveLength(1);
    expect(t.history.runs()[0]).toMatchObject({ status: "failed" });
    t.fake.failRead.clear();
    expect((await direct(t, [OTHER_RENAME])).status).toBe(409);
    nothingWritten(t);
  });

  it("excludes another direct request and settings save while applying", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = setup({
      mode: "app",
      onApplyRead: async () => {
        await held;
      },
    });
    await save(t, false);
    const first = direct(t, [AREA_RENAME]);
    await vi.waitFor(() => expect(t.applyReads).toHaveLength(1));
    expect((await direct(t, [OTHER_RENAME])).status).toBe(409);
    expect((await save(t, true, "1")).status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect(t.writeTypes()).toEqual(["config/area_registry/update"]);
  });

  it("keeps failed work for review after a partial apply", async () => {
    const t = setup();
    await save(t, false);
    t.fake.after = ({ ws }) => {
      if (ws?.kind === "write" && ws.type === "config/area_registry/update") {
        const study = t.fake.home.areas.find((a) => a.area_id === "study")!;
        study.name = "Changed elsewhere";
      }
    };
    const res = await direct(t, [AREA_RENAME, OTHER_RENAME]);
    const body = (await res.json()) as ApplyResponse;
    expect(body.ok && body.results.some((r) => !r.ok)).toBe(true);
    expect(t.changes.list()).toHaveLength(1);
    expect((await direct(t, [AREA_RENAME])).status).toBe(409);
    expect(t.history.runs()[0].results.some((r) => !r.ok)).toBe(true);
  });
});

for (const mode of ["app", "dev"] as const)
  it(`applies a direct button assignment in ${mode} without backup`, async () => {
    const backup = vi.fn(async () => ({ ok: false as const, reason: "must not run" }));
    const t = setup({ mode, backup });
    withButtonDemo(t.fake.home);
    const list = (await (await t.get("/api/buttons")).json()) as {
      inventory: { controls: { id: string; gestures: { key: string }[] }[] };
      fingerprint: string;
    };
    const control = list.inventory.controls.find((c) => c.gestures.length > 0)!;
    expect(control).toBeDefined();
    const assignment = {
      controlId: control.id,
      gestureKey: control.gestures[0].key,
      action: { service: "light.toggle", entityId: "light.desk", data: {} },
      enabled: true,
      allowExisting: true,
      fingerprint: list.fingerprint,
      changesVersion: t.version(),
    };
    expect((await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" })).status).toBe(200);
    expect((await t.post("/api/buttons/assign", assignment)).status).toBe(409);
    const previewResponse = await t.post("/api/buttons/preview-assignment", { ...assignment, settingsRevision: "1" });
    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json()) as { previewVersion: string };
    const response = await t.post("/api/buttons/assign", {
      ...assignment,
      settingsRevision: "1",
      previewVersion: preview.previewVersion,
    });
    const body = (await response.json()) as ApplyResponse;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.ok && body.results.every((r) => r.ok), JSON.stringify(body)).toBe(true);
    expect(t.changes.list()).toEqual([]);
    expect(t.history.runs()[0].status).toBe("completed");
    expect(body.ok && body.backup.made).toBe(false);
    expect(backup).not.toHaveBeenCalled();
  });

it("fences stale direct clients across a mode round trip", async () => {
  const t = setup();
  const put = (review: boolean, revision: string) => t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: review }, { "If-Match": revision });
  expect((await put(false, "0")).status).toBe(200);
  expect((await put(true, "1")).status).toBe(200);
  expect((await put(false, "2")).status).toBe(200);
  expect(
    (await t.post("/api/direct-changes", { changes: [AREA_RENAME], settingsRevision: "1", previewVersion: "stale", allowWithoutBackup: true })).status,
  ).toBe(409);
  nothingWritten(t);
});

it("falls back to review if persisted general settings are malformed", () => {
  const t = setup();
  t.store.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("general", '{"reviewChangesBeforeApplying":"false"}');
  expect(t.settings.general().reviewChangesBeforeApplying).toBe(true);
});

it("rejects a review edit that was still reading when direct mode was enabled", async () => {
  const t = setup();
  t.fake.delayMs = 200;
  const staged = t.post("/api/changes", AREA_RENAME);
  await vi.waitFor(() => expect(t.fake.inFlight).toBeGreaterThan(0), { interval: 5 });
  const saved = await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" });
  expect(saved.status).toBe(200);
  expect((await staged).status).toBe(409);
  expect(t.changes.list()).toEqual([]);
  nothingWritten(t);
});

it("previews exact direct changes without saving or writing and refuses stale Home Assistant data", async () => {
  const t = setup();
  await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" });
  const request = { changes: [AREA_RENAME], settingsRevision: "1" };
  const response = await t.post("/api/direct-preview", request);
  const preview = (await response.json()) as {
    changes: { targetId: string; before: { name: string }; after: { name: string } }[];
    previewVersion: string;
    requiresNoBackupConfirmation: boolean;
  };
  expect(response.status).toBe(200);
  expect(preview.changes[0]).toMatchObject({ targetId: "kitchen", after: { name: "Cooking" } });
  expect(preview.requiresNoBackupConfirmation).toBe(false);
  expect(t.changes.list()).toEqual([]);
  nothingWritten(t);
  t.fake.home.areas.find((a) => a.area_id === "kitchen")!.name = "Externally changed";
  const commit = await t.post("/api/direct-changes", { ...request, previewVersion: preview.previewVersion, allowWithoutBackup: true });
  expect(commit.status).toBe(409);
  expect(t.changes.list()).toEqual([]);
  nothingWritten(t);
});

it("previews a local-only setting without saving it, then returns the authoritative saved revision", async () => {
  const t = setup();
  await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" });
  const prior = t.settings.inventory();
  const value = { ...prior, areas: { ...prior.areas, kitchen: { type: "exterior" } } };
  const body = { kind: "inventory", value, revision: "0", settingsRevision: "1" };
  const response = await t.post("/api/direct-settings-preview", body);
  const planned = (await response.json()) as { ok: boolean; error?: string; previewVersion: string; localOnly: boolean; notes: string[] };
  expect(response.status, JSON.stringify(planned)).toBe(200);
  expect(planned.localOnly).toBe(true);
  expect(planned.notes.length).toBeGreaterThan(0);
  expect(t.settings.inventory()).toEqual(prior);
  expect(t.changes.list()).toEqual([]);
  nothingWritten(t);
  const committed = await t.post("/api/direct-settings", { ...body, previewVersion: planned.previewVersion });
  expect(await committed.json()).toMatchObject({ ok: true, saved: { kind: "inventory", revision: "1" }, apply: null });
  expect(t.settings.inventory()).toEqual(value);
  nothingWritten(t);
});

it("saves confirmed setting and retains recovery queue if an HA read fails", async () => {
  const t = setup({
    mode: "app",
    onApplyRead: async () => {
      throw new Error("HA read failed");
    },
  });
  for (const id of ["binary_sensor.study_motion_a", "binary_sensor.study_motion_b"]) {
    t.fake.home.entities.push({ entity_id: id, platform: "demo", area_id: "study", unique_id: id });
    t.fake.home.states.push({ entity_id: id, state: "off", attributes: { device_class: "motion" } });
  }
  t.fake.home.entities.push({
    entity_id: "binary_sensor.study_motion_all",
    platform: "group",
    area_id: "study",
    config_entry_id: "fixture",
    unique_id: "group",
  });
  t.fake.home.states.push({
    entity_id: "binary_sensor.study_motion_all",
    state: "off",
    attributes: { device_class: "motion", entity_id: ["binary_sensor.study_motion_a", "binary_sensor.study_motion_b"] },
  });
  await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" });
  const value = setCounts(buildHierarchy(t.fake.home, "now"), t.settings.inventory(), "binary_sensor.study_motion_b", false);
  const request = { kind: "inventory", value, revision: "0", settingsRevision: "1" };
  const response = await t.post("/api/direct-settings-preview", request);
  const preview = (await response.json()) as { previewVersion: string; localOnly: boolean };
  expect(response.status, JSON.stringify(preview)).toBe(200);
  expect(preview.localOnly).toBe(false);
  expect(t.settings.inventory()).not.toEqual(value);
  const result = await t.post("/api/direct-settings", { ...request, previewVersion: preview.previewVersion });
  const payload = await result.json();
  expect(payload).toMatchObject({ ok: true, saved: { kind: "inventory", value, revision: "1" }, apply: { ok: false } });
  expect(t.settings.inventory()).toEqual(value);
  expect(t.changes.list()).toHaveLength(1);
  nothingWritten(t);
});

it("previews blueprint targets and timer or schedule replacements without writing", async () => {
  const t = setup();
  await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" });
  t.fake.home.entities.push({ entity_id: "timer.study_hold", platform: "timer", area_id: "study", unique_id: "study_hold" });
  t.fake.home.states.push({ entity_id: "timer.study_hold", state: "idle", attributes: { duration: "00:05:00" } });
  t.fake.home.entities.push({ entity_id: "schedule.study_comfort", platform: "schedule", area_id: "study", unique_id: "study_comfort" });
  t.fake.home.states.push({ entity_id: "schedule.study_comfort", state: "off", attributes: {} });
  const bp = blueprintForRecipe("occupancy");
  const changes: ChangeInput[] = [
    { kind: "blueprint", op: "create", fields: { path: bp.path, version: bp.version } },
    { kind: "helper", op: "update", targetId: "timer.study_hold", fields: { duration: 600 } },
    { kind: "helper", op: "update", targetId: "schedule.study_comfort", fields: { periods: "Mon 08:00-09:00" } },
  ];
  const response = await t.post("/api/direct-preview", { changes, settingsRevision: "1" });
  const payload = (await response.json()) as { changes: { kind: string; targetId: string; before: Record<string, unknown>; after: Record<string, unknown> }[] };
  expect(response.status, JSON.stringify(payload)).toBe(200);
  expect(payload.changes.find((c) => c.kind === "blueprint")).toMatchObject({ targetId: bp.path, after: { path: bp.path, version: bp.version } });
  expect(payload.changes.find((c) => c.targetId === "timer.study_hold")).toMatchObject({ before: { duration: 300 }, after: { duration: 600 } });
  const schedule = payload.changes.find((c) => c.targetId === "schedule.study_comfort")!;
  expect(schedule.before).not.toHaveProperty("periods");
  expect(schedule.after).toHaveProperty("periods", "Mon 08:00-09:00");
  expect(t.changes.list()).toEqual([]);
  nothingWritten(t);
});

it("rejects a stale direct setting preview before saving or staging", async () => {
  const t = setup();
  await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" });
  const original = t.settings.inventory();
  const value = { ...original, areas: { ...original.areas, kitchen: { type: "exterior" } } };
  const request = { kind: "inventory", value, revision: "0", settingsRevision: "1" };
  const preview = (await (await t.post("/api/direct-settings-preview", request)).json()) as { previewVersion: string };
  const changedRequest = { ...request, value: { ...original, areas: { ...original.areas, study: { type: "exterior" } } } };
  expect((await t.post("/api/direct-settings", { ...changedRequest, previewVersion: preview.previewVersion })).status).toBe(409);
  expect(t.settings.inventory()).toEqual(original);
  expect(t.changes.list()).toEqual([]);
  nothingWritten(t);
});

it("previews rename reference targets and rejects stale reference configurations", async () => {
  const t = setup();
  await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" });
  const request = {
    changes: [{ kind: "entity", op: "update", targetId: "light.living_spots", fields: { new_entity_id: "light.living_spots_new" } }],
    settingsRevision: "1",
  };
  const response = await t.post("/api/direct-preview", request);
  const preview = (await response.json()) as { previewVersion: string; notes: string[] };
  expect(response.status, JSON.stringify(preview)).toBe(200);
  expect(preview.notes.join("\n")).toMatch(/Update (automation|scene|dashboard) /);
  expect(preview.notes.join("\n")).toMatch(/Manual review:/);
  expect(preview.notes.join("\n")).toContain("light.living_spots_new");
  expect(t.changes.list()).toEqual([]);
  nothingWritten(t);
  const config = t.fake.home.automations["1700000000001"] as Record<string, unknown>;
  config.description = "changed after preview";
  const commit = await t.post("/api/direct-changes", { ...request, previewVersion: preview.previewVersion, allowWithoutBackup: true });
  expect(commit.status).toBe(409);
  expect(t.changes.list()).toEqual([]);
  nothingWritten(t);
});

it("commits an unchanged rename preview through the guarded runner", async () => {
  const t = setup();
  await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" });
  const request = {
    changes: [{ kind: "entity", op: "update", targetId: "light.living_spots", fields: { new_entity_id: "light.living_spots_new" } }],
    settingsRevision: "1",
  };
  const previewResponse = await t.post("/api/direct-preview", request);
  const preview = (await previewResponse.json()) as { previewVersion: string };
  expect(previewResponse.status).toBe(200);
  const commit = await t.post("/api/direct-changes", { ...request, previewVersion: preview.previewVersion, allowWithoutBackup: true });
  const result = (await commit.json()) as ApplyResponse;
  expect(commit.status, JSON.stringify(result)).toBe(200);
  expect(result.ok && result.results[0].ok).toBe(true);
  expect(t.fake.home.entities.some((e) => e.entity_id === "light.living_spots_new")).toBe(true);
});

it("refuses a rename if references change after review", async () => {
  let mutate = () => {};
  const t = setup({
    mode: "app",
    onApplyRead: async () => {
      mutate();
    },
  });
  mutate = () => {
    (t.fake.home.automations["1700000000001"] as Record<string, unknown>).description = "changed after review";
  };
  await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" });
  const request = {
    changes: [{ kind: "entity", op: "update", targetId: "light.living_spots", fields: { new_entity_id: "light.living_spots_new" } }],
    settingsRevision: "1",
  };
  const previewResponse = await t.post("/api/direct-preview", request);
  const preview = (await previewResponse.json()) as { previewVersion: string };
  expect(previewResponse.status).toBe(200);
  const commit = await t.post("/api/direct-changes", { ...request, previewVersion: preview.previewVersion });
  expect(commit.status).toBe(409);
  expect(((await commit.json()) as { error: string }).error).toMatch(/References changed/);
  expect(t.changes.list()).toHaveLength(1);
  nothingWritten(t);
});

it("previews a rename collision as manual and does not expose private config values", async () => {
  const t = setup();
  (t.fake.home.automations["1700000000001"] as Record<string, unknown>).secret = "PRIVATE_SENTINEL";
  (t.fake.home.automations["1700000000001"] as Record<string, unknown>).collision = { "light.living_spots": 1, "light.living_spots_new": 2 };
  await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" });
  const response = await t.post("/api/direct-preview", {
    changes: [{ kind: "entity", op: "update", targetId: "light.living_spots", fields: { new_entity_id: "light.living_spots_new" } }],
    settingsRevision: "1",
  });
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(JSON.stringify(body)).not.toContain("PRIVATE_SENTINEL");
  expect(body.notes.join("\n")).toMatch(/Manual review: automation 1700000000001 .*key collision/);
  nothingWritten(t);
});

it("previews area sensor repointing and fences newly affected areas", async () => {
  let mutate = () => {};
  const t = setup({
    mode: "app",
    onApplyRead: async () => {
      mutate();
    },
  });
  await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" });
  const request = {
    changes: [{ kind: "entity", op: "update", targetId: "sensor.living_temperature", fields: { new_entity_id: "sensor.living_temperature_new" } }],
    settingsRevision: "1",
  };
  const response = await t.post("/api/direct-preview", request);
  const preview = (await response.json()) as { previewVersion: string; notes: string[] };
  expect(response.status, JSON.stringify(preview)).toBe(200);
  expect(preview.notes.join("\n")).toContain(
    "Update area living_room (Living room) temperature_entity_id: sensor.living_temperature → sensor.living_temperature_new.",
  );
  mutate = () => {
    t.fake.home.areas.find((a) => a.area_id === "kitchen")!.humidity_entity_id = "sensor.living_temperature";
  };
  const commit = await t.post("/api/direct-changes", { ...request, previewVersion: preview.previewVersion });
  expect(commit.status).toBe(409);
  expect(t.changes.list()).toHaveLength(1);
  nothingWritten(t);
});

it("does not repoint an area added after the final reference check", async () => {
  const t = setup();
  await t.call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" });
  const request = {
    changes: [{ kind: "entity", op: "update", targetId: "sensor.living_temperature", fields: { new_entity_id: "sensor.living_temperature_new" } }],
    settingsRevision: "1",
  };
  const response = await t.post("/api/direct-preview", request);
  const preview = (await response.json()) as { previewVersion: string };
  expect(response.status).toBe(200);
  t.fake.after = ({ ws }) => {
    if (ws?.kind === "write" && ws.type === "config/entity_registry/update")
      t.fake.home.areas.find((a) => a.area_id === "kitchen")!.humidity_entity_id = "sensor.living_temperature";
  };
  const commit = await t.post("/api/direct-changes", { ...request, previewVersion: preview.previewVersion, allowWithoutBackup: true });
  const result = (await commit.json()) as ApplyResponse;
  expect(commit.status, JSON.stringify(result)).toBe(200);
  expect(t.fake.home.areas.find((a) => a.area_id === "living_room")?.temperature_entity_id).toBe("sensor.living_temperature_new");
  expect(t.fake.home.areas.find((a) => a.area_id === "kitchen")?.humidity_entity_id).toBe("sensor.living_temperature");
  expect(result.ok && result.results[0].details?.join(" ")).toMatch(/changed after the preview/);
});
