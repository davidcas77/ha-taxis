import { ChevronDown, ChevronRight, ExternalLink, PanelRight } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ENTITY_ID_RE } from "../../shared/changes.ts";
import { DEVICE_CLASS_OPTIONS, hasDeviceClasses } from "../../shared/device-classes.ts";
import {
  NO_DEVICE,
  ROLE_LABEL,
  branchEntities,
  branchRoleCounts,
  collectBranches,
  entityStateText,
  entityValue,
  filterBranches,
  isBranchOpen,
  sortBranches,
  deviceStateSummary,
  type Branch,
  type Scope,
  type TreeColumn,
} from "../../shared/device-tree.ts";
import { displayRole, sectionsByRole } from "../../shared/roles.ts";
import { diagnosisText, type Diagnosis } from "../../shared/entity-diagnosis.ts";
import { sortRows } from "../../shared/sort.ts";
import type { DeviceItem, EntityItem, EntityRole, Hierarchy } from "../../shared/types.ts";
import { DataTable, useSortState, type Column } from "./data-table.tsx";
import { ListEmpty, Pagination, usePagination } from "./records.tsx";
import { useStoredValue } from "./storage.ts";
import { useTaxis } from "./state.tsx";
import { useStoredChoice } from "./storage.ts";
import { useWhy } from "./why.tsx";
import { AreaSelect, Button, Chip, EditedDot, SearchField, Toolbar, inputClass } from "./ui.tsx";

// Devices & entities: the table of every device with the entities it holds, for
// the whole home (the Devices & entities page) or for one area (its tab). A device
// is a row with a chevron; opening it shows its entities under it, and an entity
// with no device sits under "No device". Names and areas change in place, and every
// change goes in the change list like an edit anywhere else.
//
// Groups uses the shared entity/group cards; Devices shows a collapsible tree;
// Entities is a flat table. All three use the same filters and selection state.

const VIEWS = ["groups", "devices", "entities"] as const;
type View = (typeof VIEWS)[number];

const roleOf = displayRole;

// Upgrade the previous two view buttons plus independent switches once, without
// silently turning a saved Groups preference into a device table.
function legacyView(place: string, defaultShowEntities: boolean): View {
  try {
    if (localStorage.getItem("taxis:devices-entities-view") === "groups") return "groups";
    if (localStorage.getItem("taxis:group-by-type:devices-entities") === "1") return "entities";
    const show = localStorage.getItem(`taxis:devices-entities:show:${place}`);
    return (show === null ? defaultShowEntities : show === "1") ? "entities" : "devices";
  } catch {
    return defaultShowEntities ? "entities" : "devices";
  }
}

export type DevicesEntitiesProps = {
  h: Hierarchy;
  // An area's tab, or (left out) the whole home.
  areaId?: string;
  // The page's own filters: disabled and diagnostic entities, a label, a manufacturer, an area.
  // Keep each the same function between renders, or the table is worked out again.
  entityOk: (e: EntityItem) => boolean;
  deviceOk?: (d: DeviceItem) => boolean;
  deviceLabelOk?: (d: DeviceItem) => boolean;
  includeLoose?: boolean;
  onResetFilters?: () => void;
  activeFilters?: ReactNode;
  areaOk?: (areaId: string | null) => boolean;
  picked: ReadonlySet<string>;
  toggle: (id: string) => void;
  onOpenEntity: (id: string) => void;
  onOpenDevice: (id: string) => void;
  // Controls for the page's own filters, beside the search box.
  toolbar?: ReactNode;
  // Preference scope and the legacy Show entities default, used only to migrate
  // existing browser settings to the three mutually exclusive views.
  place: string;
  defaultShowEntities?: boolean;
  // Open the item in Organize's list (Records), selected.
  onRecord?: (id: string) => void;
  // The cards by type, with a group's members under it, for the ids that pass the chips.
  groups?: (ids: string[]) => ReactNode;
  // The most devices (or, flat, entities) drawn; the rest are counted.
  limit?: number;
  // Above the table, given the ids it shows.
  bulk?: (shown: ReadonlySet<string>) => ReactNode;
  onSelectAll?: (ids: string[]) => void;
};

// One line of the table: a device, or one of its entities (or a loose one).
type TableRow = { kind: "device"; key: string; b: Branch; open: boolean } | { kind: "entity"; key: string; e: EntityItem; indent: boolean };

