import { describe, expect, it } from "vitest";

import { buildMockRegistry, containsEntityId, handleMock, handleMockRest } from "./mock-ha-core.ts";

type Home = ReturnType<typeof buildMockRegistry>;

function ok<T>(home: Home, type: string, p: Record<string, unknown> = {}): T {
  const reply = handleMock(home, type, p);
  if (!reply.success) throw new Error(reply.message);
  return reply.result as T;
}
const fails = (home: Home, type: string, p: Record<string, unknown>) => {
  const reply = handleMock(home, type, p);
  return reply.success ? null : reply.message;
};
const related = (id: string) => ok<Record<string, string[]>>(buildMockRegistry(), "search/related", { item_type: "entity", item_id: id });

describe("containsEntityId", () => {
  it("matches whole ids only", () => {
    expect(containsEntityId("light.a", "light.a")).toBe(true);
    expect(containsEntityId("{{ states.light.a.state }}", "light.a")).toBe(true);
    expect(containsEntityId("light.a_2", "light.a")).toBe(false);
    expect(containsEntityId("xlight.a", "light.a")).toBe(false);
    expect(containsEntityId("light_a", "light.a")).toBe(false); // the dot is literal
    expect(containsEntityId("a light.a, b", "light.a")).toBe(true);
  });

  it("looks through arrays, nested objects and object keys", () => {
    expect(containsEntityId({ x: [{ y: ["light.a"] }] }, "light.a")).toBe(true);
    expect(containsEntityId({ "light.a": "off" }, "light.a")).toBe(true);
    expect(containsEntityId({ x: 1, y: null, z: ["light.b"] }, "light.a")).toBe(false);
  });
});

describe("search/related", () => {
  it("finds automations (UI and YAML), scripts, scenes, groups and config entries", () => {
    expect(related("light.living_spots")).toEqual({
      automation: ["automation.lights_on_at_sunset", "automation.hall_night_light"],
      scene: ["scene.evening"],
      group: ["light.living_all", "light.downstairs"],
      config_entry: ["01JHELPERDOWNSTAIRS"],
    });
    expect(related("light.living_lamp")).toEqual({
      automation: ["automation.lights_on_at_sunset"],
      script: ["script.movie_time"],
      scene: ["scene.evening"],
      group: ["light.living_all", "group.all_lamps"],
    });
  });

  it("finds ids in templates, string targets and triggers", () => {
    expect(related("binary_sensor.living_presence")).toEqual({ automation: ["automation.lights_on_at_sunset"] });
    expect(related("light.kitchen_main").automation).toEqual(["automation.kitchen_motion_light"]);
    expect(related("media_player.living_tv")).toEqual({ script: ["script.movie_time"] });
  });

  it("returns no keys for an unreferenced entity", () => {
    expect(related("light.desk")).toEqual({});
  });
});

describe("renaming an entity", () => {
  const configs = (h: Home) => structuredClone({ a: h.automations, y: h.yamlAutomations, s: h.scripts, sc: h.scenes, d: h.dashboards, c: h.configEntries });

  it("renames the registry entry and state, and leaves every config alone", () => {
    const home = buildMockRegistry();
    const before = configs(home);
    const groupState = structuredClone(home.states.find((s) => s.entity_id === "light.downstairs"));
    ok(home, "config/entity_registry/update", { entity_id: "light.living_spots", new_entity_id: "light.living_ceiling" });
    expect(home.entities.some((e) => e.entity_id === "light.living_ceiling")).toBe(true);
    expect(home.entities.some((e) => e.entity_id === "light.living_spots")).toBe(false);
    expect(home.states.some((s) => s.entity_id === "light.living_ceiling")).toBe(true);
    expect(home.states.some((s) => s.entity_id === "light.living_spots")).toBe(false);
    expect(configs(home)).toEqual(before);
    expect(home.states.find((s) => s.entity_id === "light.downstairs")).toEqual(groupState);
  });

  it("keeps the area's temperature entity on the old id", () => {
    const home = buildMockRegistry();
    ok(home, "config/entity_registry/update", { entity_id: "sensor.living_temperature", new_entity_id: "sensor.living_temp" });
    expect(home.areas.find((a) => a.area_id === "living_room")!.temperature_entity_id).toBe("sensor.living_temperature");
  });

  it("refuses invalid, cross-domain and taken ids, changing nothing", () => {
    const home = buildMockRegistry();
    expect(fails(home, "config/entity_registry/update", { entity_id: "light.desk", new_entity_id: "Light.Desk", name: "X" })).toBeTruthy();
    expect(fails(home, "config/entity_registry/update", { entity_id: "light.desk", new_entity_id: "switch.desk" })).toMatch(/same domain/);
    expect(fails(home, "config/entity_registry/update", { entity_id: "light.desk", new_entity_id: "light.living_lamp" })).toBe("Entity with this ID is already registered");
    expect(home.entities.find((e) => e.entity_id === "light.desk")!.name).toBeUndefined();
  });

  it("can rename and edit other fields in one call", () => {
    const home = buildMockRegistry();
    const res = ok<{ entity_entry: { entity_id: string; name: string } }>(home, "config/entity_registry/update", { entity_id: "light.desk", new_entity_id: "light.study_desk", name: "Study desk" });
    expect(res.entity_entry).toMatchObject({ entity_id: "light.study_desk", name: "Study desk" });
    expect(home.states.find((s) => s.entity_id === "light.study_desk")!.attributes?.friendly_name).toBe("Study desk");
  });
});

