import { describe, expect, it } from "vitest";

import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { NO_DEVICE, branchEntities, branchRoleCounts, collectBranches, deviceStateSummary, entityStateText, filterBranches, isBranchOpen, sortBranches, type Branch } from "./device-tree.ts";
import type { EntityRole } from "./types.ts";

// An invented house. The lamp device and the sensor device are in the living
// room; the lamp's night light has an area of its own (the hallway). The valve
// device is in the kitchen, and its temperature sensor is in the living room.
// The hub is in no area. A weather entity and a helper belong to no device.
function house() {
  const reg: RawRegistry = {
    config: { location_name: "Test house" },
    floors: [{ floor_id: "ground", name: "Ground floor", level: 0 }],
    areas: [
      { area_id: "living_room", name: "Living room", floor_id: "ground" },
      { area_id: "kitchen", name: "Kitchen", floor_id: "ground" },
      { area_id: "hallway", name: "Hallway", floor_id: "ground" },
    ],
    devices: [
      { id: "lamp", name: "Floor lamp", manufacturer: "Acme", model: "L1", area_id: "living_room" },
      { id: "sensor", name: "Room sensor", manufacturer: "Acme", model: "S2", area_id: "living_room" },
      { id: "valve", name: "Radiator valve", manufacturer: "Bolt", model: "V3", area_id: "kitchen" },
      { id: "hub", name: "Hub", manufacturer: "Bolt", model: "H1", area_id: null },
      { id: "empty", name: "Empty thing", manufacturer: "Bolt", model: "E0", area_id: "living_room" },
    ],
    entities: [
      { entity_id: "light.floor_lamp", platform: "demo", device_id: "lamp" },
      { entity_id: "light.night_light", platform: "demo", device_id: "lamp", area_id: "hallway" },
      { entity_id: "sensor.room_temperature", platform: "demo", device_id: "sensor" },
      { entity_id: "sensor.room_humidity", platform: "demo", device_id: "sensor" },
      { entity_id: "sensor.room_battery", platform: "demo", device_id: "sensor", entity_category: "diagnostic" },
      { entity_id: "climate.radiator", platform: "demo", device_id: "valve" },
      { entity_id: "sensor.radiator_temperature", platform: "demo", device_id: "valve", area_id: "living_room" },
      { entity_id: "sensor.hub_uptime", platform: "demo", device_id: "hub" },
      { entity_id: "weather.home", platform: "demo", area_id: "living_room" },
      { entity_id: "input_boolean.guest", platform: "demo" },
    ],
    labels: [],
    states: [
      { entity_id: "light.floor_lamp", state: "on", attributes: { friendly_name: "Floor lamp" } },
      { entity_id: "light.night_light", state: "off", attributes: { friendly_name: "Night light" } },
      { entity_id: "sensor.room_temperature", state: "21.5", attributes: { friendly_name: "Room temperature", device_class: "temperature", unit_of_measurement: "°C" } },
      { entity_id: "sensor.room_humidity", state: "unavailable", attributes: { friendly_name: "Room humidity", device_class: "humidity" } },
      { entity_id: "sensor.room_battery", state: "80", attributes: { friendly_name: "Room battery", device_class: "battery" } },
      { entity_id: "climate.radiator", state: "heat", attributes: { friendly_name: "Radiator" } },
      { entity_id: "sensor.radiator_temperature", state: "19", attributes: { friendly_name: "Radiator temperature", device_class: "temperature" } },
      { entity_id: "sensor.hub_uptime", state: "5", attributes: { friendly_name: "Hub uptime" } },
      { entity_id: "weather.home", state: "sunny", attributes: { friendly_name: "Home weather" } },
      { entity_id: "input_boolean.guest", state: "off", attributes: { friendly_name: "Guest mode" } },
    ],
  };
  return buildHierarchy(reg, "now");
}

const h = house();
const visible = (e: { maintenance: boolean }) => !e.maintenance;
const all = collectBranches(h, { scope: { kind: "all" }, entityOk: visible });
const keys = (bs: readonly Branch[]) => bs.map((b) => b.key);
const idsOf = (b: Branch) => b.entities.map((e) => e.entityId);
const none = new Set<EntityRole>();
const only = (...roles: EntityRole[]) => new Set<EntityRole>(roles);