// The page orders the rows (sortBranches), so the headers only report clicks.
const noSort = () => null;

export function DevicesEntities({
  h,
  areaId,
  entityOk,
  deviceOk,
  deviceLabelOk,
  includeLoose,
  onResetFilters,
  activeFilters,
  areaOk,
  picked,
  toggle,
  onOpenEntity,
  onOpenDevice,
  toolbar,
  place,
  defaultShowEntities,
  onRecord,
  groups,
  limit,
  bulk,
  onSelectAll,
}: DevicesEntitiesProps) {
  const [query, setQuery] = useStoredValue(`taxis:search:${place}:${areaId ?? "home"}`, "", (v): v is string => typeof v === "string");
  const [chosen, setChosen] = useState<ReadonlySet<EntityRole>>(new Set());
  const [view, setView] = useStoredChoice<View>("taxis:devices-entities:mode:v2", VIEWS, legacyView(place, defaultShowEntities ?? place === "area"));
  // Device chevrons keep their manual state while switching between views.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const { sort, toggle: toggleSort } = useSortState({ key: "name", dir: "asc" });
  const column = sort.key as TreeColumn;
  const why = useWhy();

  // A new area starts with every kind showing and nothing opened by hand.
  useEffect(() => {
    setChosen(new Set());
    setOverrides(new Map());
  }, [areaId]);

  const scope = useMemo<Scope>(() => (areaId ? { kind: "area", areaId } : { kind: "all" }), [areaId]);
  const collected = useMemo(
    () => collectBranches(h, { scope, entityOk, deviceOk, deviceLabelOk, includeLoose, areaOk }),
    [h, scope, entityOk, deviceOk, deviceLabelOk, includeLoose, areaOk],
  );
  const counts = useMemo(() => branchRoleCounts(collected), [collected]);
  const entityTotal = counts.reduce((n, c) => n + c.count, 0);
  // A chip for a kind the table no longer has (its last entity moved away) is
  // dropped, not left filtering.
  const active = useMemo(() => new Set([...chosen].filter((r) => counts.some((c) => c.role === r))), [chosen, counts]);
  const filtered = useMemo(() => filterBranches(collected, { roles: active, query }), [collected, active, query]);
  const flip = (role: EntityRole) =>
    setChosen(() => {
      const n = new Set(active);
      if (!n.delete(role)) n.add(role);
      return n;
    });

  const flat = view === "entities" || (view === "groups" && !groups);
  const cards = view === "groups" && Boolean(groups);
  const branches = useMemo(() => sortBranches(h, filtered, column, sort.dir), [h, filtered, column, sort.dir]);
  const flatRows = useMemo(
    () => (flat || cards ? sortRows(branchEntities(filtered), (e) => entityValue(h, e, column), sort.dir) : []),
    [flat, cards, filtered, h, column, sort.dir],
  );
  const paging = usePagination(
    flat || cards ? flatRows.length : branches.length,
    JSON.stringify([view, query, [...active], sort, areaId, collected.map((b) => [b.key, b.all.length])]),
    limit ?? 100,
  );
  const drawnBranches = branches.slice(paging.start, paging.end);
  const drawnFlat = flatRows.slice(paging.start, paging.end);
  const shownIds = useMemo(
    () => new Set((flat || cards ? drawnFlat : branchEntities(drawnBranches)).map((e) => e.entityId)),
    [flat, cards, drawnFlat, drawnBranches],
  );
  const entityCount = flat || cards ? flatRows.length : branchEntities(filtered).length;
  const deviceCount = branches.filter((branch) => branch.device !== null).length;
  const looseCount = branches.find((branch) => branch.device === null)?.entities.length ?? 0;

  const setOpen = (key: string, open: boolean) => setOverrides((m) => new Map(m).set(key, open));
  const resetFilters = () => {
    setQuery("");
    setChosen(new Set());
    onResetFilters?.();
  };

  // The rows as one list: the devices with their open entities under them, or the
  // entities alone (in sections by kind when Groups has no cards to show).
  const grouped = flat && view === "groups";
  const sections = useMemo(() => (grouped ? sectionsByRole(drawnFlat, roleOf) : []), [grouped, drawnFlat]);
  const tableRows = useMemo<TableRow[]>(() => {
    if (cards) return [];
    if (flat) return (grouped ? sections.flatMap((s) => s.rows) : drawnFlat).map((e) => ({ kind: "entity", key: `entity:${e.entityId}`, e, indent: false }));
    return drawnBranches.flatMap((b) => {
      const open = isBranchOpen(b, { showAll: false, query, override: overrides.get(b.key) });
      return [
        { kind: "device", key: `device:${b.key}`, b, open } as TableRow,
        ...(open ? b.entities.map((e): TableRow => ({ kind: "entity", key: `${b.key}/${e.entityId}`, e, indent: true })) : []),
      ];
    });
  }, [cards, flat, grouped, sections, drawnFlat, drawnBranches, query, overrides]);
  const sectionLabel = useMemo(() => new Map(sections.map((s) => [s.role, s.label])), [sections]);

  const columns: Column<TableRow>[] = [
    {
      id: "pick",
      header: "Select",
      srOnlyHeader: true,
      locked: true,
      sticky: true,
      width: 32,
      priority: 1,
      cell: (r) =>
        r.kind === "entity" && r.e.inRegistry ? (
          <input type="checkbox" aria-label={`Select ${r.e.name}`} checked={picked.has(r.e.entityId)} onChange={() => toggle(r.e.entityId)} />
        ) : null,
    },
    {
      id: "name",
      header: "Name",
      priority: 1,
      sticky: true,
      minWidth: 200,
      maxWidth: 360,
      sort: noSort,
      cell: (r) =>
        r.kind === "device" ? (
          <DeviceNameCell h={h} b={r.b} open={r.open} onToggle={() => setOpen(r.b.key, !r.open)} />
        ) : (
          <EntityNameCell e={r.e} indent={r.indent} />
        ),
    },
    {
      id: "id",
      header: flat ? "Entity id" : "Model / entity id",
      priority: 2,
      minWidth: 220,
      maxWidth: 340,
      sort: noSort,
      cell: (r) => (r.kind === "device" ? <DeviceModel b={r.b} /> : <EntityIdCell e={r.e} />),
    },
    {
      id: "type",
      header: flat ? "Type" : "Entities / type",
      priority: 2,
      minWidth: 110,
      sort: noSort,
      cell: (r) => {
        if (r.kind === "entity") return <span className="text-muted">{ROLE_LABEL[displayRole(r.e)]}</span>;
        const total = r.b.all.length;
        const count = r.b.entities.length === total ? String(total) : `${r.b.entities.length} of ${total}`;
        return (
          <span className="tabular-nums text-muted">
            {count} {total === 1 ? "entity" : "entities"}
          </span>
        );
      },
    },
    {
      id: "showAs",
      header: "Show as",
      priority: 3,
      minWidth: 140,
      sort: noSort,
      cell: (r) => (r.kind === "entity" ? <ShowAsCell e={r.e} /> : <span className="text-muted">–</span>),
    },
    {
      id: "state",
      header: "State",
      priority: 3,
      minWidth: 90,
      maxWidth: 150,
      truncate: true,
      sort: noSort,
      text: (r) => (r.kind === "entity" ? entityStateText(r.e) : r.b.all.length === 0 ? "–" : deviceStateSummary(r.b.all)),
      cell: (r) => (
        <span className="tabular-nums text-muted">{r.kind === "entity" ? entityStateText(r.e) : r.b.all.length === 0 ? "–" : deviceStateSummary(r.b.all)}</span>
      ),
    },
    {
      id: "why",
      header: "Why",
      priority: 3,
      minWidth: 130,
      maxWidth: 256,
      truncate: true,
      sort: noSort,
      text: (r) => {
        const w = r.kind === "entity" ? why.entity(r.e) : r.b.device ? why.device(r.b.device) : null;
        return w ? diagnosisText(w) : "";
      },
      cell: (r) => <WhyText why={r.kind === "entity" ? why.entity(r.e) : r.b.device ? why.device(r.b.device) : null} />,
    },
    {
      id: "area",
      header: "Area",
      priority: 2,
      minWidth: 170,
      sort: noSort,
      cell: (r) => (r.kind === "entity" ? <EntityAreaCell h={h} e={r.e} /> : <DeviceAreaCell h={h} b={r.b} />),
    },
    {
      id: "open",
      header: "Open",
      srOnlyHeader: true,
      locked: true,
      width: 72,
      priority: 1,
      nowrap: true,
      cell: (r) =>
        r.kind === "entity" ? (
          <>
            {onRecord && <RecordButton label={r.e.name} onClick={() => onRecord(r.e.entityId)} />}
            <button
              type="button"
              aria-label={`Open ${r.e.name}`}
              title="Open"
              onClick={() => onOpenEntity(r.e.entityId)}
              className="rounded-md p-1 text-muted hover:bg-sunken hover:text-fg"
            >
              <ExternalLink className="size-4" aria-hidden />
            </button>
          </>
        ) : r.b.device ? (
          <>
            {onRecord && <RecordButton label={`device ${r.b.device.name}`} onClick={() => onRecord(r.b.device!.id)} />}
            <button
              type="button"
              aria-label={`Open device ${r.b.device.name}`}
              title="Open"
              onClick={() => onOpenDevice(r.b.device!.id)}
              className="rounded-md p-1 text-muted hover:bg-sunken hover:text-fg"
            >
              <ExternalLink className="size-4" aria-hidden />
            </button>
          </>
        ) : null,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {cards && groups && (
        <Toolbar label="Find and filter">
          <SearchField value={query} onChange={setQuery} placeholder="Find a device or an entity" />
          {toolbar}
          <Button tone="ghost" onClick={resetFilters}>
            Reset filters
          </Button>
        </Toolbar>
      )}
      {!cards && toolbar && <Toolbar label="Device and entity filters">{toolbar}</Toolbar>}
      {activeFilters}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Toolbar label="Show kinds" className="flex-1 gap-x-1">
          <Chip pressed={active.size === 0} onClick={() => setChosen(new Set())}>
            All {entityTotal}
          </Chip>
          {counts.map((c) => (
            <Chip key={c.role} pressed={active.has(c.role)} onClick={() => flip(c.role)}>
              {c.label} {c.count}
            </Chip>
          ))}
        </Toolbar>
        <Toolbar label="Entity view" className="gap-x-1">
          {VIEWS.map((mode) => (
            <Chip key={mode} pressed={view === mode} onClick={() => setView(mode)}>
              {mode === "groups" ? "Groups" : mode === "devices" ? "Devices" : "Entities"}
            </Chip>
          ))}
        </Toolbar>
      </div>

      {filtered.length === 0 && cards && groups ? (
        <ListEmpty reset={resetFilters} />
      ) : cards && groups ? (
        <>
          {bulk?.(shownIds)}
          {groups(drawnFlat.map((entity) => entity.entityId))}
          <Pagination {...paging} />
        </>
      ) : (
        <>
          <p className="text-xs text-muted">
            {flat
              ? null
              : `${deviceCount.toLocaleString()} ${deviceCount === 1 ? "device" : "devices"}${looseCount ? ` and ${looseCount} entities without a device` : ""}, `}
            {entityCount.toLocaleString()} {entityCount === 1 ? "entity" : "entities"}.{" "}
            {onSelectAll && (
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => onSelectAll([...shownIds].filter((id) => h.entities[id]?.inRegistry))}
              >
                Select all shown
              </button>
            )}
            {flat
              ? " Edits go in the list of changes; nothing reaches Home Assistant until it is applied."
              : " Edits go in the list of changes; nothing reaches Home Assistant until it is applied. A device's area is its entities' area unless an entity has one of its own."}
          </p>
          <DataTable
            id={`devices-entities-${place}`}
            search={{ value: query, onChange: setQuery, placeholder: "Find a device or an entity", label: "Find a device or an entity" }}
            actions={bulk?.(shownIds)}
            filters={
              <>
                <Button tone="ghost" onClick={resetFilters}>
                  Reset filters
                </Button>
              </>
            }

            label="Devices and entities"
            empty={<ListEmpty reset={resetFilters} />}
            rows={tableRows}
            rowKey={(r) => r.key}
            columns={columns}
            sort={sort}
            onSort={toggleSort}
            groupOf={grouped ? (r) => (r.kind === "entity" ? { key: roleOf(r.e), label: sectionLabel.get(roleOf(r.e)) ?? roleOf(r.e) } : null) : undefined}
            rowTone={(r) => (r.kind === "device" ? "muted" : "default")}
            rowAttrs={(r) =>
              r.kind === "device"
                ? { "data-branch": r.b.key === NO_DEVICE ? "none" : "device" }
                : { "data-entity-id": r.e.entityId, "data-device-child": r.indent ? "true" : undefined }
            }
            maxHeight="75vh"
          />
          <Pagination {...paging} />
        </>
      )}
    </div>
  );
}

