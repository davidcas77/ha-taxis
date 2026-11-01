import type { AreaRecipeKey } from "./blueprints.ts";
import type { InventorySettings } from "./inventory.ts";
import type { Hierarchy } from "./types.ts";

// Suggestions only: these do not install recipes or change interior/exterior.
export const AREA_ROOM_TYPES = [
  {
    key: "bedroom",
    labelName: "Bedroom",
    label: "Bedroom",
    summary: "Sleep, bed presence and bedroom climate.",
    recipes: ["occupancy", "motion_lights", "area_climate"],
  },
  {
    key: "bathroom",
    labelName: "Bathroom",
    label: "Bathroom",
    summary: "Humidity and ventilation, with gentle night lighting.",
    recipes: ["occupancy", "motion_lights", "bathroom_fan", "leak_alert"],
  },
  {
    key: "kitchen",
    labelName: "Kitchen",
    label: "Kitchen",
    summary: "Lighting, appliances and water leaks.",
    recipes: ["motion_lights", "appliance_done", "leak_alert"],
  },
  {
    key: "living",
    labelName: "Living room",
    label: "Living room",
    summary: "Comfort, lighting and media.",
    recipes: ["motion_lights", "area_climate", "media_off"],
  },
  { key: "dining", labelName: "Dining room", label: "Dining room", summary: "Comfort and lighting.", recipes: ["motion_lights", "area_climate"] },
  {
    key: "office",
    labelName: "Office",
    label: "Office / study",
    summary: "Presence while seated, lighting and climate.",
    recipes: ["occupancy", "motion_lights", "area_climate"],
  },
  { key: "hallway", labelName: "Hallway", label: "Hallway / stairs", summary: "Path and night lighting.", recipes: ["occupancy", "motion_lights"] },
  { key: "entrance", labelName: "Entrance", label: "Entrance", summary: "Lighting and opening reminders.", recipes: ["motion_lights", "left_open"] },
  {
    key: "laundry",
    labelName: "Laundry",
    label: "Laundry / utility",
    summary: "Appliances, water leaks and lighting.",
    recipes: ["appliance_done", "leak_alert", "motion_lights"],
  },
  { key: "garage", labelName: "Garage", label: "Garage", summary: "Lighting and opening reminders.", recipes: ["motion_lights", "left_open"] },
  { key: "storage", labelName: "Storage", label: "Storage", summary: "Lighting and opening reminders.", recipes: ["motion_lights", "left_open"] },
  { key: "balcony", labelName: "Balcony", label: "Balcony", summary: "Outdoor lighting and opening reminders.", recipes: ["exterior_lights", "left_open"] },
  { key: "garden", labelName: "Garden", label: "Garden", summary: "Outdoor lighting and opening reminders.", recipes: ["exterior_lights", "left_open"] },
  { key: "other", labelName: "Other", label: "Other", summary: "Choose the outcomes useful in this area.", recipes: [] },
] as const satisfies readonly { key: string; label: string; labelName: string; summary: string; recipes: readonly AreaRecipeKey[] }[];

export type AreaRoomType = (typeof AREA_ROOM_TYPES)[number]["key"];
export const isAreaRoomType = (value: unknown): value is AreaRoomType => AREA_ROOM_TYPES.some((item) => item.key === value);
export const isBathroomLikeName = (name: string): boolean =>
  /\b(bath|bathroom|toilet|wc|shower|washroom|restroom|powder|ensuite|en-suite|lavatory)\b/i.test(name);

const labelKey = (name: string): string => name.trim().toLocaleLowerCase("en-US");
const roomTypeForName = (name: string): AreaRoomType | undefined => AREA_ROOM_TYPES.find((type) => labelKey(type.labelName) === labelKey(name))?.key;

