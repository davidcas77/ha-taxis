import { describe, expect, it } from "vitest";

import { buildMockRegistry } from "../scripts/mock-ha-core.ts";
import { buildHierarchy } from "../server/model/hierarchy.ts";
import { DEFAULT_HOUSE_GROUP, DEFAULT_NAMING, analyzeArea, areaCodes, detectAreaCode, duplicateCodes, duplicateCodesMessage, duplicateIds, floorCodeAdvice, floorCodes, houseGroupId, slug } from "./naming.ts";
import type { Hierarchy } from "./types.ts";

// A house shaped like a real one: areas renamed after their ids were set, old
// prefixes, integration-made ids, and a switch named after another room.
function house(): Hierarchy {
  const reg = buildMockRegistry();
  reg.areas = [
    { area_id: "living_room", name: "Living Room", floor_id: "ground" },
    { area_id: "playroom", name: "Study", floor_id: "first" },
    { area_id: "bathroom", name: "Bathroom", floor_id: "first" },
    { area_id: "hallway", name: "Hallway", floor_id: "ground" },
  ];
  reg.devices = [];
  reg.entities = [];
  reg.states = [];
  const add = (entity_id: string, area_id: string, friendly: string, device_class?: string) => {
    reg.entities.push({ entity_id, area_id, platform: "x", original_name: friendly });
    reg.states.push({ entity_id, state: "off", attributes: { friendly_name: friendly, device_class } });
  };
  add("light.livingroom_spot_fireplace", "living_room", "Livingroom spot fireplace");
  add("light.livingroom_spots_front", "living_room", "Livingroom spots front");
  add("light.livingroom_lamp", "living_room", "Livingroom lamp");
  add("light.lr_ledstrip", "living_room", "LR ledstrip");
  add("sensor.k90_motion_alarm", "living_room", "K90 Motion alarm");
  add("binary_sensor.livingroom_balcony_door", "living_room", "Balcony door", "door");
  add("light.playroom_main", "playroom", "Playroom main");
  add("light.playroom_desk", "playroom", "Playroom desk");
  add("switch.switch2_8", "playroom", "Study desk power");
  add("sensor.hp_officejet_pro_9010_series", "playroom", "HP OfficeJet Pro 9010");
  add("light.bathroom_main", "hallway", "Bathroom main");
  add("light.bathroom_mirror", "bathroom", "Bathroom mirror");
  add("light.hallway_light_1", "hallway", "Hallway light 1");
  return buildHierarchy(reg, "now");
}

describe("area codes", () => {
  it("finds the prefix an area's entities already use, even when the area was renamed", () => {
    const h = house();
    expect(detectAreaCode(h.areas.living_room, h)).toMatchObject({ code: "livingroom", count: 4, total: 6 });
    expect(detectAreaCode(h.areas.playroom, h)).toMatchObject({ code: "playroom", count: 2 });
  });

  it("uses a code the user set instead", () => {
    const h = house();
    const codes = areaCodes(h, { ...DEFAULT_NAMING, areaCodes: { playroom: "Study" } });
    expect(codes.playroom).toMatchObject({ code: "study", detected: "playroom", custom: true });
    expect(codes.playroom.aliases).toContain("playroom");
  });

  it("falls back to the area id, not the name, when nothing settles the code", () => {
    const reg = buildMockRegistry();
    reg.areas = [
      { area_id: "ground_floor", name: "Entrance", floor_id: "ground" },
      { area_id: "!!", name: "Cellar", floor_id: "ground" },
    ];
    reg.devices = [];
    reg.entities = [];
    reg.states = [];
    const h = buildHierarchy(reg, "now");
    expect(detectAreaCode(h.areas.ground_floor, h)).toMatchObject({ code: "ground_floor", count: 0, total: 0, fallback: "id" });
    // An id with nothing usable in it falls back to the name.
    expect(detectAreaCode(h.areas["!!"], h)).toMatchObject({ code: "cellar", fallback: "name" });
    expect(areaCodes(h, DEFAULT_NAMING).ground_floor.fallback).toBe("id");
  });

  it("has no fallback when entities settle the code", () => {
    const h = house();
    expect(detectAreaCode(h.areas.living_room, h).fallback).toBeNull();
  });

  it("makes ids out of any name", () => {
    expect(slug("Σαλόνι Living-Room 2")).toBe("living_room_2");
    expect(slug("Café crème")).toBe("cafe_creme");
  });
});

