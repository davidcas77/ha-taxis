import { describe, expect, it } from "vitest";
import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { overlayChanges } from "../server/changes/overlay.ts";
import type { Change } from "./types.ts";
import { nativeAreaLocations, nativeAreaStaircase, planLocationLabels, planStaircaseLabels } from "./area-location.ts";
import { areaChoice, EMPTY_INVENTORY, recipeWanted, setAreaType, setRecipeWanted } from "./inventory.ts";
import { splitByFit } from "./recipe-fit.ts";
import { DEFAULT_NAMING } from "./naming.ts";
import { NOTHING_INSTALLED, planRecipes } from "./recipes.ts";
import { validateInventory } from "../server/settings.ts";
import { setAreaRoomTypes } from "./area-room-types.ts";
import { EMPTY_PARAMETERS, resolve, setParameter } from "./parameters.ts";

const raw: RawRegistry = {
  config: { location_name: "Test" },
  floors: [],
  areas: [{ area_id: "room", name: "Room", labels: ["bed", "other", "out"] }],
  devices: [],
  entities: [],
  states: [],
  labels: [
    { label_id: "bed", name: "Bedroom" },
    { label_id: "other", name: "Favourite" },
    { label_id: "out", name: "eXtErIoR" },
    { label_id: "in", name: "INTERIOR" },
  ],
};
const hierarchy = () => buildHierarchy(structuredClone(raw), "now");