describe("REST config API", () => {
  const get = (home: Home, path: string) => handleMockRest(home, "GET", path, undefined);

  it("gets a clone of a config, 404 for unknown and YAML ones", () => {
    const home = buildMockRegistry();
    const res = get(home, "/api/config/automation/config/1700000000002");
    expect(res.status).toBe(200);
    (res.body as { alias: string }).alias = "changed";
    expect(home.automations["1700000000002"].alias).toBe("Kitchen motion light");
    expect(get(home, "/api/config/automation/config/hall_night")).toEqual({ status: 404, body: { message: "Resource not found" } });
    expect(get(home, "/api/config/automation/config/nope").status).toBe(404);
    expect(get(home, "/api/config/script/config/movie_time").status).toBe(200);
    expect(get(home, "/api/config/scene/config/1700000000100").status).toBe(200);
  });

  it("stores a posted config and updates the state's name", () => {
    const home = buildMockRegistry();
    const config = { id: "1700000000001", alias: "Sunset lights", actions: [] };
    expect(handleMockRest(home, "POST", "/api/config/automation/config/1700000000001", config)).toEqual({ status: 200, body: { result: "ok" } });
    expect(get(home, "/api/config/automation/config/1700000000001").body).toEqual(config);
    expect(home.states.find((s) => s.entity_id === "automation.lights_on_at_sunset")!.attributes?.friendly_name).toBe("Sunset lights");
    handleMockRest(home, "POST", "/api/config/script/config/movie_time", { alias: "Film night", sequence: [] });
    expect(home.states.find((s) => s.entity_id === "script.movie_time")!.attributes?.friendly_name).toBe("Film night");
  });

  it("answers 400 for a malformed body, 404 for unknown ids and paths, 405 for other methods", () => {
    const home = buildMockRegistry();
    expect(handleMockRest(home, "POST", "/api/config/automation/config/1700000000001", "nope")).toEqual({ status: 400, body: { message: "Message malformed" } });
    expect(handleMockRest(home, "POST", "/api/config/automation/config/unknown", {}).status).toBe(404);
    expect(handleMockRest(home, "POST", "/api/config/automation/config/hall_night", {}).status).toBe(404);
    expect(get(home, "/api/states").status).toBe(404);
    expect(handleMockRest(home, "DELETE", "/api/config/automation/config/1700000000001", undefined).status).toBe(405);
    expect(home.automations["1700000000001"].alias).toBe("Lights on at sunset");
  });
});

describe("lovelace", () => {
  it("lists every dashboard but the default", () => {
    const list = ok<{ id: string; url_path: string; mode: string; title: string }[]>(buildMockRegistry(), "lovelace/dashboards/list");
    expect(list.map((d) => d.url_path)).toEqual(["dashboard-kitchen", "dashboard-wall", "dashboard-auto"]);
    expect(list[1]).toMatchObject({ mode: "yaml", title: "Wall panel" });
  });

  it("reads configs and refuses missing ones", () => {
    const home = buildMockRegistry();
    expect(ok<{ views: unknown[] }>(home, "lovelace/config", { url_path: null }).views).toHaveLength(1);
    expect(fails(home, "lovelace/config", { url_path: "dashboard-auto" })).toBe("No config found.");
    expect(fails(home, "lovelace/config", { url_path: "nope" })).toBeTruthy();
  });

  it("says whether a dashboard is stored or YAML; no url_path means the default one", () => {
    const home = buildMockRegistry();
    expect(ok(home, "lovelace/info")).toEqual({ mode: "storage" });
    expect(ok(home, "lovelace/info", { url_path: null })).toEqual({ mode: "storage" });
    expect(ok(home, "lovelace/info", { url_path: "dashboard-wall" })).toEqual({ mode: "yaml" });
    expect(fails(home, "lovelace/info", { url_path: "nope" })).toBeTruthy();
    home.dashboards[0].mode = "yaml";
    expect(ok(home, "lovelace/info")).toEqual({ mode: "yaml" });
  });

  it("keys a script's config by the registry unique_id, which a rename does not change", () => {
    const home = buildMockRegistry();
    expect(home.entities.find((e) => e.entity_id === "script.movie_time")).toMatchObject({ unique_id: "movie_time" });
    ok(home, "config/entity_registry/update", { entity_id: "script.movie_time", new_entity_id: "script.film" });
    expect(home.entities.find((e) => e.entity_id === "script.film")).toMatchObject({ unique_id: "movie_time" });
    expect(handleMockRest(home, "GET", "/api/config/script/config/movie_time", undefined).status).toBe(200);
    expect(handleMockRest(home, "GET", "/api/config/script/config/film", undefined).status).toBe(404);
    // search/related names the script by its new entity id.
    expect(ok<Record<string, string[]>>(home, "search/related", { item_type: "entity", item_id: "light.living_lamp" }).script).toEqual(["script.film"]);
    handleMockRest(home, "POST", "/api/config/script/config/movie_time", { alias: "Film night", sequence: [] });
    expect(home.states.find((s) => s.entity_id === "script.film")!.attributes?.friendly_name).toBe("Film night");
  });

  it("saves a clone to a storage dashboard and refuses YAML mode", () => {
    const home = buildMockRegistry();
    const config = { views: [{ title: "New" }] };
    expect(ok(home, "lovelace/config/save", { url_path: "dashboard-auto", config })).toBeNull();
    config.views[0].title = "mutated";
    expect(ok<typeof config>(home, "lovelace/config", { url_path: "dashboard-auto" }).views[0].title).toBe("New");
    expect(fails(home, "lovelace/config/save", { url_path: "dashboard-wall", config })).toBe("Dashboard is in YAML mode, can't save.");
    expect(fails(home, "lovelace/config/save", { url_path: "nope", config })).toBeTruthy();
  });
});
