import { ChevronDown, ChevronRight, ExternalLink, PanelRight, Search } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";

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
import { displayRole } from "../../shared/roles.ts";
import { diagnosisText, type Diagnosis } from "../../shared/entity-diagnosis.ts";
import { sortRows } from "../../shared/sort.ts";
import type { DeviceItem, EntityItem, EntityRole, Hierarchy } from "../../shared/types.ts";
import { useTaxis } from "./state.tsx";
import { useStoredChoice, useStoredFlag } from "./storage.ts";
import { useWhy } from "./why.tsx";
import { GroupToggle, GroupedRows, SortHeader, useSortState } from "./table.tsx";
import { AreaSelect, EditedDot, inputClass } from "./ui.tsx";

// Devices & entities: the table of every device with the entities it holds, for
// the whole home (the Devices & entities page) or for one area (its tab). A device
// is a row with a chevron; opening it shows its entities under it, and an entity
// with no device sits under "No device". Names and areas change in place, and every
// change goes in the change list like an edit anywhere else.
//
// With "Group by type" on, the device tree gives way to one flat table of the
// entities, in sections by what they are: a tree of devices and sections by type
// don't mix.

const VIEWS = ["devices", "groups"] as const;
type View = (typeof VIEWS)[number];

const chip = (on: boolean) => `rounded-md border px-2 py-1 ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`;

const roleOf = displayRole;

