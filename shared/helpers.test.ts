import { describe, expect, it } from "vitest";

import { buildMockRegistry } from "../scripts/mock-ha-core.ts";
import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import {
  HELPERS,
  HELPER_SUFFIX_RE,
  effectiveSuffixes,
  hasPendingChange,
  helperChangeInputs,
  helperExclusions,
  helperNameErrors,
  planHelpers,
  type HelperRow,
} from "./helpers.ts";
import { areaInventory, EMPTY_INVENTORY, setCounts, type InventorySettings } from "./inventory.ts";
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
  const base: Omit<HelperRow, "status"> = { areaId: "living_room", areaName: "Living room", key: "lights", canonicalId: "light.living_all", name: "Living room lights", helper: "group", groupType: "light", sources: ["light.a", "light.b"], added: [], removed: [], actionable: true };

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
  const r = { areaId: "living_room", areaName: "Living room", key: "temperature", canonicalId: "sensor.living_temperature", name: "x", helper: "min_max", sources: [], status: "create", added: [], removed: [], actionable: true } as HelperRow;
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