describe("analyzeArea", () => {
  const h = house();

  it("counts what fits and what doesn't", () => {
    const a = analyzeArea(h.areas.living_room, h, DEFAULT_NAMING);
    expect(a.code).toBe("livingroom");
    expect(a.counts).toEqual({ ok: 4, "old-prefix": 0, "other-area": 0, "no-area": 2 });
  });

  it("suggests ids with the type in them where the domain doesn't say it, keeping what the id says", () => {
    const rows = Object.fromEntries(analyzeArea(h.areas.living_room, h, DEFAULT_NAMING).rows.map((r) => [r.entityId, r]));
    // A light's domain already says light: the id fits as it is.
    expect(rows["light.livingroom_spot_fireplace"].suggestedId).toBeNull();
    expect(rows["binary_sensor.livingroom_balcony_door"].suggestedId).toBe("binary_sensor.livingroom_door_balcony");
    // "lr" is Living Room's initials.
    expect(rows["light.lr_ledstrip"].suggestedId).toBe("light.livingroom_ledstrip");
  });

  it("names generic ids after what Home Assistant calls them", () => {
    const rows = Object.fromEntries(analyzeArea(h.areas.playroom, h, DEFAULT_NAMING).rows.map((r) => [r.entityId, r]));
    expect(rows["switch.switch2_8"]).toMatchObject({ status: "no-area", suggestedId: "switch.playroom_desk_power" });
  });

  it("notices an id that names another room", () => {
    const rows = Object.fromEntries(analyzeArea(h.areas.hallway, h, DEFAULT_NAMING).rows.map((r) => [r.entityId, r]));
    expect(rows["light.bathroom_main"]).toMatchObject({ status: "other-area", otherAreaId: "bathroom", foundPrefix: "bathroom", suggestedId: "light.hallway_main" });
  });

  it("sees an area's old prefix once the user picks a new code", () => {
    const a = analyzeArea(h.areas.playroom, h, { ...DEFAULT_NAMING, areaCodes: { playroom: "study" } });
    const main = a.rows.find((r) => r.entityId === "light.playroom_main")!;
    expect(main).toMatchObject({ status: "old-prefix", foundPrefix: "playroom", suggestedId: "light.study_main" });
  });

  it("suggests display names with the area in front, dropping another room's name", () => {
    const rows = Object.fromEntries(analyzeArea(h.areas.playroom, h, DEFAULT_NAMING).rows.map((r) => [r.entityId, r]));
    expect(rows["sensor.hp_officejet_pro_9010_series"].suggestedName).toBe("Study HP OfficeJet Pro 9010");
    // Already starts with the area: nothing to suggest.
    expect(rows["switch.switch2_8"].suggestedName).toBeNull();
    const hall = Object.fromEntries(analyzeArea(h.areas.hallway, h, DEFAULT_NAMING).rows.map((r) => [r.entityId, r]));
    expect(hall["light.bathroom_main"].suggestedName).toBe("Hallway Main");
    expect(hall["light.hallway_light_1"].suggestedName).toBeNull();
  });

  it("never suggests the same id twice, or one that's taken", () => {
    const reg = buildMockRegistry();
    reg.areas = [{ area_id: "kitchen", name: "Kitchen" }];
    reg.devices = [];
    reg.entities = [
      { entity_id: "light.kitchen_main", area_id: "kitchen", platform: "x" },
      { entity_id: "light.main", area_id: "kitchen", platform: "x" },
      { entity_id: "light.kitchen_light_main", area_id: "kitchen", platform: "x" },
    ];
    reg.states = reg.entities.map((e) => ({ entity_id: e.entity_id, state: "on", attributes: { friendly_name: "Main" } }));
    const k = buildHierarchy(reg, "now");
    const ids = analyzeArea(k.areas.kitchen, k, DEFAULT_NAMING).rows.map((r) => r.suggestedId ?? r.entityId);
    expect(new Set(ids).size).toBe(ids.length);
    // light.kitchen_light_main fits already; a numbered id would be worse.
    expect(ids).toContain("light.kitchen_light_main");
    expect(ids).toContain("light.kitchen_main_2");
  });

  it("keeps a serial number out of a suggested id", () => {
    const reg = buildMockRegistry();
    reg.areas = [{ area_id: "balcony", name: "Balcony" }];
    reg.devices = [];
    reg.entities = [{ entity_id: "sensor.sonoff_1000aa11bb_power", area_id: "balcony", platform: "x" }];
    reg.states = [{ entity_id: "sensor.sonoff_1000aa11bb_power", state: "3", attributes: { friendly_name: "Balcony strip Power", device_class: "power" } }];
    const b = buildHierarchy(reg, "now");
    const [row] = analyzeArea(b.areas.balcony, b, DEFAULT_NAMING).rows;
    expect(row.suggestedId).toBe("sensor.balcony_power_strip");
  });
});