// A text field that changes on Enter or when it loses focus, and goes back on
// Escape. An unchanged or refused value changes nothing.
function EditableText({
  label,
  value,
  mono,
  disabled,
  validate,
  onCommit,
}: {
  label: string;
  value: string;
  mono?: boolean;
  disabled?: boolean;
  validate?: (v: string) => string | null;
  // Resolves to false when the change was refused, so the old value comes back.
  onCommit: (v: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  // The preview brings the new value back after a save (or the old one, after a refusal).
  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);
  const commit = () => {
    const v = draft.trim();
    if (v === value) return setError(null);
    const bad = !v ? "Needs a value." : (validate?.(v) ?? null);
    if (bad) return setError(bad);
    setError(null);
    void onCommit(v).then((ok) => ok || setDraft(value));
  };
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <input
        aria-label={label}
        aria-invalid={error ? true : undefined}
        className={`${inputClass} ${mono ? "font-mono text-xs" : ""} ${error ? "border-danger" : ""}`}
        value={draft}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(value);
            setError(null);
          }
        }}
      />
      {error && (
        <span role="alert" className="text-[11px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

// Why a device or an entity does not work, cut short; the whole of it in the tooltip. Empty when it works.
function WhyText({ why }: { why: Diagnosis | null }) {
  if (!why) return null;
  return (
    <span
      title={diagnosisText(why)}
      className={`block truncate text-xs ${why.severity === "error" ? "text-danger" : why.severity === "warning" ? "text-warn" : "text-muted"}`}
    >
      {why.reason}
    </span>
  );
}

// Opens the item in Organize's list, selected: for a table that sits beside it.
function RecordButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Show ${label} in the list`}
      title="Show in the list"
      onClick={onClick}
      className="rounded-md p-1 text-muted hover:bg-sunken hover:text-fg"
    >
      <PanelRight className="size-4" aria-hidden />
    </button>
  );
}

function DeviceNameCell({ h, b, open, onToggle }: { h: Hierarchy; b: Branch; open: boolean; onToggle: () => void }) {
  const { propose, busy, edited } = useTaxis();
  const d = b.device;
  const Chevron = open ? ChevronDown : ChevronRight;
  const label = d ? d.name : "No device";
  const change = (fields: Record<string, unknown>) => (d ? propose({ kind: "device", op: "update", targetId: d.id, fields }) : Promise.resolve(false));
  const elsewhere = b.elsewhere ? (b.elsewhere.areaId ? `device in ${h.areas[b.elsewhere.areaId]?.name ?? "another area"}` : "device has no area") : null;
  return (
    <div className="flex items-start gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} the entities of ${label}`}
        onClick={onToggle}
        className="mt-1 rounded p-0.5 text-muted hover:bg-sunken hover:text-fg"
      >
        <Chevron className="size-4" aria-hidden />
      </button>
      {d ? (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <EditableText label={`Name of device ${d.name}`} value={d.name} disabled={busy} onCommit={(v) => change({ name_by_user: v })} />
            {edited.has(`device:${d.id}`) && <EditedDot />}
            {d.disabled && <span className="rounded bg-sunken px-1 text-[10px] text-muted">disabled</span>}
          </div>
          {elsewhere && <span className="text-[11px] text-muted">{elsewhere}</span>}
        </div>
      ) : (
        <span className="mt-1 font-medium text-muted">{label}</span>
      )}
    </div>
  );
}

