import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ENTITY_ID_RE } from "../../shared/changes.ts";
import { DEVICE_CLASS_OPTIONS, hasDeviceClasses } from "../../shared/device-classes.ts";
import { ROLE_ORDER, roleCounts } from "../../shared/roles.ts";
import type { EntityItem, EntityRole, Hierarchy } from "../../shared/types.ts";
import { useTaxis } from "./state.tsx";
import { useStoredChoice, useStoredFlag } from "./storage.ts";
import { GroupToggle, GroupedRows, SortHeader, useSort } from "./table.tsx";
import { AreaSelect, EditedDot, inputClass } from "./ui.tsx";

// An area's Entities tab: chips for the kinds of entity it has, and two views of
// the same entities, the cards by type and a table that edits in place. Every
// edit made here goes in the change list, like an edit anywhere else.

const ROLE_LABEL = Object.fromEntries(ROLE_ORDER.map((r) => [r.role, r.label])) as Record<EntityRole, string>;

const VIEWS = ["groups", "table"] as const;
type View = (typeof VIEWS)[number];

const roleOf = (e: EntityItem): EntityRole => e.role;

const stateOf = (e: EntityItem) => (e.disabled ? "disabled" : e.state === null ? "no state" : e.unit ? `${e.state} ${e.unit}` : e.state);

export function AreaEntities({
  h,
  areaId,
  entities,
  picked,
  toggle,
  onOpen,
  groups,
}: {
  h: Hierarchy;
  areaId: string;
  // The area's entities after the page's own filters (disabled, diagnostic).
  entities: EntityItem[];
  picked: ReadonlySet<string>;
  toggle: (id: string) => void;
  onOpen: (id: string) => void;
  // The cards, for the ids that pass the chips.
  groups: (ids: string[]) => ReactNode;
}) {
  const [view, setView] = useStoredChoice<View>("taxis:area-entities-view", VIEWS, "groups");
  const [chosen, setChosen] = useState<ReadonlySet<EntityRole>>(new Set());
  const counts = useMemo(() => roleCounts(entities.map((e) => e.role)), [entities]);
  // A new area starts with every kind showing.
  useEffect(() => setChosen(new Set()), [areaId]);
  // A chip for a kind the area no longer has (its last entity moved away) is
  // dropped, not left filtering.
  const active = useMemo(() => new Set([...chosen].filter((r) => counts.some((c) => c.role === r))), [chosen, counts]);
  const shown = useMemo(() => (active.size === 0 ? entities : entities.filter((e) => active.has(e.role))), [entities, active]);
  const flip = (role: EntityRole) =>
    setChosen(() => {
      const n = new Set(active);
      if (!n.delete(role)) n.add(role);
      return n;
    });

  if (entities.length === 0) return <p className="text-[13px] text-muted">No entities here with the current filters.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="Show kinds" className="flex flex-1 flex-wrap gap-1 text-xs">
          <button type="button" aria-pressed={active.size === 0} onClick={() => setChosen(new Set())} className={chip(active.size === 0)}>
            All {entities.length}
          </button>
          {counts.map((c) => (
            <button key={c.role} type="button" aria-pressed={active.has(c.role)} onClick={() => flip(c.role)} className={chip(active.has(c.role))}>
              {c.label} {c.count}
            </button>
          ))}
        </div>
        <div role="group" aria-label="View" className="flex gap-1 text-xs">
          {VIEWS.map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={chip(view === v)}>
              {v === "groups" ? "Groups" : "Table"}
            </button>
          ))}
        </div>
      </div>
      {view === "groups" ? groups(shown.map((e) => e.entityId)) : <EntityTable h={h} entities={shown} picked={picked} toggle={toggle} onOpen={onOpen} />}
    </div>
  );
}

const chip = (on: boolean) => `rounded-md border px-2 py-1 ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`;

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