describe("display names that start with the area's code", () => {
  it("drops a code word at the start instead of doubling the area", () => {
    const h = house();
    const rows = Object.fromEntries(analyzeArea(h.areas.living_room, h, DEFAULT_NAMING).rows.map((r) => [r.entityId, r]));
    expect(rows["light.livingroom_lamp"].suggestedName).toBe("Living Room Lamp");
    expect(rows["light.livingroom_spots_front"].suggestedName).toBe("Living Room Spots front");
  });
});

describe("detecting a code ignores brands and devices", () => {
  it("prefers a prefix that looks like the area over a more common brand", () => {
    const reg = buildMockRegistry();
    reg.areas = [{ area_id: "guest_bathroom", name: "Blue Bathroom" }];
    reg.devices = [];
    reg.entities = [];
    reg.states = [];
    for (const x of ["dryer", "dryer_energy", "dryer_door", "dryer_program"]) reg.entities.push({ entity_id: `sensor.${x}`, area_id: "guest_bathroom", platform: "x" });
    for (const x of ["guestbathroom_door", "guestbathroom_humidity"]) reg.entities.push({ entity_id: `sensor.${x}`, area_id: "guest_bathroom", platform: "x" });
    reg.states = reg.entities.map((e) => ({ entity_id: e.entity_id, state: "1", attributes: {} }));
    const h = buildHierarchy(reg, "now");
    expect(detectAreaCode(h.areas.guest_bathroom, h)).toMatchObject({ code: "guestbathroom", count: 2 });
  });
});

describe("review fixes", () => {
  it("doesn't trip over an area id that's also a property of every object", () => {
    const reg = buildMockRegistry();
    reg.areas = [{ area_id: "constructor", name: "Constructor" }];
    reg.devices = [];
    reg.entities = [{ entity_id: "light.constructor_main", area_id: "constructor", platform: "x" }];
    reg.states = [{ entity_id: "light.constructor_main", state: "on", attributes: { friendly_name: "Main" } }];
    const h = buildHierarchy(reg, "now");
    expect(areaCodes(h, DEFAULT_NAMING)["constructor"].code).toBe("constructor");
    expect(() => analyzeArea(h.areas["constructor"], h, DEFAULT_NAMING)).not.toThrow();
  });

  it("never names the area twice when the name is only the area", () => {
    const reg = buildMockRegistry();
    reg.areas = [{ area_id: "kitchen", name: "Kitchen" }];
    reg.devices = [];
    reg.entities = [{ entity_id: "climate.kitchen", area_id: "kitchen", platform: "x" }];
    reg.states = [{ entity_id: "climate.kitchen", state: "heat", attributes: { friendly_name: "Kitchen" } }];
    const h = buildHierarchy(reg, "now");
    const [row] = analyzeArea(h.areas.kitchen, h, DEFAULT_NAMING).rows;
    expect(row.suggestedName).toBe("Kitchen Climate");
  });
});

