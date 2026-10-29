import { Pagination, usePagination } from "./records.tsx";
import {
  Activity,
  AlertTriangle,
  Battery,
  Blinds,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  DoorOpen,
  Droplets,
  Gauge,
  Home,
  Info,
  Layers,
  Lightbulb,
  Lock,
  MapPin,
  MousePointerClick,
  Pencil,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Thermometer,
  ToggleRight,
  Tv,
  UserRound,
  Workflow,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { ROLE_ORDER, displayRole } from "../../shared/roles.ts";
import { suggestEntityArea } from "../../shared/area-suggestion.ts";
import { sortRows } from "../../shared/sort.ts";
import { arrangeGroups, membershipIndex, summarizeRoom, type BinarySummary, type NumericSummary } from "../../shared/rooms.ts";
import type { AreaNode, ChangeInput, EntityItem, EntityRole, Hierarchy } from "../../shared/types.ts";
import { diagnosisText } from "../../shared/entity-diagnosis.ts";
import { areaHealth, floorListed, healthBadges, listedAreas, type AreaHealth as Health, type HealthBadge } from "../../shared/area-health.ts";
import { analyzeArea } from "../../shared/naming.ts";
import { namingFit } from "../../shared/naming-ignores.ts";
import { EntityLabels } from "./entity-labels.tsx";
import { AreaCapabilitySummary } from "./area-capabilities.tsx";
import { AreaEditor, DeviceEditor, EntityEditor, FloorEditor, NewItemForm } from "./editors.tsx";
import { AreaCapabilitiesTab } from "./capabilities.tsx";
import { AreaFindings, useAreaFindings, useHealth } from "./health.tsx";
import { DevicesEntities } from "./devices-view.tsx";
import { AreaNamingTab } from "./naming.tsx";
import { useStoredChoice, useStoredSet } from "./storage.ts";
import { DataTable, useSortState, type Column } from "./data-table.tsx";
import { useTaxis, type AreaTab, type Route, type Selection } from "./state.tsx";
import {
  AreaSelect,
  Button,
  Chip,
  ConfirmAction,
  EditedDot,
  EmptyState,
  LabelChip,
  PageHeader,
  SearchField,
  Section,
  Tabs,
  Toolbar,
  inputClass,
  tabPanelId,
  type TabItem,
} from "./ui.tsx";
import { WhyIcon, useWhy } from "./why.tsx";
import { TooltipButton } from "./tooltip.tsx";

const ROLE_ICONS: Record<EntityRole, LucideIcon> = {
  light: Lightbulb,
  switch: ToggleRight,
  motion: Activity,
  presence: UserRound,
  opening: DoorOpen,
  climate: Wind,
  temperature: Thermometer,
  humidity: Droplets,
  illuminance: Sun,
  media: Tv,
  cover: Blinds,
  lock: Lock,
  power: Zap,
  battery: Battery,
  button: MousePointerClick,
  sensor: Gauge,
  automation: Workflow,
  helper: SlidersHorizontal,
  camera: Camera,
  other: Sparkles,
};
export const ROLE_LABEL = Object.fromEntries(ROLE_ORDER.map((r) => [r.role, r.label])) as Record<EntityRole, string>;

export type Filters = { maintenance: boolean; disabled: boolean };

export function visible(e: EntityItem, f: Filters): boolean {
  if (!f.maintenance && e.maintenance) return false;
  if (!f.disabled && (e.disabled || e.hidden)) return false;
  return true;
}

const countVisible = (ids: string[], h: Hierarchy, f: Filters) => ids.reduce((n, id) => (h.entities[id] && visible(h.entities[id], f) ? n + 1 : n), 0);

function stateText(e: EntityItem): string {
  if (e.disabled) return "disabled";
  if (e.state === null) return "no state";
  return e.unit ? `${e.state} ${e.unit}` : e.state;
}

function stateTone(e: EntityItem): "on" | "off" | "warn" {
  if (e.state === "unavailable" || e.state === "unknown") return "warn";
  if (["on", "open", "home", "playing", "unlocked", "detected", "heat", "cool", "auto"].includes(e.state ?? "")) return "on";
  return "off";
}

function groupByRole(ids: string[], h: Hierarchy, f: Filters) {
  const groups = new Map<EntityRole, EntityItem[]>();
  for (const id of ids) {
    const e = h.entities[id];
    if (!e || !visible(e, f)) continue;
    // A helper or a group is listed as one, not under what it mirrors (a light group is no light).
    const role = displayRole(e);
    const list = groups.get(role) ?? [];
    list.push(e);
    groups.set(role, list);
  }
  return ROLE_ORDER.filter((r) => groups.has(r.role)).map((r) => ({ ...r, entities: groups.get(r.role)! }));
}

// ---------------------------------------------------------------------------
// Left: the tree of spaces.
// ---------------------------------------------------------------------------

function TreeRow({
  depth,
  icon: Icon,
  label,
  count,
  health,
  active,
  muted,
  edited,
  expanded,
  onClick,
}: {
  depth: number;
  icon: LucideIcon;
  label: string;
  count?: number;
  // What needs a look in an area (its Health tab): a small dot, red for an error.
  health?: HealthBadge;
  active: boolean;
  muted?: boolean;
  edited?: boolean;
  // Set on a row that folds its areas away: whether they are showing.
  expanded?: boolean;
  onClick: () => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      aria-expanded={expanded}
      // Floors have an extra chevron before their icon. Account for its width
      // so an area's label sits 12px beyond the floor label, not before it.
      style={{ paddingLeft: 8 + depth * 14 + (depth === 2 ? 16 : 0) }}
      className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-[13px] ${
        active ? "bg-accent-soft font-medium text-accent" : muted ? "text-muted hover:bg-sunken" : "hover:bg-sunken"
      }`}
    >
      {expanded !== undefined && <Chevron className="-mr-1 size-3.5 shrink-0 text-muted" aria-hidden />}
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {edited && <EditedDot />}
      {health && (
        <span
          role="img"
          aria-label={`${health.total} health ${health.total === 1 ? "issue" : "issues"}`}
          title={`${health.total} health ${health.total === 1 ? "issue" : "issues"}`}
          className={`size-2 shrink-0 rounded-full ${health.severity === "error" ? "bg-danger" : "bg-warn"}`}
        />
      )}
      {count !== undefined && <span className="shrink-0 text-xs tabular-nums text-muted">{count}</span>}
    </button>
  );
}

export function SpaceTree({
  h,
  sel,
  select,
  filters,
  query,
  showEmpty = true,
}: {
  h: Hierarchy;
  sel: Selection;
  select: (s: Selection) => void;
  filters: Filters;
  query: string;
  showEmpty?: boolean;
}) {
  const { edited, naming, namingIgnores } = useTaxis();
  // The health report is read once for the whole home; an area's badge is the
  // number on its Health tab (its own lists and the report's findings about it).
  const { report } = useHealth();
  const badges = useMemo(() => healthBadges(h, naming, namingIgnores, report?.findings ?? null), [h, naming, namingIgnores, report]);
  const q = query.trim().toLowerCase();
  const matches = (a: AreaNode) => !q || a.name.toLowerCase().includes(q);
  // Floors folded away, per viewer: "floor:<id>", or "loose" for areas on no floor.
  const [collapsed, changeCollapsed] = useStoredSet("taxis:tree-collapsed");
  // Choosing an area (a link, say) opens the floor it is on.
  const selectedArea = sel.kind === "area" ? h.areas[sel.id] : undefined;
  const selectedGroup = selectedArea ? (selectedArea.floorId ? `floor:${selectedArea.floorId}` : "loose") : null;
  useEffect(() => {
    if (selectedGroup) changeCollapsed((s) => s.delete(selectedGroup));
  }, [selectedGroup, sel, changeCollapsed]);
  // A search shows every match, folded or not.
  const isOpen = (group: string) => Boolean(q) || !collapsed.has(group);
  const fold = (group: string) => changeCollapsed((s) => void (s.delete(group) || s.add(group)));
  // Without the empty areas (no entities under the filters), the selected one apart.
  const selectedAreaId = sel.kind === "area" ? sel.id : null;
  const listed = (ids: readonly string[]) =>
    listedAreas(
      ids.filter((id) => matches(h.areas[id])),
      (id) => countVisible(h.areas[id].entityIds, h, filters),
      showEmpty,
      selectedAreaId,
    );
  const areaRow = (a: AreaNode) => (
    <TreeRow
      key={a.id}
      depth={2}
      icon={MapPin}
      label={a.name}
      count={countVisible(a.entityIds, h, filters)}
      health={badges.get(a.id)}
      active={sel.kind === "area" && sel.id === a.id}
      edited={edited.has(`area:${a.id}`)}
      onClick={() => select({ kind: "area", id: a.id })}
    />
  );
  return (
    <nav aria-label="Spaces" className="min-h-0 flex-1 overflow-y-auto p-1.5">
      <TreeRow depth={0} icon={Home} label={h.home.name} active={sel.kind === "home"} onClick={() => select({ kind: "home" })} />
      {h.floors.map((f) => {
        const { ids, hidden } = listed(f.areaIds);
        const areas = ids.map((id) => h.areas[id]);
        if (q && areas.length === 0) return null;
        if (!floorListed(f.areaIds.length, hidden, sel.kind === "floor" && sel.id === f.id)) return null;
        return (
          <div key={f.id}>
            <TreeRow
              depth={1}
              icon={Layers}
              label={f.name}
              expanded={isOpen(`floor:${f.id}`)}
              active={sel.kind === "floor" && sel.id === f.id}
              edited={edited.has(`floor:${f.id}`)}
              onClick={() => {
                fold(`floor:${f.id}`);
                select({ kind: "floor", id: f.id });
              }}
            />
            {isOpen(`floor:${f.id}`) && areas.map(areaRow)}
          </div>
        );
      })}
      {h.looseAreaIds.length > 0 &&
        floorListed(h.looseAreaIds.filter((id) => matches(h.areas[id])).length, listed(h.looseAreaIds).hidden, sel.kind === "loose") && (
          <div>
            <TreeRow
              depth={1}
              icon={Layers}
              label="No floor"
              muted
              expanded={isOpen("loose")}
              active={sel.kind === "loose"}
              onClick={() => {
                fold("loose");
                select({ kind: "loose" });
              }}
            />
            {isOpen("loose") && listed(h.looseAreaIds).ids.map((id) => areaRow(h.areas[id]))}
          </div>
        )}
      <TreeRow
        depth={0}
        icon={AlertTriangle}
        label="Not in any area"
        muted
        count={countVisible(h.unassignedEntityIds, h, filters)}
        active={sel.kind === "unassigned"}
        onClick={() => select({ kind: "unassigned" })}
      />
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Right: the selected space, with editing.
// ---------------------------------------------------------------------------

type Editing = { kind: "entity" | "device" | "area" | "floor"; id: string } | null;

export function SpaceView({
  h,
  sel,
  tab,
  go,
  select,
  filters,
}: {
  h: Hierarchy;
  sel: Selection;
  tab: AreaTab;
  go: (r: Route) => void;
  select: (s: Selection) => void;
  filters: Filters;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // A new place starts with nothing open and nothing picked.
  const key = JSON.stringify(sel);
  useEffect(() => {
    setEditing(null);
    setPicked(new Set());
  }, [key]);

  const close = () => setEditing(null);
  const editor = editing && (
    <div className="mb-5">
      {editing.kind === "entity" && h.entities[editing.id] && <EntityEditor key={editing.id} h={h} entity={h.entities[editing.id]} onClose={close} />}
      {editing.kind === "device" && h.devices[editing.id] && <DeviceEditor key={editing.id} h={h} device={h.devices[editing.id]} onClose={close} />}
      {editing.kind === "area" && h.areas[editing.id] && (
        <AreaEditor key={editing.id} h={h} area={h.areas[editing.id]} onClose={close} onDeleted={() => select({ kind: "home" })} />
      )}
      {editing.kind === "floor" && h.floors.find((f) => f.id === editing.id) && (
        <FloorEditor key={editing.id} floor={h.floors.find((f) => f.id === editing.id)!} onClose={close} onDeleted={() => select({ kind: "home" })} />
      )}
    </div>
  );

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const rows = { picked, toggle, edit: (id: string) => setEditing({ kind: "entity", id }) };

  let body: ReactNode;
  if (sel.kind === "area") {
    const area = h.areas[sel.id];
    body = area ? (
      <AreaView
        h={h}
        area={area}
        filters={filters}
        select={select}
        rows={rows}
        tab={tab}
        onTab={(t) => go({ page: "areas", sel: { kind: "area", id: area.id }, tab: t })}
        go={go}
        onEditArea={() => setEditing({ kind: "area", id: area.id })}
        onEditDevice={(id) => setEditing({ kind: "device", id })}
      />
    ) : (
      <Missing what="That area" select={select} />
    );
  } else if (sel.kind === "floor") {
    const floor = h.floors.find((f) => f.id === sel.id);
    body = floor ? (
      <AreaList
        h={h}
        title={floor.name}
        subtitle={floor.level !== null ? `Level ${floor.level}` : "Floor"}
        areaIds={floor.areaIds}
        filters={filters}
        select={select}
        floorId={floor.id}
        onEdit={() => setEditing({ kind: "floor", id: floor.id })}
      />
    ) : (
      <Missing what="That floor" select={select} />
    );
  } else if (sel.kind === "loose") {
    body = (
      <AreaList h={h} title="No floor" subtitle="Areas that aren't on any floor" areaIds={h.looseAreaIds} filters={filters} select={select} floorId={null} />
    );
  } else if (sel.kind === "unassigned") {
    body = <UnassignedView h={h} filters={filters} edit={rows.edit} />;
  } else {
    body = <HomeView h={h} filters={filters} select={select} />;
  }

  return (
    <div className="flex min-w-0 flex-col">
      {editor}
      {picked.size > 0 && <BulkBar h={h} ids={[...picked]} onDone={() => setPicked(new Set())} />}
      {body}
    </div>
  );
}

function UnassignedView({ h, filters, edit }: { h: Hierarchy; filters: Filters; edit: (id: string) => void }) {
  const { propose, busy: applying } = useTaxis();
  const [assigning, setAssigning] = useState(false);
  const assignArea = async (entity: EntityItem, area: string | null) => {
    if (!area || !h.areas[area] || !entity.inRegistry || (entity.needsOwnName && !entity.customName) || applying || assigning) return;
    setAssigning(true);
    try {
      await propose({ kind: "entity", op: "update", targetId: entity.entityId, fields: { area_id: area } });
    } finally {
      setAssigning(false);
    }
  };
  const [view, setView] = useStoredChoice("taxis:unassigned:view", ["cards", "table"] as const, "cards");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const deviceName = (e: EntityItem) => (e.deviceId ? (h.devices[e.deviceId]?.name ?? e.deviceId) : "");
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return h.unassignedEntityIds
      .map((id) => h.entities[id])
      .filter((e): e is EntityItem => Boolean(e) && visible(e, filters) && `${e.name} ${e.entityId} ${deviceName(e)}`.toLowerCase().includes(q));
  }, [h, filters, query]);
  const { sort, toggle: sortBy } = useSortState({ key: "name", dir: "asc" });
  const sorted = useMemo(() => {
    const get = { name: (e: EntityItem) => e.name, entityId: (e: EntityItem) => e.entityId, device: deviceName, state: stateText }[
      sort.key as "name" | "entityId" | "device" | "state"
    ];
    return sortRows(matches, get, sort.dir);
  }, [matches, sort, h]);
  const paging = usePagination(sorted.length, JSON.stringify([query, filters, sort]));
  const shown = sorted.slice(paging.start, paging.end);
  const eligible = shown.filter((e) => e.inRegistry);
  // Selection never follows an entity hidden by the current query, filters or page.
  const selected = eligible.filter((e) => picked.has(e.entityId)).map((e) => e.entityId);
  const all = eligible.length > 0 && selected.length === eligible.length;
  const selectionCheckbox = (
    <input
      type="checkbox"
      aria-label="Select all shown entities"
      checked={all}
      ref={(node) => {
        if (node) node.indeterminate = selected.length > 0 && !all;
      }}
      disabled={!eligible.length || applying || assigning}
      onChange={() => setPicked(all ? new Set() : new Set(eligible.map((e) => e.entityId)))}
    />
  );
  const toggle = (id: string) =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const columns: Column<EntityItem>[] = [
    {
      id: "pick",
      header: selectionCheckbox,
      label: "Select",
      locked: true,
      sticky: true,
      width: 32,
      priority: 1,
      cell: (e) =>
        e.inRegistry ? (
          <input type="checkbox" aria-label={`Select ${e.name}`} checked={picked.has(e.entityId)} onChange={() => toggle(e.entityId)} />
        ) : (
          <span title="Not in the entity registry">—</span>
        ),
    },
    {
      id: "name",
      header: "Name",
      priority: 1,
      sticky: true,
      minWidth: 200,
      maxWidth: 360,
      sort: (e) => e.name,
      cell: (e) => (
        <>
          <button type="button" className="text-left text-accent hover:underline" onClick={() => edit(e.entityId)}>
            {e.name}
          </button>
          {(e.disabled || e.hidden || e.maintenance) && (
            <span className="block text-xs text-muted">
              {[e.disabled && "Disabled", e.hidden && "Hidden", e.maintenance && "Diagnostic"].filter(Boolean).join(" · ")}
            </span>
          )}
        </>
      ),
    },
    {
      id: "area",
      header: "Area",
      priority: 1,
      locked: true,
      minWidth: 190,
      maxWidth: 260,
      cell: (e) => {
        const suggestion = suggestEntityArea(e.name, e.entityId, Object.values(h.areas));
        const device = e.deviceId ? h.devices[e.deviceId] : undefined;
        const deviceArea = device?.areaId ? h.areas[device.areaId]?.name : null;
        const reason = !e.inRegistry
          ? "Not in the entity registry"
          : e.needsOwnName && !e.customName
            ? "Name this entity first, or move its device in Organize."
            : null;
        return (
          <div className="min-w-0">
            <label className="sr-only" htmlFor={`unassigned-area-${e.entityId}`}>
              Area for {e.name}
            </label>
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="w-28 min-w-0 max-w-[50%] shrink-0">
                <AreaSelect
                  h={h}
                  id={`unassigned-area-${e.entityId}`}
                  value={e.ownAreaId}
                  noneLabel="Choose an area…"
                  disabled={!!reason || applying || assigning}
                  onChange={(area) => void assignArea(e, area)}
                />
              </div>
              {suggestion && (
                <div className="flex min-w-0 flex-1 items-center gap-1 text-xs">
                  <span className="min-w-0 truncate text-muted" title={`Suggested: ${h.areas[suggestion.areaId].name}`}>
                    Suggested: {h.areas[suggestion.areaId].name}
                  </span>
                  <Button
                    className="shrink-0"
                    disabled={!!reason || applying || assigning}
                    aria-label={`Use suggested area ${h.areas[suggestion.areaId].name} for ${e.name}`}
                    title="Add this area assignment to Changes"
                    onClick={() => void assignArea(e, suggestion.areaId)}
                  >
                    <Check className="size-3" aria-hidden />
                  </Button>
                </div>
              )}
              {deviceArea && (
                <span className="min-w-0 flex-1 truncate text-xs text-muted" title={`Device area: ${deviceArea}`}>
                  Device area: {deviceArea}
                </span>
              )}
            </div>
            {reason && <p className="mt-1 text-xs text-muted">{reason}</p>}
          </div>
        );
      },
    },
    {
      id: "entityId",
      header: "Entity ID",
      priority: 2,
      minWidth: 160,
      maxWidth: 300,
      truncate: true,
      sort: (e) => e.entityId,
      text: (e) => e.entityId,
      cell: (e) => <span className="font-mono text-xs">{e.entityId}</span>,
    },
    {
      id: "device",
      header: "Device",
      priority: 2,
      minWidth: 140,
      maxWidth: 240,
      truncate: true,
      sort: deviceName,
      text: (e) => deviceName(e) || "No device",
      cell: (e) => deviceName(e) || "No device",
    },
    { id: "state", header: "State", priority: 3, minWidth: 100, nowrap: true, sort: stateText, cell: stateText },
  ];
  return (
    <section aria-label="Unassigned entities" className="flex min-w-0 flex-col gap-4">
      <Heading title="Not in any area" subtitle="Neither the entity nor its device has an area. Select entities and add an area assignment to Changes." />
      <Toolbar label="Unassigned entities toolbar" className="gap-3">
        <Toolbar label="Unassigned view" className="gap-x-1">
          {(["cards", "table"] as const).map((value) => (
            <Chip key={value} pressed={view === value} onClick={() => setView(value)}>
              {value === "cards" ? "Cards" : "Table"}
            </Chip>
          ))}
        </Toolbar>
        <SearchField
          label="Find unassigned entities"
          placeholder="Search name, entity ID or device"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPicked(new Set());
          }}
        />
        <span className="text-xs text-muted">{matches.length} matching entities</span>
        {query && (
          <Button
            tone="ghost"
            onClick={() => {
              setQuery("");
              setPicked(new Set());
            }}
          >
            Clear search
          </Button>
        )}
      </Toolbar>
      <BulkBar h={h} ids={selected} onDone={() => setPicked(new Set())} requireArea />
      {!shown.length ? (
        <EmptyState>{query ? "No unassigned entities match your search." : "No entities without an area match the current visibility filters."}</EmptyState>
      ) : view === "cards" ? (
        <RoleSections h={h} ids={shown.map((e) => e.entityId)} filters={filters} rows={{ picked: new Set(selected), toggle, edit }} showDevice />
      ) : (
        <DataTable
          id="unassigned-entities"
          label="Unassigned entities table"
          rows={shown}
          rowKey={(e) => e.entityId}
          columns={columns}
          sort={sort}
          onSort={sortBy}
        />
      )}
      <Pagination {...paging} />
    </section>
  );
}

function Missing({ what, select }: { what: string; select: (s: Selection) => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <Heading title="Not found" subtitle={`${what} isn't in Home Assistant any more. It may have been removed since your last visit.`} />
      <Button onClick={() => select({ kind: "home" })}>Go to the whole home</Button>
    </div>
  );
}

function Heading({ title, subtitle, children, action }: { title: string; subtitle?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <PageHeader title={title} description={subtitle} actions={action} />
      {children}
    </div>
  );
}

// dense: the smaller card of an area's Overview, under the live status.
function Stat({ label, value, note, onClick, dense }: { label: string; value: number; note?: string; onClick?: () => void; dense?: boolean }) {
  const body = (
    <>
      <span className={`font-semibold tabular-nums ${dense ? "text-lg leading-tight" : "text-2xl"}`}>{value.toLocaleString()}</span>
      <span className={`text-muted ${dense ? "text-[11px]" : "text-xs"}`}>{label}</span>
      {note && <span className="mt-0.5 text-[11px] text-muted">{note}</span>}
    </>
  );
  const box = `rounded-lg border border-line bg-surface ${dense ? "px-2.5 py-1.5" : "px-3.5 py-3"}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`flex flex-col items-start text-left hover:bg-sunken ${box}`}>
      {body}
    </button>
  ) : (
    <div className={`flex flex-col ${box}`}>{body}</div>
  );
}

function HomeView({ h, filters, select }: { h: Hierarchy; filters: Filters; select: (s: Selection) => void }) {
  const roleTotals = groupByRole(Object.keys(h.entities), h, filters);
  const floorRows = [
    ...h.floors.map((f) => ({ key: f.id, name: f.name, ids: f.areaIds, go: { kind: "floor", id: f.id } as Selection })),
    ...(h.looseAreaIds.length ? [{ key: "__loose", name: "No floor", ids: h.looseAreaIds, go: { kind: "loose" } as Selection }] : []),
  ].map((row) => ({
    ...row,
    areas: row.ids.length,
    devices: row.ids.reduce((n, id) => n + h.areas[id].deviceIds.length, 0),
    entities: row.ids.reduce((n, id) => n + countVisible(h.areas[id].entityIds, h, filters), 0),
  }));
  type FloorRow = (typeof floorRows)[number];
  const floorColumns: Column<FloorRow>[] = [
    {
      id: "floor",
      header: "Floor",
      priority: 1,
      sticky: true,
      minWidth: 160,
      sort: (r) => r.name,
      cell: (r) => (
        <button type="button" className="text-accent hover:underline" onClick={() => select(r.go)}>
          {r.name}
        </button>
      ),
    },
    { id: "areas", header: "Areas", priority: 2, minWidth: 80, sort: (r) => r.areas, cell: (r) => <span className="tabular-nums">{r.areas}</span> },
    { id: "devices", header: "Devices", priority: 2, minWidth: 80, sort: (r) => r.devices, cell: (r) => <span className="tabular-nums">{r.devices}</span> },
    { id: "entities", header: "Entities", priority: 2, minWidth: 80, sort: (r) => r.entities, cell: (r) => <span className="tabular-nums">{r.entities}</span> },
  ];
  return (
    <div className="flex flex-col gap-6">
      <Heading title={h.home.name} subtitle={h.home.haVersion ? `Home Assistant ${h.home.haVersion}` : undefined} />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <Stat label="Floors" value={h.counts.floors} />
        <Stat label="Areas" value={h.counts.areas} />
        <Stat label="Devices" value={h.counts.devices} />
        <Stat
          label="Entities"
          value={h.counts.entities}
          note={h.counts.disabledEntities > 0 ? `${h.counts.disabledEntities.toLocaleString()} more are disabled` : undefined}
        />
        <Stat label="Not in any area" value={countVisible(h.unassignedEntityIds, h, filters)} onClick={() => select({ kind: "unassigned" })} />
      </div>
      <Section title="Floors">
        {/* The floors in the order Home Assistant gives them (the areas on no floor last) until a column is clicked. */}
        <DataTable id="home-floors" label="Floors" rows={floorRows} rowKey={(r) => r.key} columns={floorColumns} defaultSort={{ key: "order", dir: "asc" }} />
        <NewItemForm kind="floor" onDone={() => {}} />
      </Section>
      <Section title="What's in the home">
        <div className="flex flex-wrap gap-2">
          {roleTotals.map((g) => {
            const Icon = ROLE_ICONS[g.role];
            return (
              <span key={g.role} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[13px]">
                <Icon className="size-3.5 text-muted" aria-hidden />
                {g.label}
                <span className="tabular-nums text-muted">{g.entities.length}</span>
              </span>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function AreaList({
  h,
  title,
  subtitle,
  areaIds,
  filters,
  select,
  floorId,
  onEdit,
}: {
  h: Hierarchy;
  title: string;
  subtitle: string;
  areaIds: string[];
  filters: Filters;
  select: (s: Selection) => void;
  floorId: string | null;
  onEdit?: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Heading
        title={title}
        subtitle={`${subtitle} · ${areaIds.length} areas`}
        action={
          onEdit && (
            <Button onClick={onEdit}>
              <Pencil className="size-3.5" aria-hidden /> Edit floor
            </Button>
          )
        }
      />
      {areaIds.length === 0 ? (
        <p className="text-[13px] text-muted">No areas here yet.</p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {areaIds.map((id) => {
            const a = h.areas[id];
            const s = summarizeRoom(a, h);
            return (
              <button
                key={id}
                type="button"
                onClick={() => select({ kind: "area", id })}
                className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-left hover:bg-sunken"
              >
                <span className="flex items-center gap-1.5 font-medium">
                  {a.name}
                  <ChevronRight className="ml-auto size-4 text-muted" aria-hidden />
                </span>
                <span className="text-xs text-muted tabular-nums">
                  {a.deviceIds.length} devices · {countVisible(a.entityIds, h, filters)} entities
                </span>
                <SummaryChips s={s} h={h} compact />
              </button>
            );
          })}
        </div>
      )}
      <NewItemForm kind="area" floorId={floorId} onDone={() => {}} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The room summary: temperature, humidity, light level, presence, motion,
// openings, lights.
// ---------------------------------------------------------------------------

function sourceNames(ids: string[], h: Hierarchy) {
  return ids.map((id) => h.entities[id]?.name ?? id).join(", ");
}

function numberChip(icon: LucideIcon, label: string, n: NumericSummary, h: Hierarchy) {
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const text = n.value !== null ? `${fmt(n.value)}${n.unit ? ` ${n.unit}` : ""}` : `${fmt(n.min)}–${fmt(n.max)}${n.unit ? ` ${n.unit}` : ""}`;
  const via = n.primaryId ? `from ${h.entities[n.primaryId]?.name ?? n.primaryId}` : `${n.sourceIds.length} sensors`;
  return {
    icon,
    label,
    text,
    title: `${label}: ${text}, ${via}. Sensors: ${sourceNames(n.sourceIds, h)}`,
    tone: "plain" as const,
    group: n.groupIds.length > 0,
  };
}

function binaryChip(icon: LucideIcon, label: string, b: BinarySummary, words: [string, string], h: Hierarchy) {
  const text = b.active === null ? "unknown" : b.active ? words[0] : words[1];
  return {
    icon,
    label,
    text,
    title: `${label}: ${text}. Sensors: ${sourceNames(b.sourceIds, h)}${b.activeIds.length ? `. Active: ${sourceNames(b.activeIds, h)}` : ""}`,
    tone: b.active ? ("on" as const) : b.active === null ? ("warn" as const) : ("plain" as const),
    group: b.groupIds.length > 0,
  };
}

function SummaryChips({ s, h, compact }: { s: ReturnType<typeof summarizeRoom>; h: Hierarchy; compact?: boolean }) {
  const chips = [
    s.temperature && numberChip(Thermometer, "Temperature", s.temperature, h),
    s.humidity && numberChip(Droplets, "Humidity", s.humidity, h),
    s.illuminance && numberChip(Sun, "Light level", s.illuminance, h),
    s.presence && binaryChip(UserRound, "Presence", s.presence, ["occupied", "clear"], h),
    s.motion && binaryChip(Activity, "Motion", s.motion, ["motion", "still"], h),
    s.opening && binaryChip(DoorOpen, "Doors and windows", s.opening, [`${s.opening.activeIds.length} open`, "closed"], h),
    s.lights && {
      icon: Lightbulb,
      label: "Lights",
      text: `${s.lights.on}/${s.lights.total} on`,
      title: `${s.lights.on} of ${s.lights.total} lights on${s.lights.groupIds.length ? `. Groups: ${sourceNames(s.lights.groupIds, h)}` : ""}`,
      tone: s.lights.on > 0 ? ("on" as const) : ("plain" as const),
      group: s.lights.groupIds.length > 0,
    },
  ].filter((c): c is NonNullable<typeof c> => Boolean(c));
  if (chips.length === 0) return compact ? null : <p className="text-[13px] text-muted">No temperature, presence, motion or light entities in this area.</p>;
  return (
    <ul aria-label="Room summary" className={compact ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-2.5"}>
      {chips.map((c) => {
        const Icon = c.icon;
        return (
          <li
            key={c.label}
            title={c.title}
            className={`inline-flex items-center rounded-md border ${compact ? "gap-1.5 px-2 py-1 text-xs" : "gap-2.5 px-4 py-3 text-sm bg-surface"} ${
              c.tone === "on" ? "border-on/40 text-on" : c.tone === "warn" ? "border-warn/40 text-warn" : "border-line text-fg"
            }`}
          >
            <Icon className={compact ? "size-3.5" : "size-5"} aria-hidden />
            {!compact && <span className="text-[13px] text-muted">{c.label}</span>}
            <span className={`font-medium tabular-nums ${compact ? "" : "text-2xl leading-none"}`}>{c.text}</span>
            {c.group && <span className="rounded bg-sunken px-1 text-[10px] text-muted">group</span>}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// An area: summary, entities by role (groups with their members), devices.
// ---------------------------------------------------------------------------

type Rows = { picked: Set<string>; toggle: (id: string) => void; edit: (id: string) => void };

function AreaView({
  h,
  area,
  filters,
  select,
  rows,
  tab,
  onTab,
  go,
  onEditArea,
  onEditDevice,
}: {
  h: Hierarchy;
  area: AreaNode;
  filters: Filters;
  select: (s: Selection) => void;
  rows: Rows;
  tab: AreaTab;
  onTab: (t: AreaTab) => void;
  go: (r: Route) => void;
  onEditArea: () => void;
  onEditDevice: (id: string) => void;
}) {
  const { edited, naming, namingIgnores } = useTaxis();
  const floor = h.floors.find((f) => f.id === area.floorId);
  const nameCheck = useMemo(() => analyzeArea(area, h, naming), [area, h, naming]);
  // A suggestion the user ignored counts as fine: the entity fits for them.
  const fit = useMemo(() => namingFit(nameCheck, namingIgnores), [nameCheck, namingIgnores]);
  const health = useMemo(() => areaHealth(area, h, nameCheck, namingIgnores), [area, h, nameCheck, namingIgnores]);
  // What the health checks (shared/health.ts) found about this area, on top of the lists in the tab.
  const checks = useAreaFindings(area.id).findings.length;
  const named = fit.total;
  // The entities of this area that pass the page's filters (config and diagnostic, disabled and hidden).
  const entityOk = useCallback((e: EntityItem) => visible(e, filters), [filters]);
  const withCount = (label: string, count?: string): ReactNode =>
    count ? (
      <>
        {label} <span className="text-xs tabular-nums text-muted">{count}</span>
      </>
    ) : (
      label
    );
  const tabs: TabItem<AreaTab>[] = [
    { key: "overview", label: "Overview" },
    { key: "capabilities", label: "Capabilities" },
    { key: "devices-entities", label: withCount("Devices & entities", `${area.deviceIds.length} · ${countVisible(area.entityIds, h, filters)}`) },
    { key: "naming", label: withCount("Naming", named ? `${fit.fits}/${named}` : undefined) },
    { key: "labels", label: "Labels" },
    { key: "health", label: withCount("Health", health.total + checks ? String(health.total + checks) : undefined) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Heading
        title={area.name}
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => go({ page: "guide", areaId: area.id })}>Guide this area</Button>
            <Button onClick={onEditArea}>
              <Pencil className="size-3.5" aria-hidden /> Edit area
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          {floor ? (
            <button type="button" className="text-accent hover:underline" onClick={() => select({ kind: "floor", id: floor.id })}>
              {floor.name}
            </button>
          ) : (
            <span>No floor</span>
          )}
          <span>
            Area id <code className="rounded bg-sunken px-1 font-mono text-xs">{area.id}</code>
          </span>
          {edited.has(`area:${area.id}`) && (
            <span className="inline-flex items-center gap-1 text-warn">
              <EditedDot /> changed, not applied
            </span>
          )}
          {area.labels.map((id) => h.labels[id] && <LabelChip key={id} label={h.labels[id]} />)}
        </div>
      </Heading>

      <Tabs tabs={tabs} value={tab} onChange={onTab} label="Area tools" />

      <div role="tabpanel" id={tabPanelId("Area tools")} className="min-w-0">
        {tab === "overview" && (
          <div className="flex flex-col gap-5">
            <AreaCapabilitySummary h={h} areaId={area.id} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8">
              <Stat dense label="Devices" value={area.deviceIds.length} onClick={() => onTab("devices-entities")} />
              <Stat dense label="Entities" value={countVisible(area.entityIds, h, filters)} onClick={() => onTab("devices-entities")} />
              <Stat dense label="Ids that fit the naming" value={fit.fits} note={named ? `of ${named}` : undefined} onClick={() => onTab("naming")} />
              <Stat dense label="Things to look at" value={health.total + checks} onClick={() => onTab("health")} />
            </div>
          </div>
        )}
        {tab === "capabilities" && <AreaCapabilitiesTab h={h} area={area} go={go} />}
        {tab === "devices-entities" && (
          <DevicesEntities
            key={area.id}
            h={h}
            areaId={area.id}
            place="area"
            entityOk={entityOk}
            picked={rows.picked}
            toggle={rows.toggle}
            onOpenEntity={rows.edit}
            onOpenDevice={onEditDevice}
            groups={(ids) => <RoleSections h={h} ids={ids} filters={filters} rows={rows} />}
          />
        )}
        {tab === "naming" && <AreaNamingTab h={h} area={area} go={go} />}
        {tab === "labels" && <AreaLabelsTab h={h} area={area} />}
        {tab === "health" && <AreaHealthTab h={h} areaId={area.id} health={health} rows={rows} go={go} />}
      </div>
    </div>
  );
}

function AreaHealthTab({ h, areaId, health, rows, go }: { h: Hierarchy; areaId: string; health: Health; rows: Rows; go: (r: Route) => void }) {
  const why = useWhy();
  return (
    <div className="flex flex-col gap-5">
      {health.total === 0 && <p className="text-[13px] text-muted">Every entity reports, groups are complete, and no id names another area.</p>}
      {health.unavailable.length > 0 && (
        <Section
          title={`Not reporting · ${health.unavailable.length}`}
          description="Unavailable or unknown right now. A device that's off or out of battery, or one that's gone."
        >
          <ul className="flex flex-col rounded-lg border border-line bg-surface py-1">
            {health.unavailable.map((e) => (
              <EntityRow key={e.entityId} e={e} rows={rows} device={e.deviceId ? h.devices[e.deviceId]?.name : undefined} note={why.entity(e)?.reason} />
            ))}
          </ul>
        </Section>
      )}
      {health.brokenGroups.length > 0 && (
        <Section title={`Groups with missing members · ${health.brokenGroups.length}`}>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {health.brokenGroups.map(({ group, missing }) => (
              <li key={group.entityId} className="px-3 py-2 text-[13px]">
                <span className="font-medium">{group.name}</span> lists entities Home Assistant doesn't have:{" "}
                <code className="font-mono text-xs text-warn">{missing.join(", ")}</code>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {health.namedElsewhere.length > 0 && (
        <Section
          title={`Named after another area · ${health.namedElsewhere.length}`}
          description="Either the entity is in the wrong area, or its id has the wrong area in it. Open it to move it; the Naming tab suggests a new name."
        >
          <ul className="flex flex-col rounded-lg border border-line bg-surface py-1">
            {health.namedElsewhere.map(({ entity, area }) => (
              <EntityRow key={entity.entityId} e={entity} rows={rows} note={`id says ${area}`} />
            ))}
          </ul>
        </Section>
      )}
      <AreaFindings h={h} areaId={areaId} go={go} />
    </div>
  );
}

// Labels in an area: what's used here, and the assign tool for this area's
// entities.
function AreaLabelsTab({ h, area }: { h: Hierarchy; area: AreaNode }) {
  return <EntityLabels h={h} fixedArea={area.id} title={`Entities in ${area.name}`} />;
}

export function RoleSections({ h, ids, filters, rows, showDevice }: { h: Hierarchy; ids: string[]; filters: Filters; rows: Rows; showDevice?: boolean }) {
  const groups = groupByRole(ids, h, filters);
  const visibleIds = new Set(groups.flatMap((group) => group.entities.map((entity) => entity.entityId)));
  const memberOf = useMemo(() => membershipIndex(h), [h]);
  if (groups.length === 0) return <p className="text-[13px] text-muted">No entities here with the current filters.</p>;
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map((g) => {
        const Icon = ROLE_ICONS[g.role];
        const { groups: grouped, loose } = arrangeGroups(g.entities, h);
        return (
          <section key={g.role} className="flex min-w-0 flex-col rounded-lg border border-line bg-surface" aria-label={g.label}>
            <h3 className="flex items-center gap-2 border-b border-line px-3 py-2 text-[13px] font-semibold">
              <Icon className="size-4 text-accent" aria-hidden />
              {g.label}
              <span className="ml-auto font-normal tabular-nums text-muted">{g.entities.length}</span>
            </h3>
            <ul className="flex flex-col py-1">
              {grouped.map((gv) => (
                <GroupBlock
                  key={gv.group.entityId}
                  h={h}
                  group={gv.group}
                  members={gv.members.filter((entity) => visibleIds.has(entity.entityId))}
                  rows={rows}
                  memberOf={memberOf}
                />
              ))}
              {loose.map((e) => (
                <EntityRow
                  key={e.entityId}
                  e={e}
                  rows={rows}
                  device={showDevice && e.deviceId ? h.devices[e.deviceId]?.name : undefined}
                  badge={e.platform === "group" && e.members.length === 0 ? "group" : undefined}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function GroupBlock({
  h,
  group,
  members,
  rows,
  memberOf,
}: {
  h: Hierarchy;
  group: EntityItem;
  members: { entityId: string; entity: EntityItem | null }[];
  rows: Rows;
  memberOf: Map<string, string[]>;
}) {
  const [open, setOpen] = useState(true);
  return (
    <li className="flex flex-col">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Hide members" : "Show members"}
          className="pl-2 text-muted hover:text-fg"
        >
          {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
        </button>
        <ul className="min-w-0 flex-1">
          <EntityRow
            e={group}
            rows={rows}
            badge={`group of ${members.length}${members.some((m) => !m.entity) ? ` · ${members.filter((m) => !m.entity).length} missing` : ""}`}
          />
        </ul>
      </div>
      {open && (
        <ul className="ml-6 flex flex-col border-l border-line">
          {members.map((m) => {
            if (!m.entity) {
              return (
                <li key={m.entityId} className="px-3 py-1 text-xs text-warn" title="The group lists it, but Home Assistant has no such entity.">
                  {m.entityId} · missing
                </li>
              );
            }
            const others = (memberOf.get(m.entityId) ?? []).filter((g) => g !== group.entityId);
            const elsewhere = m.entity.areaId && m.entity.areaId !== group.areaId ? h.areas[m.entity.areaId]?.name : null;
            const note = [elsewhere && `in ${elsewhere}`, others.length > 0 && `also in ${others.map((g) => h.entities[g]?.name ?? g).join(", ")}`]
              .filter(Boolean)
              .join(" · ");
            return <EntityRow key={m.entityId} e={m.entity} rows={rows} note={note || undefined} />;
          })}
        </ul>
      )}
    </li>
  );
}

function EntityRow({ e, rows, device, badge, note }: { e: EntityItem; rows: Rows; device?: string; badge?: string; note?: string }) {
  const { edited } = useTaxis();
  const why = useWhy().entity(e);
  const tone = stateTone(e);
  const id = `pick-${e.entityId}`;
  return (
    <li className="group flex items-center gap-2 px-3 py-1 text-[13px] hover:bg-sunken" title={e.entityId}>
      {e.inRegistry ? (
        <input
          id={id}
          type="checkbox"
          checked={rows.picked.has(e.entityId)}
          onChange={() => rows.toggle(e.entityId)}
          aria-label={`Select ${e.name}`}
          className="shrink-0"
        />
      ) : (
        <span className="w-[13px] shrink-0" aria-hidden />
      )}
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${tone === "on" ? "bg-on" : tone === "warn" ? "bg-warn" : "bg-off"}`} />
      <button type="button" onClick={() => rows.edit(e.entityId)} className="flex min-w-0 flex-1 flex-col text-left">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{e.name}</span>
          {edited.has(`entity:${e.entityId}`) && <EditedDot />}
          {badge && <span className="shrink-0 rounded bg-sunken px-1 text-[10px] text-muted">{badge}</span>}
          {device && <span className="truncate text-xs text-muted">{device}</span>}
        </span>
        {note && <span className="truncate text-[11px] text-muted">{note}</span>}
      </button>
      <span
        title={why ? diagnosisText(why) : undefined}
        className={`flex max-w-[11rem] shrink-0 items-center gap-1 tabular-nums ${tone === "warn" ? "text-warn" : "text-muted"}`}
      >
        <span className="truncate">{stateText(e)}</span>
        <WhyIcon why={why} />
      </span>
    </li>
  );
}

