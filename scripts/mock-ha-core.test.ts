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
    expect(handleMockRest(home, "POST", "/api/config/script/config/unknown", {}).status).toBe(404);
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

describe("config flows", () => {
  const FLOW = "/api/config/config_entries/flow";
  const OPTIONS = "/api/config/config_entries/options/flow";
  const post = (home: Home, path: string, body: unknown) => handleMockRest(home, "POST", path, body);
  const answer = (r: ReturnType<typeof handleMockRest>) => r.body as Record<string, unknown> & { flow_id: string; result: { entry_id: string } };

  it("walks the group flow: a menu, the form of the chosen type, then an entry and its entity", () => {
    const home = buildMockRegistry();
    const menu = answer(post(home, FLOW, { handler: "group", show_advanced_options: false }));
    expect(menu).toMatchObject({ type: "menu", handler: "group" });
    expect(menu.flow_id).toMatch(/^[0-9a-f]{32}$/);
    expect(menu.menu_options).toContain("binary_sensor");
    const form = post(home, `${FLOW}/${menu.flow_id}`, { next_step_id: "binary_sensor" });
    expect(form.body).toMatchObject({ type: "form", step_id: "binary_sensor" });
    const done = answer(post(home, `${FLOW}/${menu.flow_id}`, { name: "Kitchen motions", entities: ["binary_sensor.kitchen_motion"], hide_members: false, all: false }));
    expect(done).toMatchObject({ type: "create_entry", title: "Kitchen motions" });
    expect(done.result.entry_id).toMatch(/^[0-9A-Z]{26}$/);
    expect(home.entities.find((e) => e.entity_id === "binary_sensor.kitchen_motions")).toMatchObject({ platform: "group", config_entry_id: done.result.entry_id });
    expect(home.states.find((s) => s.entity_id === "binary_sensor.kitchen_motions")).toMatchObject({ state: "off", attributes: { friendly_name: "Kitchen motions", entity_id: ["binary_sensor.kitchen_motion"] } });
    // The flow is over.
    expect(post(home, `${FLOW}/${menu.flow_id}`, {}).status).toBe(404);
  });

  it("derives the entity id from the name, and numbers it when it's taken", () => {
    const home = buildMockRegistry();
    const make = () => {
      const menu = answer(post(home, FLOW, { handler: "group" }));
      post(home, `${FLOW}/${menu.flow_id}`, { next_step_id: "light" });
      return answer(post(home, `${FLOW}/${menu.flow_id}`, { name: "Desk Lights", entities: ["light.desk"], hide_members: false, all: false }));
    };
    make();
    make();
    expect(home.entities.map((e) => e.entity_id)).toEqual(expect.arrayContaining(["light.desk_lights", "light.desk_lights_2"]));
  });

  it("makes a min/max sensor that reports the mean, not its members", () => {
    const home = buildMockRegistry();
    const start = answer(post(home, FLOW, { handler: "min_max" }));
    expect(start).toMatchObject({ type: "form", step_id: "user" });
    const done = answer(post(home, `${FLOW}/${start.flow_id}`, { name: "Living mean", entity_ids: ["sensor.living_temperature", "sensor.living_window_temperature"], type: "mean", round_digits: 1 }));
    expect(done.type).toBe("create_entry");
    const state = home.states.find((s) => s.entity_id === "sensor.living_mean")!;
    expect(state.state).toBe("20.8");
    expect(state.attributes).toMatchObject({ device_class: "temperature", unit_of_measurement: "°C" });
    expect(state.attributes?.entity_id).toBeUndefined();
    expect(home.entities.find((e) => e.entity_id === "sensor.living_mean")).toMatchObject({ platform: "min_max" });
  });

  it("changes a group's members through its options flow, and keeps the other options", () => {
    const home = buildMockRegistry();
    const start = answer(post(home, OPTIONS, { handler: "01JHELPERGARAGEALL" }));
    expect(start).toMatchObject({ type: "form", step_id: "init" });
    const schema = start.data_schema as { name: string; description?: { suggested_value?: unknown } }[];
    expect(schema.map((f) => f.name)).toEqual(["entities", "hide_members", "all"]);
    expect(schema[0].description?.suggested_value).toEqual(["light.garage_ceiling"]);
    const done = post(home, `${OPTIONS}/${start.flow_id}`, { entities: ["light.garage_ceiling", "light.garage_bench"], hide_members: true, all: false });
    expect(done.body).toMatchObject({ type: "create_entry" });
    expect(home.states.find((s) => s.entity_id === "light.garage_all")?.attributes?.entity_id).toEqual(["light.garage_ceiling", "light.garage_bench"]);
    expect(home.configEntries.find((e) => e.entry_id === "01JHELPERGARAGEALL")).toMatchObject({ hide_members: true });
    // Asked again, the form shows what is now.
    const again = answer(post(home, OPTIONS, { handler: "01JHELPERGARAGEALL" }));
    expect((again.data_schema as { name: string; description?: { suggested_value?: unknown } }[]).find((f) => f.name === "hide_members")?.description?.suggested_value).toBe(true);
  });

  it("answers an unknown handler, entry or flow with 404, and anything but POST with 405", () => {
    const home = buildMockRegistry();
    expect(post(home, FLOW, { handler: "mqtt" }).status).toBe(404);
    expect(post(home, OPTIONS, { handler: "NOSUCHENTRY123" }).status).toBe(404);
    expect(post(home, `${FLOW}/00000000000000000000000000000000`, {}).status).toBe(404);
    expect(post(home, FLOW, {}).status).toBe(400);
    expect(handleMockRest(home, "GET", FLOW, undefined).status).toBe(405);
    expect(handleMockRest(home, "DELETE", `${FLOW}/abc`, undefined).status).toBe(405);
  });

  it("asks again, with an error, for a form without a name or members", () => {
    const home = buildMockRegistry();
    const menu = answer(post(home, FLOW, { handler: "group" }));
    post(home, `${FLOW}/${menu.flow_id}`, { next_step_id: "light" });
    expect(post(home, `${FLOW}/${menu.flow_id}`, { name: "", entities: ["light.desk"] }).body).toMatchObject({ type: "form", errors: { name: "name_required" } });
    expect(post(home, `${FLOW}/${menu.flow_id}`, { name: "X", entities: [] }).body).toMatchObject({ type: "form", errors: { entities: "entities_required" } });
  });
});

