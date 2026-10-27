import { ChevronLeft, Layers, Search } from "lucide-react";
import { useMemo, useState, type DragEvent, type ReactNode } from "react";

import { listKeyFor } from "../../shared/groups.ts";
import type { CategoryScope, EntityItem, FloorNode, Hierarchy } from "../../shared/types.ts";
import { AreaEditor, DeviceEditor, EntityEditor, FloorEditor, NewItemForm } from "./editors.tsx";
import { GroupedList } from "./groups.tsx";
import { CategoryDetail, LabelDetail, NewForm, categoryUsage, labelUsage } from "./labels.tsx";
import { OrganizeTable } from "./lists.tsx";
import { AreaCodeField } from "./naming.tsx";
import { ROLE_LABEL } from "./spaces.tsx";
import { useTaxis, type OrganizeType, type Route } from "./state.tsx";
import { useStoredValue } from "./storage.ts";
import { useStoredChoice } from "./storage.ts";
import { AreaMultiSelect, FilterChips, Pagination, RecordsSplit, ResizeHandle, useAreaFilter, usePagination, useWidths } from "./records.tsx";
import { SortHeader, useSort, type SortValue } from "./table.tsx";
import { Button, EditedDot, Panel, labelColor } from "./ui.tsx";

// Organize: what we organize on the left, its items in the middle, the
// selected item's properties on the right. Every edit still goes through the
// change list.


const categoryScope = (t: OrganizeType): CategoryScope | null => (t.startsWith("category-") ? (t.slice(9) as CategoryScope) : null);

const TYPE_NAME: Record<OrganizeType, string> = {
  spaces: "Floors and areas",
  labels: "Labels",
  "category-automation": "Automation categories",
  "category-script": "Script categories",
  "category-scene": "Scene categories",
  "category-helpers": "Helper categories",
  zones: "Zones",
  devices: "Devices",
  entities: "Entities",
  helpers: "Helpers",
};
const TYPE_ORDER = Object.keys(TYPE_NAME) as OrganizeType[];

const zonesOf = (h: Hierarchy) => Object.values(h.entities).filter((e) => e.domain === "zone");

function typeCount(h: Hierarchy, t: OrganizeType): number {
  switch (t) {
    case "spaces":
      return h.floors.length + Object.keys(h.areas).length;
    case "labels":
      return Object.keys(h.labels).length;
    case "zones":
      return zonesOf(h).length;
    case "devices":
      return Object.keys(h.devices).length;
    case "entities":
      return Object.keys(h.entities).length;
    case "helpers":
      return Object.values(h.entities).filter(e => e.categoryScope === "helpers").length;
    default:
      return h.categories[categoryScope(t)!].length;
  }
}

type Step = "types" | "items" | "props";

// Devices and Entities can be shown as a table that fills the page (devices with
// their entities under them, filters, grouping, sorting and edits in place), or as
// the list with the selected item's properties beside it. Each remembers which.
const VIEWS = ["table", "records"] as const;
type View = (typeof VIEWS)[number];

