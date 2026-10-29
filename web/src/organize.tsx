import {
  ChevronLeft,
  Clapperboard,
  Cpu,
  FileCode,
  FileCode2,
  FolderCog,
  Layers,
  List,
  ListChecks,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
  Tags,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";

import { listKeyFor } from "../../shared/groups.ts";
import { entityMatchesSection, isOrganizeEntityType, organizeEntityType } from "../../shared/organize.ts";
import { sortRows, type SortValue } from "../../shared/sort.ts";
import type { CategoryScope, EntityItem, FloorNode, Hierarchy } from "../../shared/types.ts";
import { AreaEditor, DeviceEditor, EntityEditor, FloorEditor, NewItemForm } from "./editors.tsx";
import { GroupedList } from "./groups.tsx";
import { CategoryDetail, LabelDetail, NewForm, categoryUsage, labelUsage } from "./labels.tsx";
import { OrganizeTable } from "./lists.tsx";
import { BlueprintRecords } from "./blueprints.tsx";
import { AreaCodeField } from "./naming.tsx";
import { ROLE_LABEL } from "./spaces.tsx";
import { useTaxis, type OrganizeType, type Route } from "./state.tsx";
import { useStoredValue } from "./storage.ts";
import { useStoredChoice } from "./storage.ts";
import { AreaMultiSelect, FilterChips, Pagination, RecordsSplit, useAreaFilter, usePagination } from "./records.tsx";
import { DataTable, useSortState, type Column } from "./data-table.tsx";
import { Button, Chip, EditedDot, EmptyState, PageHeader, Panel, SearchField, Toolbar, labelColor } from "./ui.tsx";

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
  automations: "Automations",
  blueprints: "Blueprints",
  devices: "Devices",
  entities: "Entities",
  helpers: "Helpers",
};
const TYPE_ORDER = Object.keys(TYPE_NAME) as OrganizeType[];
const TYPE_ICON: Record<OrganizeType, LucideIcon> = {
  spaces: Layers,
  labels: Tags,
  "category-automation": ListChecks,
  "category-script": FileCode2,
  "category-scene": Clapperboard,
  "category-helpers": FolderCog,
  zones: MapPin,
  automations: Workflow,
  blueprints: FileCode,
  devices: Cpu,
  entities: List,
  helpers: SlidersHorizontal,
};

const zonesOf = (h: Hierarchy) => Object.values(h.entities).filter((e) => e.domain === "zone");

function typeCount(h: Hierarchy, t: OrganizeType): number | null {
  switch (t) {
    case "spaces":
      return h.floors.length + Object.keys(h.areas).length;
    case "labels":
      return Object.keys(h.labels).length;
    case "zones":
      return zonesOf(h).length;
    case "devices":
      return Object.keys(h.devices).length;
    case "automations":
    case "entities":
    case "helpers":
      return Object.values(h.entities).filter((e) => entityMatchesSection(e, t)).length;
    case "blueprints":
      return null;
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
    <Toolbar label="View" className="w-fit gap-x-1">
      {VIEWS.map((v) => (
        <Chip key={v} pressed={view === v} onClick={() => onChange(v)}>
          {v === "table" ? "Table" : "Records"}
        </Chip>
      ))}
    </Toolbar>
  );
}

