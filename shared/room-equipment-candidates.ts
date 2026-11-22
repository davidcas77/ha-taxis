import { suggestAreaPlacement, type AreaPlacement } from "./area-suggestion.ts";
import { equipmentIsReporting, type AutomationEquipmentCheck } from "./guide-automations.ts";
import { areaInventory, defaultCapability, kindAllowed, type InventorySettings } from "./inventory.ts";
import type { EntityItem, Hierarchy } from "./types.ts";

export type RoomEquipmentCandidate = {
  entity: EntityItem;
  placement: AreaPlacement;
  recommended: boolean;
  verification: string | null;
};

export function roomEquipmentCandidates(
  h: Hierarchy,
  inventory: InventorySettings,
  areaId: string,
  check: Pick<AutomationEquipmentCheck, "capabilities" | "candidateRole" | "entityIds">,
  exclusions: (areaId: string) => ReadonlySet<string>,
  query = "",
): RoomEquipmentCandidate[] {
  const rooms = Object.values(h.areas);
  const detected = new Set(check.entityIds);
  const roomExclusions = exclusions(areaId);
  const roomHasMotion = check.candidateRole === "starts" && areaInventory(h, inventory, areaId, roomExclusions).motion.some((row) => row.counts);
  const needle = query.trim().normalize("NFC").toLowerCase();
  const candidates = Object.values(h.entities).flatMap((entity): RoomEquipmentCandidate[] => {
    if (!entity.inRegistry || entity.maintenance || entity.areaId === areaId || detected.has(entity.entityId) || roomExclusions.has(entity.entityId)) return [];
    if (entity.areaId && (!needle || exclusions(entity.areaId).has(entity.entityId))) return [];
    if ((entity.domain === "light" && (entity.platform === "group" || entity.members.length > 0)) || (entity.domain === "switch" && entity.hidden)) return [];
    const base = defaultCapability(entity);
    if (base === null) return [];
    const choice = Object.hasOwn(inventory.entities, entity.entityId) ? inventory.entities[entity.entityId] : undefined;
    const capability = choice?.kind && kindAllowed(base, choice.kind) ? choice.kind : base;
    if (!check.capabilities.includes(capability) || !equipmentIsReporting(entity, capability)) return [];
    const device = entity.deviceId ? h.devices[entity.deviceId] : undefined;
    if (needle && !`${entity.name} ${entity.entityId} ${device?.name ?? ""}`.normalize("NFC").toLowerCase().includes(needle)) return [];
    const placement = suggestAreaPlacement({ entityName: entity.name, entityId: entity.entityId, deviceName: device?.name }, rooms);
    const recommended = !entity.areaId && placement.kind === "suggestion" && placement.areaId === areaId;
    let verification: string | null = null;
    if (capability === "tv" && check.candidateRole && choice?.tvOccupancyRole !== check.candidateRole)
      verification = "Confirm whether this TV should participate in occupancy after assigning it.";
    const startsAsHold = choice?.role === "holds" || (choice?.role === undefined && capability === "presence" && roomHasMotion && choice?.counts !== false);
    if ((capability === "motion" || capability === "presence") && check.candidateRole === "starts" && startsAsHold)
      verification = "Check its occupancy role. It may need to be set to detect entry after assigning it.";
    if (check.candidateRole === "appliance" && !choice?.appliance)
      verification = "Confirm that this sensor measures the intended appliance after assigning it.";
    if (capability === "fan" && entity.domain === "switch" && choice?.counts !== true)
      verification = "Confirm that this switch controls the ventilation fan after assigning it.";
    if (choice?.counts === false && !verification) verification = "This source is excluded in Capabilities. Confirm before including it.";
    return [{ entity, placement, recommended, verification }];
  });
  return candidates.sort(
    (a, b) =>
      Number(b.recommended) - Number(a.recommended) ||
      Number(Boolean(a.entity.areaId)) - Number(Boolean(b.entity.areaId)) ||
      a.entity.name.localeCompare(b.entity.name) ||
      a.entity.entityId.localeCompare(b.entity.entityId),
  );
}
