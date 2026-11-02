import type { AreaType } from "./inventory.ts";
import type { Hierarchy } from "./types.ts";

const locationForName = (name: string): AreaType | undefined => {
  const key = name.trim().toLocaleLowerCase("en-US");
  return key === "interior" || key === "exterior" ? key : undefined;
};

/** Location labels actually assigned to this area, including pending Changes. */
export function nativeAreaLocations(h: Hierarchy, areaId: string): AreaType[] {
  return [
    ...new Set(
      (h.areas[areaId]?.labels ?? [])
        .map((id) => h.labels[id])
        .filter(Boolean)
        .map((label) => locationForName(label.name))
        .filter((value): value is AreaType => value !== undefined),
    ),
  ];
}

/** Reuses native labels and preserves all labels outside the location pair. */
export function planLocationLabels(
  h: Hierarchy,
  areaId: string,
  desired: AreaType | null,
): { ok: true; labels: string[]; missing: AreaType | null } | { ok: false; error: string } {
  const area = h.areas[areaId];
  if (!area) return { ok: false, error: "The area is no longer available." };
  const relevant = new Set([...nativeAreaLocations(h, areaId), ...(desired ? [desired] : [])]);
  const matches = new Map<AreaType, string[]>();
  for (const label of Object.values(h.labels)) {
    const type = locationForName(label.name);
    if (type && relevant.has(type)) matches.set(type, [...(matches.get(type) ?? []), label.id]);
  }
  for (const type of relevant) {
    if ((matches.get(type)?.length ?? 0) > 1)
      return { ok: false, error: `More than one label is named ${type === "interior" ? "Interior" : "Exterior"}. Resolve the duplicate labels first.` };
  }
  const labels = area.labels.filter((id) => !h.labels[id] || !locationForName(h.labels[id].name));
  const id = desired && matches.get(desired)?.[0];
  if (id) labels.push(id);
  return { ok: true, labels: [...new Set(labels)], missing: desired && !id ? desired : null };
}

export function nativeAreaStaircase(h: Hierarchy, areaId: string): boolean {
  return (h.areas[areaId]?.labels ?? []).some((id) => h.labels[id]?.name.trim().toLocaleLowerCase("en-US") === "staircase");
}

export function planStaircaseLabels(
  h: Hierarchy,
  areaId: string,
  wanted: boolean,
): { ok: true; labels: string[]; missing: boolean } | { ok: false; error: string } {
  const area = h.areas[areaId];
  if (!area) return { ok: false, error: "The area is no longer available." };
  const matches = Object.values(h.labels).filter((label) => label.name.trim().toLocaleLowerCase("en-US") === "staircase");
  if ((wanted || nativeAreaStaircase(h, areaId)) && matches.length > 1)
    return { ok: false, error: "More than one label is named Staircase. Resolve the duplicate labels first." };
  const labels = area.labels.filter((id) => h.labels[id]?.name.trim().toLocaleLowerCase("en-US") !== "staircase");
  if (wanted && matches[0]) labels.push(matches[0].id);
  return { ok: true, labels: [...new Set(labels)], missing: wanted && matches.length === 0 };
}