function ViewSwitch({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div role="group" aria-label="View" className="flex w-fit gap-1 text-xs">
      {VIEWS.map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          className={`rounded-md border px-2 py-1 ${view === v ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}
        >
          {v === "table" ? "Table" : "Records"}
        </button>
      ))}
    </div>
  );
}

export function OrganizePage({ h, type, id, go }: { h: Hierarchy; type: OrganizeType; id: string | null; go: (r: Route) => void }) {
  // On narrow screens only one pane shows; wide screens show all three.
  const [step, setStep] = useState<Step>(id ? "props" : "items");
  const pick = (t: OrganizeType) => {
    go({ page: "organize", type: t, id: null });
    setStep("items");
  };
  const select = (next: string | null) => {
    go({ page: "organize", type, id: next });
    setStep(next ? "props" : "items");
  };
  const show = (s: Step) => (step === s ? "flex" : "hidden");
  const [devicesView, setDevicesView] = useStoredChoice<View>("taxis:organize-view:devices", VIEWS, "table");
  const [entitiesView, setEntitiesView] = useStoredChoice<View>("taxis:organize-view:entities", VIEWS, "records");
  const tabular = type === "devices" || type === "entities";
  // A link to one item (an old bookmark, a link from Health) opens the list with it selected.
  const view: View = tabular && id === null ? (type === "devices" ? devicesView : entitiesView) : "records";
  const choose = (v: View) => {
    (type === "devices" ? setDevicesView : setEntitiesView)(v);
    // The table shows no one item: leave the one selected.
    if (v === "table" && id !== null) select(null);
  };
  // The table's way to the list: that item, selected.
  const showRecord = (item: string) => {
    (type === "devices" ? setDevicesView : setEntitiesView)("records");
    select(item);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav
        aria-label="What to organize"
        className={`${show("types")} min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto border-b border-line bg-surface p-2 md:flex md:w-44 md:flex-none lg:w-56 md:border-r md:border-b-0`}
      >
        {TYPE_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            aria-current={t === type ? "true" : undefined}
            onClick={() => pick(t)}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${t === type ? "bg-accent-soft font-medium text-accent" : "hover:bg-sunken"}`}
          >
            <span className="min-w-0 flex-1 truncate">{TYPE_NAME[t]}</span>
            <span className="text-xs tabular-nums text-muted">{typeCount(h, t).toLocaleString()}</span>
          </button>
        ))}
      </nav>
      {view === "table" && (type === "devices" || type === "entities") ? (
        <section aria-label={TYPE_NAME[type]} className={`${step === "types" ? "hidden" : "flex"} min-h-0 min-w-0 flex-1 flex-col md:flex`}>
          <BackBar label="Types" onBack={() => setStep("types")} />
          <div className="border-b border-line px-4 py-2">
            <ViewSwitch view={view} onChange={choose} />
          </div>
          <OrganizeTable key={type} h={h} section={type} onRecord={showRecord} />
        </section>
      ) : (
        <RecordsSplit
          listVisible={step === "items"} detailsVisible={step === "props"}
          list={<>
            <BackBar label="Types" onBack={() => setStep("types")} />
            {tabular && <div className="border-b border-line px-2.5 py-2"><ViewSwitch view={view} onChange={choose} /></div>}
            <ItemsPane key={type} h={h} type={type} id={id} select={select} />
          </>}
          details={<>
            <BackBar label={TYPE_NAME[type]} onBack={() => select(null)} />
            <div className="p-4"><Properties h={h} type={type} id={id} go={go} clear={() => select(null)} /></div>
          </>}
        />
      )}
    </div>
  );
}

function BackBar({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="border-b border-line px-2 py-1.5 md:hidden">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[13px] text-accent">
        <ChevronLeft className="size-4" aria-hidden /> {label}
      </button>
    </div>
  );
}

function SearchInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-line bg-bg px-2 py-1.5">
      <Search className="size-4 text-muted" aria-hidden />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} aria-label={label} className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted" />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Middle pane

type Col = { key: string; label: string };
type Row = { areaId?: string | null; id: string; edited: string; search: string; v: Record<string, SortValue>; cells: Record<string, ReactNode> };

