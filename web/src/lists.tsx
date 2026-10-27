import { useCallback, useMemo, useState } from "react";

import type { Hierarchy } from "../../shared/types.ts";
import { DevicesEntities } from "./devices-view.tsx";
import { DeviceEditor, EntityEditor } from "./editors.tsx";
import { BulkBar } from "./spaces.tsx";
import { inputClass } from "./ui.tsx";

// The Table view of Organize > Devices and Organize > Entities: every device with
// its entities, and the entities with no device, in one table that can be searched
// and filtered, grouped by type, sorted, and edited in place (devices-view.tsx).

const LIMIT = 400;

type Editing = { kind: "entity" | "device"; id: string } | null;

function AreaFilter({ h, value, onChange }: { h: Hierarchy; value: string; onChange: (v: string) => void }) {
  return (
    <select aria-label="Area" className={`${inputClass} w-48!`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="*">Any area</option>
      <option value="">No area</option>
      {[...h.floors.flatMap((f) => f.areaIds), ...h.looseAreaIds].map((id) => (
        <option key={id} value={id}>
          {h.areas[id].name}
        </option>
      ))}
    </select>
  );
}

// `section`: which of the two it is shown for. Both are the same table; Entities
// opens with every device's entities showing, Devices with them folded.
export function OrganizeTable({ h, section, onRecord }: { h: Hierarchy; section: "devices" | "entities"; onRecord: (id: string) => void }) {
  const [area, setArea] = useState("*");
  const [maker, setMaker] = useState("");
  const [label, setLabel] = useState("");
  const [extra, setExtra] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const makers = useMemo(() => [...new Set(Object.values(h.devices).map((d) => d.manufacturer).filter((m): m is string => Boolean(m)))].sort(), [h]);

  // The same function between renders unless a filter changes, so the table is not worked out again for nothing.
  const entityOk = useCallback(
    (e: { disabled: boolean; hidden: boolean; maintenance: boolean; labels: string[] }) => (extra || (!e.disabled && !e.hidden && !e.maintenance)) && (!label || e.labels.includes(label)),
    [extra, label],
  );
  const deviceOk = useMemo(() => (maker ? (d: { manufacturer: string | null }) => d.manufacturer === maker : undefined), [maker]);
  const areaOk = useMemo(() => (area === "*" ? undefined : (id: string | null) => (area === "" ? id === null : id === area)), [area]);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="flex flex-col gap-4">
        {editing?.kind === "entity" && h.entities[editing.id] && <EntityEditor key={editing.id} h={h} entity={h.entities[editing.id]} onClose={() => setEditing(null)} />}
        {editing?.kind === "device" && h.devices[editing.id] && <DeviceEditor key={editing.id} h={h} device={h.devices[editing.id]} onClose={() => setEditing(null)} />}
        <DevicesEntities
          h={h}
          place={section}
          defaultShowEntities={section === "entities"}
          onRecord={onRecord}
          entityOk={entityOk}
          deviceOk={deviceOk}
          areaOk={areaOk}
          picked={picked}
          toggle={toggle}
          onOpenEntity={(id) => setEditing({ kind: "entity", id })}
          onOpenDevice={(id) => setEditing({ kind: "device", id })}
          limit={LIMIT}
          onSelectAll={(ids) => setPicked(new Set(ids))}
          // Only what the table shows is acted on.
          bulk={(shown) => {
            const ids = [...picked].filter((id) => shown.has(id));
            return ids.length > 0 && <BulkBar h={h} ids={ids} onDone={() => setPicked(new Set())} />;
          }}
          toolbar={
            <>
              <AreaFilter h={h} value={area} onChange={setArea} />
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
                <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} /> Include disabled, hidden and diagnostic
              </label>
            </>
          }
        />
      </div>
    </div>
  );
}
