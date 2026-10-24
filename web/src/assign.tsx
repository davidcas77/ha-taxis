import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { ROLE_ORDER } from "../../shared/roles.ts";
import type { EntityItem, EntityRole, Hierarchy } from "../../shared/types.ts";
import { useTaxis } from "./state.tsx";
import { SortHeader, useSort } from "./table.tsx";
import { Button, ConfirmAction, inputClass } from "./ui.tsx";

// Pick entities with filters, then add them to something (a label, a
// category) or take them out. Used by the Labels and Categories pages and an
// area's Labels tab.

type Show = "not" | "in" | "all";

// Roles a label's name suggests: "Night lights" -> lights, "Battery check" ->
// batteries. Only ever offered as a filter, never applied on its own.
const ROLE_LABEL = Object.fromEntries(ROLE_ORDER.map((r) => [r.role, r.label])) as Record<EntityRole, string>;

const ROLE_WORDS: [RegExp, EntityRole][] = [
  [/light|lamp|spot/i, "light"],
  [/motion|pir/i, "motion"],
  [/presence|occupan/i, "presence"],
  [/batter/i, "battery"],
  [/door|window|opening|contact/i, "opening"],
  [/temp/i, "temperature"],
  [/humid/i, "humidity"],
  [/media|tv|speaker|music|audio/i, "media"],
  [/camera|cam\b|cctv/i, "camera"],
  [/lock/i, "lock"],
  [/blind|shade|curtain|cover|shutter/i, "cover"],
  [/switch|plug|socket|outlet/i, "switch"],
  [/power|energy/i, "power"],
  [/climate|heat|cool|\bac\b|thermostat/i, "climate"],
];

export function rolesSuggestedBy(name: string): EntityRole[] {
  return [...new Set(ROLE_WORDS.filter(([re]) => re.test(name)).map(([, role]) => role))];
}

