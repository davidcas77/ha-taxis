import { describe, expect, it } from "vitest";

import { findReferences, searchRelated } from "./find.ts";
import { fakeHa } from "./fake-ha.ts";
import { snapshot } from "./snapshot.ts";

// The fake house (scripts/mock-ha-core.ts): light.living_spots is used by a UI
// automation, a scene, the default dashboard, a YAML automation, a YAML
// dashboard, two groups and a group helper.
async function lookup(entityId: string, tweak?: (t: ReturnType<typeof fakeHa>) => void) {
  const t = fakeHa();
  tweak?.(t);
  const snap = await snapshot({ ha: t.ha, rest: t.api }, t.home.states, t.home.entities);
  const related = await searchRelated(t.ha, entityId);
  return { t, snap, related, found: findReferences(snap, related, entityId) };
}

describe("snapshot", () => {
  it("reads every candidate config once, and says which are YAML", async () => {
    const t = fakeHa();
    const snap = await snapshot({ ha: t.ha, rest: t.api }, t.home.states, t.home.entities);

    const gets = t.rest.map((c) => `${c.method} ${c.path} ${c.status}`).sort();
    expect(gets).toEqual([
      "GET /api/config/automation/config/1700000000001 200",
      "GET /api/config/automation/config/1700000000002 200",
      "GET /api/config/automation/config/hall_night 404",
      "GET /api/config/scene/config/1700000000100 200",
      "GET /api/config/script/config/movie_time 200",
    ]);
    const lovelace = t.ws.filter((c) => c.type.startsWith("lovelace")).map((c) => `${c.type} ${JSON.stringify(c.payload)}`).sort();
    expect(lovelace).toEqual([
      'lovelace/config {"url_path":"dashboard-auto"}',
      'lovelace/config {"url_path":"dashboard-kitchen"}',
      'lovelace/config {"url_path":"dashboard-wall"}',
      'lovelace/config {"url_path":null}',
      "lovelace/dashboards/list {}",
    ]);
    expect(t.writes()).toEqual({ ws: [], rest: [] });

    const by = Object.fromEntries(snap.items.map((i) => [`${i.kind}:${i.id}`, i]));
    expect(by["automation:hall_night"]).toMatchObject({ yaml: true, editable: false, config: null, name: "Hall night light" });
    expect(by["automation:1700000000001"]).toMatchObject({ yaml: false, editable: true, name: "Lights on at sunset", entityId: "automation.lights_on_at_sunset" });
    expect(by["scene:1700000000100"]).toMatchObject({ editable: true, name: "Evening" });
    expect(by["script:movie_time"]).toMatchObject({ editable: true, name: "Movie time" });
    expect(by["dashboard:lovelace"]).toMatchObject({ editable: true, urlPath: null });
    expect(by["dashboard:dashboard-kitchen"]).toMatchObject({ editable: true, name: "Kitchen" });
    // YAML dashboards are read, but not editable.
    expect(by["dashboard:dashboard-wall"]).toMatchObject({ editable: false, yaml: true });
    expect(by["dashboard:dashboard-wall"].config).not.toBeNull();
    // An auto-generated dashboard has nothing stored: not an error.
    expect(by["dashboard:dashboard-auto"]).toMatchObject({ editable: false, config: null });
    expect(snap.notes).toEqual([]);
  });

  it("skips and notes what it can't read, and carries on", async () => {
    const t = fakeHa();
    t.restStatus = (_m, path) => (path.endsWith("/1700000000002") ? 500 : null);
    t.failRead.add("lovelace/dashboards/list");
    const snap = await snapshot({ ha: t.ha, rest: t.api }, t.home.states, t.home.entities);
    expect(snap.notes).toHaveLength(2);
    expect(snap.notes.join("\n")).toMatch(/couldn't read automation “Kitchen motion light” \(Home Assistant refused to read the automation \(HTTP 500: forced 500\)/);
    expect(snap.notes.join("\n")).toMatch(/couldn't list the dashboards/);
    const kitchen = snap.items.find((i) => i.id === "1700000000002")!;
    expect(kitchen).toMatchObject({ editable: false, yaml: false, config: null });
    // The rest was read: the other automation, the scene, the script, the default dashboard.
    expect(snap.items.filter((i) => i.config !== null).map((i) => i.id).sort()).toEqual(["1700000000001", "1700000000100", "lovelace", "movie_time"]);
  });

  it("reads at most 6 configs at a time", async () => {
    const t = fakeHa();
    t.delayMs = 5;
    await snapshot({ ha: t.ha, rest: t.api }, t.home.states, t.home.entities);
    expect(t.maxInFlight).toBeGreaterThan(1);
    expect(t.maxInFlight).toBeLessThanOrEqual(6);
  });

  it("doesn't touch the token or send anything but reads", async () => {
    const t = fakeHa();
    await snapshot({ ha: t.ha, rest: t.api }, t.home.states, t.home.entities);
    expect(t.ws.every((c) => c.kind === "read")).toBe(true);
    expect(t.rest.every((c) => c.method === "GET")).toBe(true);
  });
});

describe("references for light.living_spots", () => {
  it("lists what Taxis can update, with counts", async () => {
    const { found } = await lookup("light.living_spots");
    expect(found.sites).toEqual([
      { kind: "automation", id: "1700000000001", name: "Lights on at sunset", count: 1 },
      { kind: "scene", id: "1700000000100", name: "Evening", count: 1 },
      // The light card and the tile card inside the vertical stack.
      { kind: "dashboard", id: "lovelace", name: "Overview", count: 2 },
    ]);
  });

  it("lists what the user must change by hand, each with a plain reason", async () => {
    const { found } = await lookup("light.living_spots");
    expect(found.manual).toEqual([
      { kind: "automation", id: "automation.hall_night_light", name: "Hall night light", reason: "Written in YAML: change it in the file." },
      { kind: "dashboard", id: "dashboard-wall", name: "Wall panel", reason: "Written in YAML: change it in the file." },
      { kind: "group", id: "light.living_all", name: "Living all", reason: "A YAML group: change it in the file." },
      { kind: "config_entry", id: "01JHELPERDOWNSTAIRS", name: "Downstairs", reason: "A helper: open its options in Home Assistant and pick the new entity." },
    ]);
  });

  it("includes a script when it uses the entity", async () => {
    const { found } = await lookup("light.living_lamp");
    expect(found.sites.map((s) => `${s.kind}:${s.name}:${s.count}`)).toEqual([
      "automation:Lights on at sunset:1",
      "script:Movie time:1",
      "scene:Evening:1",
    ]);
    expect(found.manual.map((m) => `${m.kind}:${m.id}`)).toEqual(["group:group.all_lamps", "group:light.living_all"]);
  });

  it("finds ids in templates and in object keys", async () => {
    const presence = await lookup("binary_sensor.living_presence");
    expect(presence.found.sites).toEqual([{ kind: "automation", id: "1700000000001", name: "Lights on at sunset", count: 1 }]);
    // sensor.living_temperature is on the area as well; that is handled by Apply, not listed here.
    const temperature = await lookup("sensor.living_temperature");
    expect(temperature.found.sites).toEqual([{ kind: "dashboard", id: "lovelace", name: "Overview", count: 2 }]);
    expect(temperature.found.manual).toEqual([]);
  });

  it("has nothing to say about an entity nothing uses", async () => {
    const { found, t } = await lookup("light.desk");
    expect(found).toEqual({ sites: [], manual: [] });
    expect(t.writes()).toEqual({ ws: [], rest: [] });
  });

  it("settles an automation Taxis could read by its own config, not by search/related", async () => {
    const { snap } = await lookup("light.kitchen_main");
    // search/related also reports things that only share a device or area.
    const found = findReferences(snap, { automation: ["automation.lights_on_at_sunset", "automation.kitchen_motion_light"] }, "light.kitchen_main");
    expect(found.sites.map((s) => s.name)).toEqual(["Kitchen motion light", "Kitchen", "Overview"]);
    expect(found.manual).toEqual([]);
  });

  it("falls back to search/related for an automation it couldn't read, and says so", async () => {
    const { found } = await lookup("light.kitchen_main", (t) => {
      t.restStatus = (_m, path) => (path.endsWith("/1700000000002") ? 500 : null);
    });
    expect(found.sites.map((s) => s.kind)).toEqual(["dashboard", "dashboard"]);
    expect(found.manual).toContainEqual({
      kind: "automation",
      id: "automation.kitchen_motion_light",
      name: "Kitchen motion light",
      reason: "Taxis couldn't read it: check it in Home Assistant.",
    });
  });

  it("doesn't report the entity's own integration as a helper", async () => {
    const t = fakeHa();
    t.home.entities.find((e) => e.entity_id === "light.living_spots")!.platform = "hue";
    (t.home.entities.find((e) => e.entity_id === "light.living_spots") as Record<string, unknown>).config_entry_id = "HUEENTRY";
    const snap = await snapshot({ ha: t.ha, rest: t.api }, t.home.states, t.home.entities);
    const found = findReferences(snap, { config_entry: ["HUEENTRY", "01JHELPERDOWNSTAIRS"] }, "light.living_spots");
    expect(found.manual.filter((m) => m.kind === "config_entry").map((m) => m.id)).toEqual(["01JHELPERDOWNSTAIRS"]);
  });

  it("names a helper after its entity, and doesn't list a helper group twice", async () => {
    const t = fakeHa();
    (t.home.entities.find((e) => e.entity_id === "light.downstairs") as Record<string, unknown>).config_entry_id = "01JHELPERDOWNSTAIRS";
    const snap = await snapshot({ ha: t.ha, rest: t.api }, t.home.states, t.home.entities);
    const found = findReferences(snap, await searchRelated(t.ha, "light.living_spots"), "light.living_spots");
    expect(found.manual.filter((m) => m.id === "light.downstairs" || m.id === "01JHELPERDOWNSTAIRS")).toEqual([
      { kind: "config_entry", id: "01JHELPERDOWNSTAIRS", name: "Downstairs", reason: "A helper: open its options in Home Assistant and pick the new entity." },
    ]);
  });
});

describe("searchRelated", () => {
  it("sends the one read it needs", async () => {
    const t = fakeHa();
    const related = await searchRelated(t.ha, "scene.evening");
    expect(related).toEqual({});
    expect(t.ws).toEqual([{ kind: "read", type: "search/related", payload: { item_type: "entity", item_id: "scene.evening" } }]);
  });
});
