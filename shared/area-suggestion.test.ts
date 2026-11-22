import { describe, expect, it } from "vitest";
import { suggestAreaPlacement, suggestEntityArea } from "./area-suggestion.ts";

const areas = [
  { id: "bed", name: "Bedroom" },
  { id: "bath", name: "Bedroom Bathroom" },
  { id: "hall", name: "Hall" },
];
describe("exact area suggestions", () => {
  it("prefers the longest leading area phrase", () => {
    expect(suggestEntityArea("Bedroom Bathroom humidity", "sensor.any", areas)).toEqual({ areaId: "bath", source: "name" });
    expect(suggestEntityArea("Bedroom lamp", "light.any", areas)?.areaId).toBe("bed");
  });
  it("accepts a unique contained phrase and prioritizes a leading phrase", () => {
    expect(suggestEntityArea("Temperature in Hall", "sensor.any", areas)?.areaId).toBe("hall");
    expect(suggestEntityArea("Hall to Bedroom contact", "sensor.any", areas)?.areaId).toBe("hall");
  });
  it("does not guess for ambiguous contained or duplicate names", () => {
    expect(suggestEntityArea("Between Bedroom and Hall", "sensor.bedroom", areas)).toBeNull();
    expect(suggestEntityArea("Bedroom light", "light.hall", [...areas, { id: "other", name: "Bedroom" }])).toBeNull();
  });
  it("uses exact object-id words only when display name has no match", () => {
    expect(suggestEntityArea("Humidity", "sensor.bedroom_bathroom_humidity", areas)).toEqual({ areaId: "bath", source: "entityId" });
    expect(suggestEntityArea("Hall temperature", "sensor.bedroom_temperature", areas)?.source).toBe("name");
    expect(suggestEntityArea("Humidity", "sensor.bedroomish_humidity", areas)).toBeNull();
  });
  it("preserves foreign spelling and rejects substrings or fuzzy transliteration", () => {
    const foreign = [
      { id: "greek", name: "Βιβλιοθήκη" },
      { id: "french", name: "Étage" },
    ];
    expect(suggestEntityArea("Βιβλιοθήκη φως", "light.any", foreign)?.areaId).toBe("greek");
    expect(suggestEntityArea("E\u0301tage temperature", "sensor.any", foreign)?.areaId).toBe("french");
    expect(suggestEntityArea("Etage temperature", "sensor.any", foreign)).toBeNull();
    expect(suggestEntityArea("Hallway motion", "sensor.any", areas)).toBeNull();
  });
});

describe("area placement evidence", () => {
  it("explains a device name independently and collects agreeing entity evidence", () => {
    expect(suggestAreaPlacement({ deviceName: "Bedroom Bathroom Multisensor" }, areas)).toEqual({
      kind: "suggestion",
      areaId: "bath",
      evidence: [{ source: "Device name", text: "Bedroom Bathroom Multisensor" }],
    });
    expect(suggestAreaPlacement({ entityName: "Motion", entityId: "binary_sensor.hall_motion", deviceName: "Hall Multisensor" }, areas)).toEqual({
      kind: "suggestion",
      areaId: "hall",
      evidence: [
        { source: "Entity ID", text: "binary_sensor.hall_motion" },
        { source: "Device name", text: "Hall Multisensor" },
      ],
    });
  });
  it("withholds suggestions for conflicting, duplicate or separate room names", () => {
    expect(suggestAreaPlacement({ entityName: "Hall motion", deviceName: "Bedroom motion" }, areas)).toEqual({ kind: "ambiguous" });
    expect(suggestAreaPlacement({ entityName: "Bedroom contact", entityId: "binary_sensor.hall_contact" }, areas)).toEqual({ kind: "ambiguous" });
    expect(suggestAreaPlacement({ deviceName: "Hall to Bedroom contact" }, areas)).toEqual({ kind: "ambiguous" });
    expect(suggestAreaPlacement({ entityName: "Hall motion" }, [...areas, { id: "other_hall", name: "Hall" }])).toEqual({ kind: "ambiguous" });
    expect(suggestAreaPlacement({ deviceName: "New wing motion" }, [...areas, { id: "new:area:1", name: "New wing" }])).toEqual({ kind: "none" });
  });
  it("matches actual transliterated area IDs without assuming a translation", () => {
    const greek = [{ id: "bibliothiki", name: "Βιβλιοθήκη" }];
    expect(suggestAreaPlacement({ entityId: "light.bibliothiki_rack" }, greek)).toMatchObject({ kind: "suggestion", areaId: "bibliothiki" });
    expect(suggestAreaPlacement({ deviceName: "Library desk" }, greek)).toEqual({ kind: "none" });
  });
});