export function AssignTool({
  h,
  title,
  isMember,
  candidate = (e) => e.inRegistry,
  onAdd,
  onRemove,
  suggestedRoles = [],
  fixedArea,
}: {
  h: Hierarchy;
  title: string;
  isMember: (e: EntityItem) => boolean;
  candidate?: (e: EntityItem) => boolean;
  onAdd: (ids: string[]) => void;
  onRemove?: (ids: string[]) => void;
  suggestedRoles?: EntityRole[];
  // Limit the tool to one area (an area's Labels tab).
  fixedArea?: string;
}) {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<string | null>(fixedArea ?? null);
  const [anyArea, setAnyArea] = useState(!fixedArea);
  const [role, setRole] = useState<string>(suggestedRoles.length === 1 ? suggestedRoles[0] : "");
  const [domain, setDomain] = useState("");
  const [show, setShow] = useState<Show>("not");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { busy } = useTaxis();

  const domains = useMemo(() => [...new Set(Object.values(h.entities).map((e) => e.domain))].sort(), [h]);
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    return Object.values(h.entities)
      .filter((e) => candidate(e) && !e.disabled)
      .filter((e) => (fixedArea ? e.areaId === fixedArea : anyArea ? true : e.areaId === area))
      .filter((e) => (role ? e.role === role : true))
      .filter((e) => (domain ? e.domain === domain : true))
      .filter((e) => (show === "all" ? true : show === "in" ? isMember(e) : !isMember(e)))
      .filter((e) => !q || e.name.toLowerCase().includes(q) || e.entityId.includes(q));
  }, [h, candidate, fixedArea, anyArea, area, role, domain, show, isMember, q]);
  const {
    rows: sorted,
    sort,
    toggle: toggleSort,
  } = useSort(
    rows,
    {
      name: (e) => e.name,
      entityId: (e) => e.entityId,
      area: (e) => (e.areaId ? h.areas[e.areaId]?.name : null),
      kind: (e) => ROLE_LABEL[e.role],
      has: (e) => (isMember(e) ? "a" : "b"),
    },
    { key: "name", dir: "asc" },
  );
  const shown = sorted.slice(0, 300);
  // Members only get a checkbox in "Already added": there it is how Remove is reached.
  const selectable = (e: EntityItem) => show === "in" || !isMember(e);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // Only what the filters show: a pick hidden by a later filter isn't acted on.
  const visible = new Set(rows.map((e) => e.entityId));
  const pickedList = [...picked].filter((id) => h.entities[id] && visible.has(id) && selectable(h.entities[id]));
  const toAdd = pickedList.filter((id) => !isMember(h.entities[id]));
  const toRemove = pickedList.filter((id) => isMember(h.entities[id]));

  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-md border border-line bg-bg px-2 py-1.5">
          <Search className="size-4 text-muted" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or entity id" aria-label="Search entities" className="w-full bg-transparent text-[13px] outline-none" />
        </label>
        {!fixedArea && (
          <div className="w-48">
            <select aria-label="Area" className={inputClass} value={anyArea ? "*" : area ?? ""} onChange={(e) => (e.target.value === "*" ? setAnyArea(true) : (setAnyArea(false), setArea(e.target.value || null)))}>
              <option value="*">Any area</option>
              <option value="">No area</option>
              {h.floors.flatMap((f) => f.areaIds).concat(h.looseAreaIds).map((id) => (
                <option key={id} value={id}>
                  {h.areas[id].name}
                </option>
              ))}
            </select>
          </div>
        )}
        <select aria-label="Role" className={`${inputClass} w-40`} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Any role</option>
          {ROLE_ORDER.map((r) => (
            <option key={r.role} value={r.role}>
              {r.label}
              {suggestedRoles.includes(r.role) ? " (suggested)" : ""}
            </option>
          ))}
        </select>
        <select aria-label="Domain" className={`${inputClass} w-36`} value={domain} onChange={(e) => setDomain(e.target.value)}>
          <option value="">Any domain</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <div role="group" aria-label="Show" className="flex rounded-md border border-line p-0.5 text-xs">
          {(
            [
              ["not", "Not added yet"],
              ["in", "Already added"],
              ["all", "Show all"],
            ] as [Show, string][]
          ).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={show === v} onClick={() => setShow(v)} className={`rounded px-2 py-1 ${show === v ? "bg-sunken font-medium" : "text-muted"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {suggestedRoles.length > 0 && (
        <p className="text-xs text-muted">
          The name suggests{" "}
          {suggestedRoles.map((r, i) => (
            <span key={r}>
              {i > 0 && ", "}
              <button type="button" className="text-accent hover:underline" onClick={() => setRole(r)}>
                {ROLE_ORDER.find((x) => x.role === r)?.label.toLowerCase()}
              </button>
            </span>
          ))}
          . Pick what fits; nothing is added on its own.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">
          {rows.length.toLocaleString()} match{rows.length === 1 ? "" : "es"}
          {rows.length > shown.length && `, showing ${shown.length}`} · {pickedList.length} selected
        </span>
        <Button tone="ghost" onClick={() => setPicked(new Set([...picked, ...shown.filter(selectable).map((e) => e.entityId)]))}>
          Select all shown
        </Button>
        {picked.size > 0 && (
          <Button tone="ghost" onClick={() => setPicked(new Set())}>
            Clear selection
          </Button>
        )}
        <span className="ml-auto flex gap-2">
          <Button
            tone="primary"
            disabled={busy || toAdd.length === 0}
            onClick={() => {
              onAdd(toAdd);
              setPicked(new Set());
            }}
          >
            Add {toAdd.length || ""}
          </Button>
          {onRemove && (
            <ConfirmAction
              tone="plain"
              disabled={busy || toRemove.length === 0}
              question={`Remove ${toRemove.length} ${toRemove.length === 1 ? "entity" : "entities"} from ${title}?`}
              onConfirm={() => {
                onRemove(toRemove);
                setPicked(new Set());
              }}
            >
              Remove {toRemove.length || ""}
            </ConfirmAction>
          )}
        </span>
      </div>
      <div className="max-h-[28rem] overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-10 bg-sunken text-left text-xs text-muted">
            <tr>
              <th className="w-8 px-3 py-2">
                <span className="sr-only">Select</span>
              </th>
              <SortHeader label="Name" k="name" sort={sort} onToggle={toggleSort} />
              <SortHeader label="Entity id" k="entityId" sort={sort} onToggle={toggleSort} />
              <SortHeader label="Area" k="area" sort={sort} onToggle={toggleSort} />
              <SortHeader label="Kind" k="kind" sort={sort} onToggle={toggleSort} />
              <SortHeader label="Has it" k="has" sort={sort} onToggle={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-muted">
                  Nothing matches these filters.
                </td>
              </tr>
            )}
            {shown.map((e) => {
              const has = isMember(e);
              return (
                <tr key={e.entityId} className={`border-t border-line hover:bg-sunken ${has ? "text-muted opacity-60" : ""}`}>
                  <td className="px-3 py-1.5">{selectable(e) && <input type="checkbox" aria-label={`Select ${e.name}`} checked={picked.has(e.entityId)} onChange={() => toggle(e.entityId)} />}</td>
                  <td className="px-3 py-1.5">{e.name}</td>
                  <td className="px-3 py-1.5">
                    <code className="font-mono text-xs text-muted">{e.entityId}</code>
                  </td>
                  <td className="px-3 py-1.5 text-muted">{e.areaId ? h.areas[e.areaId]?.name : "No area"}</td>
                  <td className="px-3 py-1.5 text-muted">{ROLE_LABEL[e.role]}</td>
                  <td className="px-3 py-1.5">{has && <span className="rounded bg-accent-soft px-1.5 text-[11px] text-accent">has it</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