describe("duplicate codes", () => {
  it("lists each code more than one area ends up with", () => {
    const dupes = duplicateCodes({ a: { code: "kitchen" }, b: { code: "kitchen" }, c: { code: "hall" }, d: { code: "" }, e: { code: "" } });
    expect([...dupes]).toEqual([["kitchen", ["a", "b"]]]);
    expect(duplicateCodes({ a: { code: "x" }, b: { code: "y" } }).size).toBe(0);
  });

  it("sees a custom code that collides with another area's detected one", () => {
    const h = house();
    const codes = areaCodes(h, { ...DEFAULT_NAMING, areaCodes: { playroom: "bathroom" } });
    expect([...duplicateCodes(codes)]).toEqual([["bathroom", ["playroom", "bathroom"]]]);
  });

  it("sees detected codes that collide on their own", () => {
    const reg = buildMockRegistry();
    reg.areas = [
      { area_id: "guest-room", name: "A", floor_id: "ground" },
      { area_id: "guest_room", name: "B", floor_id: "ground" },
    ];
    reg.devices = [];
    reg.entities = [];
    reg.states = [];
    const dupes = duplicateCodes(areaCodes(buildHierarchy(reg, "now"), DEFAULT_NAMING));
    expect([...dupes.keys()]).toEqual(["guest_room"]);
  });

  it("finds repeated ids and words the clash", () => {
    expect(duplicateIds(["a", "b", "a", "a"])).toEqual(["a"]);
    expect(duplicateIds(["a", "b"])).toEqual([]);
    const msg = duplicateCodesMessage(new Map([["kit", ["k1", "k2"]]]), (id) => ({ k1: "Kitchen", k2: "Kitchenette" })[id]!);
    expect(msg).toBe("The code “kit” is used by Kitchen and Kitchenette.");
    expect(duplicateCodesMessage(new Map(), String)).toBeNull();
  });
});

