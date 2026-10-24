import { describe, expect, it } from "vitest";

import { buildMockRegistry } from "../scripts/mock-ha-core.ts";
import { buildHierarchy } from "../server/model/hierarchy.ts";
import { DEFAULT_NAMING, analyzeArea, areaCodes, detectAreaCode, slug } from "./naming.ts";
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
  add("sensor.c220_motion_alarm", "living_room", "C220 Motion alarm");
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
    reg.areas = [{ area_id: "guest_bathroom", name: "Serenity Bathroom" }];
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