// Changes to several entities at once.
export function BulkBar({ h, ids, onDone, requireArea = false }: { h: Hierarchy; ids: string[]; onDone: () => void; requireArea?: boolean }) {
  const { propose } = useTaxis();
  const [area, setArea] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const labels = Object.values(h.labels).sort((a, b) => a.name.localeCompare(b.name));
  const { notify } = useTaxis();
  const run = async (make: (e: EntityItem) => ChangeInput | null, skip?: (e: EntityItem) => boolean, skipWhy?: string) => {
    const chosen = ids.map((id) => h.entities[id]).filter(Boolean);
    const skipped = skip ? chosen.filter(skip) : [];
    const inputs = chosen
      .filter((e) => !skipped.includes(e))
      .map(make)
      .filter((x): x is ChangeInput => Boolean(x));
    if (inputs.length === 0) {
      if (skipped.length) notify({ tone: "error", text: `Nothing added: ${skipWhy}` });
      return;
    }
    setBusy(true);
    const ok = await propose(inputs);
    setBusy(false);
    if (ok && skipped.length) notify({ tone: "error", text: `${skipped.length} left out: ${skipWhy}` });
    if (ok) onDone();
  };
  return (
    <div
      role="region"
      aria-label="Change the selected entities"
      className="sticky top-0 z-10 flex min-w-0 max-w-full flex-nowrap items-center gap-3 overflow-x-auto rounded-lg border border-accent/40 bg-surface p-2 shadow-sm"
    >
      <span className="shrink-0 whitespace-nowrap text-[13px] font-medium">{ids.length} selected</span>
      <div className="flex shrink-0 items-center gap-1.5">
        <label htmlFor="bulk-area" className="shrink-0 whitespace-nowrap text-xs text-muted">
          Assign area to selected entities
        </label>
        {requireArea && (
          <TooltipButton
            label="Area assignment help"
            compact
            className="shrink-0 text-muted"
            content="Only selected entities on this page are changed. Entities outside the registry cannot be selected. A device's main entity needs its own name to take an area; otherwise move its device in Organize."
          >
            <Info className="size-3.5" aria-hidden />
          </TooltipButton>
        )}
        <div className="w-48 shrink-0">
          <AreaSelect
            h={h}
            id="bulk-area"
            value={area}
            onChange={setArea}
            disabled={busy || !ids.length}
            noneLabel={requireArea ? "Choose an area…" : "Same as their device"}
          />
        </div>
        <Button
          disabled={busy || !ids.length || (requireArea && !area)}
          onClick={() =>
            void run(
              (e) => (e.ownAreaId === area ? null : { kind: "entity", op: "update", targetId: e.entityId, fields: { area_id: area } }),
              // A device's main entity can't take an area of its own without a name.
              (e) => Boolean(area) && e.needsOwnName && !e.customName,
              "a device's main entity needs a name before it can have an area of its own. Move its device instead, or name it first.",
            )
          }
        >
          Move
        </Button>
      </div>
      {ids.length > 0 && (
        <>
          <div className="flex shrink-0 items-center gap-1.5">
            <select aria-label="Label" className={`${inputClass} w-40!`} value={label} onChange={(ev) => setLabel(ev.target.value)}>
              <option value="">Choose a label…</option>
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <Button
              disabled={busy || !label}
              onClick={() =>
                void run((e) =>
                  e.labels.includes(label) ? null : { kind: "entity", op: "update", targetId: e.entityId, fields: { labels: [...e.labels, label] } },
                )
              }
            >
              Add label
            </Button>
            <ConfirmAction
              tone="plain"
              disabled={busy || !label}
              question={`Take “${h.labels[label]?.name ?? label}” off ${ids.length} selected?`}
              onConfirm={() =>
                void run((e) =>
                  !e.labels.includes(label)
                    ? null
                    : { kind: "entity", op: "update", targetId: e.entityId, fields: { labels: e.labels.filter((x) => x !== label) } },
                )
              }
            >
              Remove label
            </ConfirmAction>
          </div>
          <Button
            disabled={busy}
            className="shrink-0 whitespace-nowrap"
            onClick={() => void run((e) => (e.hidden ? null : { kind: "entity", op: "update", targetId: e.entityId, fields: { hidden_by: "user" } }))}
          >
            Hide
          </Button>
          <Button tone="ghost" className="ml-auto shrink-0 whitespace-nowrap" onClick={onDone}>
            Clear selection
          </Button>
        </>
      )}
    </div>
  );
}