describe("the table for the whole home", () => {
  it("has a branch per device, with its entities in order of name, and one for the entities with no device last", () => {
    expect(new Set(keys(all))).toEqual(new Set(["lamp", "sensor", "valve", "hub", "empty", NO_DEVICE]));
    expect(keys(all).at(-1)).toBe(NO_DEVICE);
    const lamp = all.find((b) => b.key === "lamp")!;
    expect(lamp.all.map((e) => e.entityId)).toEqual(["light.floor_lamp", "light.night_light"]);
    expect(lamp.device?.name).toBe("Floor lamp");
    expect(lamp.elsewhere).toBeNull();
    expect(all.at(-1)!.device).toBeNull();
    expect(all.at(-1)!.all.map((e) => e.entityId)).toEqual(["input_boolean.guest", "weather.home"]);
  });

  it("applies the page's own filters to the entities, and keeps a device that has none left", () => {
    const sensor = all.find((b) => b.key === "sensor")!;
    expect(sensor.all.map((e) => e.entityId)).toEqual(["sensor.room_humidity", "sensor.room_temperature"]);
    expect(all.find((b) => b.key === "empty")!.all).toEqual([]);
    const everything = collectBranches(h, { scope: { kind: "all" }, entityOk: () => true });
    expect(everything.find((b) => b.key === "sensor")!.all).toHaveLength(3);
  });

  it("filters devices (the manufacturer), and then leaves the branch with no device out", () => {
    const acme = collectBranches(h, { scope: { kind: "all" }, entityOk: visible, deviceOk: (d) => d.manufacturer === "Acme" });
    expect(new Set(keys(acme))).toEqual(new Set(["lamp", "sensor"]));
  });

  it("filters by area: a device is listed for itself or for an entity that passes", () => {
    const hallway = collectBranches(h, { scope: { kind: "all" }, entityOk: visible, areaOk: (a) => a === "hallway" });
    // The lamp's night light is in the hallway though the lamp is not.
    expect(keys(hallway)).toEqual(["lamp"]);
    expect(hallway[0].all.map((e) => e.entityId)).toEqual(["light.night_light"]);
    const living = collectBranches(h, { scope: { kind: "all" }, entityOk: visible, areaOk: (a) => a === "living_room" });
    expect(new Set(keys(living))).toEqual(new Set(["lamp", "sensor", "valve", "empty", NO_DEVICE]));
    expect(living.find((b) => b.key === "valve")!.all.map((e) => e.entityId)).toEqual(["sensor.radiator_temperature"]);
    const noArea = collectBranches(h, { scope: { kind: "all" }, entityOk: visible, areaOk: (a) => a === null });
    expect(new Set(keys(noArea))).toEqual(new Set(["hub", NO_DEVICE]));
  });
});

describe("the table for one area", () => {
  const living = collectBranches(h, { scope: { kind: "area", areaId: "living_room" }, entityOk: visible });

  it("has the devices in the area with all their entities", () => {
    expect(new Set(keys(living))).toEqual(new Set(["lamp", "sensor", "empty", "valve", NO_DEVICE]));
    const lamp = living.find((b) => b.key === "lamp")!;
    expect(lamp.elsewhere).toBeNull();
    // The night light belongs to the lamp but sits in the hallway: still listed, its Area says so.
    expect(lamp.all.map((e) => e.entityId)).toEqual(["light.floor_lamp", "light.night_light"]);
  });

  it("has the entities in the area whose device is elsewhere under that device, marked", () => {
    const valve = living.find((b) => b.key === "valve")!;
    expect(valve.elsewhere).toEqual({ areaId: "kitchen" });
    expect(valve.all.map((e) => e.entityId)).toEqual(["sensor.radiator_temperature"]);
  });

  it("has the entities in the area with no device under one branch for them, last", () => {
    expect(keys(living).at(-1)).toBe(NO_DEVICE);
    expect(living.at(-1)!.all.map((e) => e.entityId)).toEqual(["weather.home"]);
  });

  it("marks a device that sits in another area", () => {
    const hallway = collectBranches(h, { scope: { kind: "area", areaId: "hallway" }, entityOk: visible });
    expect(keys(hallway)).toEqual(["lamp"]);
    expect(hallway[0].elsewhere).toEqual({ areaId: "living_room" });
    expect(hallway[0].all.map((e) => e.entityId)).toEqual(["light.night_light"]);
  });

  it("marks a device that is in no area", () => {
    const withHub = buildHierarchy(
      {
        config: {},
        floors: [],
        areas: [{ area_id: "attic", name: "Attic" }],
        devices: [{ id: "hub", name: "Hub", area_id: null }],
        entities: [{ entity_id: "sensor.hub_uptime", platform: "demo", device_id: "hub", area_id: "attic" }],
        labels: [],
        states: [{ entity_id: "sensor.hub_uptime", state: "5", attributes: {} }],
      },
      "now",
    );
    const attic = collectBranches(withHub, { scope: { kind: "area", areaId: "attic" }, entityOk: () => true });
    expect(attic[0].elsewhere).toEqual({ areaId: null });
  });

  it("is empty for an area that isn't there", () => {
    expect(collectBranches(h, { scope: { kind: "area", areaId: "nowhere" }, entityOk: visible })).toEqual([]);
  });
});