function DeviceModel({ b }: { b: Branch }) {
  const d = b.device;
  return <span className="text-muted">{d ? [d.manufacturer, d.model].filter(Boolean).join(" · ") || "–" : "Entities with no device"}</span>;
}

function DeviceAreaCell({ h, b }: { h: Hierarchy; b: Branch }) {
  const { propose, busy } = useTaxis();
  const d = b.device;
  if (!d) return <span className="text-muted">–</span>;
  return (
    <div className="w-40 max-w-full">
      <label className="sr-only" htmlFor={`device-area-${d.id}`}>
        Area of device {d.name}
      </label>
      <AreaSelect
        h={h}
        id={`device-area-${d.id}`}
        value={d.areaId}
        noneLabel="No area"
        onChange={(v) => {
          if (v === d.areaId || busy) return;
          void propose({ kind: "device", op: "update", targetId: d.id, fields: { area_id: v } });
        }}
      />
    </div>
  );
}

function EntityNameCell({ e, indent }: { e: EntityItem; indent: boolean }) {
  const { propose, busy, edited } = useTaxis();
  const editable = e.inRegistry && !busy;
  return (
    <div className={`relative ${indent ? "pl-11" : ""}`}>
      {indent && (
        <span aria-hidden className="pointer-events-none absolute -bottom-1.5 -top-1.5 left-5 w-5 border-l border-line">
          <span className="absolute left-0 top-1/2 w-3 border-t border-line" />
        </span>
      )}
      <span className="sr-only">{indent ? "Entity of the device above" : ""}</span>
      {e.inRegistry ? (
        <div className="flex items-center gap-1.5">
          <EditableText
            label={`Name of ${e.entityId}`}
            value={e.name}
            disabled={!editable}
            onCommit={(v) => propose({ kind: "entity", op: "update", targetId: e.entityId, fields: { name: v } })}
          />
          {edited.has(`entity:${e.entityId}`) && <EditedDot />}
        </div>
      ) : (
        <span title="No unique id, so Home Assistant won't let it be renamed.">{e.name}</span>
      )}
    </div>
  );
}

