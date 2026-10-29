import type { ChangeInput, DeviceItem, Hierarchy } from "./types.ts";

export function unassignedDevices(h: Hierarchy, showDisabled: boolean): DeviceItem[] {
  return Object.values(h.devices).filter((device) => device.areaId === null && (showDisabled || !device.disabled));
}

// Device moves are intentionally independent of entity overrides. HA's normal
// inheritance applies to followers, while an entity's explicit area stays put.
export function deviceAreaAssignments(h: Hierarchy, ids: readonly string[], areaId: string): ChangeInput[] {
  if (!h.areas[areaId]) return [];
  return [...new Set(ids)].flatMap((id) =>
    h.devices[id]?.areaId === null ? [{ kind: "device" as const, op: "update" as const, targetId: id, fields: { area_id: areaId } }] : [],
  );
}