describe("native area location", () => {
  it("reuses case-insensitive labels for add, switch and clear while retaining other assignments", () => {
    const h = hierarchy();
    expect(nativeAreaLocations(h, "room")).toEqual(["exterior"]);
    expect(planLocationLabels(h, "room", "interior")).toEqual({ ok: true, labels: ["bed", "other", "in"], missing: null });
    expect(planLocationLabels(h, "room", null)).toEqual({ ok: true, labels: ["bed", "other"], missing: null });
    h.areas.room.labels = ["bed", "other"];
    expect(planLocationLabels(h, "room", "exterior")).toEqual({ ok: true, labels: ["bed", "other", "out"], missing: null });
    delete h.labels.out;
    expect(planLocationLabels(h, "room", "exterior")).toEqual({ ok: true, labels: ["bed", "other"], missing: "exterior" });
  });

  it("reads queued assignments and refuses ambiguous matching names", () => {
    const changes = [
      {
        id: 1,
        kind: "area",
        op: "update",
        targetId: "room",
        scope: null,
        before: { labels: ["bed", "other", "out"] },
        after: { labels: ["bed", "other", "in"] },
        createdAt: "",
      },
    ] as Change[];
    const h = buildHierarchy(overlayChanges(raw, changes), "now");
    expect(nativeAreaLocations(h, "room")).toEqual(["interior"]);
    h.labels.duplicate = { ...h.labels.in, id: "duplicate", name: "interior" };
    expect(planLocationLabels(h, "room", null)).toMatchObject({ ok: false, error: expect.stringContaining("More than one label") });
    expect(planLocationLabels(h, "room", "interior")).toMatchObject({ ok: false });
  });
  it("uses assigned and queued labels for behavior while retaining legacy fallback until cleared", () => {
    const legacy = setAreaType(EMPTY_INVENTORY, "room", "exterior");
    const h = hierarchy();
    const params = setParameter(EMPTY_PARAMETERS, { level: "type", id: "exterior" }, "hold_timeout", 12);
    expect(areaChoice(legacy, "room", h).type).toBe("exterior");
    h.areas.room.labels = ["bed", "in"];
    expect(areaChoice(legacy, "room", h).type).toBe("interior");
    h.areas.room.labels = ["bed"];
    expect(areaChoice(legacy, "room", h).type).toBe("exterior");
    expect(resolve(params, h, legacy, "room", "hold_timeout").value).toBe(12);
    const cleaned = setAreaType(legacy, "room", "interior");
    expect(areaChoice(cleaned, "room", h).type).toBe("interior");
    // Discarding a pending removal restores the live native assignment.
    h.areas.room.labels = ["bed", "out"];
    expect(areaChoice(cleaned, "room", h).type).toBe("exterior");
  });
  it("keeps Staircase independent of the primary location and handles duplicates", () => {
    const h = hierarchy();
    h.labels.stairs = { ...h.labels.in, id: "stairs", name: "sTaIrCaSe" };
    expect(planStaircaseLabels(h, "room", true)).toEqual({ ok: true, labels: ["bed", "other", "out", "stairs"], missing: false });
    h.areas.room.labels.push("stairs");
    expect(nativeAreaStaircase(h, "room")).toBe(true);
    expect(planLocationLabels(h, "room", "interior")).toEqual({ ok: true, labels: ["bed", "other", "stairs", "in"], missing: null });
    expect(planStaircaseLabels(h, "room", false)).toEqual({ ok: true, labels: ["bed", "other", "out"], missing: false });
    h.labels.duplicate = { ...h.labels.stairs, id: "duplicate", name: "Staircase" };
    expect(planStaircaseLabels(h, "room", false)).toMatchObject({ ok: false });
  });

  it("defaults climate and ventilation from explicit classification and preserves manual overrides through validation", () => {
    const h = hierarchy();
    expect(recipeWanted(EMPTY_INVENTORY, "room", "area_climate", h)).toBe(false);
    expect(recipeWanted(EMPTY_INVENTORY, "room", "bathroom_fan", h)).toBe(false);
    let inv = setRecipeWanted(EMPTY_INVENTORY, "room", "area_climate", true, h);
    inv = setRecipeWanted(inv, "room", "bathroom_fan", true, h);
    const validated = validateInventory(inv);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(recipeWanted(validated.value, "room", "area_climate", h)).toBe(true);
    expect(recipeWanted(validated.value, "room", "bathroom_fan", h)).toBe(true);
    h.areas.room.labels = ["bed", "in"];
    expect(recipeWanted(EMPTY_INVENTORY, "room", "area_climate", h)).toBe(false);
    h.labels.bath = { ...h.labels.bed, id: "bath", name: "Bathroom" };
    h.areas.room.labels.push("bath");
    expect(recipeWanted(EMPTY_INVENTORY, "room", "bathroom_fan", h)).toBe(true);
    const off = setRecipeWanted(EMPTY_INVENTORY, "room", "bathroom_fan", false, h);
    expect(validateInventory(off)).toMatchObject({ ok: true, value: { areas: { room: { recipePreferences: { bathroom_fan: false } } } } });
    h.areas.room.labels = ["other", "in"];
    h.areas.room.name = "Bathroom";
    expect(recipeWanted(EMPTY_INVENTORY, "room", "bathroom_fan", h)).toBe(false);
    expect(recipeWanted(setAreaRoomTypes(EMPTY_INVENTORY, "room", ["bathroom"]), "room", "bathroom_fan", h)).toBe(true);
    h.labels.neutral = { ...h.labels.bed, id: "neutral", name: "Other" };
    h.areas.room.labels.push("neutral");
    expect(recipeWanted(setAreaRoomTypes(EMPTY_INVENTORY, "room", ["bathroom"]), "room", "bathroom_fan", h)).toBe(false);
  });
  it("shows explicitly enabled outdoor climate and non-bathroom ventilation even when normal fit rules exclude them", () => {
    const h = hierarchy();
    let inv = setRecipeWanted(EMPTY_INVENTORY, "room", "area_climate", true, h);
    inv = setRecipeWanted(inv, "room", "bathroom_fan", true, h);
    const cells = planRecipes(h, inv, DEFAULT_NAMING, EMPTY_PARAMETERS, NOTHING_INSTALLED, []);
    const selected = splitByFit(h, inv, DEFAULT_NAMING, cells).fits.map((cell) => cell.recipe);
    expect(selected).toContain("area_climate");
    expect(selected).toContain("bathroom_fan");
  });
});
