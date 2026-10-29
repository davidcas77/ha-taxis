import { useCallback, useMemo, useState } from "react";

import type { EntityItem, Hierarchy } from "../../shared/types.ts";
import { entityMatchesSection } from "../../shared/organize.ts";
import { DevicesEntities } from "./devices-view.tsx";
import { DeviceEditor, EntityEditor } from "./editors.tsx";
import { BulkBar, RoleSections } from "./spaces.tsx";
import { AreaMultiSelect, FilterChips, useAreaFilter } from "./records.tsx";
import { useStoredValue } from "./storage.ts";
import { inputClass } from "./ui.tsx";

// The Table view of Organize > Devices and Organize > Entities: every device with
// its entities, and the entities with no device, in one table that can be searched
// and filtered, grouped by type, sorted, and edited in place (devices-view.tsx).

const PAGE_SIZE = 100;

type Editing = { kind: "entity" | "device"; id: string } | null;

// `section`: which of the two it is shown for. Both are the same table; Entities
// opens with every device's entities showing, Devices with them folded.
export function OrganizeTable({ h, section, onRecord }: { h: Hierarchy; section: "devices" | "entities"; onRecord: (id: string) => void }) {
  const [areas, setAreas] = useAreaFilter();
  const [maker, setMaker] = useStoredValue("taxis:filters:maker", "", (v): v is string => typeof v === "string");
  const [label, setLabel] = useStoredValue("taxis:filters:label", "", (v): v is string => typeof v === "string");
  const [showDisabled, setShowDisabled] = useStoredValue("taxis:filters:disabled-devices", false, (v): v is boolean => typeof v === "boolean");
  const [extra, setExtra] = useStoredValue("taxis:filters:extra", false, (v): v is boolean => typeof v === "boolean");
  const [editing, setEditing] = useState<Editing>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const makers = useMemo(
    () =>
      [
        ...new Set(
          Object.values(h.devices)
            .map((d) => d.manufacturer)
            .filter((m): m is string => Boolean(m)),
        ),
      ].sort(),
    [h],
  );

  // The same function between renders unless a filter changes, so the table is not worked out again for nothing.
  const entityOk = useCallback(
    (e: EntityItem) =>
      (section !== "entities" || entityMatchesSection(e, "entities")) &&
      (extra || (!e.disabled && !e.hidden && !e.maintenance)) &&
      (!label || e.labels.includes(label)),
    [extra, label, section],
  );
  const deviceOk = useMemo(
    () => (d: { manufacturer: string | null; disabled: boolean }) => (showDisabled || !d.disabled) && (!maker || d.manufacturer === maker),
    [maker, showDisabled],
  );
  const deviceLabelOk = useMemo(() => (label ? (d: { labels: string[] }) => d.labels.includes(label) : undefined), [label]);
  const reset = () => {
    setAreas(new Set());
    setMaker("");
    setLabel("");
    setExtra(false);
    setShowDisabled(false);
  };
  const chips = [...areas].map((id) => ({
    label: id ? (h.areas[id]?.name ?? id) : "No area",
    remove: () => setAreas(new Set([...areas].filter((a) => a !== id))),
  }));
  if (maker) chips.push({ label: maker, remove: () => setMaker("") });
  if (label) chips.push({ label: h.labels[label]?.name ?? label, remove: () => setLabel("") });
  if (extra) chips.push({ label: "Include hidden/disabled", remove: () => setExtra(false) });
  const areaOk = useMemo(() => (areas.size ? (id: string | null) => areas.has(id ?? "") : undefined), [areas]);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
      <div className="flex min-w-0 flex-col gap-4">
        {editing?.kind === "entity" && h.entities[editing.id] && (
          <EntityEditor key={editing.id} h={h} entity={h.entities[editing.id]} onClose={() => setEditing(null)} />
        )}
        {editing?.kind === "device" && h.devices[editing.id] && (
          <DeviceEditor key={editing.id} h={h} device={h.devices[editing.id]} onClose={() => setEditing(null)} />
        )}
        <DevicesEntities
          h={h}
          place={section}
          defaultShowEntities={section === "entities"}
          onRecord={onRecord}
          entityOk={entityOk}
          deviceOk={deviceOk}
          deviceLabelOk={deviceLabelOk}
          includeLoose={!maker}
          groups={(ids) => (
            <RoleSections
              h={h}
              ids={ids}
              filters={{ maintenance: true, disabled: true }}
              rows={{ picked, toggle, edit: (id) => setEditing({ kind: "entity", id }) }}
              showDevice
            />
          )}
          onResetFilters={reset}
          activeFilters={<FilterChips items={chips} clear={reset} />}
          areaOk={areaOk}
          picked={picked}
          toggle={toggle}
          onOpenEntity={(id) => setEditing({ kind: "entity", id })}
          onOpenDevice={(id) => setEditing({ kind: "device", id })}
          limit={PAGE_SIZE}
          onSelectAll={(ids) => setPicked(new Set(ids))}
          // Only what the table shows is acted on.
          bulk={(shown) => {
            const ids = [...picked].filter((id) => shown.has(id));
            return ids.length > 0 && <BulkBar h={h} ids={ids} onDone={() => setPicked(new Set())} />;
          }}
          toolbar={
            <>
              <AreaMultiSelect areas={Object.values(h.areas)} selected={areas} onChange={setAreas} />
              <select aria-label="Manufacturer" className={`${inputClass} w-44!`} value={maker} onChange={(e) => setMaker(e.target.value)}>
                <option value="">Any manufacturer</option>
                {makers.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select aria-label="Label" className={`${inputClass} w-40!`} value={label} onChange={(e) => setLabel(e.target.value)}>
                <option value="">Any label</option>
                {Object.values(h.labels).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={showDisabled} onChange={(e) => setShowDisabled(e.target.checked)} /> Show disabled devices
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} /> Include disabled, hidden and diagnostic entities
              </label>
            </>
          }
        />
      </div>
    </div>
  );
}
