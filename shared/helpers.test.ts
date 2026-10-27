import { describe, expect, it } from "vitest";

import { buildMockRegistry } from "../scripts/mock-ha-core.ts";
import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import {
  HELPERS,
  HELPER_SUFFIX_RE,
  areaHelperRow,
  effectiveSuffixes,
  hasPendingChange,
  helperChangeInputs,
  helperExclusions,
  helperKeyFor,
  helperNameErrors,
  planHelpers,
  type HelperRow,
} from "./helpers.ts";
import { areaInventory, EMPTY_INVENTORY, setCounts, type InventorySettings } from "./inventory.ts";
import { validateInput } from "./changes.ts";
import { DEFAULT_NAMING, type NamingSettings } from "./naming.ts";
import type { Change } from "./types.ts";

type Spec = { id: string; state?: string; dc?: string; platform?: string; members?: string[]; area?: string; entry?: string; name?: string };

// A small invented house: a living room and a kitchen, each with the code its
// entity ids use. Specs without an area go to the living room.
function house(specs: Spec[], areas: Partial<Record<string, { temperature?: string; humidity?: string }>> = {}) {
  const reg: RawRegistry = {
    config: { location_name: "Test house" },
    floors: [{ floor_id: "ground", name: "Ground floor", level: 0 }],
    areas: [
      { area_id: "living_room", name: "Living room", floor_id: "ground", temperature_entity_id: areas.living_room?.temperature, humidity_entity_id: areas.living_room?.humidity },
      { area_id: "kitchen", name: "Kitchen", floor_id: "ground", temperature_entity_id: areas.kitchen?.temperature },
    ],
    devices: [],
    entities: [],
    labels: [],
    states: [],
  };
  for (const s of specs) {
    reg.entities.push({ entity_id: s.id, platform: s.platform ?? "demo", area_id: s.area ?? "living_room", config_entry_id: s.entry, original_name: s.name });
    reg.states.push({ entity_id: s.id, state: s.state ?? "off", attributes: { friendly_name: s.name ?? s.id.split(".")[1].replace(/_/g, " "), device_class: s.dc, entity_id: s.members } });
  }
  return buildHierarchy(reg, "now");
}

const naming: NamingSettings = { ...DEFAULT_NAMING, areaCodes: { living_room: "living", kitchen: "kitchen" } };
const plan = (specs: Spec[], inv: InventorySettings = EMPTY_INVENTORY, n: NamingSettings = naming, areas = {}) => planHelpers(house(specs, areas), inv, n);
const row = (rows: HelperRow[], key: string, area = "living_room") => rows.find((r) => r.key === key && r.areaId === area);

const lights = [{ id: "light.living_spots" }, { id: "light.living_lamp" }];

describe("what gets a helper", () => {
  it("proposes a canonical helper per capability with a counted source, with the default names", () => {
    const rows = plan([
      ...lights,
      { id: "binary_sensor.living_pir", dc: "motion" },
      { id: "binary_sensor.living_mmwave", dc: "occupancy" },
      { id: "binary_sensor.living_balcony", dc: "door" },
      { id: "binary_sensor.living_window", dc: "window" },
      { id: "sensor.living_t1", dc: "temperature", state: "21" },
      { id: "sensor.living_h1", dc: "humidity", state: "50" },
      { id: "sensor.living_lux", dc: "illuminance", state: "100" },
    ]);
    expect(rows.map((r) => [r.key, r.canonicalId, r.status, r.helper, r.groupType])).toEqual([
      ["lights", "light.living_all", "create", "group", "light"],
      ["motion", "binary_sensor.living_motions", "create", "group", "binary_sensor"],
      ["presence", "binary_sensor.living_presences", "create", "group", "binary_sensor"],
      ["door", "binary_sensor.living_doors", "create", "group", "binary_sensor"],
      ["window", "binary_sensor.living_windows", "create", "group", "binary_sensor"],
      ["temperature", "sensor.living_temperature", "create", "min_max", undefined],
      ["humidity", "sensor.living_humidity", "create", "min_max", undefined],
      ["illuminance", "sensor.living_illuminance", "create", "min_max", undefined],
    ]);
    expect(row(rows, "motion")!.name).toBe("Living room motions");
    expect(row(rows, "lights")!.sources).toEqual(["light.living_lamp", "light.living_spots"]);
  });

  it("uses only counted entities, and nothing when none count", () => {
    const specs = [{ id: "binary_sensor.living_pir", dc: "motion" }, { id: "binary_sensor.living_pir2", dc: "motion" }];
    const h = house(specs);
    const off = setCounts(h, setCounts(h, EMPTY_INVENTORY, "binary_sensor.living_pir2", false), "binary_sensor.living_pir", false);
    expect(row(planHelpers(h, setCounts(h, EMPTY_INVENTORY, "binary_sensor.living_pir2", false), naming), "motion")!.sources).toEqual(["binary_sensor.living_pir"]);
    expect(row(planHelpers(h, off, naming), "motion")).toBeUndefined();
  });

  it("needs two players for a media helper, speakers and TVs together", () => {
    expect(row(plan([{ id: "media_player.living_speaker" }]), "media")).toBeUndefined();
    const two = row(plan([{ id: "media_player.living_speaker" }, { id: "media_player.living_tv", dc: "tv" }]), "media")!;
    expect(two).toMatchObject({ canonicalId: "media_player.living_media", helper: "group", groupType: "media_player", sources: ["media_player.living_speaker", "media_player.living_tv"] });
  });

  it("uses the names set in the settings", () => {
    const rows = plan([...lights, { id: "binary_sensor.living_pir", dc: "motion" }], EMPTY_INVENTORY, { ...naming, helperNames: { lights: "lamps", motion: "pirs" } });
    expect(row(rows, "lights")!.canonicalId).toBe("light.living_lamps");
    expect(row(rows, "motion")!.canonicalId).toBe("binary_sensor.living_pirs");
  });
});

