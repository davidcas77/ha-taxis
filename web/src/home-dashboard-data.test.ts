import { describe, expect, it } from "vitest";
import { buildHierarchy, type RawRegistry } from "../../server/model/hierarchy.ts";
import { assessHouse, EMPTY_GUIDE } from "../../shared/guide.ts";
import type { HealthFinding } from "../../shared/health.ts";
import { EMPTY_INVENTORY, setCounts, setRecipeWanted } from "../../shared/inventory.ts";
import { DEFAULT_NAMING } from "../../shared/naming.ts";
import { EMPTY_PARAMETERS } from "../../shared/parameters.ts";
import { NOTHING_INSTALLED } from "../../shared/recipes.ts";
import { groupHomeHealth, groupHomeRooms, suggestHomeRooms } from "./home-dashboard-data.ts";

function house() {
  const raw: RawRegistry = {
    config: { location_name: "Home dashboard test" },
    floors: [{ floor_id: "upper", name: "Πάνω όροφος" }],
    areas: [
      { area_id: "room_10", name: "Δωμάτιο 10", floor_id: "upper" },
      { area_id: "room_2", name: "Δωμάτιο 2", floor_id: "upper" },
      { area_id: "empty_area", name: "Empty area" },
      { area_id: "spare_room", name: "Spare room" },
    ],
    devices: [],
    entities: [
      { entity_id: "light.room_2", platform: "demo", area_id: "room_2" },
      { entity_id: "binary_sensor.room_2_motion", platform: "demo", area_id: "room_2" },
    ],
    labels: [],
    states: [
      { entity_id: "light.room_2", state: "off", attributes: {} },
      { entity_id: "binary_sensor.room_2_motion", state: "off", attributes: { device_class: "motion" } },
    ],
  };
  return buildHierarchy(raw, "2026-11-18T00:00:00Z");
}

function assessments(h: ReturnType<typeof house>) {
  return assessHouse(h, EMPTY_INVENTORY, DEFAULT_NAMING, EMPTY_PARAMETERS, EMPTY_GUIDE, NOTHING_INSTALLED, []);
}

describe("Home rooms", () => {
  it("groups rooms including areas without a floor and matches names, floors and ids across Greek accents", () => {
    const h = house();
    expect(groupHomeRooms(h, "").map(({ id, rooms }) => [id, rooms.map((room) => room.id)])).toEqual([
      ["upper", ["room_2", "room_10"]],
      [null, ["empty_area", "spare_room"]],
    ]);
    expect(groupHomeRooms(h, "ΟΡΟΦΟΣ δωματιο 10")[0].rooms.map((room) => room.id)).toEqual(["room_10"]);
    expect(groupHomeRooms(h, "room_2")[0].rooms.map((room) => room.id)).toEqual(["room_2"]);
    expect(groupHomeRooms(h, "no floor spare")[0].rooms.map((room) => room.id)).toEqual(["spare_room"]);
    expect(groupHomeRooms(h, "unused")).toEqual([]);
  });

  it("explains a fresh opportunity from counted, reporting lighting and occupancy inventory", () => {
    const h = house();
    const areas = assessments(h);
    const suggestions = suggestHomeRooms(h, EMPTY_INVENTORY, DEFAULT_NAMING, areas, null);
    expect(suggestions).toEqual([
      expect.objectContaining({
        room: expect.objectContaining({ areaId: "room_2" }),
        title: "Explore automatic lighting",
        reason: expect.stringMatching(/lights and a motion sensor/i),
      }),
    ]);
    for (const inventory of [
      setCounts(h, EMPTY_INVENTORY, "binary_sensor.room_2_motion", false),
      setRecipeWanted(EMPTY_INVENTORY, "room_2", "motion_lights", false, h),
    ]) {
      expect(suggestHomeRooms(h, inventory, DEFAULT_NAMING, areas, null)).toEqual([]);
    }
    h.entities["binary_sensor.room_2_motion"].state = "unavailable";
    expect(suggestHomeRooms(h, EMPTY_INVENTORY, DEFAULT_NAMING, areas, null)).toEqual([]);
  });

  it("puts saved actionable work before ideas and excludes the resumed and explicitly unplanned rooms", () => {
    const h = house();
    const areas = assessments(h).map((room) =>
      room.areaId === "room_10"
        ? { ...room, stage: "changes" as const, equipmentConfirmed: true }
        : room.areaId === "spare_room"
          ? { ...room, stage: "test" as const, equipmentConfirmed: true }
          : room.areaId === "empty_area"
            ? { ...room, stage: "unplanned" as const }
            : room,
    );
    expect(suggestHomeRooms(h, EMPTY_INVENTORY, DEFAULT_NAMING, areas, "spare_room").map(({ room, reason }) => [room.areaId, reason])).toEqual([
      ["room_10", "This room has changes ready for review."],
      ["room_2", "Controllable lights and a motion sensor are already in this room."],
    ]);
  });
});

describe("Home Health", () => {
  it("summarizes actionable checks by priority and represents a group with an error when it has one", () => {
    const findings: HealthFinding[] = [
      { id: "old-dashboard", check: "references", severity: "warning", title: "Old dashboard", detail: "" },
      { id: "automation", check: "references", severity: "error", title: "Enabled automation missing a reference", detail: "" },
      { id: "dead-condition", check: "conditions", severity: "error", title: "Can never pass", detail: "" },
      { id: "manual-toggle", check: "conditions", severity: "info", title: "Switch is changed by hand", detail: "" },
      { id: "light", check: "light-areas", severity: "warning", title: "No area", detail: "" },
      { id: "offline", check: "unavailable", severity: "warning", title: "Not reporting", detail: "" },
    ];
    expect(groupHomeHealth(findings).map(({ check, count, errors, example }) => [check, count, errors, example.id])).toEqual([
      ["references", 2, 1, "automation"],
      ["conditions", 1, 1, "dead-condition"],
      ["unavailable", 1, 0, "offline"],
    ]);
  });
});