describe("pointing an area at a sensor, and placing a new entity", () => {
  it("sets an area's temperature and humidity sensor", () => {
    const home = buildMockRegistry();
    ok(home, "config/area_registry/update", { area_id: "study", temperature_entity_id: "sensor.study_climate_temperature", humidity_entity_id: null });
    expect(home.areas.find((a) => a.area_id === "study")).toMatchObject({ temperature_entity_id: "sensor.study_climate_temperature", humidity_entity_id: null });
  });

  it("renames an entity and gives it an area in one update", () => {
    const home = buildMockRegistry();
    ok(home, "config/entity_registry/update", { entity_id: "light.hall_lights", new_entity_id: "light.hall_all", area_id: "study" });
    expect(home.entities.find((e) => e.entity_id === "light.hall_all")).toMatchObject({ area_id: "study", platform: "group" });
  });
});

describe("what recipes need from Home Assistant", () => {
  const post = (home: Home, path: string, body: unknown) => handleMockRest(home, "POST", path, body);
  const header = 'blueprint:\n  name: Test\n  domain: automation\n  description: "A test. Taxis blueprint version 3."\n  input: {}\n';

  it("saves a blueprint, lists it with its metadata, and refuses to overwrite without allow_override", () => {
    const home = buildMockRegistry();
    expect(ok(home, "blueprint/list", { domain: "automation" })).toEqual({});
    ok(home, "blueprint/save", { domain: "automation", path: "taxis/x.yaml", yaml: header, allow_override: true });
    expect(ok(home, "blueprint/list", { domain: "automation" })).toEqual({ "taxis/x.yaml": { metadata: { name: "Test", domain: "automation", description: "A test. Taxis blueprint version 3." } } });
    expect(fails(home, "blueprint/save", { domain: "automation", path: "taxis/x.yaml", yaml: header })).toBe("File already exists");
    expect(ok(home, "blueprint/save", { domain: "automation", path: "taxis/x.yaml", yaml: header.replace("3", "4"), allow_override: true })).toEqual({});
    expect(home.blueprints["taxis/x.yaml"]).toContain("version 4");
    expect(fails(home, "blueprint/save", { domain: "script", path: "taxis/x.yaml", yaml: header })).not.toBeNull();
    expect(fails(home, "blueprint/save", { domain: "automation", path: "../x.yaml", yaml: header })).toBe("Invalid path");
    expect(fails(home, "blueprint/save", { domain: "automation", path: "taxis/y.yaml", yaml: "nope" })).toMatch(/Invalid blueprint/);
    expect(fails(home, "blueprint/list", { domain: "script" })).not.toBeNull();
  });

  it("creates a timer and a toggle the way storage helpers appear, and updates a timer's duration", () => {
    const home = buildMockRegistry();
    const timer = ok<{ id: string; duration: string }>(home, "timer/create", { name: "Study hold", duration: "00:05:00", restore: true });
    expect(timer).toMatchObject({ id: "study_hold", duration: "00:05:00" });
    expect(home.entities.find((e) => e.entity_id === "timer.study_hold")).toMatchObject({ platform: "timer", unique_id: "study_hold" });
    expect(home.states.find((s) => s.entity_id === "timer.study_hold")).toMatchObject({ state: "idle", attributes: { duration: "0:05:00", restore: true } });
    ok(home, "timer/update", { timer_id: "study_hold", duration: "00:08:00" });
    expect(home.states.find((s) => s.entity_id === "timer.study_hold")!.attributes).toMatchObject({ duration: "0:08:00" });
    expect(fails(home, "timer/update", { timer_id: "nope", duration: "00:08:00" })).toBe("Unable to find timer");
    expect(fails(home, "timer/create", { name: "x", duration: "five" })).toBe("Invalid duration");
    // A second timer of the same name gets another id.
    expect(ok<{ id: string }>(home, "timer/create", { name: "Study hold", duration: "00:05:00" }).id).toBe("study_hold_2");

    ok(home, "input_boolean/create", { name: "Study automations paused", icon: "mdi:pause-circle-outline", initial: true });
    expect(home.states.find((s) => s.entity_id === "input_boolean.study_automations_paused")).toMatchObject({ state: "on", attributes: { icon: "mdi:pause-circle-outline" } });
    ok(home, "input_boolean/create", { name: "Other", icon: "mdi:robot" });
    expect(home.states.find((s) => s.entity_id === "input_boolean.other")!.state).toBe("off");
    expect(fails(home, "input_boolean/create", { name: " " })).toBe("name is required");
  });

  it("walks the template flow to a binary sensor whose state follows its timer", () => {
    const home = buildMockRegistry();
    ok(home, "timer/create", { name: "Study hold", duration: "00:05:00" });
    const FLOW = "/api/config/config_entries/flow";
    const menu = post(home, FLOW, { handler: "template" }).body as { flow_id: string; menu_options: string[] };
    expect(menu.menu_options).toContain("binary_sensor");
    expect(post(home, `${FLOW}/${menu.flow_id}`, { next_step_id: "sensor" }).status).toBe(400);
    expect(post(home, `${FLOW}/${menu.flow_id}`, { next_step_id: "binary_sensor" }).body).toMatchObject({ type: "form", step_id: "binary_sensor" });
    const done = post(home, `${FLOW}/${menu.flow_id}`, { name: "Study occupied", state: "{{ is_state('timer.study_hold','active') }}", device_class: "occupancy" }).body as { type: string; result: { entry_id: string } };
    expect(done.type).toBe("create_entry");
    expect(home.entities.find((e) => e.entity_id === "binary_sensor.study_occupied")).toMatchObject({ platform: "template", config_entry_id: done.result.entry_id });
    expect(home.states.find((s) => s.entity_id === "binary_sensor.study_occupied")).toMatchObject({ state: "off", attributes: { device_class: "occupancy" } });
  });

  it("creates an automation on POST to a new id, and one made from a missing blueprint is unavailable until it exists", () => {
    const home = buildMockRegistry();
    const config = { id: "taxis_occupancy_study", alias: "Study – Occupancy (Taxis)", use_blueprint: { path: "taxis/occupancy.yaml", input: {} } };
    expect(handleMockRest(home, "POST", "/api/config/automation/config/taxis_occupancy_study", config).status).toBe(200);
    expect(handleMockRest(home, "GET", "/api/config/automation/config/taxis_occupancy_study", undefined).body).toEqual(config);
    const state = () => home.states.find((s) => (s.attributes as { id?: string }).id === "taxis_occupancy_study")!;
    expect(state()).toMatchObject({ entity_id: "automation.study_occupancy_taxis", state: "unavailable" });
    ok(home, "blueprint/save", { domain: "automation", path: "taxis/occupancy.yaml", yaml: header, allow_override: true });
    expect(state().state).toBe("on");
    // Posting again replaces it and doesn't make a second entity.
    handleMockRest(home, "POST", "/api/config/automation/config/taxis_occupancy_study", { ...config, alias: "Study again" });
    expect(home.states.filter((s) => (s.attributes as { id?: string }).id === "taxis_occupancy_study")).toHaveLength(1);
    expect(state().attributes).toMatchObject({ friendly_name: "Study again" });
    // A YAML automation, and a malformed body, are still refused.
    expect(handleMockRest(home, "POST", "/api/config/automation/config/hall_night", config).status).toBe(404);
    expect(handleMockRest(home, "POST", "/api/config/automation/config/another", "x").status).toBe(400);
  });
});