function EntityTable({ h, entities, picked, toggle, onOpen }: { h: Hierarchy; entities: EntityItem[]; picked: ReadonlySet<string>; toggle: (id: string) => void; onOpen: (id: string) => void }) {
  const { propose, busy, edited } = useTaxis();
  const [grouped, setGrouped] = useStoredFlag("taxis:group-by-type:area-entities");
  const columns = useMemo(
    () => ({
      name: (e: EntityItem) => e.name,
      id: (e: EntityItem) => e.entityId,
      role: (e: EntityItem) => ROLE_LABEL[e.role],
      showAs: (e: EntityItem) => e.deviceClass,
      state: (e: EntityItem) => stateOf(e),
      area: (e: EntityItem) => (e.areaId ? h.areas[e.areaId]?.name : null),
    }),
    [h],
  );
  const { rows, sort, toggle: toggleSort } = useSort(entities, columns, { key: "name", dir: "asc" });
  const change = (e: EntityItem, fields: Record<string, unknown>) => propose({ kind: "entity", op: "update", targetId: e.entityId, fields });

  const renderRow = (e: EntityItem) => {
    const editable = e.inRegistry && !busy;
    const domain = e.domain;
    return (
      <tr key={e.entityId} className="border-t border-line align-top hover:bg-sunken">
        <td className="px-3 py-1.5">{e.inRegistry && <input type="checkbox" aria-label={`Select ${e.name}`} checked={picked.has(e.entityId)} onChange={() => toggle(e.entityId)} />}</td>
        <td className="min-w-[10rem] px-3 py-1.5">
          {e.inRegistry ? (
            <div className="flex items-center gap-1.5">
              <EditableText label={`Name of ${e.entityId}`} value={e.name} disabled={!editable} onCommit={(v) => change(e, { name: v })} />
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
              onCommit={(v) => change(e, { new_entity_id: v })}
            />
          ) : (
            <code className="font-mono text-xs text-muted">{e.entityId}</code>
          )}
        </td>
        <td className="px-3 py-1.5 text-muted">{ROLE_LABEL[e.role]}</td>
        <td className="px-3 py-1.5">
          {e.inRegistry && hasDeviceClasses(domain) ? (
            <select
              aria-label={`Show ${e.name} as`}
              className={`${inputClass} w-40`}
              disabled={!editable}
              value={e.deviceClassOverride ?? ""}
              onChange={(ev) => void change(e, { device_class: ev.target.value || null })}
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
        <td className="max-w-[9rem] truncate px-3 py-1.5 tabular-nums text-muted">{stateOf(e)}</td>
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
                  void change(e, { area_id: v, ...(v && e.needsOwnName && !e.customName ? { name: e.name } : {}) });
                }}
              />
            </div>
          ) : (
            <span className="text-muted">{e.areaId ? h.areas[e.areaId]?.name : "–"}</span>
          )}
        </td>
        <td className="px-1.5 py-1.5">
          <button type="button" aria-label={`Open ${e.name}`} title="Open" onClick={() => onOpen(e.entityId)} className="rounded-md p-1 text-muted hover:bg-sunken hover:text-fg">
            <ExternalLink className="size-4" aria-hidden />
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted">Edits go in the list of changes; nothing reaches Home Assistant until it is applied.</p>
        <span className="flex-1" />
        <GroupToggle on={grouped} onChange={setGrouped} />
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-[13px]">
          <thead className="bg-sunken text-left text-xs text-muted">
            <tr>
              <th className="w-8 px-3 py-2" />
              <SortHeader label="Name" k="name" sort={sort} onToggle={toggleSort} />
              <SortHeader label="Entity id" k="id" sort={sort} onToggle={toggleSort} />
              <SortHeader label="Type" k="role" sort={sort} onToggle={toggleSort} />
              <SortHeader label="Show as" k="showAs" sort={sort} onToggle={toggleSort} />
              <SortHeader label="State" k="state" sort={sort} onToggle={toggleSort} />
              <SortHeader label="Area" k="area" sort={sort} onToggle={toggleSort} />
              <th className="w-9 px-1.5 py-2">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <GroupedRows rows={rows} grouped={grouped} roleOf={roleOf} colSpan={8} row={renderRow} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