describe("the combined entity of a capability", () => {
  it("maps each capability to its helper, speakers and TVs to the media group", () => {
    expect(helperKeyFor("lights")).toBe("lights");
    expect(helperKeyFor("illuminance")).toBe("illuminance");
    expect(helperKeyFor("speaker")).toBe("media");
    expect(helperKeyFor("tv")).toBe("media");
    for (const none of ["thermostat", "cover", "fan", "power"] as const) expect(helperKeyFor(none)).toBeNull();
  });

  it("finds the row of an area for a helper, and nothing where the area gets none", () => {
    const rows = plan([...lights, { id: "media_player.living_speaker" }, { id: "binary_sensor.kitchen_pir", dc: "motion", area: "kitchen" }]);
    expect(areaHelperRow(rows, "living_room", "lights")?.canonicalId).toBe("light.living_all");
    expect(areaHelperRow(rows, "kitchen", "motion")?.canonicalId).toBe("binary_sensor.kitchen_motions");
    // One player is not enough for a media group; the other area has no lights.
    expect(areaHelperRow(rows, "living_room", "media")).toBeUndefined();
    expect(areaHelperRow(rows, "kitchen", "lights")).toBeUndefined();
  });

  it("follows the counts: a capability whose entities no longer count has no row", () => {
    const specs = [{ id: "binary_sensor.living_pir", dc: "motion" }];
    const h = house(specs);
    expect(areaHelperRow(planHelpers(h, EMPTY_INVENTORY, naming), "living_room", "motion")).toBeDefined();
    const off = setCounts(h, EMPTY_INVENTORY, "binary_sensor.living_pir", false);
    expect(areaHelperRow(planHelpers(h, off, naming), "living_room", "motion")).toBeUndefined();
  });
});

describe("a helper that is already there", () => {
  it("is in place when a group at the canonical id has the same members, in any order", () => {
    const rows = plan([...lights, { id: "light.living_all", platform: "group", members: ["light.living_spots", "light.living_lamp"], entry: "E1" }]);
    expect(row(rows, "lights")).toMatchObject({ status: "in-place", actionable: false, canonicalId: "light.living_all" });
    // The group itself is not one of the area's lights.
    expect(row(rows, "lights")!.sources).toEqual(["light.living_lamp", "light.living_spots"]);
  });

  it("updates the members of a group at the canonical id when they differ", () => {
    const rows = plan([...lights, { id: "light.living_all", platform: "group", members: ["light.living_spots", "light.living_old"], entry: "E1" }, { id: "light.living_old", area: "kitchen" }]);
    expect(row(rows, "lights")).toMatchObject({ status: "update-members", added: ["light.living_lamp"], removed: ["light.living_old"], actionable: true });
  });

  it("is a conflict, with nothing to do, for a group written in YAML whose members differ", () => {
    const rows = plan([...lights, { id: "light.living_all", platform: "group", members: ["light.living_spots"] }]);
    expect(row(rows, "lights")).toMatchObject({ status: "conflict", conflict: "not-editable", heldBy: "light.living_all", actionable: false });
  });

  it("treats a min/max at the canonical id as in place, without checking its members", () => {
    const rows = plan([{ id: "sensor.living_t1", dc: "temperature", state: "21" }, { id: "sensor.living_temperature", platform: "min_max", dc: "temperature", state: "21" }], EMPTY_INVENTORY, naming, {
      living_room: { temperature: "sensor.living_temperature" },
    });
    expect(row(rows, "temperature")).toMatchObject({ status: "in-place", membersUnknown: true, actionable: false });
    expect(row(rows, "temperature")!.sources).toEqual(["sensor.living_t1"]);
  });

  it("conflicts with a real sensor on the canonical id, and says who has it", () => {
    const rows = plan([{ id: "sensor.living_temperature", dc: "temperature", state: "21", name: "Living temperature" }]);
    expect(row(rows, "temperature")).toMatchObject({ status: "conflict", conflict: "taken", heldBy: "sensor.living_temperature", heldByName: "Living temperature", actionable: false });
    // A real sensor stays among the area's temperature sources.
    expect(row(rows, "temperature")!.sources).toEqual(["sensor.living_temperature"]);
  });

  it("conflicts when the canonical id is another kind of helper", () => {
    const rows = plan([...lights, { id: "light.living_all", platform: "template", members: undefined }]);
    expect(row(rows, "lights")).toMatchObject({ status: "conflict", conflict: "taken" });
  });
});