describe("floor codes", () => {
  const floor = (id: string, name: string) => ({ floor_id: id, name, level: 0 });
  const hierarchy = (floors: { floor_id: string; name: string; level: number }[]) => {
    const reg = buildMockRegistry();
    reg.floors = floors;
    reg.areas = [];
    reg.devices = [];
    reg.entities = [];
    reg.states = [];
    return buildHierarchy(reg, "now");
  };

  it("defaults to the slug of the floor's id, and uses a code the user set instead, as a slug", () => {
    const h = hierarchy([floor("ground", "Ground floor"), floor("First-Floor", "First floor"), floor("loft", "Loft")]);
    expect(floorCodes(h, DEFAULT_NAMING)).toEqual({
      ground: { code: "ground", detected: "ground", custom: false },
      "First-Floor": { code: "first_floor", detected: "first_floor", custom: false },
      loft: { code: "loft", detected: "loft", custom: false },
    });
    const own = floorCodes(h, { ...DEFAULT_NAMING, floorCodes: { loft: "Attic Rooms", ground: "" } });
    expect(own.loft).toEqual({ code: "attic_rooms", detected: "loft", custom: true });
    // An empty code is no choice.
    expect(own.ground).toMatchObject({ code: "ground", custom: false });
  });

  it("falls back to the name of a floor whose id has no letters or digits, and reads its own keys only", () => {
    const h = hierarchy([floor("__", "Cellar"), floor("constructor", "Odd one")]);
    expect(floorCodes(h, DEFAULT_NAMING).__.code).toBe("cellar");
    expect(floorCodes(h, DEFAULT_NAMING).constructor).toMatchObject({ code: "constructor", custom: false });
  });

  it("can be checked for duplicates like area codes", () => {
    const h = hierarchy([floor("ground", "Ground floor"), floor("first", "First floor")]);
    const dupes = duplicateCodes(floorCodes(h, { ...DEFAULT_NAMING, floorCodes: { first: "ground" } }));
    expect([...dupes].map(([code, ids]) => [code, [...ids].sort()])).toEqual([["ground", ["first", "ground"]]]);
    expect(duplicateCodes(floorCodes(h, DEFAULT_NAMING)).size).toBe(0);
  });

  describe("advice", () => {
    const advice = (id: string, name: string, custom = false) => floorCodeAdvice({ name }, { code: slug(id), custom });

    it("suggests the slug of the name when the id is a generic word, with or without a number", () => {
      expect(advice("floor_2", "Loft")).toBe("loft");
      expect(advice("floor", "Upstairs")).toBe("upstairs");
      expect(advice("level_1", "Cellar")).toBe("cellar");
      expect(advice("level1", "Ground floor")).toBe("ground_floor");
      expect(advice("f2", "Attic")).toBe("attic");
      expect(advice("2", "Attic")).toBe("attic");
      expect(advice("storey", "Second floor")).toBe("second_floor");
      expect(advice("default", "Basement")).toBe("basement");
    });

    it("suggests it when the id has nothing to do with the name", () => {
      expect(advice("ground", "Basement")).toBe("basement");
      expect(advice("a1b2c3", "Garden level")).toBe("garden_level");
    });

    it("says nothing when the id fits the name, however it is spelled", () => {
      expect(advice("ground", "Ground floor")).toBeNull();
      expect(advice("first_floor", "First floor")).toBeNull();
      expect(advice("firstfloor", "First floor")).toBeNull();
      expect(advice("first", "First floor")).toBeNull();
      expect(advice("ground_floor", "Ground")).toBeNull();
      // Even a generic id is fine when the name says the same.
      expect(advice("floor_2", "Floor 2")).toBeNull();
      expect(advice("level_1", "Level 1")).toBeNull();
      expect(advice("level1", "Level 1")).toBeNull();
    });

    it("says nothing for a code the user typed, or when the name gives nothing better", () => {
      expect(advice("floor_2", "Loft", true)).toBeNull();
      expect(advice("floor_2", "!!!")).toBeNull();
      expect(advice("floor_2", "")).toBeNull();
    });

    it("is what the settings screen shows for the mock house's floors", () => {
      const h = buildHierarchy(buildMockRegistry(), "now");
      const codes = floorCodes(h, DEFAULT_NAMING);
      const found = Object.fromEntries(h.floors.map((f) => [f.id, floorCodeAdvice(f, codes[f.id])]));
      expect(found).toEqual({ ground: null, first: null, floor_2: "loft", level_1: "cellar" });
    });
  });
});

describe("the house light group", () => {
  it("is light.all unless Settings say another end", () => {
    expect(houseGroupId(DEFAULT_NAMING)).toBe("light.all");
    expect(houseGroupId({ houseGroup: "" })).toBe("light.all");
    expect(houseGroupId({ houseGroup: "everything" })).toBe("light.everything");
    expect(DEFAULT_HOUSE_GROUP).toBe("all");
  });
});