function EntityIdCell({ e }: { e: EntityItem }) {
  const { propose, busy } = useTaxis();
  const editable = e.inRegistry && !busy;
  return e.inRegistry ? (
    <EditableText
      label={`Entity id of ${e.name}`}
      mono
      value={e.entityId}
      disabled={!editable}
      validate={(v) =>
        !ENTITY_ID_RE.test(v) ? "Lower-case letters, digits and single underscores." : v.split(".")[0] !== e.domain ? `It has to stay a ${e.domain}.` : null
      }
      onCommit={(v) => propose({ kind: "entity", op: "update", targetId: e.entityId, fields: { new_entity_id: v } })}
    />
  ) : (
    <code className="font-mono text-xs text-muted">{e.entityId}</code>
  );
}

function ShowAsCell({ e }: { e: EntityItem }) {
  const { propose, busy } = useTaxis();
  const domain = e.domain;
  if (!(e.inRegistry && hasDeviceClasses(domain))) return <span className="text-muted">–</span>;
  return (
    <select
      aria-label={`Show ${e.name} as`}
      className={`${inputClass} w-40! min-w-0 max-w-full`}
      disabled={busy}
      value={e.deviceClassOverride ?? ""}
      onChange={(ev) => void propose({ kind: "entity", op: "update", targetId: e.entityId, fields: { device_class: ev.target.value || null } })}
    >
      <option value="">{e.deviceClassOverride === null && e.deviceClass ? `Default (${e.deviceClass.replace(/_/g, " ")})` : "Default"}</option>
      {[
        ...new Set([
          ...(e.deviceClassOverride && !DEVICE_CLASS_OPTIONS[domain].includes(e.deviceClassOverride) ? [e.deviceClassOverride] : []),
          ...DEVICE_CLASS_OPTIONS[domain],
        ]),
      ].map((c) => (
        <option key={c} value={c}>
          {c.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}

function EntityAreaCell({ h, e }: { h: Hierarchy; e: EntityItem }) {
  const { propose } = useTaxis();
  if (!e.inRegistry) return <span className="text-muted">{e.areaId ? h.areas[e.areaId]?.name : "–"}</span>;
  return (
    <div className="w-40 max-w-full">
      <label className="sr-only" htmlFor={`area-${e.entityId}`}>
        Area of {e.name}
      </label>
      {/* An entity that follows its device has no area of its own to clear; it can only be given one. */}
      <AreaSelect
        h={h}
        id={`area-${e.entityId}`}
        value={e.areaId}
        noneLabel={e.ownAreaId === null && e.areaId ? "Follows its device" : "No area"}
        onChange={(v) => {
          if (v === e.areaId || (v === null && e.ownAreaId === null)) return;
          // A device's main entity with no name of its own is allowed an area only once it has a name: the same edit gives it the one it shows.
          void propose({
            kind: "entity",
            op: "update",
            targetId: e.entityId,
            fields: { area_id: v, ...(v && e.needsOwnName && !e.customName ? { name: e.name } : {}) },
          });
        }}
      />
    </div>
  );
}