describe("adopting a group that already does the job", () => {
  const spots = { id: "light.living_spots" };
  const lamp = { id: "light.living_lamp" };

  it("renames a group whose members are exactly the sources", () => {
    const rows = plan([spots, lamp, { id: "light.living_both", platform: "group", members: ["light.living_lamp", "light.living_spots"], name: "Both" }]);
    expect(row(rows, "lights")).toMatchObject({ status: "adopt", adoptFrom: "light.living_both", canonicalId: "light.living_all", actionable: true });
    expect(row(rows, "lights")!.membersDiffer).toBeUndefined();
  });

  it("prefers a group in the same area, then the first by name", () => {
    const g = (id: string, name: string, area?: string) => ({ id, platform: "group", members: ["light.living_lamp", "light.living_spots"], name, area });
    const rows = plan([spots, lamp, g("light.z_elsewhere", "A elsewhere", "kitchen"), g("light.living_b", "B"), g("light.living_a", "A")]);
    expect(row(rows, "lights")!.adoptFrom).toBe("light.living_a");
  });

  it("adopts a group in this area that shares at least half its members, and marks the difference", () => {
    const rows = plan([spots, lamp, { id: "light.living_old", platform: "group", members: ["light.living_spots", "light.living_gone"], entry: "E2" }, { id: "light.living_gone", area: "kitchen" }]);
    expect(row(rows, "lights")).toMatchObject({ status: "adopt", adoptFrom: "light.living_old", membersDiffer: true, added: ["light.living_lamp"], removed: ["light.living_gone"] });
  });

  it("doesn't adopt a near match with too little in common, in another area, or that can't be edited", () => {
    const third = { id: "light.living_third" };
    const many = ["light.living_spots", "light.k1", "light.k2"];
    const k = [{ id: "light.k1", area: "kitchen" }, { id: "light.k2", area: "kitchen" }];
    expect(row(plan([spots, lamp, third, ...k, { id: "light.living_wide", platform: "group", members: many, entry: "E" }]), "lights")!.status).toBe("create");
    expect(row(plan([spots, lamp, { id: "light.k_near", platform: "group", members: ["light.living_spots"], entry: "E", area: "kitchen" }]), "lights")!.status).toBe("create");
    expect(row(plan([spots, lamp, { id: "light.living_yaml", platform: "group", members: ["light.living_spots"] }]), "lights")!.status).toBe("create");
  });

  it("never adopts a group of another domain, or one that is another area's canonical helper", () => {
    const rows = plan([
      spots,
      lamp,
      { id: "switch.living_both", platform: "group", members: ["light.living_lamp", "light.living_spots"] },
      { id: "light.kitchen_all", platform: "group", members: ["light.living_lamp", "light.living_spots"], area: "kitchen", entry: "E" },
    ]);
    expect(row(rows, "lights")!.status).toBe("create");
  });

  it("adopts a group for one helper only", () => {
    const rows = plan([
      { id: "binary_sensor.living_pir", dc: "motion" },
      { id: "binary_sensor.living_mm", dc: "occupancy" },
      { id: "binary_sensor.living_pir2", dc: "motion" },
      { id: "binary_sensor.living_pair", platform: "group", members: ["binary_sensor.living_pir", "binary_sensor.living_pir2"] },
    ]);
    expect([row(rows, "motion")!.status, row(rows, "presence")!.status]).toEqual(["adopt", "create"]);
  });

  it("never adopts a min/max: its members can't be read", () => {
    const rows = plan([{ id: "sensor.living_t1", dc: "temperature", state: "21" }, { id: "sensor.living_mean", platform: "min_max", dc: "temperature", state: "21", members: ["sensor.living_t1"] }]);
    expect(row(rows, "temperature")!.status).toBe("create");
  });
});