export function OrganizePage({ h, type, id, go }: { h: Hierarchy; type: OrganizeType; id: string | null; go: (r: Route) => void }) {
  // Existing entity links still reach their editor after the lists are split.
  useEffect(() => {
    const entity = id ? h.entities[id] : undefined;
    if (entity && isOrganizeEntityType(type) && organizeEntityType(entity) !== type) go({ page: "organize", type: organizeEntityType(entity), id });
  }, [h, type, id, go]);
  const [blueprintCount, setBlueprintCount] = useState<number | null>(null);
  const [blueprintsPartial, setBlueprintsPartial] = useState(false);
  const updateBlueprintCount = useCallback((count: number | null, partial = false) => {
    setBlueprintCount(count);
    setBlueprintsPartial(partial);
  }, []);
  const [collapsed, setCollapsed] = useStoredValue("taxis:organize:sidebar-collapsed", false, (value): value is boolean => typeof value === "boolean");
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
  const [automationsView, setAutomationsView] = useStoredChoice<View>("taxis:organize-view:automations", VIEWS, "records");
  const [helpersView, setHelpersView] = useStoredChoice<View>("taxis:organize-view:helpers", VIEWS, "records");
  const tabular = type === "devices" || isOrganizeEntityType(type);
  const storedView = type === "devices" ? devicesView : type === "automations" ? automationsView : type === "helpers" ? helpersView : entitiesView;
  const setView = type === "devices" ? setDevicesView : type === "automations" ? setAutomationsView : type === "helpers" ? setHelpersView : setEntitiesView;
  // A link to one item (an old bookmark, a link from Health) opens the list with it selected.
  const view: View = tabular && id === null ? storedView : "records";
  const choose = (v: View) => {
    setView(v);
    // The table shows no one item: leave the one selected.
    if (v === "table" && id !== null) select(null);
  };
  // The table's way to the list: that item, selected.
  const showRecord = (item: string | null) => {
    setView("records");
    select(item);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav
        id="organize-sidebar"
        aria-label="What to organize"
        onClick={(event) => {
          if (event.target instanceof Element && !event.target.closest("button,a,input,select")) setCollapsed(!collapsed);
        }}
        className={`${show("types")} min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto border-b border-line bg-surface p-2 md:flex ${collapsed ? "md:w-24" : "md:w-44 lg:w-56"} md:flex-none md:border-r md:border-b-0`}
      >
        <div className={`flex shrink-0 ${collapsed ? "justify-center" : "justify-end"}`}>
          <button
            type="button"
            aria-label={collapsed ? "Expand Organize sidebar" : "Collapse Organize sidebar"}
            aria-expanded={!collapsed}
            aria-controls="organize-sidebar"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed(!collapsed)}
            className="rounded p-1.5 text-muted hover:bg-sunken hover:text-accent"
          >
            {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
          </button>
        </div>
        {TYPE_ORDER.map((t) => {
          const Icon = TYPE_ICON[t];
          return (
            <button
              key={t}
              type="button"
              aria-current={t === type ? "true" : undefined}
              onClick={() => pick(t)}
              className={`relative flex shrink-0 items-center rounded-md ${collapsed ? "min-h-14 flex-col justify-center gap-1 px-1 py-2 text-center text-[10px] leading-tight" : "gap-2 px-2 py-1.5 text-left text-[13px]"} ${t === type ? "bg-accent-soft font-medium text-accent" : "hover:bg-sunken"}`}
            >
              {collapsed && <Icon className="size-5 shrink-0" aria-hidden />}
              <span className={collapsed ? "w-full min-w-0 break-words" : "min-w-0 flex-1 truncate"}>{TYPE_NAME[t]}</span>
              <span
                className={`${collapsed ? "absolute right-1 top-0.5 text-[9px]" : "text-xs"} tabular-nums text-muted`}
                title={
                  t === "blueprints" && blueprintCount === null
                    ? "Open Blueprints to read installed blueprints"
                    : t === "blueprints" && blueprintsPartial
                      ? "Some blueprint domains could not be read"
                      : undefined
                }
              >
                {t === "blueprints"
                  ? blueprintCount === null
                    ? "–"
                    : `${blueprintCount.toLocaleString()}${blueprintsPartial ? "+" : ""}`
                  : typeCount(h, t)?.toLocaleString()}
              </span>
            </button>
          );
        })}
      </nav>
      {type === "blueprints" ? (
        <section aria-label="Blueprints" className={`${step === "types" ? "hidden" : "flex"} min-h-0 min-w-0 flex-1 flex-col md:flex`}>
          <BackBar label="Types" onBack={() => setStep("types")} />
          <BlueprintRecords onCount={updateBlueprintCount} refreshKey={h.fetchedAt} />
        </section>
      ) : view === "table" && tabular ? (
        <section aria-label={TYPE_NAME[type]} className={`${step === "types" ? "hidden" : "flex"} min-h-0 min-w-0 flex-1 flex-col md:flex`}>
          <BackBar label="Types" onBack={() => setStep("types")} />
          <div className="border-b border-line px-4 py-2">
            <ViewSwitch view={view} onChange={choose} />
          </div>
          {type === "devices" || type === "entities" ? (
            <OrganizeTable key={type} h={h} section={type} onRecord={showRecord} />
          ) : (
            <ItemsPane key={type} h={h} type={type} id={null} select={showRecord} />
          )}
        </section>
      ) : (
        <RecordsSplit
          listVisible={step === "items"}
          detailsVisible={step === "props"}
          list={
            <>
              <BackBar label="Types" onBack={() => setStep("types")} />
              {tabular && (
                <div className="border-b border-line px-2.5 py-2">
                  <ViewSwitch view={view} onChange={choose} />
                </div>
              )}
              <ItemsPane key={type} h={h} type={type} id={id} select={select} />
            </>
          }
          details={
            <>
              <BackBar label={TYPE_NAME[type]} onBack={() => select(null)} />
              <div className="p-4">
                <Properties h={h} type={type} id={id} go={go} clear={() => select(null)} />
              </div>
            </>
          }
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

// ---------------------------------------------------------------------------
// Middle pane

type Col = { key: string; label: string };
type Row = { areaId?: string | null; id: string; edited: string; search: string; v: Record<string, SortValue>; cells: Record<string, ReactNode> };

function rowsFor(h: Hierarchy, type: OrganizeType): { cols: Col[]; rows: Row[] } {
  const areaName = (aid: string | null) => (aid ? (h.areas[aid]?.name ?? null) : null);
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
    case "automations":
    case "helpers":
    case "entities":
      return {
        cols: [
          { key: "name", label: "Name" },
          { key: "id", label: "Entity id" },
          { key: "area", label: "Area" },
          { key: "kind", label: "Kind" },
        ],
        rows: Object.values(h.entities)
          .filter((e) => entityMatchesSection(e, type))
          .map((e: EntityItem) => ({
            areaId: e.areaId,
            id: e.entityId,
            edited: `entity:${e.entityId}`,
            search: `${e.name} ${e.entityId}`,
            v: { name: e.name, id: e.entityId, area: areaName(e.areaId), kind: ROLE_LABEL[e.role] },
            cells: { name: e.name, id: <code className="font-mono text-[11px]">{e.entityId}</code>, area: dash(areaName(e.areaId)), kind: ROLE_LABEL[e.role] },
          })),
      };
    case "blueprints":
      return { cols: [], rows: [] };
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
        <PageHeader title={TYPE_NAME[type]} />
        <Toolbar label="Find and filter">
          <SearchField value={query} onChange={setQuery} placeholder={`Find in ${TYPE_NAME[type].toLowerCase()}`} />
          {(type === "devices" || isOrganizeEntityType(type)) && <AreaMultiSelect areas={Object.values(h.areas)} selected={areas} onChange={setAreas} />}
        </Toolbar>
        {type === "devices" && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={showDisabled} onChange={(e) => setShowDisabled(e.target.checked)} />
            Show disabled devices
          </label>
        )}
      </div>
      {(type === "devices" || isOrganizeEntityType(type)) && (
        <div className="px-2 py-1">
          <FilterChips
            items={[
              ...[...areas].map((a) => ({ label: h.areas[a]?.name ?? (a || "No area"), remove: () => setAreas(new Set([...areas].filter((id) => id !== a))) })),
              ...(query ? [{ label: query, remove: () => setQuery("") }] : []),
            ]}
            clear={() => {
              setAreas(new Set());
              setQuery("");
            }}
          />
        </div>
      )}
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
  return (
    <div className="border-t border-line p-2.5">
      {scope ? <NewForm kind="category" scope={scope} onCreated={() => {}} /> : <NewForm kind="label" onCreated={() => {}} />}
    </div>
  );
}

// Labels and categories: sections by group (groups are a Taxis-only view).
function GroupedItems({
  h,
  type,
  id,
  select,
  query,
}: {
  h: Hierarchy;
  type: OrganizeType;
  id: string | null;
  select: (id: string | null) => void;
  query: string;
}) {
  const { rows } = useMemo(() => rowsFor(h, type), [h, type]);
  const isLabel = type === "labels";
  const items = useMemo(
    () =>
      rows.map((r) => ({
        id: r.id,
        name: String(r.v.name),
        edited: r.edited,
        search: r.search,
        extra: isLabel ? r.cells.color : `${r.cells.items} item${r.cells.items === 1 ? "" : "s"}`,
      })),
    [rows, isLabel],
  );
  return <GroupedList list={listKeyFor(type)!} noun={isLabel ? "label" : "category"} rows={items} id={id} select={select} query={query} />;
}

// How each column of the lists behaves: the name is always there and stays in
// view; ids are cut short with the whole in a tooltip; the rest give way first.
const COLUMN_RULES: Record<string, Partial<Column<Row>>> = {
  name: { priority: 1, minWidth: 150, maxWidth: 320, sticky: true },
  id: { priority: 2, minWidth: 130, maxWidth: 220, truncate: true },
  model: { priority: 2, minWidth: 130, maxWidth: 220, truncate: true },
  area: { priority: 2, minWidth: 100 },
  kind: { priority: 3, minWidth: 90 },
  color: { priority: 2, minWidth: 100 },
  used: { priority: 2, minWidth: 70, nowrap: true },
  items: { priority: 2, minWidth: 70, nowrap: true },
  people: { priority: 2, minWidth: 70, nowrap: true },
};

function ItemsTable({
  h,
  type,
  id,
  select,
  query,
  areas,
  showDisabled,
}: {
  h: Hierarchy;
  type: OrganizeType;
  id: string | null;
  select: (id: string | null) => void;
  query: string;
  areas: ReadonlySet<string>;
  showDisabled: boolean;
}) {
  const { edited } = useTaxis();
  const { cols, rows: all } = useMemo(() => rowsFor(h, type), [h, type]);
  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all.filter(
        (r) =>
          (!q || r.search.toLowerCase().includes(q)) &&
          ((type !== "devices" && !isOrganizeEntityType(type)) || !areas.size || areas.has(r.areaId ?? "")) &&
          (type !== "devices" || showDisabled || !h.devices[r.id]?.disabled),
      ),
    [all, q, areas, type, showDisabled, h],
  );
  const { sort, toggle } = useSortState({ key: "name", dir: "asc" });
  const sorted = useMemo(() => sortRows(rows, (r) => r.v[sort.key], sort.dir), [rows, sort]);
  const paging = usePagination(sorted.length, JSON.stringify([q, [...areas], sort, type]));
  const shown = sorted.slice(paging.start, paging.end);
  const columns: Column<Row>[] = cols.map((c, i) => ({
    id: c.key,
    header: c.label,
    sort: (r) => r.v[c.key],
    text: (r) => String(r.v[c.key] ?? ""),
    cellClassName: i === 0 ? "" : "text-muted tabular-nums",
    cell: (r) =>
      i === 0 ? (
        // The name is a button, so a keyboard reaches the row; a click anywhere on the row selects it too.
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 text-left"
          onClick={(e) => {
            e.stopPropagation();
            select(r.id);
          }}
        >
          {r.cells[c.key]}
          {edited.has(r.edited) && <EditedDot />}
        </button>
      ) : (
        r.cells[c.key]
      ),
    ...COLUMN_RULES[c.key],
  }));
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-2.5">
      <DataTable
        id={`organize-${type}`}
        label={`${TYPE_NAME[type]} list`}
        rows={shown}
        rowKey={(r) => r.id}
        columns={columns}
        sort={sort}
        onSort={toggle}
        rowTone={(r) => (r.id === id ? "selected" : "default")}
        rowAttrs={(r) => ({ "aria-selected": r.id === id })}
        onRowClick={(r) => select(r.id)}
        empty={<EmptyState>{all.length === 0 ? "Nothing here yet." : "Nothing matches."}</EmptyState>}
      />
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
              <div
                {...dropProps(g.key)}
                className={`flex items-center gap-1 rounded-md ${over === g.key ? "bg-accent-soft ring-2 ring-accent" : active ? "bg-accent-soft" : ""}`}
              >
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
                    <span className="ml-auto whitespace-nowrap text-xs font-normal tabular-nums text-muted">
                      {g.all} area{g.all === 1 ? "" : "s"}
                    </span>
                  </button>
                ) : (
                  <span className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-[13px] font-semibold text-muted">
                    <span className="truncate">No floor</span>
                    <span className="ml-auto whitespace-nowrap text-xs font-normal tabular-nums">
                      {g.all} area{g.all === 1 ? "" : "s"}
                    </span>
                  </span>
                )}
                {g.floor && (
                  <Button
                    tone="ghost"
                    className="!px-1.5 !py-0.5 text-xs"
                    onClick={() => setAdding({ kind: "area", floorId: g.floor!.id })}
                    aria-label={`New area on ${g.floor.name}`}
                  >
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
                    <li
                      key={aid}
                      className={`flex items-center gap-1 rounded-md ${sel === id ? "bg-accent-soft" : "hover:bg-sunken"} ${dragging === aid ? "opacity-50" : ""}`}
                    >
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
      ) : (
        missing
      );
    }
    case "labels": {
      const l = h.labels[id];
      return l ? <LabelDetail key={l.id} h={h} label={l} usage={labelUsage(h).get(l.id)} onDeleted={clear} /> : missing;
    }
    case "devices": {
      const d = h.devices[id];
      return d ? <DeviceEditor key={d.id} h={h} device={d} onClose={clear} /> : missing;
    }
    case "automations":
    case "helpers":
    case "entities": {
      const e = h.entities[id];
      return e && entityMatchesSection(e, type) ? <EntityEditor key={e.entityId} h={h} entity={e} onClose={clear} /> : missing;
    }
    case "zones": {
      const z = h.entities[id];
      return z ? <ZoneView key={z.entityId} zone={z} onClose={clear} /> : missing;
    }
    case "blueprints":
      return null;
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
    [
      "Entity id",
      <code key="id" className="font-mono text-xs">
        {zone.entityId}
      </code>,
    ],
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
