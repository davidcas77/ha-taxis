import type { Change, Hierarchy } from "./types.ts";

/** Identity is the Home Assistant label ID, never a display name or floor. */
export type Space = { id: string; name: string; areaIds: string[]; declaredFloorIds: string[]; blocked: string | null };
export type RecipeScope = { kind: "legacy" } | { kind: "space"; space: Space };
export type AreaSpace = RecipeScope | { kind: "conflict"; error: string };

const labelName = (name: string): string | null => /^space:\s*(\S(?:.*\S)?)\s*$/i.exec(name.trim())?.[1] ?? null;
const key = (name: string) => name.trim().toLocaleLowerCase("en-US");
const isTemp = (id: string) => id.startsWith("new:");
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// An app-owned, exact description on newly created Space labels. This is only
// a tree placement hint; it does not assign areas or define Space membership.
const FLOOR_HINT_PREFIX = "Taxis Space floor: ";
export const spaceFloorDescription = (floorId: string): string => FLOOR_HINT_PREFIX + JSON.stringify(floorId);
export function spaceFloorFromDescription(description: unknown): string | null {
  if (typeof description !== "string" || !description.startsWith(FLOOR_HINT_PREFIX)) return null;
  try {
    const id: unknown = JSON.parse(description.slice(FLOOR_HINT_PREFIX.length));
    return typeof id === "string" && id.length > 0 && id.length <= 255 && description === spaceFloorDescription(id) ? id : null;
  } catch {
    return null;
  }
}

// FNV-1a twice with independent seeds. IDs stay bounded and stable when the
// label name changes. resolveSpaces refuses the unlikely hash collision.
function tokenFor(id: string): string {
  const bytes = new TextEncoder().encode(id);
  const hash = (seed: number) => {
    let value = seed;
    for (const byte of bytes) value = Math.imul(value ^ byte, 0x01000193) >>> 0;
    return value.toString(16).padStart(8, "0");
  };
  return `s${hash(0x811c9dc5)}${hash(0x9e3779b9)}`;
}

export function spaceIds(labelId: string) {
  if (!labelId || isTemp(labelId)) throw new Error("Apply the Space label before creating Space objects.");
  const token = tokenFor(labelId);
  return {
    token,
    lights: `light.taxis_space_${token}_all`,
    away: `input_boolean.taxis_space_${token}_away`,
    sleep: `input_boolean.taxis_space_${token}_sleep`,
    guest: `input_boolean.taxis_space_${token}_guest`,
    pause: `input_boolean.taxis_space_${token}_paused`,
    areasOccupied: `binary_sensor.taxis_space_${token}_areas_occupied`,
    occupied: `binary_sensor.taxis_space_${token}_occupied`,
    announce: `taxis_space_${token}_announce`,
    goodbye: `taxis_space_${token}_goodbye`,
    automation: (recipe: string) => `taxis_${recipe}_space_${token}`,
  };
}

