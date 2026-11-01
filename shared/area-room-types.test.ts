import { describe, expect, it } from "vitest";
import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import {
  AREA_ROOM_TYPES,
  areaHasRoomType,
  areaRoomTypes,
  nativeAreaRoomTypes,
  normalizeAreaRoomTypes,
  planRoomTypeLabels,
  setAreaRoomTypes,
} from "./area-room-types.ts";
import { overlayChanges } from "../server/changes/overlay.ts";
import type { Change } from "./types.ts";
import { areaChoice, EMPTY_INVENTORY, setAreaType, setBedroom } from "./inventory.ts";
import { EMPTY_PARAMETERS, resolve, setParameter } from "./parameters.ts";
import { areaFacts, recipeSuitsArea } from "./recipe-fit.ts";
import { DEFAULT_NAMING } from "./naming.ts";

const h = buildHierarchy(
  {
    config: { location_name: "Test" },
    floors: [],
    areas: [
      { area_id: "bath", name: "Bathroom" },
      { area_id: "room", name: "Room" },
    ],
    devices: [],
    entities: [],
    labels: [],
    states: [],
  } as RawRegistry,
  "now",
);

describe("area room types", () => {
  it("prefers native labels by name, uses real IDs, and preserves unrelated labels", () => {
    const native = structuredClone(h);
    native.labels = {
      strange_id: { id: "strange_id", name: "bAtHrOoM", color: null, icon: null, description: null },
      user: { id: "user", name: "Favourite", color: null, icon: null, description: null },
      neutral: { id: "neutral", name: "Other", color: null, icon: null, description: null },
    };
    native.areas.room.labels = ["user", "strange_id"];
    const legacy = setAreaRoomTypes(EMPTY_INVENTORY, "room", ["kitchen"]);
    expect(areaRoomTypes(native, legacy, "room")).toEqual(["bathroom"]);
    expect(planRoomTypeLabels(native, "room", ["bathroom"])).toEqual({ ok: true, labels: ["user", "strange_id"], missing: [] });
    expect(planRoomTypeLabels(native, "room", [])).toEqual({ ok: true, labels: ["user", "neutral"], missing: [] });
    native.areas.bath.labels = ["neutral"];
    expect(areaRoomTypes(native, setBedroom(EMPTY_INVENTORY, "bath", true), "bath")).toEqual(["other"]);
    expect(areaChoice(setBedroom(EMPTY_INVENTORY, "bath", true), "bath", native).bedroom).toBe(false);
    expect(nativeAreaRoomTypes(native, "bath")).toEqual(["other"]);
    expect(normalizeAreaRoomTypes(["other", "bedroom"])).toEqual(["bedroom"]);
  });

  it("finds missing labels, refuses ambiguous names and uses pending temporary IDs in the preview", () => {
    const pending = [
      { id: 1, op: "create", kind: "label", targetId: "new:label:1", scope: null, before: {}, after: { name: "Bedroom" }, createdAt: "" },
      { id: 2, op: "update", kind: "area", targetId: "room", scope: null, before: { labels: [] }, after: { labels: ["new:label:1"] }, createdAt: "" },
    ] as Change[];
    const raw: RawRegistry = {
      config: { location_name: "Test" },
      floors: [],
      areas: [{ area_id: "room", name: "Room" }],
      devices: [],
      entities: [],
      labels: [],
      states: [],
    };
    const live = buildHierarchy(raw, "now");
    expect(planRoomTypeLabels(live, "room", ["bedroom"])).toEqual({ ok: true, labels: [], missing: ["bedroom"] });
    const preview = buildHierarchy(overlayChanges(raw, pending), "now");
    expect(areaRoomTypes(preview, EMPTY_INVENTORY, "room")).toEqual(["bedroom"]);
    expect(areaChoice(EMPTY_INVENTORY, "room", preview).bedroom).toBe(true);
    expect(recipeSuitsArea(areaFacts(preview, EMPTY_INVENTORY, DEFAULT_NAMING, "room"), "occupancy")).toBe(true);
    expect(planRoomTypeLabels(preview, "room", ["bedroom"])).toEqual({ ok: true, labels: ["new:label:1"], missing: [] });
    preview.labels.duplicate = { id: "duplicate", name: "BEDROOM", color: null, icon: null, description: null };
    expect(planRoomTypeLabels(preview, "room", ["bedroom"])).toMatchObject({ ok: false });
    expect(planRoomTypeLabels(preview, "room", [])).toMatchObject({ ok: false });
  });
  it("falls back to the legacy bedroom choice and bathroom name only when no explicit types exist", () => {
    const legacy = setBedroom(EMPTY_INVENTORY, "bath", true);
    expect(areaRoomTypes(h, legacy, "bath")).toEqual(["bedroom", "bathroom"]);
    expect(areaRoomTypes(h, legacy, "room")).toEqual([]);
    const cleared = setAreaRoomTypes(legacy, "bath", []);
    expect(cleared.areas.bath.roomTypes).toEqual([]);
    expect(areaRoomTypes(h, cleared, "bath")).toEqual([]);
    expect(areaChoice(cleared, "bath").bedroom).toBe(false);
    expect(areaHasRoomType(h, cleared, "bath", "bathroom")).toBe(false);
  });

  it("stores multiple types in catalog order, deduplicated, and keeps bedroom setter consistent", () => {
    let inv = setAreaRoomTypes(EMPTY_INVENTORY, "room", ["bathroom", "bedroom", "bathroom"]);
    expect(inv.areas.room.roomTypes).toEqual(["bedroom", "bathroom"]);
    expect(areaHasRoomType(h, inv, "room", "bathroom")).toBe(true);
    expect(areaChoice(inv, "room").bedroom).toBe(true);
    expect(setAreaRoomTypes(inv, "room", ["bedroom", "bathroom"])).toBe(inv);
    inv = setBedroom(inv, "room", false);
    expect(inv.areas.room.roomTypes).toEqual(["bathroom"]);
    expect(areaChoice(inv, "room").bedroom).toBe(false);
    expect(setBedroom(inv, "room", true).areas.room.roomTypes).toEqual(["bedroom", "bathroom"]);
    expect(AREA_ROOM_TYPES).toHaveLength(14);
  });

  it("does not change interior/exterior parameter inheritance", () => {
    const inv = setAreaRoomTypes(setAreaType(EMPTY_INVENTORY, "room", "exterior"), "room", ["bedroom", "garden"]);
    const params = setParameter(EMPTY_PARAMETERS, { level: "type", id: "exterior" }, "hold_timeout", 12);
    expect(areaChoice(inv, "room")).toEqual({ type: "exterior", bedroom: true });
    expect(resolve(params, h, inv, "room", "hold_timeout").value).toBe(12);
  });
});