export function normalizeAreaRoomTypes(types: readonly AreaRoomType[]): AreaRoomType[] {
  const specific = AREA_ROOM_TYPES.filter((type) => type.key !== "other" && types.includes(type.key)).map((type) => type.key);
  return specific.length ? specific : ["other"];
}

export function nativeAreaRoomTypes(h: Hierarchy, areaId: string): AreaRoomType[] {
  const assigned = new Set(
    (h.areas[areaId]?.labels ?? [])
      .map((id) => h.labels[id])
      .filter(Boolean)
      .map((label) => roomTypeForName(label.name)),
  );
  const native = AREA_ROOM_TYPES.filter((type) => assigned.has(type.key)).map((type) => type.key);
  return native.length ? normalizeAreaRoomTypes(native) : [];
}

export function areaRoomTypes(h: Hierarchy, inventory: InventorySettings, areaId: string): AreaRoomType[] {
  const native = nativeAreaRoomTypes(h, areaId);
  if (native.length) return native;
  const choice = Object.hasOwn(inventory.areas, areaId) ? inventory.areas[areaId] : undefined;
  if (choice?.roomTypes !== undefined) return [...choice.roomTypes];
  const inferred: AreaRoomType[] = [];
  if (choice?.bedroom) inferred.push("bedroom");
  if (isBathroomLikeName(h.areas[areaId]?.name ?? areaId)) inferred.push("bathroom");
  return inferred;
}

// Work against the current hierarchy, including the Changes overlay. New labels
// must be queued first and this plan recomputed with their temporary IDs.
export function planRoomTypeLabels(
  h: Hierarchy,
  areaId: string,
  types: readonly AreaRoomType[],
): { ok: true; labels: string[]; missing: AreaRoomType[] } | { ok: false; error: string } {
  const area = h.areas[areaId];
  if (!area) return { ok: false, error: "The area is no longer available." };
  const desired = normalizeAreaRoomTypes(types);
  const relevant = new Set([
    ...desired,
    ...area.labels
      .map((id) => h.labels[id])
      .filter(Boolean)
      .map((label) => roomTypeForName(label.name))
      .filter((type): type is AreaRoomType => type !== undefined),
  ]);
  const matching = new Map<AreaRoomType, string[]>();
  for (const label of Object.values(h.labels)) {
    const type = roomTypeForName(label.name);
    if (type && relevant.has(type)) matching.set(type, [...(matching.get(type) ?? []), label.id]);
  }
  for (const type of relevant) {
    if ((matching.get(type)?.length ?? 0) > 1)
      return {
        ok: false,
        error: `More than one label is named ${AREA_ROOM_TYPES.find((item) => item.key === type)!.labelName}. Resolve the duplicate labels first.`,
      };
  }
  const labels = area.labels.filter((id) => !h.labels[id] || !roomTypeForName(h.labels[id].name));
  const missing: AreaRoomType[] = [];
  for (const type of AREA_ROOM_TYPES) {
    if (!desired.includes(type.key)) continue;
    const id = matching.get(type.key)?.[0];
    if (id) labels.push(id);
    else missing.push(type.key);
  }
  return { ok: true, labels: [...new Set(labels)], missing };
}

export const areaHasRoomType = (h: Hierarchy, inventory: InventorySettings, areaId: string, type: AreaRoomType): boolean =>
  areaRoomTypes(h, inventory, areaId).includes(type);

export function setAreaRoomTypes(inventory: InventorySettings, areaId: string, types: readonly AreaRoomType[]): InventorySettings {
  const ordered = AREA_ROOM_TYPES.filter((item) => types.includes(item.key)).map((item) => item.key);
  const current = Object.hasOwn(inventory.areas, areaId) ? inventory.areas[areaId] : undefined;
  if (current?.roomTypes && current.roomTypes.length === ordered.length && current.roomTypes.every((type, i) => type === ordered[i])) return inventory;
  return { ...inventory, areas: { ...inventory.areas, [areaId]: { ...current, roomTypes: ordered } } };
}