export function SearchResults({ h, query, filters, select }: { h: Hierarchy; query: string; filters: Filters; select: (s: Selection) => void }) {
  const q = query.trim().toLowerCase();
  const results = useMemo(
    () => Object.values(h.entities).filter((e) => visible(e, filters) && (e.name.toLowerCase().includes(q) || e.entityId.includes(q))),
    [h, q, filters],
  );
  const paging = usePagination(results.length, JSON.stringify([q, filters]));
  return (
    <div className="flex flex-col gap-4">
      <Heading title={`Entities matching “${query.trim()}”`} subtitle={`${results.length} found.`} />
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {results.slice(paging.start, paging.end).map((e) => {
          const area = e.areaId ? h.areas[e.areaId] : undefined;
          const Icon = ROLE_ICONS[e.role];
          return (
            <li key={e.entityId} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-[13px]">
              <Icon className="size-4 text-muted" aria-hidden />
              <span className="font-medium">{e.name}</span>
              <code className="font-mono text-xs text-muted">{e.entityId}</code>
              <span className="text-xs text-muted">{ROLE_LABEL[e.role]}</span>
              {area ? (
                <button type="button" className="ml-auto text-accent hover:underline" onClick={() => select({ kind: "area", id: area.id })}>
                  {area.name}
                </button>
              ) : (
                <span className="ml-auto text-muted">Not in any area</span>
              )}
            </li>
          );
        })}
      </ul>
      <Pagination {...paging} />
    </div>
  );
}
