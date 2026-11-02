import { expect, it, vi } from "vitest";
import { buildMockRegistry } from "../../scripts/mock-ha-core.ts";
import { blueprintForRecipe } from "../../shared/blueprints.ts";
import { EMPTY_INVENTORY } from "../../shared/inventory.ts";
import { EMPTY_PARAMETERS, setParameter } from "../../shared/parameters.ts";
import { NOTHING_INSTALLED } from "../../shared/recipes.ts";
import { planHouseRecipes } from "../../shared/recipes-house.ts";
import { resolveSpaces, spaceIds } from "../../shared/spaces.ts";
import { createApp } from "../app.ts";
import { testStore } from "../ai/test-store.ts";
import { applyHistory } from "./history.ts";
import { changeStore } from "./store.ts";
import { fakeHa } from "../references/fake-ha.ts";
import { buildHierarchy } from "../model/hierarchy.ts";
import { settingsStore } from "../settings.ts";

it("previews and applies an Office setting delta only, after saving exactly the reviewed parameters", async () => {
  const store = testStore();
  try {
    const fake = fakeHa(buildMockRegistry());
    const settings = settingsStore(store.store.db);
    const changes = changeStore(store.store.db);
    const history = applyHistory(store.store.db);
    const areas = ["kitchen", "study", "bathroom"];
    const spaceNames = ["Office", "Studio", "Keli"];
    for (const [i, area] of areas.entries()) {
      const labelId = `space_${i}`;
      fake.home.labels.push({ label_id: labelId, name: `Space: ${spaceNames[i]}` });
      let target = fake.home.areas.find((row) => row.area_id === area);
      if (!target) {
        target = { area_id: area, name: area };
        fake.home.areas.push(target);
      }
      target.labels = [labelId];
      for (const [id, platform, state] of [
        [`media_player.${area}_test_speaker`, "mqtt", "on"],
        [`binary_sensor.${area}_occupied`, "template", "on"],
        [`input_boolean.${area}_paused`, "input_boolean", "off"],
      ]) {
        fake.home.entities.push({ entity_id: id, platform, area_id: area, config_entry_id: `fixture_${area}`, unique_id: id });
        fake.home.states.push({ entity_id: id, state, attributes: {} });
      }
      const automationId = `taxis_occupancy_${area}`;
      fake.home.automations[automationId] = { alias: `${area} Occupancy`, use_blueprint: { path: "taxis/occupancy.yaml", input: {} } };
      fake.home.states.push({ entity_id: `automation.${automationId}`, state: "on", attributes: { id: automationId } });
    }
    for (const name of ["office", "studio", "keli", "preserved"]) {
      fake.home.entities.push({ entity_id: `tts.${name}`, platform: "tts", unique_id: name });
      fake.home.states.push({ entity_id: `tts.${name}`, state: "idle", attributes: {} });
    }
    const naming = { ...settings.naming(), areaCodes: { kitchen: "kitchen", study: "study", bathroom: "bathroom" } };
    settings.saveNaming(naming);
    let before = EMPTY_PARAMETERS;
    for (const [i, name] of ["office", "studio", "keli"].entries())
      before = setParameter(before, { level: "space", id: `space_${i}` }, "tts_entity", `tts.${name}`);
    settings.saveParameters(before);
    const h = buildHierarchy(structuredClone(fake.home), "now");
    const installed = structuredClone(NOTHING_INSTALLED);
    for (const area of areas) installed.automations[`taxis_occupancy_${area}`] = { alias: `${area} Occupancy`, path: "taxis/occupancy.yaml", input: {} };
    const bp = blueprintForRecipe("announce");
    fake.home.scriptBlueprints ??= {};
    fake.home.scriptBlueprints[bp.path] = bp.yaml;
    for (const space of resolveSpaces(h)) {
      const cell = planHouseRecipes(h, EMPTY_INVENTORY, naming, before, installed, [], true, { kind: "space", space }).find((x) => x.recipe === "announce")!;
      const input = cell.inputs.find((x) => x.kind === "script")!;
      const blueprint = input.fields!.use_blueprint as { path: string; input: Record<string, unknown> };
      const id = spaceIds(space.id).announce;
      fake.home.scripts[id] = {
        alias: input.fields!.alias,
        use_blueprint: { path: blueprint.path, input: { ...blueprint.input, tts_entity: "tts.preserved" } },
      };
      fake.home.states.push({ entity_id: `script.${id}`, state: "off", attributes: {} });
    }
    const unchanged = structuredClone(fake.home.scripts);
    const app = createApp({
      mode: "dev",
      version: "test",
      target: { ok: true, target: { wsUrl: "ws://ha.test/api/websocket", restUrl: "http://ha.test/api", token: "mock-token", mode: "dev" } },
      ha: fake.ha,
      rest: fake.api,
      backup: async () => ({ ok: true, name: "test", slug: "test" }),
      db: store.store.db,
      settings,
      changes,
      history,
      saveSnapshot: () => {},
      clock: Date.now,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      webRoot: null,
    });
    const call = (method: string, path: string, value: unknown, headers: Record<string, string> = {}) =>
      app.request(path, { method, headers: { "x-taxis-request": "1", "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
    expect((await call("PUT", "/api/settings/general", { reviewChangesBeforeApplying: false }, { "If-Match": "0" })).status).toBe(200);
    const after = setParameter(before, { level: "space", id: "space_0" }, "announce_volume", 65);
    const request = { kind: "parameters", value: after, revision: "0", settingsRevision: "1" };
    const previewResponse = await call("POST", "/api/direct-settings-preview", request);
    const preview = (await previewResponse.json()) as { previewVersion: string; changes: { targetId: string }[]; error?: string };
    expect(previewResponse.status, JSON.stringify(preview)).toBe(200);
    expect(preview.changes.map((change) => change.targetId)).toEqual([spaceIds("space_0").announce]);
    expect(settings.parameters()).toEqual(before);
    expect(fake.writes()).toEqual({ ws: [], rest: [] });
    const response = await call("POST", "/api/direct-settings", { ...request, previewVersion: preview.previewVersion, allowWithoutBackup: true });
    const result = (await response.json()) as { ok: boolean; error?: string; apply?: { ok: boolean } };
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, apply: { ok: true } });
    expect(settings.parameters()).toEqual(after);
    expect(fake.writes().ws).toEqual([]);
    expect(fake.writes().rest.map((write) => [write.method, write.path])).toEqual([["POST", `/api/config/script/config/${spaceIds("space_0").announce}`]]);
    expect(fake.home.scripts[spaceIds("space_1").announce]).toEqual(unchanged[spaceIds("space_1").announce]);
    expect(fake.home.scripts[spaceIds("space_2").announce]).toEqual(unchanged[spaceIds("space_2").announce]);
    const changed = fake.home.scripts[spaceIds("space_0").announce];
    expect(changed).toMatchObject({ use_blueprint: { input: { default_volume: 65, tts_entity: "tts.preserved" } } });
  } finally {
    store.close();
  }
});