describe("the area's temperature and humidity sensor", () => {
  const t1 = { id: "sensor.living_t1", dc: "temperature", state: "21" };

  it("is proposed together with a new canonical sensor", () => {
    const r = row(plan([t1]), "temperature")!;
    expect(r).toMatchObject({ status: "create", areaSensor: { field: "temperature_entity_id", current: null } });
    expect(helperChangeInputs(r)).toEqual([
      {
        kind: "helper",
        op: "create",
        fields: { helper: "min_max", name: "Living room temperature", entity_id: "sensor.living_temperature", entities: ["sensor.living_t1"], area_id: "living_room", set_area_sensor: "temperature" },
      },
    ]);
  });

  it("is a small proposal of its own when the canonical sensor is in place", () => {
    const specs = [t1, { id: "sensor.living_temperature", platform: "min_max", dc: "temperature", state: "21" }];
    const r = row(plan(specs, EMPTY_INVENTORY, naming, { living_room: { temperature: "sensor.living_t1" } }), "temperature")!;
    expect(r).toMatchObject({ status: "in-place", actionable: true, areaSensor: { field: "temperature_entity_id", current: "sensor.living_t1" } });
    expect(helperChangeInputs(r)).toEqual([{ kind: "area", op: "update", targetId: "living_room", fields: { temperature_entity_id: "sensor.living_temperature" } }]);
  });

  it("is left alone when the area already points at the canonical sensor, and for a conflict", () => {
    const done = plan([t1, { id: "sensor.living_temperature", platform: "min_max", dc: "temperature", state: "21" }], EMPTY_INVENTORY, naming, { living_room: { temperature: "sensor.living_temperature" } });
    expect(row(done, "temperature")!.areaSensor).toBeUndefined();
    const clash = row(plan([{ id: "sensor.living_temperature", dc: "temperature", state: "21" }]), "temperature")!;
    expect(clash.status).toBe("conflict");
    expect(clash.areaSensor).toBeUndefined();
  });

  it("does the same for humidity, with its own field", () => {
    const r = row(plan([{ id: "sensor.living_h1", dc: "humidity", state: "50" }]), "humidity")!;
    expect(r.areaSensor).toEqual({ field: "humidity_entity_id", current: null });
  });
});

describe("the change a row makes", () => {
  const base: Omit<HelperRow, "status"> = { level: "area", floorId: null, areaId: "living_room", areaName: "Living room", key: "lights", canonicalId: "light.living_all", name: "Living room lights", helper: "group", groupType: "light", sources: ["light.a", "light.b"], added: [], removed: [], actionable: true };

  it("renames the group to adopt it, and updates its members only when they differ", () => {
    expect(helperChangeInputs({ ...base, status: "adopt", adoptFrom: "light.both" })).toEqual([{ kind: "entity", op: "update", targetId: "light.both", fields: { new_entity_id: "light.living_all" } }]);
    expect(helperChangeInputs({ ...base, status: "adopt", adoptFrom: "light.both", membersDiffer: true })).toEqual([
      { kind: "entity", op: "update", targetId: "light.both", fields: { new_entity_id: "light.living_all" } },
      { kind: "helper", op: "update", targetId: "light.both", fields: { entities: ["light.a", "light.b"] } },
    ]);
  });

  it("updates the members of a group in place, creates a group with its type, and does nothing for a conflict", () => {
    expect(helperChangeInputs({ ...base, status: "update-members", added: ["light.b"] })).toEqual([{ kind: "helper", op: "update", targetId: "light.living_all", fields: { entities: ["light.a", "light.b"] } }]);
    expect(helperChangeInputs({ ...base, status: "create" })).toEqual([
      { kind: "helper", op: "create", fields: { helper: "group", group_type: "light", name: "Living room lights", entity_id: "light.living_all", entities: ["light.a", "light.b"], area_id: "living_room" } },
    ]);
    expect(helperChangeInputs({ ...base, status: "conflict", actionable: false })).toEqual([]);
    expect(helperChangeInputs({ ...base, status: "in-place", actionable: false })).toEqual([]);
  });
});

