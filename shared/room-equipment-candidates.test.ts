import { describe, expect, it } from "vitest";
import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { EMPTY_INVENTORY, type InventorySettings } from "./inventory.ts";
import { roomEquipmentCandidates } from "./room-equipment-candidates.ts";

function fixture() {
  const raw: RawRegistry = {
    config: { location_name: "Candidate test" },
    floors: [],
    areas: [
      { area_id: "office", name: "Office" },
      { area_id: "hall", name: "Hall" },
    ],
    devices: [{ id: "spare", name: "Office Multi sensor" }],
    entities: [],
    states: [],
    labels: [],
  };
  const add = (id: string, name: string, kind: string, state = "off", area?: string, device?: string) => {
    raw.entities.push({ entity_id: id, platform: "demo", area_id: area, device_id: device });
    raw.states.push({ entity_id: id, state, attributes: { friendly_name: name, device_class: kind } });
  };
  add("binary_sensor.spare", "Entry PIR", "motion", "off", undefined, "spare");
  add("binary_sensor.hall_presence", "Office presence sensor", "presence");
  add("binary_sensor.office_old", "Office offline motion", "motion", "unavailable");
  add("binary_sensor.office_in_use", "Office desk motion", "motion", "on", "office");
  add("binary_sensor.hall_main", "Hall motion", "motion", "on", "hall");
  add("binary_sensor.office_contact", "Office door contact", "door");
  add("media_player.office_tv", "Office TV", "tv", "idle");
  return buildHierarchy(raw, "2026-11-22T00:00:00Z");
}

const activity = { capabilities: ["motion", "presence", "tv"], candidateRole: "starts", entityIds: [] } as const;
const exclusions = () => new Set<string>();

describe("missing room equipment candidates", () => {
  it("suggests verified matches by name, retaining ambiguous reporting matches for manual review", () => {
    const h = fixture();
    const candidates = roomEquipmentCandidates(h, EMPTY_INVENTORY, "office", { ...activity, entityIds: [] }, exclusions);
    expect(candidates.map(({ entity }) => entity.entityId)).toEqual(["binary_sensor.spare", "media_player.office_tv", "binary_sensor.hall_presence"]);
    expect(candidates.map(({ recommended, placement }) => [recommended, placement.kind])).toEqual([
      [true, "suggestion"],
      [true, "suggestion"],
      [false, "ambiguous"],
    ]);
    expect(candidates[0].placement).toMatchObject({ evidence: [{ source: "Device name", text: "Office Multi sensor" }] });
    expect(candidates[1].verification).toContain("TV");
    expect(candidates[2].verification).toContain("detect entry");
    const optedIn: InventorySettings = { ...EMPTY_INVENTORY, entities: { "media_player.office_tv": { tvOccupancyRole: "starts" } } };
    expect(roomEquipmentCandidates(h, optedIn, "office", { ...activity, entityIds: [] }, exclusions)[1].verification).toBeNull();
  });

  it("only includes equipment assigned elsewhere when searched and respects helper exclusions", () => {
    const h = fixture();
    const search = { ...activity, entityIds: [] };
    const found = roomEquipmentCandidates(h, EMPTY_INVENTORY, "office", search, exclusions, "Hall");
    expect(found.find(({ entity }) => entity.entityId === "binary_sensor.hall_main")).toMatchObject({ recommended: false });
    const omit = (area: string) => new Set(area === "hall" ? ["binary_sensor.hall_main"] : []);
    expect(
      roomEquipmentCandidates(h, EMPTY_INVENTORY, "office", search, omit, "Hall").some(({ entity }) => entity.entityId === "binary_sensor.hall_main"),
    ).toBe(false);
    const omitRoomHelper = (area: string) => new Set(area === "office" ? ["binary_sensor.spare"] : []);
    expect(roomEquipmentCandidates(h, EMPTY_INVENTORY, "office", search, omitRoomHelper).some(({ entity }) => entity.entityId === "binary_sensor.spare")).toBe(
      false,
    );
  });
});
