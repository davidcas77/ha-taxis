import { useMemo, useState } from "react";
import { roomEquipment, type AreaReadiness } from "../../shared/guide.ts";
import { helperExclusions } from "../../shared/helpers.ts";
import { defaultCapability } from "../../shared/inventory.ts";
import type { EntityItem, Hierarchy } from "../../shared/types.ts";
import { useDraftGuard } from "./draft-guard.ts";
import { useTaxis, type Route } from "./state.tsx";
import { AreaSelect, Button, inputClass } from "./ui.tsx";

export function RoomEquipment({
  h,
  area,
  go,
  onConfirm,
}: {
  h: Hierarchy;
  area: AreaReadiness;
  go: (route: Route) => void;
  onConfirm: () => Promise<string | null>;
}) {
  const { naming, busy, reviewChanges, changes } = useTaxis();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const equipment = useMemo(() => roomEquipment(h, area.areaId, helperExclusions(h, naming)(area.areaId)), [h, area.areaId, naming]);
  const devices = h.areas[area.areaId].deviceIds.map((id) => h.devices[id]).filter(Boolean);
  const assigned = (entity: EntityItem) => (entity.ownAreaId ? "Assigned here" : entity.deviceId ? "Follows device" : "Listed in this room");
  const equipmentRows = (items: EntityItem[]) => (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((entity) => (
        <li key={entity.entityId} className="min-w-0 rounded-lg border border-line p-3">
          <div className="break-words text-sm font-medium">{entity.name}</div>
          <div className="mt-1 break-all font-mono text-xs text-muted">{entity.entityId}</div>
          <div className="mt-1 text-xs text-muted">
            {assigned(entity)}
            {entity.disabled ? " · Disabled" : ""}
          </div>
        </li>
      ))}
    </ul>
  );
  const pending = changes.some((change) => {
    if (!["device", "entity"].includes(change.kind) || !Object.hasOwn(change.after, "area_id")) return false;
    const id = change.kind === "entity" ? h.entities[change.targetId]?.areaId : h.devices[change.targetId]?.areaId;
    return [id, change.before?.area_id, change.after.area_id].includes(area.areaId);
  });
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Check that these are the devices and controls physically in {area.name}.</p>
      <div className="flex flex-wrap items-center gap-2">
        {pending ? (
          <Button tone="primary" onClick={() => go({ page: "changes" })}>
            Review assignment in Changes
          </Button>
        ) : (
          !area.equipmentConfirmed && (
            <Button
              tone="primary"
              disabled={busy || saving}
              onClick={async () => {
                setSaving(true);
                setError(null);
                try {
                  const problem = await onConfirm();
                  setError(problem);
                } finally {
                  setSaving(false);
                }
              }}
            >
              Confirm room equipment
            </Button>
          )
        )}
        <Button onClick={() => go({ page: "areas", sel: { kind: "area", id: area.areaId }, tab: "devices-entities" })}>Manage devices and entities</Button>
        {pending && reviewChanges && <span className="text-sm text-warn">Apply the assignment, then confirm the live equipment.</span>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <details className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm font-medium">Correct an equipment assignment</summary>
        <RoomAssignment h={h} areaId={area.areaId} />
      </details>
      {equipment.length ? equipmentRows(equipment.slice(0, 6)) : <p className="text-sm text-muted">No lights, sensors or controls were found here.</p>}
      {equipment.length > 6 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-accent">More room equipment ({equipment.length - 6})</summary>
          <div className="mt-2">{equipmentRows(equipment.slice(6))}</div>
        </details>
      )}
      {devices.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-accent">Devices assigned here ({devices.length})</summary>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {devices.map((device) => (
              <li key={device.id} className="break-words">
                {device.name}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function RoomAssignment({ h, areaId }: { h: Hierarchy; areaId: string }) {
  const { naming, propose, busy, reviewChanges } = useTaxis();
  const [query, setQuery] = useState("");
  const [entityId, setEntityId] = useState("");
  const [destination, setDestination] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const current = roomEquipment(h, areaId, helperExclusions(h, naming)(areaId));
  const source = needle
    ? Object.values(h.entities).filter(
        (entity) =>
          (defaultCapability(entity) !== null || ["switch", "button"].includes(entity.domain)) &&
          (entity.name.toLowerCase().includes(needle) || entity.entityId.toLowerCase().includes(needle)),
      )
    : current;
  const options = source.filter((entity) => entity.inRegistry && !entity.entityId.startsWith("new:")).slice(0, 60);
  const selected = h.entities[entityId];
  const inherited = selected?.deviceId ? (h.devices[selected.deviceId]?.areaId ?? null) : null;
  const changed = Boolean(selected && (destination ? destination !== selected.areaId : selected.ownAreaId !== null));
  const guard = useDraftGuard(changed);
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="flex min-w-0 flex-col gap-1 text-sm">
        Find equipment
        <input className={inputClass} type="search" placeholder="Search this home" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-sm">
        Equipment to move
        <select
          aria-label="Equipment to move"
          className={inputClass}
          value={entityId}
          onChange={(event) => {
            const entity = h.entities[event.target.value];
            setEntityId(event.target.value);
            setDestination(entity?.ownAreaId ?? (entity?.areaId ? null : areaId));
          }}
        >
          <option value="">Choose equipment</option>
          {selected && !options.some((entity) => entity.entityId === selected.entityId) && <option value={selected.entityId}>{selected.name}</option>}
          {options.map((entity) => (
            <option key={entity.entityId} value={entity.entityId}>
              {entity.name} ({entity.areaId ? (h.areas[entity.areaId]?.name ?? entity.areaId) : "Unassigned"})
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <>
          <div className="flex min-w-0 flex-col gap-1 text-sm">
            <label htmlFor="room-equipment-destination">Destination room</label>
            <AreaSelect
              h={h}
              id="room-equipment-destination"
              value={destination}
              onChange={setDestination}
              disabled={busy}
              noneLabel={inherited ? `Follow device to ${h.areas[inherited]?.name ?? inherited}` : "No room"}
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Button
              disabled={!changed || busy}
              onClick={async () => {
                const ok = await propose({
                  kind: "entity",
                  op: "update",
                  targetId: selected.entityId,
                  fields: { area_id: destination, ...(destination && selected.needsOwnName && !selected.customName ? { name: selected.name } : {}) },
                });
                if (ok) {
                  setEntityId("");
                  setDestination(null);
                  guard.release();
                }
              }}
            >
              {reviewChanges ? "Add assignment to changes" : "Preview assignment change"}
            </Button>
            <Button
              tone="ghost"
              onClick={() => {
                setEntityId("");
                setDestination(null);
                guard.release();
              }}
            >
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