function rowsFor(h: Hierarchy, type: OrganizeType): { cols: Col[]; rows: Row[] } {
  const areaName = (aid: string | null) => (aid ? h.areas[aid]?.name ?? null : null);
  const dash = (v: ReactNode) => v || "–";
  switch (type) {
    case "labels": {
      const use = labelUsage(h);
      return {
        cols: [
          { key: "name", label: "Name" },
          { key: "color", label: "Color" },
          { key: "used", label: "Used on" },
        ],
        rows: Object.values(h.labels).map((l) => ({
          id: l.id,
          edited: `label:${l.id}`,
          search: l.name,
          v: { name: l.name, color: l.color, used: use.get(l.id)?.total ?? 0 },
          cells: {
            name: l.name,
            color: (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-full" style={{ background: labelColor(l.color) ?? "var(--off)" }} />
                {l.color ?? "–"}
              </span>
            ),
            used: use.get(l.id)?.total ?? 0,
          },
        })),
      };
    }
    case "zones":
      return {
        cols: [
          { key: "name", label: "Name" },
          { key: "id", label: "Entity id" },
          { key: "people", label: "People" },
        ],
        rows: zonesOf(h).map((z) => ({
          id: z.entityId,
          edited: `entity:${z.entityId}`,
          search: `${z.name} ${z.entityId}`,
          v: { name: z.name, id: z.entityId, people: Number(z.state) || 0 },
          cells: { name: z.name, id: <code className="font-mono text-[11px]">{z.entityId}</code>, people: dash(z.state) },
        })),
      };
    case "devices":
      return {
        cols: [
          { key: "name", label: "Name" },
          { key: "model", label: "Model" },
          { key: "area", label: "Area" },
        ],
        rows: Object.values(h.devices).map((d) => {
          const model = [d.manufacturer, d.model].filter(Boolean).join(" · ");
          return {
            areaId: d.areaId,
            id: d.id,
            edited: `device:${d.id}`,
            search: `${d.name} ${model}`,
            v: { name: d.name, model, area: areaName(d.areaId) },
            cells: { name: d.name, model: dash(model), area: dash(areaName(d.areaId)) },
          };
        }),
      };
    case "helpers":
    case "entities":
      return {
        cols: [
          { key: "name", label: "Name" },
          { key: "id", label: "Entity id" },
          { key: "area", label: "Area" },
          { key: "kind", label: "Kind" },
        ],
        rows: Object.values(h.entities).filter(e => type !== "helpers" || e.categoryScope === "helpers").map((e: EntityItem) => ({
          areaId: e.areaId,
          id: e.entityId,
          edited: `entity:${e.entityId}`,
          search: `${e.name} ${e.entityId}`,
          v: { name: e.name, id: e.entityId, area: areaName(e.areaId), kind: ROLE_LABEL[e.role] },
          cells: { name: e.name, id: <code className="font-mono text-[11px]">{e.entityId}</code>, area: dash(areaName(e.areaId)), kind: ROLE_LABEL[e.role] },
        })),
      };
    default: {
      const scope = categoryScope(type)!;
      const use = categoryUsage(h);
      return {
        cols: [
          { key: "name", label: "Name" },
          { key: "items", label: "Items" },
        ],
        rows: h.categories[scope].map((c) => ({
          id: c.id,
          edited: `category:${c.id}`,
          search: c.name,
          v: { name: c.name, items: use.get(`${scope}:${c.id}`)?.length ?? 0 },
          cells: { name: c.name, items: use.get(`${scope}:${c.id}`)?.length ?? 0 },
        })),
      };
    }
  }
}


function ItemsPane({ h, type, id, select }: { h: Hierarchy; type: OrganizeType; id: string | null; select: (id: string | null) => void }) {
  const [query, setQuery] = useStoredValue(`taxis:records:search:${type}`, "", (v): v is string => typeof v === "string");
  const [areas, setAreas] = useAreaFilter();
  const [showDisabled, setShowDisabled] = useStoredValue("taxis:filters:disabled-devices", false, (v): v is boolean => typeof v === "boolean");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-line p-2.5">
        <h1 className="text-sm font-semibold">{TYPE_NAME[type]}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1"><SearchInput value={query} onChange={setQuery} label={`Find in ${TYPE_NAME[type].toLowerCase()}`} /></div>
          {(type === "devices" || type === "entities" || type === "helpers") && <AreaMultiSelect areas={Object.values(h.areas)} selected={areas} onChange={setAreas} />}
        </div>
        {type === "devices" && <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={showDisabled} onChange={e => setShowDisabled(e.target.checked)} />Show disabled devices</label>}
      </div>
      {(type === "devices" || type === "entities" || type === "helpers") && <div className="px-2 py-1"><FilterChips items={[
        ...[...areas].map(a => ({ label: h.areas[a]?.name ?? (a || "No area"), remove: () => setAreas(new Set([...areas].filter(id => id !== a))) })),
        ...(query ? [{ label: query, remove: () => setQuery("") }] : []),
      ]} clear={() => { setAreas(new Set()); setQuery(""); }} /></div>}
      {type === "spaces" ? (
        <SpacesTree h={h} id={id} select={select} query={query} />
      ) : listKeyFor(type) ? (
        <GroupedItems h={h} type={type} id={id} select={select} query={query} />
      ) : (
        <ItemsTable h={h} type={type} id={id} select={select} query={query} areas={areas} showDisabled={showDisabled} />
      )}
      <NewFooter type={type} />
    </div>
  );
}