describe("semantic motion aggregates and windows", () => {
  function serenity(groupMembers: string[] = ["binary_sensor.serenity_pir_left", "binary_sensor.serenity_pir_right"], windowClass: string | null = "window") {
    const reg = buildMockRegistry();
    reg.areas = [{ area_id: "serenity", name: "Serenity" }];
    reg.devices = [];
    reg.entities = [];
    reg.states = [];
    for (const [id, dc, members] of [
      ["binary_sensor.serenity_pir_left", "motion", undefined],
      ["binary_sensor.serenity_pir_right", "motion", undefined],
      ["binary_sensor.serenity_motions", "motion", groupMembers],
      ["binary_sensor.serenity_window_side", windowClass, undefined],
    ] as const) {
      reg.entities.push({ entity_id: id, area_id: "serenity", platform: members ? "group" : "demo", original_name: id });
      reg.states.push({ entity_id: id, state: "off", attributes: { device_class: dc ?? undefined, entity_id: members ? [...members] : undefined } });
    }
    const h = buildHierarchy(reg, "now");
    return { h, analyze: (settings = DEFAULT_NAMING) => analyzeArea(h.areas.serenity, h, settings).rows };
  }

  it("names a verified all-motion group motion_all, preserving the chosen pattern and type word", () => {
    const { analyze } = serenity();
    expect(analyze().find(r => r.entityId === "binary_sensor.serenity_motions")!.suggestedId).toBe("binary_sensor.serenity_motion_all");
    expect(analyze({ ...DEFAULT_NAMING, idPattern: "{area}_{name}_{type}", typeWords: { motion: "pir" } }).find(r => r.entityId === "binary_sensor.serenity_motions")!.suggestedId).toBe("binary_sensor.serenity_all_pir");
    expect(analyze({ ...DEFAULT_NAMING, helperNames: { motion: "motions" } }).find(r => r.entityId === "binary_sensor.serenity_motions")!.suggestedId).toBeNull();
    expect(analyze({ ...DEFAULT_NAMING, helperNames: { motion: "all_motion" } }).find(r => r.entityId === "binary_sensor.serenity_motions")!.suggestedId).toBe("binary_sensor.serenity_all_motion");
  });

  it("does not infer all from a plural individual name or a group containing only some motion sensors", () => {
    const { h, analyze } = serenity(["binary_sensor.serenity_pir_left"]);
    expect(analyze().find(r => r.entityId === "binary_sensor.serenity_motions")!.suggestedId).not.toBe("binary_sensor.serenity_motion_all");
    h.entities["binary_sensor.serenity_motions"].members = [];
    h.entities["binary_sensor.serenity_motions"].platform = "demo";
    expect(analyze().find(r => r.entityId === "binary_sensor.serenity_motions")!.suggestedId).not.toBe("binary_sensor.serenity_motion_all");
  });

  it("keeps window_side for a real window, a general opening contact, and a contact missing its live class", () => {
    for (const deviceClass of ["window", "opening", null]) {
      const { analyze } = serenity(undefined, deviceClass);
      expect(analyze().find(r => r.entityId === "binary_sensor.serenity_window_side")!.suggestedId).toBeNull();
    }
  });

  it("does not infer a window from a token belonging to the area's prefix", () => {
    const { h, analyze } = serenity(undefined, "opening");
    const oldId = "binary_sensor.serenity_window_side";
    const newId = "binary_sensor.window_room_side";
    h.entities[newId] = { ...h.entities[oldId], entityId: newId };
    delete h.entities[oldId];
    h.areas.serenity.entityIds = h.areas.serenity.entityIds.map(id => id === oldId ? newId : id);
    expect(analyze({ ...DEFAULT_NAMING, areaCodes: { serenity: "window_room" } }).find(r => r.entityId === newId)!.suggestedId).toBe("binary_sensor.window_room_door_side");
  });

  it("preserves an explicit custom opening word and skips contradictory door/window ID suggestions", () => {
    const { analyze } = serenity(undefined, "window");
    expect(analyze({ ...DEFAULT_NAMING, typeWords: { opening: "contact" } }).find(r => r.entityId === "binary_sensor.serenity_window_side")!.suggestedId).toBe("binary_sensor.serenity_contact_window_side");
    const door = serenity(undefined, "door");
    expect(door.analyze().find(r => r.entityId === "binary_sensor.serenity_window_side")!.suggestedId).toBeNull();
    expect(door.h.entities["binary_sensor.serenity_window_side"].deviceClass).toBe("door");
  });
});
