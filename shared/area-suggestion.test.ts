import { describe, expect, it } from "vitest";
import { suggestEntityArea } from "./area-suggestion.ts";

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