// Labels and categories are made here; floors and areas have their own toolbar.
function NewFooter({ type }: { type: OrganizeType }) {
  const scope = categoryScope(type);
  if (type !== "labels" && !scope) return null;
  return <div className="border-t border-line p-2.5">{scope ? <NewForm kind="category" scope={scope} onCreated={() => {}} /> : <NewForm kind="label" onCreated={() => {}} />}</div>;
}

// Labels and categories: sections by group (groups are a Taxis-only view).
function GroupedItems({ h, type, id, select, query }: { h: Hierarchy; type: OrganizeType; id: string | null; select: (id: string | null) => void; query: string }) {
  const { rows } = useMemo(() => rowsFor(h, type), [h, type]);
  const isLabel = type === "labels";
  const items = useMemo(
    () => rows.map((r) => ({ id: r.id, name: String(r.v.name), edited: r.edited, search: r.search, extra: isLabel ? r.cells.color : `${r.cells.items} item${r.cells.items === 1 ? "" : "s"}` })),
    [rows, isLabel],
  );
  return <GroupedList list={listKeyFor(type)!} noun={isLabel ? "label" : "category"} rows={items} id={id} select={select} query={query} />;
}

function ItemsTable({ h, type, id, select, query, areas, showDisabled }: { h: Hierarchy; type: OrganizeType; id: string | null; select: (id: string | null) => void; query: string; areas: ReadonlySet<string>; showDisabled: boolean }) {
  const { edited } = useTaxis();
  const { cols, rows: all } = useMemo(() => rowsFor(h, type), [h, type]);
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => all.filter(r => (!q || r.search.toLowerCase().includes(q)) && ((type !== "devices" && type !== "entities" && type !== "helpers") || !areas.size || areas.has(r.areaId ?? "")) && (type !== "devices" || showDisabled || !h.devices[r.id]?.disabled)), [all, q, areas, type, showDisabled, h]);
  const { widths, setWidth } = useWidths(`taxis:records:columns:${type}`, Object.fromEntries(cols.map(c => [c.key, c.key === "name" ? 180 : c.key === "area" ? 130 : 200])));
  const getters = Object.fromEntries(cols.map((c) => [c.key, (r: Row) => r.v[c.key]]));
  const { rows: sorted, sort, toggle } = useSort(rows, getters, { key: "name", dir: "asc" });
  const paging = usePagination(sorted.length, JSON.stringify([q, [...areas], sort, type]));
  const shown = sorted.slice(paging.start, paging.end);
  const numeric = (k: string) => k === "used" || k === "items" || k === "people";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {rows.length === 0 ? (
        <p className="p-3 text-[13px] text-muted">{all.length === 0 ? "Nothing here yet." : "Nothing matches."}</p>
      ) : (
        <table className="records-table table-fixed text-[13px]" style={{ width: Math.max(1, Object.values(widths).reduce((a, b) => a + b, 0)) }}>
          <colgroup>{cols.map(c => <col key={c.key} style={{ width: widths[c.key] }} />)}</colgroup>
          <thead className="sticky top-0 bg-sunken text-left text-xs text-muted">
            <tr>
              {cols.map((c) => (
                <SortHeader key={c.key} label={c.label} k={c.key} sort={sort} onToggle={toggle} className="px-3 py-1.5" resize={<ResizeHandle label={`Resize ${c.label} column`} value={widths[c.key]} onChange={width => setWidth(c.key, width)} />} />
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.id}
                tabIndex={0}
                aria-selected={r.id === id}
                onClick={() => select(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(r.id);
                  }
                }}
                className={`cursor-pointer border-t border-line ${r.id === id ? "bg-accent-soft text-accent" : "hover:bg-sunken"}`}
              >
                {cols.map((c, i) => (
                  <td key={c.key} className={`px-3 py-1.5 ${i === 0 ? "" : "text-muted"} ${numeric(c.key) ? "tabular-nums" : ""}`}>
                    {i === 0 ? (
                      <span className="flex items-center gap-1.5">
                        {r.cells[c.key]}
                        {edited.has(r.edited) && <EditedDot />}
                      </span>
                    ) : (
                      r.cells[c.key]
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination {...paging} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floors and areas: a tree where areas can be moved between floors.

// Not a slug Home Assistant can produce, so a floor called "None" stays a floor.
const NO_FLOOR = "(no floor)";

function SpacesTree({ h, id, select, query }: { h: Hierarchy; id: string | null; select: (id: string | null) => void; query: string }) {
  const { edited, propose, busy } = useTaxis();
  const [adding, setAdding] = useState<{ kind: "area" | "floor"; floorId: string | null } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const q = query.trim().toLowerCase();

  const floors = useMemo(() => [...h.floors].sort((a, b) => (a.level ?? Infinity) - (b.level ?? Infinity) || a.name.localeCompare(b.name)), [h.floors]);
  const groups = useMemo(() => {
    const areaMatch = (aid: string) => !q || h.areas[aid]?.name.toLowerCase().includes(q);
    const byName = (ids: string[]) => ids.filter((a) => h.areas[a]).sort((x, y) => h.areas[x].name.localeCompare(h.areas[y].name));
    const out: { key: string; floor: FloorNode | null; all: number; areas: string[]; floorHit: boolean }[] = floors.map((f) => {
      // A floor whose own name matches shows all its areas.
      const floorHit = q !== "" && f.name.toLowerCase().includes(q);
      return { key: f.id, floor: f, all: f.areaIds.length, floorHit, areas: byName(f.areaIds).filter((a) => floorHit || areaMatch(a)) };
    });
    out.push({ key: NO_FLOOR, floor: null, all: h.looseAreaIds.length, floorHit: false, areas: byName(h.looseAreaIds).filter(areaMatch) });
    return out.filter((g) => !q || g.areas.length > 0 || g.floorHit);
  }, [h, floors, q]);

  const move = (areaId: string, key: string) => {
    const area = h.areas[areaId];
    const floorId = key === NO_FLOOR ? null : key;
    if (!area || busy || (area.floorId ?? null) === floorId) return;
    void propose({ kind: "area", op: "update", targetId: areaId, fields: { floor_id: floorId } });
  };

  // A floor is a drop target only for an area that isn't already on it.
  const dropProps = (key: string) => {
    const valid = dragging !== null && !busy && (h.areas[dragging]?.floorId ?? NO_FLOOR) !== key;
    return {
      onDragOver: (e: DragEvent) => {
        if (!valid) return;
        e.preventDefault();
        setOver(key);
      },
      onDragLeave: () => setOver((o) => (o === key ? null : o)),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setOver(null);
        const aid = e.dataTransfer.getData("text/plain") || dragging;
        setDragging(null);
        if (aid && valid) move(aid, key);
      },
    };
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-2.5">
        <Button onClick={() => setAdding({ kind: "floor", floorId: null })}>New floor</Button>
        <Button onClick={() => setAdding({ kind: "area", floorId: null })}>New area</Button>
      </div>
      {adding && (
        <div className="flex items-end gap-2 border-b border-line bg-sunken p-2.5">
          <NewItemForm key={`${adding.kind}:${adding.floorId}`} kind={adding.kind} floorId={adding.floorId} onDone={() => setAdding(null)} />
          <Button tone="ghost" onClick={() => setAdding(null)}>
            Cancel
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.length === 0 && <p className="p-1 text-[13px] text-muted">{q ? "Nothing matches." : "No floors or areas yet."}</p>}
        {groups.map((g) => {
          const floorSel = g.floor ? `floor:${g.floor.id}` : null;
          const active = floorSel !== null && floorSel === id;
          return (
            <div key={g.key} className="mb-2">
              <div {...dropProps(g.key)} className={`flex items-center gap-1 rounded-md ${over === g.key ? "bg-accent-soft ring-2 ring-accent" : active ? "bg-accent-soft" : ""}`}>
                {g.floor ? (
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => select(floorSel)}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-semibold ${active ? "text-accent" : "hover:bg-sunken"}`}
                  >
                    <Layers className="size-3.5 shrink-0 text-muted" aria-hidden />
                    <span className="truncate">{g.floor.name}</span>
                    {edited.has(`floor:${g.floor.id}`) && <EditedDot />}
                    <span className="ml-auto whitespace-nowrap text-xs font-normal tabular-nums text-muted">{g.all} area{g.all === 1 ? "" : "s"}</span>
                  </button>
                ) : (
                  <span className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-[13px] font-semibold text-muted">
                    <span className="truncate">No floor</span>
                    <span className="ml-auto whitespace-nowrap text-xs font-normal tabular-nums">{g.all} area{g.all === 1 ? "" : "s"}</span>
                  </span>
                )}
                {g.floor && (
                  <Button tone="ghost" className="!px-1.5 !py-0.5 text-xs" onClick={() => setAdding({ kind: "area", floorId: g.floor!.id })} aria-label={`New area on ${g.floor.name}`}>
                    + area
                  </Button>
                )}
              </div>
              <ul className="ml-3 border-l border-line pl-1">
                {g.areas.length === 0 && <li className="px-2 py-1 text-xs text-muted">No areas.</li>}
                {g.areas.map((aid) => {
                  const a = h.areas[aid];
                  const sel = `area:${aid}`;
                  return (
                    <li key={aid} className={`flex items-center gap-1 rounded-md ${sel === id ? "bg-accent-soft" : "hover:bg-sunken"} ${dragging === aid ? "opacity-50" : ""}`}>
                      <button
                        type="button"
                        draggable={!busy}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", aid);
                          e.dataTransfer.effectAllowed = "move";
                          setDragging(aid);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        aria-current={sel === id ? "true" : undefined}
                        onClick={() => select(sel)}
                        className={`flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[13px] ${sel === id ? "font-medium text-accent" : ""} ${busy ? "" : "cursor-grab"}`}
                      >
                        <span className="truncate">{a.name}</span>
                        {edited.has(`area:${aid}`) && <EditedDot />}
                        <span className="ml-auto whitespace-nowrap text-xs font-normal tabular-nums text-muted">
                          {a.deviceIds.length} dev · {a.entityIds.length} ent
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        <p className="px-1 pb-1 text-[11px] text-muted">Drag an area onto a floor to move it.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right pane

function Properties({ h, type, id, go, clear }: { h: Hierarchy; type: OrganizeType; id: string | null; go: (r: Route) => void; clear: () => void }) {
  if (!id) return <p className="text-[13px] text-muted">Pick an item to see its properties here.</p>;
  const missing = <p className="text-[13px] text-muted">That item is gone. Pick another.</p>;
  switch (type) {
    case "spaces": {
      const [kind, ...rest] = id.split(":");
      const rid = rest.join(":");
      if (kind === "floor") {
        const f = h.floors.find((x) => x.id === rid);
        return f ? <FloorEditor key={f.id} floor={f} onClose={clear} onDeleted={clear} /> : missing;
      }
      const a = h.areas[rid];
      return a ? (
        <div className="flex flex-col gap-4">
          <AreaCodeField h={h} area={a} go={go} />
          <AreaEditor key={a.id} h={h} area={a} onClose={clear} onDeleted={clear} />
        </div>
      ) : missing;
    }
    case "labels": {
      const l = h.labels[id];
      return l ? <LabelDetail key={l.id} h={h} label={l} usage={labelUsage(h).get(l.id)} onDeleted={clear} /> : missing;
    }
    case "devices": {
      const d = h.devices[id];
      return d ? <DeviceEditor key={d.id} h={h} device={d} onClose={clear} /> : missing;
    }
    case "helpers":
    case "entities": {
      const e = h.entities[id];
      return e ? <EntityEditor key={e.entityId} h={h} entity={e} onClose={clear} /> : missing;
    }
    case "zones": {
      const z = h.entities[id];
      return z ? <ZoneView key={z.entityId} zone={z} onClose={clear} /> : missing;
    }
    default: {
      const scope = categoryScope(type)!;
      const c = h.categories[scope].find((x) => x.id === id);
      return c ? <CategoryDetail key={c.id} h={h} category={c} members={categoryUsage(h).get(`${scope}:${c.id}`) ?? []} onDeleted={clear} /> : missing;
    }
  }
}

// Taxis can't change zones yet, so this only shows them.
function ZoneView({ zone, onClose }: { zone: EntityItem; onClose: () => void }) {
  const rows: [string, ReactNode][] = [
    ["Name", zone.name],
    ["Entity id", <code key="id" className="font-mono text-xs">{zone.entityId}</code>],
    ["People", zone.state ?? "–"],
  ];
  if (zone.icon) rows.push(["Icon", zone.icon]);
  return (
    <Panel title={zone.name} onClose={onClose}>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted">Zones are edited in Home Assistant's settings for now.</p>
    </Panel>
  );
}