describe("the chips", () => {
  it("count the kinds of entity in the table, once each", () => {
    expect(branchRoleCounts(all).map((c) => [c.role, c.count])).toEqual([
      ["light", 2],
      ["climate", 1],
      ["temperature", 2],
      ["humidity", 1],
      ["sensor", 1],
      ["helper", 1],
      ["other", 1],
    ]);
  });

  it("keep the devices with a matching entity, and only those entities", () => {
    const lights = filterBranches(all, { roles: only("light"), query: "" });
    expect(keys(lights)).toEqual(["lamp"]);
    expect(idsOf(lights[0])).toEqual(["light.floor_lamp", "light.night_light"]);
    const two = filterBranches(all, { roles: only("humidity", "climate"), query: "" });
    expect(new Set(keys(two))).toEqual(new Set(["sensor", "valve"]));
    expect(idsOf(two.find((b) => b.key === "sensor")!)).toEqual(["sensor.room_humidity"]);
  });

  it("keep every device when none is chosen, a device with no entities included", () => {
    const f = filterBranches(all, { roles: none, query: "" });
    expect(keys(f)).toEqual(keys(all));
    expect(f.find((b) => b.key === "empty")!.entities).toEqual([]);
  });

  it("do not change what a branch holds for the device row", () => {
    const sensor = filterBranches(all, { roles: only("humidity"), query: "" })[0];
    expect(sensor.all).toHaveLength(2);
    expect(sensor.entities).toHaveLength(1);
  });
});

describe("the search", () => {
  const find = (query: string, roles: ReadonlySet<EntityRole> = none) => filterBranches(all, { roles, query });

  it("finds a device by name, model or manufacturer and lists all its entities", () => {
    for (const q of ["floor", "L1", "ACME", "  lamp "]) expect(keys(find(q)), q).toContain("lamp");
    expect(keys(find("acme")).sort()).toEqual(["lamp", "sensor"]);
    const f = find("room sensor");
    expect(keys(f)).toEqual(["sensor"]);
    expect(idsOf(f[0])).toEqual(["sensor.room_humidity", "sensor.room_temperature"]);
    expect(f[0].matched).toBe(0);
  });

  it("finds an entity by name or entity id and lists only the entities that match", () => {
    const f = find("humidity");
    expect(keys(f)).toEqual(["sensor"]);
    expect(idsOf(f[0])).toEqual(["sensor.room_humidity"]);
    expect(f[0].matched).toBe(1);
    expect(keys(find("weather.home"))).toEqual([NO_DEVICE]);
  });

  it("finds nothing for what isn't there, and keeps a device that matches by itself", () => {
    expect(find("zzz")).toEqual([]);
    expect(keys(find("empty thing"))).toEqual(["empty"]);
  });

  it("works with the chips: a device must have an entity that passes both", () => {
    expect(keys(find("room", only("humidity")))).toEqual(["sensor"]);
    expect(idsOf(find("room", only("humidity"))[0])).toEqual(["sensor.room_humidity"]);
    expect(find("floor", only("humidity"))).toEqual([]);
  });
});

describe("which branches are open", () => {
  it("follows Show entities, a search opening the branches it found entities in, and a chevron the user clicked above both", () => {
    const branch = { matched: 0 };
    expect(isBranchOpen(branch, { showAll: false, query: "", override: undefined })).toBe(false);
    expect(isBranchOpen(branch, { showAll: true, query: "", override: undefined })).toBe(true);
    expect(isBranchOpen({ matched: 2 }, { showAll: false, query: "lamp", override: undefined })).toBe(true);
    // A search the device matched by itself leaves it as it was.
    expect(isBranchOpen(branch, { showAll: false, query: "lamp", override: undefined })).toBe(false);
    expect(isBranchOpen({ matched: 2 }, { showAll: false, query: "lamp", override: false })).toBe(false);
    expect(isBranchOpen(branch, { showAll: true, query: "", override: false })).toBe(false);
    expect(isBranchOpen(branch, { showAll: false, query: "", override: true })).toBe(true);
  });
});

describe("what the rows say", () => {
  it("writes an entity's state, with the unit, 'no state' and 'disabled'", () => {
    expect(entityStateText({ disabled: false, state: "21.5", unit: "°C" })).toBe("21.5 °C");
    expect(entityStateText({ disabled: false, state: "on", unit: null })).toBe("on");
    expect(entityStateText({ disabled: false, state: null, unit: null })).toBe("no state");
    expect(entityStateText({ disabled: true, state: "on", unit: null })).toBe("disabled");
  });

  it("sums a device up by what is on and what isn't reporting", () => {
    const by = (key: string) => all.find((b) => b.key === key)!.all;
    expect(deviceStateSummary(by("lamp"))).toBe("1 on");
    expect(deviceStateSummary(by("sensor"))).toBe("1 unavailable");
    expect(deviceStateSummary(by("hub"))).toBe("idle");
    expect(deviceStateSummary([])).toBe("–");
    expect(deviceStateSummary([...by("lamp"), ...by("sensor")])).toBe("1 on · 1 unavailable");
  });
});