export type DevicesEntitiesProps = {
  h: Hierarchy;
  // An area's tab, or (left out) the whole home.
  areaId?: string;
  // The page's own filters: disabled and diagnostic entities, a label, a manufacturer, an area.
  // Keep each the same function between renders, or the table is worked out again.
  entityOk: (e: EntityItem) => boolean;
  deviceOk?: (d: DeviceItem) => boolean;
  areaOk?: (areaId: string | null) => boolean;
  picked: ReadonlySet<string>;
  toggle: (id: string) => void;
  onOpenEntity: (id: string) => void;
  onOpenDevice: (id: string) => void;
  // Controls for the page's own filters, beside the search box.
  toolbar?: ReactNode;
  // Where "Show entities" is remembered, and whether it starts on (an area's tab
  // starts on; a table of the whole home, on the section's say).
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

export function DevicesEntities({ h, areaId, entityOk, deviceOk, areaOk, picked, toggle, onOpenEntity, onOpenDevice, toolbar, place, defaultShowEntities, onRecord, groups, limit, bulk, onSelectAll }: DevicesEntitiesProps) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<ReadonlySet<EntityRole>>(new Set());
  const [showAll, setShowAll] = useStoredFlag(`taxis:devices-entities:show:${place}`, defaultShowEntities ?? place === "area");
  const [grouped, setGrouped] = useStoredFlag("taxis:group-by-type:devices-entities");
  const [view, setView] = useStoredChoice<View>("taxis:devices-entities-view", VIEWS, "devices");
  // Chevrons the user clicked: they decide for their device, whatever Show entities says.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const { sort, toggle: toggleSort } = useSortState({ key: "name", dir: "asc" });
  const column = sort.key as TreeColumn;

  // A new area starts with every kind showing and nothing opened by hand.
  useEffect(() => {
    setChosen(new Set());
    setOverrides(new Map());
    setQuery("");
  }, [areaId]);

  const scope = useMemo<Scope>(() => (areaId ? { kind: "area", areaId } : { kind: "all" }), [areaId]);
  const collected = useMemo(() => collectBranches(h, { scope, entityOk, deviceOk, areaOk }), [h, scope, entityOk, deviceOk, areaOk]);
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

  const flat = grouped && view === "devices";
  const branches = useMemo(() => sortBranches(h, filtered, column, sort.dir), [h, filtered, column, sort.dir]);
  const drawnBranches = limit ? branches.slice(0, limit) : branches;
  const flatRows = useMemo(() => (flat ? sortRows(branchEntities(filtered), (e) => entityValue(h, e, column), sort.dir) : []), [flat, filtered, h, column, sort.dir]);
  const drawnFlat = limit ? flatRows.slice(0, limit) : flatRows;
  const shownIds = useMemo(() => new Set((flat ? drawnFlat : branchEntities(drawnBranches)).map((e) => e.entityId)), [flat, drawnFlat, drawnBranches]);
  const entityCount = flat ? flatRows.length : branchEntities(filtered).length;
  const cut = flat ? flatRows.length - drawnFlat.length : branches.length - drawnBranches.length;

  const setOpen = (key: string, open: boolean) => setOverrides((m) => new Map(m).set(key, open));
  // Show entities opens or folds every device, and leaves the chevrons clicked before it behind.
  const showEntities = (on: boolean) => {
    setShowAll(on);
    setOverrides(new Map());
  };

  if (collected.length === 0) return <p className="text-[13px] text-muted">No devices or entities here with the current filters.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-[14rem] flex-1 items-center gap-2 rounded-md border border-line bg-bg px-2 py-1.5">
          <Search className="size-4 text-muted" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a device or an entity" aria-label="Find a device or an entity" className="w-full bg-transparent text-[13px] outline-none" />
        </label>
        {toolbar}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="Show kinds" className="flex flex-1 flex-wrap gap-1 text-xs">
          <button type="button" aria-pressed={active.size === 0} onClick={() => setChosen(new Set())} className={chip(active.size === 0)}>
            All {entityTotal}
          </button>
          {counts.map((c) => (
            <button key={c.role} type="button" aria-pressed={active.has(c.role)} onClick={() => flip(c.role)} className={chip(active.has(c.role))}>
              {c.label} {c.count}
            </button>
          ))}
        </div>
        {groups && (
          <div role="group" aria-label="View" className="flex gap-1 text-xs">
            {VIEWS.map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={chip(view === v)}>
                {v === "devices" ? "Devices" : "Groups"}
              </button>
            ))}
          </div>
        )}
        {view === "devices" && (
          <>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={showAll} onChange={(e) => showEntities(e.target.checked)} className="accent-[var(--accent)]" /> Show entities
            </label>
            <GroupToggle on={grouped} onChange={setGrouped} />
          </>
        )}
      </div>

      {view === "groups" && groups ? (
        groups(branchEntities(filtered).map((e) => e.entityId))
      ) : (
        <>
          {bulk?.(shownIds)}
          <p className="text-xs text-muted">
            {flat ? null : `${branches.length.toLocaleString()} ${branches.length === 1 ? "device" : "devices"}, `}
            {entityCount.toLocaleString()} {entityCount === 1 ? "entity" : "entities"}
            {cut > 0 && `, showing the first ${(flat ? drawnFlat.length : drawnBranches.length).toLocaleString()}`}.{" "}
            {onSelectAll && (
              <button type="button" className="text-accent hover:underline" onClick={() => onSelectAll([...shownIds].filter((id) => h.entities[id]?.inRegistry))}>
                Select all shown
              </button>
            )}
            {flat ? " Edits go in the list of changes; nothing reaches Home Assistant until it is applied." : " Edits go in the list of changes; nothing reaches Home Assistant until it is applied. A device's area is its entities' area unless an entity has one of its own."}
          </p>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-[13px]">
              <thead className="bg-sunken text-left text-xs text-muted">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <SortHeader label="Name" k="name" sort={sort} onToggle={toggleSort} />
                  <SortHeader label={flat ? "Entity id" : "Model / entity id"} k="id" sort={sort} onToggle={toggleSort} />
                  <SortHeader label={flat ? "Type" : "Entities / type"} k="type" sort={sort} onToggle={toggleSort} />
                  <SortHeader label="Show as" k="showAs" sort={sort} onToggle={toggleSort} />
                  <SortHeader label="State" k="state" sort={sort} onToggle={toggleSort} />
                  <SortHeader label="Why" k="why" sort={sort} onToggle={toggleSort} />
                  <SortHeader label="Area" k="area" sort={sort} onToggle={toggleSort} />
                  <th className="w-16 px-1.5 py-2">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {flat ? (
                  <GroupedRows rows={drawnFlat} grouped colSpan={9} roleOf={roleOf} row={(e) => <EntityRow key={e.entityId} h={h} e={e} picked={picked} toggle={toggle} onOpen={onOpenEntity} onRecord={onRecord} />} />
                ) : (
                  drawnBranches.map((b) => {
                    const open = isBranchOpen(b, { showAll, query, override: overrides.get(b.key) });
                    return (
                      <Fragment key={b.key}>
                        <DeviceRow h={h} b={b} open={open} onToggle={() => setOpen(b.key, !open)} onOpen={onOpenDevice} onRecord={onRecord} />
                        {open && b.entities.map((e) => <EntityRow key={e.entityId} h={h} e={e} picked={picked} toggle={toggle} onOpen={onOpenEntity} onRecord={onRecord} indent />)}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
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
function WhyCell({ why }: { why: Diagnosis | null }) {
  return (
    <td className="max-w-[16rem] px-3 py-1.5 text-xs" title={why ? diagnosisText(why) : undefined}>
      {why && <span className={`block truncate ${why.severity === "error" ? "text-danger" : why.severity === "warning" ? "text-warn" : "text-muted"}`}>{why.reason}</span>}
    </td>
  );
}

// Opens the item in Organize's list, selected: for a table that sits beside it.
function RecordButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={`Show ${label} in the list`} title="Show in the list" onClick={onClick} className="rounded-md p-1 text-muted hover:bg-sunken hover:text-fg">
      <PanelRight className="size-4" aria-hidden />
    </button>
  );
}

function DeviceRow({ h, b, open, onToggle, onOpen, onRecord }: { h: Hierarchy; b: Branch; open: boolean; onToggle: () => void; onOpen: (id: string) => void; onRecord?: (id: string) => void }) {
  const { propose, busy, edited } = useTaxis();
  const why = useWhy();
  const d = b.device;
  const reason = d ? why.device(d) : null;
  const Chevron = open ? ChevronDown : ChevronRight;
  const label = d ? d.name : "No device";
  const total = b.all.length;
  const count = b.entities.length === total ? String(total) : `${b.entities.length} of ${total}`;
  const change = (fields: Record<string, unknown>) => (d ? propose({ kind: "device", op: "update", targetId: d.id, fields }) : Promise.resolve(false));
  const elsewhere = b.elsewhere ? (b.elsewhere.areaId ? `device in ${h.areas[b.elsewhere.areaId]?.name ?? "another area"}` : "device has no area") : null;
  return (
    <tr className="border-t border-line bg-sunken/40 align-top hover:bg-sunken" data-branch={b.key === NO_DEVICE ? "none" : "device"}>
      <td className="px-3 py-1.5" />
      <td className="min-w-[12rem] px-3 py-1.5">
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
      </td>
      <td className="px-3 py-1.5 text-muted">{d ? [d.manufacturer, d.model].filter(Boolean).join(" · ") || "–" : "Entities with no device"}</td>
      <td className="px-3 py-1.5 tabular-nums text-muted">
        {count} {total === 1 ? "entity" : "entities"}
      </td>
      <td className="px-3 py-1.5 text-muted">–</td>
      <td className="max-w-[9rem] truncate px-3 py-1.5 tabular-nums text-muted" title={deviceStateSummary(b.all)}>
        {b.all.length === 0 ? "–" : deviceStateSummary(b.all)}
      </td>
      <WhyCell why={reason} />
      <td className="px-3 py-1.5">
        {d ? (
          <div className="w-40">
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
                void change({ area_id: v });
              }}
            />
          </div>
        ) : (
          <span className="text-muted">–</span>
        )}
      </td>
      <td className="whitespace-nowrap px-1.5 py-1.5">
        {d && onRecord && <RecordButton label={`device ${d.name}`} onClick={() => onRecord(d.id)} />}
        {d && (
          <button type="button" aria-label={`Open device ${d.name}`} title="Open" onClick={() => onOpen(d.id)} className="rounded-md p-1 text-muted hover:bg-sunken hover:text-fg">
            <ExternalLink className="size-4" aria-hidden />
          </button>
        )}
      </td>
    </tr>
  );
}

function EntityRow({ h, e, picked, toggle, onOpen, onRecord, indent }: { h: Hierarchy; e: EntityItem; picked: ReadonlySet<string>; toggle: (id: string) => void; onOpen: (id: string) => void; onRecord?: (id: string) => void; indent?: boolean }) {
  const { propose, busy, edited } = useTaxis();
  const why = useWhy();
  const editable = e.inRegistry && !busy;
  const domain = e.domain;
  const change = (fields: Record<string, unknown>) => propose({ kind: "entity", op: "update", targetId: e.entityId, fields });
  return (
    <tr className="border-t border-line align-top hover:bg-sunken">
      <td className="px-3 py-1.5">{e.inRegistry && <input type="checkbox" aria-label={`Select ${e.name}`} checked={picked.has(e.entityId)} onChange={() => toggle(e.entityId)} />}</td>
      <td className={`min-w-[10rem] py-1.5 pr-3 ${indent ? "pl-10" : "pl-3"}`}>
        {e.inRegistry ? (
          <div className="flex items-center gap-1.5">
            <EditableText label={`Name of ${e.entityId}`} value={e.name} disabled={!editable} onCommit={(v) => change({ name: v })} />
            {edited.has(`entity:${e.entityId}`) && <EditedDot />}
          </div>
        ) : (
          <span title="No unique id, so Home Assistant won't let it be renamed.">{e.name}</span>
        )}
      </td>
      <td className="min-w-[12rem] px-3 py-1.5">
        {e.inRegistry ? (
          <EditableText
            label={`Entity id of ${e.name}`}
            mono
            value={e.entityId}
            disabled={!editable}
            validate={(v) => (!ENTITY_ID_RE.test(v) ? "Lower-case letters, digits and single underscores." : v.split(".")[0] !== domain ? `It has to stay a ${domain}.` : null)}
            onCommit={(v) => change({ new_entity_id: v })}
          />
        ) : (
          <code className="font-mono text-xs text-muted">{e.entityId}</code>
        )}
      </td>
      <td className="px-3 py-1.5 text-muted">{ROLE_LABEL[displayRole(e)]}</td>
      <td className="px-3 py-1.5">
        {e.inRegistry && hasDeviceClasses(domain) ? (
          <select
            aria-label={`Show ${e.name} as`}
            className={`${inputClass} w-40!`}
            disabled={!editable}
            value={e.deviceClassOverride ?? ""}
            onChange={(ev) => void change({ device_class: ev.target.value || null })}
          >
            <option value="">{e.deviceClassOverride === null && e.deviceClass ? `Default (${e.deviceClass.replace(/_/g, " ")})` : "Default"}</option>
            {[...new Set([...(e.deviceClassOverride && !DEVICE_CLASS_OPTIONS[domain].includes(e.deviceClassOverride) ? [e.deviceClassOverride] : []), ...DEVICE_CLASS_OPTIONS[domain]])].map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-muted">–</span>
        )}
      </td>
      <td className="max-w-[9rem] truncate px-3 py-1.5 tabular-nums text-muted">{entityStateText(e)}</td>
      <WhyCell why={why.entity(e)} />
      <td className="px-3 py-1.5">
        {e.inRegistry ? (
          <div className="w-40">
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
                void change({ area_id: v, ...(v && e.needsOwnName && !e.customName ? { name: e.name } : {}) });
              }}
            />
          </div>
        ) : (
          <span className="text-muted">{e.areaId ? h.areas[e.areaId]?.name : "–"}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-1.5 py-1.5">
        {onRecord && <RecordButton label={e.name} onClick={() => onRecord(e.entityId)} />}
        <button type="button" aria-label={`Open ${e.name}`} title="Open" onClick={() => onOpen(e.entityId)} className="rounded-md p-1 text-muted hover:bg-sunken hover:text-fg">
          <ExternalLink className="size-4" aria-hidden />
        </button>
      </td>
    </tr>
  );
}
