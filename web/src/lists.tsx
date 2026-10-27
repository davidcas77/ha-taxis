import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { ROLE_ORDER } from "../../shared/roles.ts";
import type { EntityItem, Hierarchy } from "../../shared/types.ts";
import { DeviceEditor, EntityEditor } from "./editors.tsx";
import { BulkBar, ROLE_ICONS, ROLE_LABEL } from "./spaces.tsx";
import { useTaxis } from "./state.tsx";
import { useStoredFlag } from "./storage.ts";
import { GroupToggle, GroupedRows, SortHeader, useSort } from "./table.tsx";
import { EditedDot, LabelChip, inputClass } from "./ui.tsx";

// Every device, and every entity, in one filterable list.

const LIMIT = 400;

const roleOf = (e: EntityItem) => e.role;

function AreaFilter({ h, value, onChange }: { h: Hierarchy; value: string; onChange: (v: string) => void }) {
  return (
    <select aria-label="Area" className={`${inputClass} w-48`} value={value} onChange={(e) => onChange(e.target.value)}>
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

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex min-w-[14rem] flex-1 items-center gap-2 rounded-md border border-line bg-bg px-2 py-1.5">
      <Search className="size-4 text-muted" aria-hidden />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="w-full bg-transparent text-[13px] outline-none" />
    </label>
  );
}