describe("rows already in the change list", () => {
  const r = { level: "area", floorId: null, areaId: "living_room", areaName: "Living room", key: "temperature", canonicalId: "sensor.living_temperature", name: "x", helper: "min_max", sources: [], status: "create", added: [], removed: [], actionable: true } as HelperRow;
  const change = (c: Partial<Change>): Change => ({ id: 1, kind: "helper", op: "create", targetId: "", scope: null, before: {}, after: {}, createdAt: "", ...c });

  it("sees a helper being created or updated, a rename to the id, and the area setting", () => {
    expect(hasPendingChange(r, [])).toBe(false);
    expect(hasPendingChange(r, [change({ targetId: "sensor.living_temperature" })])).toBe(true);
    expect(hasPendingChange({ ...r, adoptFrom: "light.old" }, [change({ kind: "entity", op: "update", targetId: "light.old", after: { new_entity_id: "light.living_all" } })])).toBe(true);
    expect(hasPendingChange(r, [change({ kind: "entity", op: "update", targetId: "sensor.x", after: { new_entity_id: "sensor.living_temperature" } })])).toBe(true);
    const sensor = { ...r, status: "in-place", areaSensor: { field: "temperature_entity_id", current: null } } as HelperRow;
    expect(hasPendingChange(sensor, [change({ kind: "area", op: "update", targetId: "living_room", after: { temperature_entity_id: "sensor.living_temperature" } })])).toBe(true);
    expect(hasPendingChange(r, [change({ kind: "area", op: "update", targetId: "living_room", after: { temperature_entity_id: "sensor.living_temperature" } })])).toBe(false);
    expect(hasPendingChange(r, [change({ targetId: "sensor.other" })])).toBe(false);
  });
});

describe("what the inventory leaves out", () => {
  it("hides an area's canonical helpers that exist as the right kind of helper, not a real sensor", () => {
    const h = house([
      { id: "binary_sensor.living_motions", platform: "group", dc: "motion", members: ["binary_sensor.living_pir"], entry: "E" },
      { id: "binary_sensor.living_pir", dc: "motion" },
      { id: "sensor.living_temperature", dc: "temperature", state: "21" },
    ]);
    const exclude = helperExclusions(h, naming)("living_room");
    expect([...exclude]).toEqual(["binary_sensor.living_motions"]);
    const motion = areaInventory(h, EMPTY_INVENTORY, "living_room", exclude).motion.map((m) => m.entityId);
    expect(motion).toEqual(["binary_sensor.living_pir"]);
    expect(areaInventory(h, EMPTY_INVENTORY, "living_room").motion.map((m) => m.entityId)).toContain("binary_sensor.living_motions");
    expect(areaInventory(h, EMPTY_INVENTORY, "living_room", exclude).temperature.map((m) => m.entityId)).toEqual(["sensor.living_temperature"]);
  });
});

describe("helper names", () => {
  it("fills in the defaults and takes the ones set", () => {
    expect(effectiveSuffixes(undefined)).toMatchObject({ lights: "all", motion: "motions", presence: "presences", door: "doors", window: "windows", temperature: "temperature", humidity: "humidity", illuminance: "illuminance", media: "media" });
    expect(effectiveSuffixes({ lights: "lamps" }).lights).toBe("lamps");
    expect(HELPERS.map((s) => s.key)).toHaveLength(9);
  });

  it("accepts lower-case slugs only", () => {
    for (const ok of ["a", "all", "motion_group", "m2", "x".repeat(30)]) expect(HELPER_SUFFIX_RE.test(ok)).toBe(true);
    for (const bad of ["", "Motion", "a b", "a-b", "_a", "a_", "a__b", "x".repeat(31), "é"]) expect(HELPER_SUFFIX_RE.test(bad)).toBe(false);
  });

  it("says what is wrong, per key, including a name two keys share", () => {
    expect(helperNameErrors({})).toEqual({});
    expect(helperNameErrors({ lights: "Lamps" }).lights).toMatch(/a–z/);
    // The default of another key counts too.
    expect(helperNameErrors({ lights: "motions" })).toMatchObject({ lights: expect.stringContaining("Motion"), motion: expect.stringContaining("Lights") });
    expect(helperNameErrors({ lights: "x", motion: "x" })).toMatchObject({ lights: expect.any(String), motion: expect.any(String) });
  });
});

describe("the demo house", () => {
  const rows = planHelpers(buildHierarchy(buildMockRegistry(), "now"), EMPTY_INVENTORY, DEFAULT_NAMING);
  const at = (id: string) => rows.find((r) => r.canonicalId === id)!;

  it("shows every status, so the Helpers views can be tried against the mock", () => {
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(["in-place", "update-members", "adopt", "create", "conflict"]));
    expect(at("light.living_all")).toMatchObject({ status: "in-place" });
    expect(at("light.garage_all")).toMatchObject({ status: "update-members", added: ["light.garage_bench"], removed: [] });
    expect(at("light.hall_all")).toMatchObject({ status: "adopt", adoptFrom: "light.hall_lights" });
    expect(at("sensor.living_temperature")).toMatchObject({ status: "conflict", conflict: "taken" });
    expect(at("sensor.study_temperature")).toMatchObject({ status: "create", helper: "min_max", areaSensor: { field: "temperature_entity_id", current: null } });
    expect(at("binary_sensor.kitchen_motions")).toMatchObject({ status: "create", helper: "group" });
  });
});