/** Derive the current overlay, but never treat queued membership as live proof. */
export function resolveSpaces(h: Hierarchy, changes: readonly Change[] = []): Space[] {
  const spaces: Space[] = Object.values(h.labels).flatMap((label) => {
    const name = labelName(label.name);
    const declaredFloor = spaceFloorFromDescription(label.description);
    const declaredFloorIds = declaredFloor && h.floors.some((floor) => floor.id === declaredFloor) ? [declaredFloor] : [];
    return name ? [{ id: label.id, name, areaIds: [], declaredFloorIds, blocked: null }] : [];
  });
  const byId = new Map(spaces.map((space) => [space.id, space]));
  const names = new Map<string, number>();
  const tokens = new Map<string, number>();
  for (const space of spaces) {
    names.set(key(space.name), (names.get(key(space.name)) ?? 0) + 1);
    const token = tokenFor(space.id);
    tokens.set(token, (tokens.get(token) ?? 0) + 1);
  }
  for (const area of Object.values(h.areas)) {
    const assigned = area.labels.filter((id) => byId.has(id));
    for (const id of assigned) byId.get(id)!.areaIds.push(area.id);
    if (assigned.length > 1) for (const id of assigned) byId.get(id)!.blocked = `${area.name} has more than one Space label. Resolve the assignments first.`;
    if (area.labels.some((id) => !h.labels[id]))
      for (const id of assigned) byId.get(id)!.blocked = `${area.name} has an unknown label. Refresh before planning this Space.`;
  }
  for (const space of spaces) {
    space.areaIds.sort();
    if (isTemp(space.id)) space.blocked = "Apply the Space label and its area assignments before planning Space objects.";
    else if ((names.get(key(space.name)) ?? 0) > 1) space.blocked = `More than one Space is named ${space.name}. Resolve duplicate labels first.`;
    else if ((tokens.get(tokenFor(space.id)) ?? 0) > 1) space.blocked = "Space identifiers collide. Resolve the labels before planning Space objects.";
    else if (
      changes.some((change) => {
        if (change.kind === "label" && change.targetId === space.id) return true;
        if (change.kind !== "area" || !Object.hasOwn(change.after, "labels")) return false;
        const before = strings(change.before.labels).includes(space.id);
        const after = strings(change.after.labels).includes(space.id);
        return before !== after;
      })
    )
      space.blocked = "Apply the pending Space label and area assignments before planning Space objects.";
  }
  return spaces.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function areaSpace(h: Hierarchy, areaId: string, changes: readonly Change[] = []): AreaSpace {
  const area = h.areas[areaId];
  if (!area) return { kind: "conflict", error: "The area is no longer available." };
  if (area.labels.some((id) => !h.labels[id])) return { kind: "conflict", error: "This area has an unknown label. Refresh before planning." };
  const known = new Set(
    Object.values(h.labels)
      .filter((label) => labelName(label.name))
      .map((label) => label.id),
  );
  for (const change of changes) if (change.kind === "label" && labelName(String(change.after.name ?? change.before.name ?? ""))) known.add(change.targetId);
  const pending = changes.some((change) => {
    if (change.kind !== "area" || change.targetId !== areaId || !Object.hasOwn(change.after, "labels")) return false;
    const before = strings(change.before.labels)
      .filter((id) => known.has(id))
      .sort();
    const after = strings(change.after.labels)
      .filter((id) => known.has(id))
      .sort();
    return before.length !== after.length || before.some((id, i) => id !== after[i]);
  });
  if (pending) return { kind: "conflict", error: "Apply the pending Space assignment before planning this area." };
  const assigned = resolveSpaces(h, changes).filter((space) => space.areaIds.includes(areaId));
  if (assigned.length > 1) return { kind: "conflict", error: `${area.name} has more than one Space label.` };
  if (!assigned.length) return { kind: "legacy" };
  return { kind: "space", space: assigned[0] };
}

/** Replace only Space assignments, retaining every other native label. */
export function planSpaceLabels(h: Hierarchy, areaId: string, labelId: string | null): { ok: true; labels: string[] } | { ok: false; error: string } {
  const area = h.areas[areaId];
  if (!area) return { ok: false, error: "The area is no longer available." };
  const spaces = resolveSpaces(h);
  const selected = labelId === null ? undefined : spaces.find((space) => space.id === labelId);
  if (labelId !== null && !selected) return { ok: false, error: "The Space label is no longer available." };
  if (selected && spaces.filter((space) => key(space.name) === key(selected.name)).length > 1)
    return { ok: false, error: `More than one Space is named ${selected.name}. Resolve duplicate labels first.` };
  const assigned = area.labels.filter((id) => spaces.some((space) => space.id === id));
  for (const id of assigned) {
    const current = spaces.find((space) => space.id === id)!;
    if (spaces.filter((space) => key(space.name) === key(current.name)).length > 1)
      return { ok: false, error: `More than one Space is named ${current.name}. Resolve duplicate labels first.` };
  }
  if (area.labels.some((id) => !h.labels[id])) return { ok: false, error: "The area has an unknown label. Refresh before changing its Space." };
  const labels = area.labels.filter((id) => !assigned.includes(id));
  if (selected) labels.push(selected.id);
  return { ok: true, labels: [...new Set(labels)] };
}

export function scopeProblem(h: Hierarchy, changes: readonly Change[], scope: RecipeScope): string | null {
  if (scope.kind === "legacy") return null;
  const current = resolveSpaces(h, changes).find((space) => space.id === scope.space.id);
  if (!current) return "The Space label is no longer available.";
  if (current.blocked) return current.blocked;
  if (!current.areaIds.length) return "Assign at least one area to this Space first.";
  const expected = [...scope.space.areaIds].sort();
  if (expected.length !== current.areaIds.length || expected.some((id, i) => id !== current.areaIds[i]))
    return "Space membership changed. Refresh before planning.";
  return null;
}