describe("the order", () => {
  const f = filterBranches(all, { roles: none, query: "" });
  const order = (column: Parameters<typeof sortBranches>[2], dir: "asc" | "desc" = "asc") => sortBranches(h, f, column, dir).map((b) => b.key);

  it("sorts the devices by a column and the entities of each by the same, the branch with no device last", () => {
    const names = (dir: "asc" | "desc") => sortBranches(h, f, "name", dir).map((b) => b.device?.name ?? "No device");
    expect(names("asc")).toEqual(["Empty thing", "Floor lamp", "Hub", "Radiator valve", "Room sensor", "No device"]);
    expect(names("desc")).toEqual(["Room sensor", "Radiator valve", "Hub", "Floor lamp", "Empty thing", "No device"]);
    expect(idsOf(sortBranches(h, f, "name", "desc").find((b) => b.key === "lamp")!)).toEqual(["light.night_light", "light.floor_lamp"]);
  });

  it("sorts devices by model, entity count, state and area, blanks last", () => {
    expect(order("id")).toEqual(["lamp", "sensor", "empty", "hub", "valve", NO_DEVICE]);
    expect(order("type").slice(0, 2)).toEqual(["empty", "hub"]);
    expect(order("type", "desc").slice(-3)).toEqual(["hub", "empty", NO_DEVICE]);
    // The kitchen valve, then the living room devices; the hub has no area.
    expect(order("area")[0]).toBe("valve");
    expect(order("area").at(-2)).toBe("hub");
    expect(order("area", "desc").at(-2)).toBe("hub");
    expect(order("state")[0]).toBe("lamp");
  });

  it("sorts the entities of a device by the entity columns", () => {
    const sensor = (column: Parameters<typeof sortBranches>[2], dir: "asc" | "desc" = "asc") => idsOf(sortBranches(h, f, column, dir).find((b) => b.key === "sensor")!);
    expect(sensor("id")).toEqual(["sensor.room_humidity", "sensor.room_temperature"]);
    expect(sensor("type")).toEqual(["sensor.room_humidity", "sensor.room_temperature"]);
    expect(sensor("state")).toEqual(["sensor.room_temperature", "sensor.room_humidity"]);
    expect(sensor("state", "desc")).toEqual(["sensor.room_humidity", "sensor.room_temperature"]);
  });

  it("does not touch the branches it was given", () => {
    const before = f.map((b) => idsOf(b));
    sortBranches(h, f, "name", "desc");
    expect(f.map((b) => idsOf(b))).toEqual(before);
  });
});

describe("the flat list", () => {
  it("has each entity once, in the order of the branches", () => {
    const f = filterBranches(all, { roles: only("temperature"), query: "" });
    expect(new Set(branchEntities(f).map((e) => e.entityId))).toEqual(new Set(["sensor.room_temperature", "sensor.radiator_temperature"]));
    expect(branchEntities([...f, ...f])).toHaveLength(2);
  });
});

describe("helpers and groups", () => {
  const g = buildHierarchy(
    {
      config: {},
      floors: [],
      areas: [{ area_id: "hall", name: "Hall" }],
      devices: [],
      entities: [
        { entity_id: "light.hall_lamp", platform: "hue", area_id: "hall" },
        { entity_id: "light.hall_all", platform: "group", area_id: "hall" },
        { entity_id: "light.hall_gone", platform: "group", area_id: "hall" },
      ],
      labels: [],
      states: [
        { entity_id: "light.hall_lamp", state: "on", attributes: { friendly_name: "Hall lamp" } },
        { entity_id: "light.hall_all", state: "on", attributes: { friendly_name: "Hall all", entity_id: ["light.hall_lamp"] } },
        // Unavailable: no members reported.
        { entity_id: "light.hall_gone", state: "unavailable", attributes: { friendly_name: "Hall gone" } },
      ],
    },
    "now",
  );
  const branches = collectBranches(g, { scope: { kind: "area", areaId: "hall" }, entityOk: () => true });

  it("counts a light group, and one that is unavailable, as helpers and not as lights", () => {
    expect(branchRoleCounts(branches).map((c) => [c.role, c.count])).toEqual([
      ["light", 1],
      ["helper", 2],
    ]);
  });

  it("keeps them under the Helpers chip", () => {
    expect(branchEntities(filterBranches(branches, { roles: new Set<EntityRole>(["helper"]), query: "" })).map((e) => e.entityId)).toEqual(["light.hall_all", "light.hall_gone"]);
    expect(branchEntities(filterBranches(branches, { roles: new Set<EntityRole>(["light"]), query: "" })).map((e) => e.entityId)).toEqual(["light.hall_lamp"]);
  });
});