// ---------------------------------------------------------------------------
// The light groups of the floors and of the house.
// ---------------------------------------------------------------------------

describe("floor and house light groups", () => {
  // Two floors, three areas on them and a garage on none. Everything with a code of its own.
  function tiers(specs: Spec[], o: { floors?: RawRegistry["floors"]; areas?: RawRegistry["areas"] } = {}) {
    const reg: RawRegistry = {
      config: { location_name: "Test house" },
      floors: o.floors ?? [
        { floor_id: "ground", name: "Ground floor", level: 0 },
        { floor_id: "first", name: "First floor", level: 1 },
      ],
      areas: o.areas ?? [
        { area_id: "living_room", name: "Living room", floor_id: "ground" },
        { area_id: "kitchen", name: "Kitchen", floor_id: "ground" },
        { area_id: "bedroom", name: "Bedroom", floor_id: "first" },
        { area_id: "garage", name: "Garage", floor_id: null },
      ],
      devices: [],
      entities: [],
      labels: [],
      states: [],
    };
    for (const s of specs) {
      reg.entities.push({ entity_id: s.id, platform: s.platform ?? "demo", area_id: s.area ?? "living_room", config_entry_id: s.entry, original_name: s.name });
      reg.states.push({ entity_id: s.id, state: s.state ?? "off", attributes: { friendly_name: s.name ?? s.id.split(".")[1].replace(/_/g, " "), device_class: s.dc, entity_id: s.members } });
    }
    return buildHierarchy(reg, "now");
  }
  const n: NamingSettings = { ...DEFAULT_NAMING, areaCodes: { living_room: "living", kitchen: "kitchen", bedroom: "bedroom", garage: "garage" } };
  const upper = (rows: HelperRow[]) => rows.filter((r) => r.level !== "area");
  const run = (specs: Spec[], naming: NamingSettings = n, changes: Change[] = [], o?: Parameters<typeof tiers>[1]) => upper(planHelpers(tiers(specs, o), EMPTY_INVENTORY, naming, changes));
  // entry: the group's config entry (null: written in YAML).
  const grp = (id: string, area: string, members: string[], entry: string | null = "E"): Spec => ({ id, platform: "group", members, area, entry: entry ?? undefined });
  const change = (c: Partial<Change>): Change => ({ id: 1, kind: "helper", op: "create", targetId: "", scope: null, before: {}, after: {}, createdAt: "", ...c });

  const living = grp("light.living_all", "living_room", ["light.living_spots"], "E1");
  const kitchen = grp("light.kitchen_all", "kitchen", ["light.kitchen_main"], "E2");
  const garage = grp("light.garage_all", "garage", ["light.garage_ceiling"], "E4");
  const lamps = [
    { id: "light.living_spots" },
    { id: "light.kitchen_main", area: "kitchen" },
    { id: "light.bedside", area: "bedroom" },
    { id: "light.garage_ceiling", area: "garage" },
  ];

  it("has none while no area has a light group, in Home Assistant or in the list", () => {
    expect(run([...lamps])).toEqual([]);
    // The area's group is only planned (a row to create), not there: nothing to gather yet.
    expect(planHelpers(tiers(lamps), EMPTY_INVENTORY, n).some((r) => r.level === "area" && r.key === "lights")).toBe(true);
    expect(upper(planHelpers(tiers(lamps), EMPTY_INVENTORY, n))).toEqual([]);
  });

  it("creates a floor's group from the light groups of its areas, named after the floor and the lights suffix", () => {
    const rows = run([...lamps, living, kitchen]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      level: "floor",
      floorId: "ground",
      areaId: null,
      areaName: "Ground floor",
      key: "lights",
      canonicalId: "light.ground_all",
      name: "Ground floor lights",
      helper: "group",
      groupType: "light",
      sources: ["light.kitchen_all", "light.living_all"],
      status: "create",
      actionable: true,
    });
    // The other floor has no area group, so no row.
    expect(rows.some((r) => r.floorId === "first")).toBe(false);
  });

  it("gathers the area groups of areas on no floor into the house group, with the floors' groups", () => {
    const floorGroup = grp("light.ground_all", "living_room", ["light.kitchen_all", "light.living_all"], "E5");
    const rows = run([...lamps, living, kitchen, garage, floorGroup]);
    const ground = rows.find((r) => r.level === "floor")!;
    expect(ground).toMatchObject({ canonicalId: "light.ground_all", status: "in-place", actionable: false });
    const house = rows.find((r) => r.level === "house")!;
    expect(house).toMatchObject({
      areaId: null,
      floorId: null,
      areaName: "House",
      canonicalId: "light.all",
      name: "All lights",
      groupType: "light",
      sources: ["light.garage_all", "light.ground_all"],
      status: "create",
    });
  });

  it("leaves a floor out of the house group until its group exists or is in the list", () => {
    // The ground floor's group is only planned: the house gathers just the garage.
    const planned = run([...lamps, living, kitchen, garage]);
    expect(planned.find((r) => r.level === "floor")!.status).toBe("create");
    expect(planned.find((r) => r.level === "house")!.sources).toEqual(["light.garage_all"]);
    // Once its creation is in the list, the house gathers it too.
    const queued = [change({ targetId: "light.ground_all", after: { helper: "group", entity_id: "light.ground_all" } })];
    expect(run([...lamps, living, kitchen, garage], n, queued).find((r) => r.level === "house")!.sources).toEqual(["light.garage_all", "light.ground_all"]);
    // No house group when there is nothing at all for it.
    expect(run([...lamps, living, kitchen]).some((r) => r.level === "house")).toBe(false);
  });

  it("counts an area group that is in the list: created, or renamed from another group", () => {
    const only = run([...lamps, living]);
    expect(only[0].sources).toEqual(["light.living_all"]);
    const created = [change({ targetId: "light.kitchen_all", after: { helper: "group", entity_id: "light.kitchen_all" } })];
    expect(run([...lamps, living], n, created)[0].sources).toEqual(["light.kitchen_all", "light.living_all"]);
    const renamed = [change({ kind: "entity", op: "update", targetId: "light.old_kitchen", after: { new_entity_id: "light.kitchen_all" } })];
    expect(run([...lamps, living], n, renamed)[0].sources).toEqual(["light.kitchen_all", "light.living_all"]);
    // A change for some other id doesn't.
    const other = [change({ targetId: "light.pantry_all", after: { helper: "group", entity_id: "light.pantry_all" } })];
    expect(run([...lamps, living], n, other)[0].sources).toEqual(["light.living_all"]);
  });

  it("is in place when the group has the members, in any order", () => {
    const floorGroup = grp("light.ground_all", "living_room", ["light.living_all", "light.kitchen_all"], "E5");
    const row = run([...lamps, living, kitchen, floorGroup])[0];
    expect(row).toMatchObject({ status: "in-place", actionable: false, added: [], removed: [] });
    expect(helperChangeInputs(row)).toEqual([]);
  });

  it("updates the members of a floor's group set up in the UI", () => {
    const floorGroup = grp("light.ground_all", "living_room", ["light.living_all", "light.old"], "E5");
    const row = run([...lamps, living, kitchen, floorGroup, { id: "light.old", area: "garage" }])[0];
    expect(row).toMatchObject({ status: "update-members", added: ["light.kitchen_all"], removed: ["light.old"], actionable: true });
    expect(helperChangeInputs(row)).toEqual([{ kind: "helper", op: "update", targetId: "light.ground_all", fields: { entities: ["light.kitchen_all", "light.living_all"] } }]);
  });

  it("is a conflict when the id is a group written in YAML with other members, or something that isn't a group", () => {
    const yaml = grp("light.ground_all", "living_room", ["light.living_all"], null);
    expect(run([...lamps, living, kitchen, yaml])[0]).toMatchObject({ status: "conflict", conflict: "not-editable", heldBy: "light.ground_all", actionable: false });
    const strip = { id: "light.ground_all", name: "Strip", area: "living_room" };
    expect(run([...lamps, living, kitchen, strip])[0]).toMatchObject({ status: "conflict", conflict: "taken", heldByName: "Strip", actionable: false });
    // A conflicting floor group isn't gathered by the house.
    const rows = run([...lamps, living, kitchen, garage, strip]);
    expect(rows.find((r) => r.level === "house")!.sources).toEqual(["light.garage_all"]);
  });

  it("adopts a group with exactly the members, once, by renaming it", () => {
    const downstairs = grp("light.downstairs", "living_room", ["light.kitchen_all", "light.living_all"], "E6");
    const rows = run([...lamps, living, kitchen, downstairs]);
    expect(rows[0]).toMatchObject({ status: "adopt", adoptFrom: "light.downstairs", adoptFromName: "downstairs" });
    expect(helperChangeInputs(rows[0])).toEqual([{ kind: "entity", op: "update", targetId: "light.downstairs", fields: { new_entity_id: "light.ground_all" } }]);
    // No near match for a floor: other members mean a group of its own.
    const near = grp("light.downstairs", "living_room", ["light.kitchen_all", "light.living_all", "light.porch"], "E6");
    expect(run([...lamps, living, kitchen, near, { id: "light.porch" }])[0].status).toBe("create");
  });

  it("adopts a group for the house the same way", () => {
    const floorGroup = grp("light.ground_all", "living_room", ["light.kitchen_all", "light.living_all"], "E5");
    const all = grp("light.everything", "garage", ["light.garage_all", "light.ground_all"], "E7");
    const house = run([...lamps, living, kitchen, garage, floorGroup, all]).find((r) => r.level === "house")!;
    expect(house).toMatchObject({ status: "adopt", adoptFrom: "light.everything", canonicalId: "light.all" });
  });

  it("is a conflict when a floor's code is an area's, naming the area's helper", () => {
    const rows = run([...lamps, living, kitchen], { ...n, floorCodes: { ground: "kitchen" } });
    expect(rows[0]).toMatchObject({ canonicalId: "light.kitchen_all", status: "conflict", conflict: "taken", heldByName: "Kitchen lights", actionable: false });
    // The same when the area's group doesn't exist yet: the id is the area's.
    expect(run([...lamps, living, kitchen], { ...n, floorCodes: { ground: "garage" } })[0]).toMatchObject({ canonicalId: "light.garage_all", status: "conflict", heldByName: "Garage lights" });
  });

  it("is a conflict for the second of two floors with one code, and for a house id that is a floor's", () => {
    const bedroom = grp("light.bedroom_all", "bedroom", ["light.bedside"], "E3");
    const rows = run([...lamps, living, bedroom], { ...n, floorCodes: { first: "ground" } });
    const floors = rows.filter((r) => r.level === "floor");
    expect(floors.map((f) => [f.floorId, f.status])).toEqual([["ground", "create"], ["first", "conflict"]]);
    expect(floors[1]).toMatchObject({ conflict: "taken", heldByName: "Ground floor lights" });
    const onFloor = run([...lamps, living, garage, grp("light.ground_all", "living_room", ["light.living_all"], "E5")], { ...n, houseGroup: "ground_all" });
    expect(onFloor.find((r) => r.level === "house")).toMatchObject({ canonicalId: "light.ground_all", status: "conflict" });
  });

  it("follows the settings: floor codes, the lights suffix and the house group's id", () => {
    const settings: NamingSettings = { ...n, floorCodes: { ground: "downstairs" }, helperNames: { lights: "lamps" }, houseGroup: "everything" };
    const l = grp("light.living_lamps", "living_room", ["light.living_spots"], "E1");
    const g = grp("light.garage_lamps", "garage", ["light.garage_ceiling"], "E4");
    const rows = run([...lamps, l, g], settings);
    expect(rows.map((r) => r.canonicalId)).toEqual(["light.downstairs_lamps", "light.everything"]);
    expect(rows[0].sources).toEqual(["light.living_lamps"]);
  });

  it("does nothing for a floor with no areas", () => {
    const loose = { floors: [{ floor_id: "attic", name: "Attic", level: 2 }], areas: [{ area_id: "living_room", name: "Living room", floor_id: null }] };
    expect(run([...lamps, living], n, [], loose).map((r) => r.level)).toEqual(["house"]);
  });

  it("creates with no area, through the same change a group of an area makes", () => {
    const row = run([...lamps, living, kitchen])[0];
    const inputs = helperChangeInputs(row);
    expect(inputs).toEqual([
      { kind: "helper", op: "create", fields: { helper: "group", group_type: "light", name: "Ground floor lights", entity_id: "light.ground_all", entities: ["light.kitchen_all", "light.living_all"] } },
    ]);
    expect(inputs[0].fields).not.toHaveProperty("area_id");
    expect(validateInput(inputs[0])).toBeNull();
  });

  it("is in the list once a change creates its id, or renames a group to it", () => {
    const row = run([...lamps, living, kitchen])[0];
    expect(hasPendingChange(row, [])).toBe(false);
    expect(hasPendingChange(row, [change({ targetId: "light.ground_all", after: { helper: "group", entity_id: "light.ground_all" } })])).toBe(true);
    expect(hasPendingChange(row, [change({ kind: "entity", op: "update", targetId: "light.x", after: { new_entity_id: "light.ground_all" } })])).toBe(true);
    // An area change for the same id means nothing to a floor row.
    expect(hasPendingChange(row, [change({ kind: "area", op: "update", targetId: "living_room", after: { temperature_entity_id: "light.ground_all" } })])).toBe(false);
  });
});

describe("the mock house", () => {
  it("has a light with no area, an area with no floor and floors with ids that say little", () => {
    const h = buildHierarchy(buildMockRegistry(), "now");
    expect(h.entities["light.stair_lamp"]).toMatchObject({ areaId: null, needsOwnName: false });
    expect(h.entities["light.porch_lamp"]).toMatchObject({ areaId: null, needsOwnName: true });
    expect(h.areas.garage.floorId).toBeNull();
    expect(h.floors.map((f) => f.id)).toEqual(expect.arrayContaining(["floor_2", "level_1"]));
  });
});
