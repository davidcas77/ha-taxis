// Renaming entity ids: Apply renames in the registry, then replaces the old id
// in what uses it, over the fake Home Assistant, recording every call so the
// tests can say what was NOT written as well as what was.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { buildMockRegistry, handleMock } from "../../scripts/mock-ha-core.ts";
import { validateInput } from "../../shared/changes.ts";
import type { ChangeInput } from "../../shared/types.ts";
import { fakeHa } from "../references/fake-ha.ts";
import { buildHierarchy } from "../model/hierarchy.ts";
import { applyChanges } from "./apply.ts";
import { changeStore } from "./store.ts";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE changes (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, op TEXT NOT NULL, target_id TEXT NOT NULL,
    scope TEXT, before TEXT NOT NULL, after TEXT NOT NULL, created_at TEXT NOT NULL)`);
  const store = changeStore(db);
  const fake = fakeHa(buildMockRegistry());
  const add = (input: ChangeInput) => validateInput(input) ?? store.add(input, buildHierarchy(structuredClone(fake.home), "now"));
  const rename = (from: string, to: string) => {
    const refused = add({ kind: "entity", op: "update", targetId: from, fields: { new_entity_id: to } });
    expect(refused).toBeNull();
  };
  // What the server does after Apply: changes that took leave the list.
  const apply = async () => {
    const out = await applyChanges(store.list(), fake.ha, fake.readFresh, { ha: fake.ha, rest: fake.api });
    for (const id of out.appliedIds) store.done(id);
    return out;
  };
  const entity = (id: string) => fake.home.entities.find((e) => e.entity_id === id);
  const state = (id: string) => fake.home.states.find((s) => s.entity_id === id);
  return { store, fake, add, rename, apply, entity, state };
}

describe("renaming light.living_spots", () => {
  it("renames it, rewrites the automation, scene and default dashboard, and lists the rest", async () => {
    const t = setup();
    const wall = structuredClone(t.fake.home.dashboards.find((d) => d.url_path === "dashboard-wall")!.config);
    const hallNight = structuredClone(t.fake.home.yamlAutomations.hall_night);
    t.rename("light.living_spots", "light.living_ceiling");

    const { results, appliedIds } = await t.apply();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: true, message: "Applied." });
    expect(results[0].details).toEqual([
      "Updated automation “Lights on at sunset” (1 place)",
      "Updated scene “Evening” (1 place)",
      "Updated dashboard “Overview” (2 places)",
      "Needs a hand: Hall night light: Written in YAML: change it in the file.",
      "Needs a hand: Wall panel: Written in YAML: change it in the file.",
      "Needs a hand: Living all: A YAML group: change it in the file.",
      "Needs a hand: Downstairs: A helper: open its options in Home Assistant and pick the new entity.",
    ]);
    expect(appliedIds).toEqual([results[0].changeId]);
    expect(t.store.list()).toEqual([]);

    // The registry and the state.
    expect(t.entity("light.living_ceiling")).toBeDefined();
    expect(t.entity("light.living_spots")).toBeUndefined();
    expect(t.state("light.living_ceiling")).toBeDefined();
    expect(t.state("light.living_spots")).toBeUndefined();

    // What used it.
    const { home } = t.fake;
    expect(home.automations["1700000000001"].actions).toEqual([{ action: "light.turn_on", target: { entity_id: ["light.living_ceiling", "light.living_lamp"] } }]);
    expect(home.scenes["1700000000100"].entities).toEqual({ "light.living_ceiling": { state: "on", brightness: 120 }, "light.living_lamp": "off" });
    expect(JSON.stringify(home.dashboards.find((d) => d.url_path === null)!.config)).not.toContain("light.living_spots");
    expect(JSON.stringify(home.dashboards.find((d) => d.url_path === null)!.config).match(/light\.living_ceiling/g)).toHaveLength(2);
    // The new alias shows in the state: HA derives it from the saved config.
    expect(t.state("automation.lights_on_at_sunset")!.attributes!.friendly_name).toBe("Lights on at sunset");

    // What Taxis can't edit is as it was.
    expect(home.yamlAutomations.hall_night).toEqual(hallNight);
    expect(home.dashboards.find((d) => d.url_path === "dashboard-wall")!.config).toEqual(wall);
  });

  it("reads what uses the id before it writes anything, and writes only what it should", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    await t.apply();

    const firstWrite = t.fake.ws.findIndex((c) => c.kind === "write");
    expect(t.fake.ws[firstWrite]).toMatchObject({ type: "config/entity_registry/update", payload: { entity_id: "light.living_spots", new_entity_id: "light.living_ceiling" } });
    const before = t.fake.ws.slice(0, firstWrite).map((c) => c.type);
    expect(before).toContain("search/related");
    expect(before).toContain("lovelace/dashboards/list");
    expect(t.fake.ws.slice(0, firstWrite).filter((c) => c.type === "lovelace/config")).toHaveLength(4);

    const writes = t.fake.writes();
    expect(writes.ws.map((c) => c.type)).toEqual(["config/entity_registry/update", "lovelace/config/save"]);
    expect(writes.ws[1].payload).toMatchObject({ url_path: null });
    // Only the three UI configs that use it are posted: not the other automation,
    // not the script, not the YAML automation.
    expect(writes.rest.map((c) => c.path).sort()).toEqual(["/api/config/automation/config/1700000000001", "/api/config/scene/config/1700000000100"]);
    expect(writes.rest.every((c) => c.status === 200)).toBe(true);
    // The YAML dashboard and the other dashboards were not saved.
    expect(writes.ws.filter((c) => c.type === "lovelace/config/save")).toHaveLength(1);
    // And no service was called, nothing deleted.
    expect(t.fake.ws.every((c) => !/call_service|delete|remove/.test(c.type))).toBe(true);
    expect(t.fake.rest.every((c) => c.method === "GET" || c.method === "POST")).toBe(true);
  });

  it("checks each config again right before writing, and reads it back after", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    await t.apply();
    const automation = t.fake.rest.filter((c) => c.path.endsWith("/1700000000001")).map((c) => c.method);
    // snapshot, re-read before the write, write, read back
    expect(automation).toEqual(["GET", "GET", "POST", "GET"]);
    const dashboard = t.fake.ws.filter((c) => c.type.startsWith("lovelace/config") && c.payload.url_path === null).map((c) => c.type);
    expect(dashboard).toEqual(["lovelace/config", "lovelace/config", "lovelace/config/save", "lovelace/config"]);
  });
});

describe("renaming several entities at once", () => {
  it("rewrites a config that uses more than one of them in a single write", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    t.rename("light.living_lamp", "light.living_floor");
    const { results } = await t.apply();
    expect(results.every((r) => r.ok)).toBe(true);

    // The automation and the scene use both: one POST each, with both replaced.
    const posts = t.fake.writes().rest;
    expect(posts.filter((c) => c.path.endsWith("/1700000000001"))).toHaveLength(1);
    expect(posts.filter((c) => c.path.endsWith("/1700000000100"))).toHaveLength(1);
    expect(t.fake.home.automations["1700000000001"].actions).toEqual([{ action: "light.turn_on", target: { entity_id: ["light.living_ceiling", "light.living_floor"] } }]);
    expect(Object.keys(t.fake.home.scenes["1700000000100"].entities as object)).toEqual(["light.living_ceiling", "light.living_floor"]);
    // The script uses only the lamp.
    expect(t.fake.home.scripts.movie_time.sequence).toEqual([
      { action: "media_player.turn_on", target: { entity_id: "media_player.living_tv" } },
      { action: "light.turn_off", target: { entity_id: "light.living_floor" } },
    ]);

    // Each rename lists its own places.
    const spots = results[0].details!;
    const lamp = results[1].details!;
    expect(spots).toContain("Updated automation “Lights on at sunset” (1 place)");
    expect(lamp).toContain("Updated automation “Lights on at sunset” (1 place)");
    expect(lamp).toContain("Updated script “Movie time” (1 place)");
    expect(spots.some((d) => d.includes("Movie time"))).toBe(false);
    expect(lamp).toContain("Needs a hand: All lamps: A YAML group: change it in the file.");
  });
});

describe("an area's temperature sensor", () => {
  it("points the area at the new id, which Home Assistant leaves alone", async () => {
    const t = setup();
    t.rename("sensor.living_temperature", "sensor.living_room_temperature");
    const { results } = await t.apply();

    expect(results[0]).toMatchObject({ ok: true });
    expect(results[0].details).toContain("Updated area “Living room” (temperature sensor)");
    expect(results[0].details).toContain("Updated dashboard “Overview” (2 places)");
    const area = t.fake.home.areas.find((a) => a.area_id === "living_room")!;
    expect(area.temperature_entity_id).toBe("sensor.living_room_temperature");
    const writes = t.fake.writes().ws.map((c) => [c.type, c.payload]);
    expect(writes).toContainEqual(["config/area_registry/update", { area_id: "living_room", temperature_entity_id: "sensor.living_room_temperature" }]);
    // Nothing else about the area is sent.
    expect(writes.filter(([type]) => type === "config/area_registry/update")).toHaveLength(1);
  });

  it("leaves areas that use other sensors alone", async () => {
    const t = setup();
    t.rename("sensor.living_window_temperature", "sensor.living_window_temp");
    const { results } = await t.apply();
    expect(results[0].ok).toBe(true);
    expect(t.fake.writes().ws.map((c) => c.type)).toEqual(["config/entity_registry/update"]);
    expect(t.fake.home.areas.find((a) => a.area_id === "living_room")!.temperature_entity_id).toBe("sensor.living_temperature");
  });
});

describe("a config that changed after Taxis read it", () => {
  it("is skipped and reported, and the others are still updated", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    let edited = false;
    t.fake.after = (call) => {
      // Someone saves the automation in Home Assistant right after Taxis read it.
      if (!edited && call.rest?.method === "GET" && call.rest.path.endsWith("/1700000000001")) {
        edited = true;
        t.fake.home.automations["1700000000001"].description = "Edited meanwhile";
      }
    };
    const { results } = await t.apply();

    expect(edited).toBe(true);
    expect(results[0].ok).toBe(true);
    expect(results[0].details).toContain("Not updated: automation “Lights on at sunset” changed in Home Assistant since Taxis read it; update it by hand.");
    expect(results[0].details).toContain("Updated scene “Evening” (1 place)");
    // The edit is untouched and still has the old id: nothing was written to it.
    expect(t.fake.writes().rest.map((c) => c.path)).toEqual(["/api/config/scene/config/1700000000100"]);
    expect(t.fake.home.automations["1700000000001"].description).toBe("Edited meanwhile");
    expect(JSON.stringify(t.fake.home.automations["1700000000001"])).toContain("light.living_spots");
  });

  it("is skipped for a dashboard too", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    let reads = 0;
    t.fake.after = (call) => {
      if (call.ws?.type === "lovelace/config" && call.ws.payload.url_path === null && ++reads === 1) {
        t.fake.home.dashboards[0].config!.views = [];
      }
    };
    const { results } = await t.apply();
    expect(results[0].details).toContain("Not updated: dashboard “Overview” changed in Home Assistant since Taxis read it; update it by hand.");
    expect(t.fake.writes().ws.map((c) => c.type)).toEqual(["config/entity_registry/update"]);
  });

  it("is skipped when Home Assistant stops serving it as editable", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    t.fake.after = (call) => {
      if (call.rest?.method === "GET" && call.rest.path.endsWith("/1700000000100")) delete t.fake.home.scenes["1700000000100"];
    };
    const { results } = await t.apply();
    expect(results[0].details).toContain("Not updated: scene “Evening” can't be edited in Home Assistant any more. Update it by hand.");
  });
});

describe("when a config can't be written", () => {
  it("the rename still counts as done, and the failure is listed", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    t.fake.restStatus = (method, path) => (method === "POST" && path.endsWith("/1700000000001") ? 500 : null);
    const { results, appliedIds } = await t.apply();

    expect(results[0].ok).toBe(true);
    expect(appliedIds).toEqual([results[0].changeId]);
    expect(t.store.list()).toEqual([]);
    expect(t.entity("light.living_ceiling")).toBeDefined();
    expect(results[0].details).toContain("Not updated: automation “Lights on at sunset”: Home Assistant refused it (Home Assistant refused to save the automation (HTTP 500: forced 500).). Update it by hand.");
    expect(results[0].details).toContain("Updated scene “Evening” (1 place)");
  });

  it("is reported when Home Assistant says yes but the old id is still there", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    const original = structuredClone(t.fake.home.automations["1700000000001"]);
    // Home Assistant accepts the POST and quietly keeps the old config.
    t.fake.after = (call) => {
      if (call.rest?.method === "POST" && call.rest.path.endsWith("/1700000000001")) t.fake.home.automations["1700000000001"] = structuredClone(original);
    };
    const { results } = await t.apply();
    expect(results[0].ok).toBe(true);
    expect(results[0].details).toContain("Not updated: automation “Lights on at sunset” still uses the old id after saving (1 place). Check it in Home Assistant.");
  });

  it("a dashboard Home Assistant refuses to save is listed", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    t.fake.home.dashboards[0].mode = "yaml";
    // Taxis can't tell the mode, assumes storage, tries, and is refused.
    t.fake.failRead.add("lovelace/info");
    const { results } = await t.apply();
    expect(results[0].ok).toBe(true);
    expect(results[0].details!.join("\n")).toMatch(/Not updated: dashboard “Overview”: Home Assistant refused it \(Dashboard is in YAML mode, can't save.\)/);
  });

  it("a default dashboard in YAML mode is not edited, and is listed as needing a hand", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    t.fake.home.dashboards[0].mode = "yaml";
    const yaml = structuredClone(t.fake.home.dashboards[0].config);
    const { results } = await t.apply();
    expect(results[0].ok).toBe(true);
    expect(results[0].details).toContain("Needs a hand: Overview: Written in YAML: change it in the file.");
    expect(results[0].details!.some((d) => /dashboard “Overview”/.test(d) && /^(Updated|Not updated)/.test(d))).toBe(false);
    expect(t.fake.writes().ws.map((c) => c.type)).toEqual(["config/entity_registry/update"]);
    expect(t.fake.home.dashboards[0].config).toEqual(yaml);
  });
});

describe("a rename Home Assistant refuses", () => {
  it("writes no configs at all", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    // The id was free when the rename was made; now it isn't.
    t.fake.home.entities.push({ entity_id: "light.living_ceiling", platform: "demo" });
    t.fake.home.states.push({ entity_id: "light.living_ceiling", state: "off", attributes: {} });
    const { results, appliedIds } = await t.apply();

    expect(results[0].ok).toBe(false);
    expect(results[0].message).toMatch(/refused it: Entity with this ID is already registered/);
    expect(appliedIds).toEqual([]);
    expect(t.store.list()).toHaveLength(1);
    const writes = t.fake.writes();
    expect(writes.ws.map((c) => c.type)).toEqual(["config/entity_registry/update"]);
    expect(writes.rest).toEqual([]);
    expect(t.entity("light.living_spots")).toBeDefined();
    expect(JSON.stringify(t.fake.home.automations)).toContain("light.living_spots");
  });

  it("is also not trusted when the registry doesn't show it afterwards", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    // Home Assistant answers success and changes nothing.
    const liar = { write: async <T,>() => ({}) as T };
    const { results } = await applyChanges(t.store.list(), liar, t.fake.readFresh, { ha: t.fake.ha, rest: t.fake.api });
    expect(results[0].ok).toBe(false);
    expect(results[0].message).toMatch(/entity id|old id|doesn't show|no longer/i);
    expect(results[0].details).toEqual([expect.stringMatching(/^Not updated: automations, scripts, scenes and dashboards were left alone/)]);
    expect(t.fake.writes()).toEqual({ ws: [], rest: [] });
  });
});

describe("when what uses an id can't be read", () => {
  it("doesn't rename, so nothing is left pointing at a missing id; other changes go ahead", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { name: "Desk" } });
    t.fake.failRead.add("search/related");
    const { results } = await t.apply();

    expect(results.map((r) => r.ok)).toEqual([false, true]);
    expect(results[0].message).toMatch(/couldn't check what uses it/);
    expect(t.entity("light.living_spots")).toBeDefined();
    expect(t.fake.writes().ws.map((c) => [c.type, c.payload.entity_id])).toEqual([["config/entity_registry/update", "light.desk"]]);
    expect(t.fake.writes().rest).toEqual([]);
  });

  it("an unreadable automation is noted, not fatal", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    t.fake.restStatus = (method, path) => (method === "GET" && path.endsWith("/1700000000002") ? 500 : null);
    const { results } = await t.apply();
    expect(results[0].ok).toBe(true);
    expect(results[0].details!.some((d) => /^Not updated: couldn't read automation “Kitchen motion light” .*Check it by hand\.$/.test(d))).toBe(true);
    expect(results[0].details).toContain("Updated automation “Lights on at sunset” (1 place)");
  });
});

describe("renaming a script", () => {
  // Home Assistant runs a script by its config key, so after the rename
  // `action: script.movie_time` still works and `action: script.film` would not.
  const callers = (t: ReturnType<typeof setup>) => {
    const { home } = t.fake;
    // Only calls it: nothing to rewrite.
    home.automations["1700000000001"].actions = [{ action: "script.movie_time" }];
    // Calls it, and also names it as an entity.
    home.automations["1700000000002"].actions = [
      { action: "script.movie_time" },
      { action: "script.turn_on", target: { entity_id: "script.movie_time" } },
    ];
    home.dashboards[0].config = {
      views: [{ cards: [{ type: "button", entity: "script.movie_time", tap_action: { action: "perform-action", perform_action: "script.movie_time" } }] }],
    };
  };

  it("keeps 'action: script.old' and rewrites the entity references, and says so", async () => {
    const t = setup();
    callers(t);
    t.rename("script.movie_time", "script.film");
    const { results } = await t.apply();

    expect(results[0]).toMatchObject({ ok: true, message: "Applied." });
    const { home } = t.fake;
    expect(home.automations["1700000000001"].actions).toEqual([{ action: "script.movie_time" }]);
    expect(home.automations["1700000000002"].actions).toEqual([
      { action: "script.movie_time" },
      { action: "script.turn_on", target: { entity_id: "script.film" } },
    ]);
    expect(home.dashboards[0].config).toEqual({
      views: [{ cards: [{ type: "button", entity: "script.film", tap_action: { action: "perform-action", perform_action: "script.movie_time" } }] }],
    });
    // The config key is what Home Assistant runs it by; it didn't move.
    expect(Object.keys(home.scripts)).toEqual(["movie_time"]);

    const details = results[0].details!;
    expect(details).toContain("Kept “action: script.movie_time” in automation “Lights on at sunset”: Home Assistant still runs the script by its old key.");
    expect(details).toContain("Kept “action: script.movie_time” in automation “Kitchen motion light”: Home Assistant still runs the script by its old key.");
    expect(details).toContain("Kept “perform_action: script.movie_time” in dashboard “Overview”: Home Assistant still runs the script by its old key.");
    expect(details).toContain("Updated automation “Kitchen motion light” (1 place)");
    expect(details).toContain("Updated dashboard “Overview” (1 place)");
    // Kept is not a task for the user, and not a failure.
    expect(details.some((d) => d.startsWith("Needs a hand") || d.startsWith("Not updated"))).toBe(false);
    // The automation that only calls the script is not written at all.
    expect(t.fake.writes().rest.map((c) => c.path)).toEqual(["/api/config/automation/config/1700000000002"]);
  });

  it("writes nothing to a config that only calls the script", async () => {
    const t = setup();
    callers(t);
    t.fake.home.automations["1700000000002"].actions = [{ action: "script.movie_time" }];
    t.fake.home.dashboards[0].config = { views: [{ cards: [{ type: "button", tap_action: { action: "perform-action", perform_action: "script.movie_time" } }] }] };
    t.rename("script.movie_time", "script.film");
    const { results } = await t.apply();
    expect(results[0].ok).toBe(true);
    expect(t.fake.writes().rest).toEqual([]);
    expect(t.fake.writes().ws.map((c) => c.type)).toEqual(["config/entity_registry/update"]);
    expect(results[0].details!.filter((d) => d.startsWith("Kept"))).toHaveLength(3);
  });

  it("finds a script's config by its registry unique_id after an earlier rename", async () => {
    const t = setup();
    // Renamed before: the entity is script.film, the config key is still movie_time.
    expect(handleMock(t.fake.home, "config/entity_registry/update", { entity_id: "script.movie_time", new_entity_id: "script.film" }).success).toBe(true);
    t.rename("light.living_lamp", "light.living_floor");
    const { results } = await t.apply();

    expect(results[0].ok).toBe(true);
    expect(results[0].details).toContain("Updated script “Movie time” (1 place)");
    expect(t.fake.home.scripts.movie_time.sequence).toEqual([
      { action: "media_player.turn_on", target: { entity_id: "media_player.living_tv" } },
      { action: "light.turn_off", target: { entity_id: "light.living_floor" } },
    ]);
    const script = t.fake.rest.filter((c) => c.path.includes("/script/"));
    expect(script.every((c) => c.path.endsWith("/movie_time") && c.status === 200)).toBe(true);
    expect(script.map((c) => c.method)).toEqual(["GET", "GET", "POST", "GET"]);
  });
});

describe("a rename that landed but couldn't be read back", () => {
  // The first read is the one before writing; the second is the check after.
  const flaky = (t: ReturnType<typeof setup>) => {
    let reads = 0;
    return async () => {
      if (++reads === 2) throw new Error("connection lost");
      return t.fake.readFresh();
    };
  };
  const firstApply = async (t: ReturnType<typeof setup>) => {
    const out = await applyChanges(t.store.list(), t.fake.ha, flaky(t), { ha: t.fake.ha, rest: t.fake.api });
    for (const id of out.appliedIds) t.store.done(id);
    return out;
  };

  it("is finished by the next Apply, which doesn't send the rename again", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    const first = await firstApply(t);

    expect(first.results[0].ok).toBe(false);
    expect(first.results[0].message).toMatch(/couldn't read Home Assistant back/);
    expect(first.retargets).toEqual([]);
    // The rename is in the registry, the change is still in the list under the old id, nothing uses the new id yet.
    expect(t.entity("light.living_ceiling")).toBeDefined();
    expect(t.store.list()).toHaveLength(1);
    expect(t.store.list()[0].targetId).toBe("light.living_spots");
    expect(JSON.stringify(t.fake.home.automations)).toContain("light.living_spots");

    t.fake.ws.length = 0;
    t.fake.rest.length = 0;
    const second = await t.apply();

    expect(second.results[0]).toMatchObject({ ok: true });
    expect(second.retargets).toEqual([]);
    expect(t.store.list()).toEqual([]);
    // Not sent again: the only writes are the dashboard and the two configs.
    expect(t.fake.writes().ws.map((c) => c.type)).toEqual(["lovelace/config/save"]);
    expect(t.fake.writes().rest.map((c) => c.path).sort()).toEqual(["/api/config/automation/config/1700000000001", "/api/config/scene/config/1700000000100"]);
    expect(second.results[0].details).toContain("Updated automation “Lights on at sunset” (1 place)");
    expect(second.results[0].details).toContain("Updated dashboard “Overview” (2 places)");
    expect(JSON.stringify(t.fake.home.automations["1700000000001"])).toContain("light.living_ceiling");
    expect(JSON.stringify(t.fake.home.automations["1700000000001"])).not.toContain("light.living_spots");
  });

  it("also sends the change's other fields, to the new id", async () => {
    const t = setup();
    expect(t.add({ kind: "entity", op: "update", targetId: "light.living_spots", fields: { new_entity_id: "light.living_ceiling", name: "Ceiling" } })).toBeNull();
    await firstApply(t);
    expect(t.store.list()).toHaveLength(1);

    t.fake.ws.length = 0;
    const second = await t.apply();
    expect(second.results[0]).toMatchObject({ ok: true });
    expect(t.store.list()).toEqual([]);
    const registry = t.fake.writes().ws.filter((c) => c.type === "config/entity_registry/update");
    expect(registry.map((c) => c.payload)).toEqual([{ entity_id: "light.living_ceiling", name: "Ceiling" }]);
    expect(t.entity("light.living_ceiling")!.name).toBe("Ceiling");
    expect(second.results[0].details).toContain("Updated scene “Evening” (1 place)");
  });

  it("keeps the change when what uses the old id can't be read, so the next Apply tries again", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    await firstApply(t);

    t.fake.failRead.add("search/related");
    t.fake.ws.length = 0;
    const second = await t.apply();
    expect(second.results[0].ok).toBe(false);
    expect(second.results[0].message).toMatch(/couldn't check what uses it.*didn't update them/);
    expect(second.retargets).toEqual([]);
    expect(t.store.list()).toHaveLength(1);
    expect(t.fake.writes()).toEqual({ ws: [], rest: [] });

    t.fake.failRead.clear();
    const third = await t.apply();
    expect(third.results[0].ok).toBe(true);
    expect(t.store.list()).toEqual([]);
  });

  it("still counts as an ordinary failure when the new id isn't there either", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    t.fake.home.entities = t.fake.home.entities.filter((e) => e.entity_id !== "light.living_spots");
    t.fake.home.states = t.fake.home.states.filter((s) => s.entity_id !== "light.living_spots");
    const { results } = await t.apply();
    expect(results[0]).toMatchObject({ ok: false, message: "It's no longer in Home Assistant." });
    expect(t.fake.writes()).toEqual({ ws: [], rest: [] });
  });
});

describe("a rename that verified while another field of the change didn't", () => {
  // Home Assistant takes the rename and quietly drops the name.
  const dropsName = (t: ReturnType<typeof setup>) => ({
    write: <T,>(type: string, payload: Record<string, unknown>) => {
      const { name: _name, ...rest } = payload;
      return t.fake.ha.write<T>(type, type === "config/entity_registry/update" ? rest : payload);
    },
  });
  const renameAndName = (t: ReturnType<typeof setup>) =>
    expect(t.add({ kind: "entity", op: "update", targetId: "light.living_spots", fields: { new_entity_id: "light.living_ceiling", name: "Ceiling" } })).toBeNull();

  it("reports the change as failed and hands back the rest, aimed at the new id", async () => {
    const t = setup();
    renameAndName(t);
    const change = t.store.list()[0];
    const out = await applyChanges(t.store.list(), dropsName(t), t.fake.readFresh, { ha: t.fake.ha, rest: t.fake.api });

    expect(out.results[0].ok).toBe(false);
    expect(out.results[0].message).toMatch(/^Renamed, but its name /);
    expect(out.appliedIds).toEqual([]);
    const { new_entity_id: _a, ...before } = change.before;
    expect(out.retargets).toEqual([{ changeId: change.id, targetId: "light.living_ceiling", after: { name: "Ceiling" }, before }]);
    // The rename did its job: what used the old id was updated.
    expect(out.results[0].details).toContain("Updated automation “Lights on at sunset” (1 place)");
    expect(t.entity("light.living_ceiling")).toBeDefined();
  });

  it("keeps it in the list as an ordinary update, and the next Apply finishes it", async () => {
    const t = setup();
    renameAndName(t);
    const out = await applyChanges(t.store.list(), dropsName(t), t.fake.readFresh, { ha: t.fake.ha, rest: t.fake.api });
    for (const id of out.appliedIds) t.store.done(id);
    for (const r of out.retargets) t.store.retarget(r.changeId, r.targetId, r.after, r.before);

    const [left, ...more] = t.store.list();
    expect(more).toEqual([]);
    expect(left).toMatchObject({ kind: "entity", op: "update", targetId: "light.living_ceiling", after: { name: "Ceiling" } });
    expect(left.after).not.toHaveProperty("new_entity_id");
    expect(left.before).not.toHaveProperty("new_entity_id");

    t.fake.ws.length = 0;
    t.fake.rest.length = 0;
    const next = await t.apply();
    expect(next.results[0]).toMatchObject({ ok: true, message: "Applied." });
    expect(next.results[0].details).toBeUndefined();
    expect(t.store.list()).toEqual([]);
    expect(t.entity("light.living_ceiling")!.name).toBe("Ceiling");
    // Nothing about a rename or about configs is sent any more.
    expect(t.fake.ws.map((c) => [c.type, c.payload])).toEqual([["config/entity_registry/update", { entity_id: "light.living_ceiling", name: "Ceiling" }]]);
    expect(t.fake.rest).toEqual([]);
  });

});

describe("a list without renames", () => {
  it("makes no search, no dashboard and no REST calls, and behaves as before", async () => {
    const t = setup();
    t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { name: "Desk", labels: ["kids"] } });
    t.add({ kind: "area", op: "update", targetId: "study", fields: { name: "Office" } });
    t.add({ kind: "label", op: "create", fields: { name: "Night" } });
    const { results } = await t.apply();

    expect(results.every((r) => r.ok && r.details === undefined)).toBe(true);
    expect(t.fake.rest).toEqual([]);
    // Registry reads happen through readFresh, not the socket: nothing is sent but the edits.
    expect(t.fake.ws.every((c) => c.kind === "write")).toBe(true);
    expect(t.fake.ws.map((c) => c.type).sort()).toEqual(["config/area_registry/update", "config/entity_registry/update", "config/label_registry/create"]);
  });

  it("makes no extra reads when no rename io is given either", async () => {
    const t = setup();
    t.rename("light.living_spots", "light.living_ceiling");
    const { results } = await applyChanges(t.store.list(), t.fake.ha, t.fake.readFresh);
    // Without the means to read what uses it, a rename only changes the registry.
    expect(results[0]).toMatchObject({ ok: true, message: "Applied." });
    expect(t.fake.rest).toEqual([]);
    expect(t.fake.ws.map((c) => c.type)).toEqual(["config/entity_registry/update"]);
  });
});