export function EntitiesPage({ h }: { h: Hierarchy }) {
  const { edited } = useTaxis();
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("*");
  const [role, setRole] = useState("");
  const [label, setLabel] = useState("");
  const [extra, setExtra] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [grouped, setGrouped] = useStoredFlag("taxis:group-by-type:entities");
  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      Object.values(h.entities)
        .filter((e) => extra || (!e.disabled && !e.hidden && !e.maintenance))
        .filter((e) => (area === "*" ? true : area === "" ? !e.areaId : e.areaId === area))
        .filter((e) => (role ? e.role === role : true))
        .filter((e) => (label ? e.labels.includes(label) : true))
        .filter((e) => !q || e.name.toLowerCase().includes(q) || e.entityId.includes(q)),
    [h, extra, area, role, label, q],
  );
  const {
    rows: sorted,
    sort,
    toggle: toggleSort,
  } = useSort(
    rows,
    {
      name: (e) => e.name,
      area: (e) => (e.areaId ? h.areas[e.areaId]?.name : null),
      role: (e) => ROLE_LABEL[e.role],
      labels: (e) => e.labels.map((l) => h.labels[l]?.name ?? "").filter(Boolean).sort().join(", "),
      state: (e) => e.state,
    },
    { key: "name", dir: "asc" },
  );
  const shown = sorted.slice(0, LIMIT);
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const renderRow = (e: EntityItem) => {
    const Icon = ROLE_ICONS[e.role];
    return (
      <tr key={e.entityId} className="border-t border-line align-top hover:bg-sunken">
        <td className="px-3 py-1.5">{e.inRegistry && <input type="checkbox" aria-label={`Select ${e.name}`} checked={picked.has(e.entityId)} onChange={() => toggle(e.entityId)} />}</td>
        <td className="px-3 py-1.5">
          <button type="button" className="flex items-center gap-1.5 text-left hover:text-accent" onClick={() => setEditing(e.entityId)}>
            {e.name}
            {edited.has(`entity:${e.entityId}`) && <EditedDot />}
          </button>
          <code className="font-mono text-[11px] text-muted">{e.entityId}</code>
        </td>
        <td className="px-3 py-1.5 text-muted">{e.areaId ? h.areas[e.areaId]?.name : "–"}</td>
        <td className="px-3 py-1.5 text-muted">
          <span className="inline-flex items-center gap-1">
            <Icon className="size-3.5" aria-hidden />
            {ROLE_LABEL[e.role]}
          </span>
        </td>
        <td className="px-3 py-1.5">
          <span className="flex flex-wrap gap-1">{e.labels.map((l) => h.labels[l] && <LabelChip key={l} label={h.labels[l]} />)}</span>
        </td>
        <td className="max-w-[10rem] truncate px-3 py-1.5 tabular-nums text-muted">{e.state === null ? "–" : e.unit ? `${e.state} ${e.unit}` : e.state}</td>
      </tr>
    );
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Entities</h1>
        {editing && h.entities[editing] && <EntityEditor key={editing} h={h} entity={h.entities[editing]} onClose={() => setEditing(null)} />}
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={query} onChange={setQuery} placeholder="Find by name or entity id" />
          <AreaFilter h={h} value={area} onChange={setArea} />
          <select aria-label="Role" className={`${inputClass} w-40`} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Any role</option>
            {ROLE_ORDER.map((r) => (
              <option key={r.role} value={r.role}>
                {r.label}
              </option>
            ))}
          </select>
          <select aria-label="Label" className={`${inputClass} w-40`} value={label} onChange={(e) => setLabel(e.target.value)}>
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
          <GroupToggle on={grouped} onChange={setGrouped} />
        </div>
        {(() => {
          // Only what the filters show is acted on.
          const ids = rows.filter((e) => picked.has(e.entityId)).map((e) => e.entityId);
          return ids.length > 0 && <BulkBar h={h} ids={ids} onDone={() => setPicked(new Set())} />;
        })()}
        <p className="text-xs text-muted">
          {rows.length.toLocaleString()} entities{rows.length > shown.length && `, showing the first ${shown.length}`}.{" "}
          <button type="button" className="text-accent hover:underline" onClick={() => setPicked(new Set(shown.filter((e) => e.inRegistry).map((e) => e.entityId)))}>
            Select all shown
          </button>
        </p>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead className="bg-sunken text-left text-xs text-muted">
              <tr>
                <th className="w-8 px-3 py-2" />
                <SortHeader label="Name" k="name" sort={sort} onToggle={toggleSort} />
                <SortHeader label="Area" k="area" sort={sort} onToggle={toggleSort} />
                <SortHeader label="Role" k="role" sort={sort} onToggle={toggleSort} />
                <SortHeader label="Labels" k="labels" sort={sort} onToggle={toggleSort} />
                <SortHeader label="State" k="state" sort={sort} onToggle={toggleSort} />
              </tr>
            </thead>
            <tbody>
              <GroupedRows rows={shown} grouped={grouped} roleOf={roleOf} colSpan={6} row={renderRow} />
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

export function DevicesPage({ h }: { h: Hierarchy }) {
  const { edited } = useTaxis();
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("*");
  const [maker, setMaker] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const makers = useMemo(() => [...new Set(Object.values(h.devices).map((d) => d.manufacturer).filter((m): m is string => Boolean(m)))].sort(), [h]);
  const q = query.trim().toLowerCase();
  const rows = Object.values(h.devices)
    .filter((d) => (area === "*" ? true : area === "" ? !d.areaId : d.areaId === area))
    .filter((d) => (maker ? d.manufacturer === maker : true))
    .filter((d) => !q || d.name.toLowerCase().includes(q) || (d.model ?? "").toLowerCase().includes(q));
  const {
    rows: sorted,
    sort,
    toggle: toggleSort,
  } = useSort(
    rows,
    {
      name: (d) => d.name,
      model: (d) => [d.manufacturer, d.model].filter(Boolean).join(" · "),
      area: (d) => (d.areaId ? h.areas[d.areaId]?.name : null),
      via: (d) => (d.viaDeviceId ? h.devices[d.viaDeviceId]?.name : null),
      entities: (d) => d.entityIds.length,
    },
    { key: "name", dir: "asc" },
  );
  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Devices</h1>
        {editing && h.devices[editing] && <DeviceEditor key={editing} h={h} device={h.devices[editing]} onClose={() => setEditing(null)} />}
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={query} onChange={setQuery} placeholder="Find by name or model" />
          <AreaFilter h={h} value={area} onChange={setArea} />
          <select aria-label="Manufacturer" className={`${inputClass} w-44`} value={maker} onChange={(e) => setMaker(e.target.value)}>
            <option value="">Any manufacturer</option>
            {makers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted">{rows.length.toLocaleString()} devices.</p>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead className="bg-sunken text-left text-xs text-muted">
              <tr>
                <SortHeader label="Device" k="name" sort={sort} onToggle={toggleSort} />
                <SortHeader label="Model" k="model" sort={sort} onToggle={toggleSort} />
                <SortHeader label="Area" k="area" sort={sort} onToggle={toggleSort} />
                <SortHeader label="Connected via" k="via" sort={sort} onToggle={toggleSort} />
                <SortHeader label="Entities" k="entities" sort={sort} onToggle={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, LIMIT).map((d) => (
                <tr key={d.id} className="border-t border-line hover:bg-sunken">
                  <td className="px-3 py-1.5">
                    <button type="button" className="flex items-center gap-1.5 text-left hover:text-accent" onClick={() => setEditing(d.id)}>
                      {d.name}
                      {edited.has(`device:${d.id}`) && <EditedDot />}
                      {d.disabled && <span className="rounded bg-sunken px-1 text-[10px] text-muted">disabled</span>}
                    </button>
                  </td>
                  <td className="px-3 py-1.5 text-muted">{[d.manufacturer, d.model].filter(Boolean).join(" · ") || "–"}</td>
                  <td className="px-3 py-1.5 text-muted">{d.areaId ? h.areas[d.areaId]?.name : "–"}</td>
                  <td className="px-3 py-1.5 text-muted">{d.viaDeviceId ? h.devices[d.viaDeviceId]?.name ?? "–" : "–"}</td>
                  <td className="px-3 py-1.5 tabular-nums text-muted">{d.entityIds.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
