import { useMemo, useState, type ReactNode } from "react";

import { ROLE_ORDER } from "../../shared/roles.ts";
import { sortRows } from "../../shared/sort.ts";
import type { EntityItem, EntityRole, Hierarchy } from "../../shared/types.ts";
import { useTaxis } from "./state.tsx";
import { DataTable, useSortState, type Column } from "./data-table.tsx";
import { Button, Chip, ConfirmAction, EmptyState, SearchField, Toolbar, inputClass } from "./ui.tsx";

// Pick entities with filters, then add them to something (a label, a
// category) or take them out. Used by the Labels and Categories pages and an
// area's Labels tab.

type Show = "not" | "in" | "all";

const ROLE_LABEL = Object.fromEntries(ROLE_ORDER.map((r) => [r.role, r.label])) as Record<EntityRole, string>;

export function AssignTool({
  h,
  title,
  isMember,
  candidate = (e) => e.inRegistry,
  onAdd,
  onRemove,
  fixedArea,
}: {
  h: Hierarchy;
  title: string;
  isMember: (e: EntityItem) => boolean;
  candidate?: (e: EntityItem) => boolean;
  onAdd: (ids: string[]) => void;
  onRemove?: (ids: string[]) => void;
  // Limit the tool to one area (an area's Labels tab).
  fixedArea?: string;
}) {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<string | null>(fixedArea ?? null);
  const [anyArea, setAnyArea] = useState(!fixedArea);
  const [role, setRole] = useState<string>("");
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
  const { sort, toggle: toggleSort } = useSortState({ key: "name", dir: "asc" });
  const sorted = useMemo(() => {
    const get = {
      name: (e: EntityItem) => e.name,
      entityId: (e: EntityItem) => e.entityId,
      area: (e: EntityItem) => (e.areaId ? h.areas[e.areaId]?.name : null),
      kind: (e: EntityItem) => ROLE_LABEL[e.role],
      has: (e: EntityItem) => (isMember(e) ? "a" : "b"),
    }[sort.key as "name" | "entityId" | "area" | "kind" | "has"];
    return sortRows(rows, get, sort.dir);
  }, [rows, sort, h, isMember]);
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

  // A row already in the thing is dimmed.
  const dim = (e: EntityItem, node: ReactNode) => (isMember(e) ? <span className="opacity-60">{node}</span> : node);
  const columns: Column<EntityItem>[] = [
    {
      id: "pick",
      header: "Select",
      srOnlyHeader: true,
      locked: true,
      sticky: true,
      width: 32,
      priority: 1,
      cell: (e) =>
        selectable(e) && <input type="checkbox" aria-label={`Select ${e.name}`} checked={picked.has(e.entityId)} onChange={() => toggle(e.entityId)} />,
    },
    { id: "name", header: "Name", priority: 1, sticky: true, minWidth: 180, maxWidth: 320, sort: (e) => e.name, cell: (e) => dim(e, e.name) },
    {
      id: "entityId",
      header: "Entity id",
      priority: 2,
      minWidth: 160,
      maxWidth: 280,
      truncate: true,
      sort: (e) => e.entityId,
      text: (e) => e.entityId,
      cell: (e) => dim(e, <code className="font-mono text-xs text-muted">{e.entityId}</code>),
    },
    {
      id: "area",
      header: "Area",
      priority: 2,
      minWidth: 110,
      sort: (e) => (e.areaId ? h.areas[e.areaId]?.name : null),
      cell: (e) => dim(e, <span className="text-muted">{e.areaId ? h.areas[e.areaId]?.name : "No area"}</span>),
    },
    {
      id: "kind",
      header: "Kind",
      priority: 3,
      minWidth: 90,
      sort: (e) => ROLE_LABEL[e.role],
      cell: (e) => dim(e, <span className="text-muted">{ROLE_LABEL[e.role]}</span>),
    },
    {
      id: "has",
      header: "Has it",
      priority: 2,
      minWidth: 70,
      nowrap: true,
      sort: (e) => (isMember(e) ? "a" : "b"),
      cell: (e) => isMember(e) && <span className="rounded bg-accent-soft px-1.5 text-[11px] text-accent">has it</span>,
    },
  ];

  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <Toolbar label="Find and filter" className="gap-2">
        <SearchField value={query} onChange={setQuery} placeholder="Name or entity id" label="Search entities" />
        {!fixedArea && (
          <div className="w-48">
            <select
              aria-label="Area"
              className={inputClass}
              value={anyArea ? "*" : (area ?? "")}
              onChange={(e) => (e.target.value === "*" ? setAnyArea(true) : (setAnyArea(false), setArea(e.target.value || null)))}
            >
              <option value="*">Any area</option>
              <option value="">No area</option>
              {h.floors
                .flatMap((f) => f.areaIds)
                .concat(h.looseAreaIds)
                .map((id) => (
                  <option key={id} value={id}>
                    {h.areas[id].name}
                  </option>
                ))}
            </select>
          </div>
        )}
        <select aria-label="Role" className={`${inputClass} w-40!`} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Any role</option>
          {ROLE_ORDER.map((r) => (
            <option key={r.role} value={r.role}>
              {r.label}
            </option>
          ))}
        </select>
        <select aria-label="Domain" className={`${inputClass} w-36!`} value={domain} onChange={(e) => setDomain(e.target.value)}>
          <option value="">Any domain</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <Toolbar label="Show" className="gap-x-1">
          {(
            [
              ["not", "Not added yet"],
              ["in", "Already added"],
              ["all", "Show all"],
            ] as [Show, string][]
          ).map(([v, l]) => (
            <Chip key={v} pressed={show === v} onClick={() => setShow(v)}>
              {l}
            </Chip>
          ))}
        </Toolbar>
      </Toolbar>
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
      <DataTable
        id="assign"
        label={title}
        rows={shown}
        rowKey={(e) => e.entityId}
        columns={columns}
        sort={sort}
        onSort={toggleSort}
        maxHeight="28rem"
        empty={<EmptyState>Nothing matches these filters.</EmptyState>}
      />
    </section>
  );
}
