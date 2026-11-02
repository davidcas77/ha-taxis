import { planSpaceLabels, resolveSpaces } from "./spaces.ts";
import { sameValue } from "./changes.ts";
import type { ChangeInput, Hierarchy } from "./types.ts";

export type AreaMoveDestination = {
  floorId: string | null;
  space: { kind: "keep" } | { kind: "set"; labelId: string | null };
};

/** Plan only the native area registry edit; installed helpers and recipes need review separately. */
export function planAreaMove(
  h: Hierarchy,
  areaId: string,
  destination: AreaMoveDestination,
): { ok: true; input: ChangeInput; membershipChanged: boolean; warning: string | null } | { ok: false; error: string } {
  const area = h.areas[areaId];
  if (!area) return { ok: false, error: "The area is no longer available. Refresh and try again." };
  if (destination.floorId !== null && !h.floors.some((floor) => floor.id === destination.floorId))
    return { ok: false, error: "The destination floor is no longer available. Refresh and try again." };
  if (area.floorId !== null && !h.floors.some((floor) => floor.id === area.floorId))
    return { ok: false, error: "The area's current floor is unavailable. Refresh and try again." };
  if (area.labels.some((id) => !h.labels[id])) return { ok: false, error: "The area has an unknown label. Refresh before moving it." };
  const spaces = resolveSpaces(h);
  const assigned = spaces.filter((space) => space.areaIds.includes(areaId));
  if (assigned.length > 1 && destination.space.kind === "keep")
    return { ok: false, error: "The area has more than one Space label. Resolve its assignments before moving it." };
  const fields: Record<string, unknown> = {};
  if (area.floorId !== destination.floorId) fields.floor_id = destination.floorId;
  let membershipChanged = false;
  if (destination.space.kind === "set") {
    const planned = planSpaceLabels(h, areaId, destination.space.labelId);
    if (!planned.ok) return planned;
    membershipChanged = !sameValue(planned.labels, area.labels);
    fields.labels = planned.labels;
  }
  if (area.floorId === destination.floorId && !membershipChanged) return { ok: false, error: "The area is already in this location." };
  const warning = membershipChanged
    ? "After applying, review the old and new Space light and occupancy groups, scripts and recipes. Their installed members or settings are not changed by this move. Also review affected floor light groups."
    : "After applying, review the old and new floor light groups. Their installed members are not changed by this move.";
  return {
    ok: true,
    input: {
      kind: "area",
      op: "update",
      targetId: areaId,
      fields,
      ...(destination.space.kind === "set"
        ? { areaMove: { spaceLabelId: destination.space.labelId, sourceSpaces: assigned.map((space) => ({ id: space.id, name: h.labels[space.id].name })) } }
        : {}),
    },
    membershipChanged,
    warning,
  };
}
