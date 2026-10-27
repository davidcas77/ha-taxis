import { useMemo, useState, type ReactNode } from "react";

import { HELPERS, HELPER_SPEC, canonicalId, helperSuffixes, hasPendingChange, helperChangeInputs, helperExclusions, helperKeyFor, planHelpers, type HelperKey, type HelperRow, type HelperStatus } from "../../shared/helpers.ts";
import { CAPABILITIES, inventoryMatrix, type MatrixRow } from "../../shared/inventory.ts";
import { areaCodes } from "../../shared/naming.ts";
import type { AreaNode, Hierarchy } from "../../shared/types.ts";
import { useTaxis, type Route } from "./state.tsx";
import { ColumnHeader, SortHeader, useSort } from "./table.tsx";
import { HelpDisclosure, HelpTopic } from "./help.tsx";
import { Button } from "./ui.tsx";

// Canonical helpers: what Taxis proposes per area, from the capabilities. One
// table on the Parameters page (every area), and under each capability of an
// area's Capabilities tab, its combined entity. Adding rows puts changes in the
// list; nothing reaches Home Assistant until the list is applied.

export const HELPERS_NOTE = "Helpers Taxis proposes per area, from the capabilities. Nothing is written until you apply the change list.";

export const UPPER_NOTE =
  "The light group of each floor gathers the light groups of its areas, and the house's gathers the floors' (and those of areas on no floor). Only groups that exist, or are in the change list, are members: add the areas' groups first, then these. They go in no area.";

const NAME_OF = Object.fromEntries(HELPERS.map((s) => [s.key, s.label])) as Record<string, string>;

// "in-changes" is not a plan status: the row is waiting in the list.
type Shown = HelperStatus | "in-changes";

const ORDER: Shown[] = ["conflict", "adopt", "update-members", "create", "in-changes", "in-place"];

const FILTERS: { key: Shown | "all" | "todo"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "todo", label: "To do" },
  { key: "in-place", label: "In place" },
  { key: "adopt", label: "Adopt" },
  { key: "update-members", label: "Update members" },
  { key: "create", label: "Create" },
  { key: "conflict", label: "Conflict" },
  { key: "in-changes", label: "In changes" },
];

export type Line = { row: HelperRow; shown: Shown; pending: boolean; selectable: boolean };

function usePlan(h: Hierarchy): { ready: boolean; lines: Line[] } {
  const { inventory, inventoryLoaded, naming, namingLoaded, changes } = useTaxis();
  const ready = inventoryLoaded && namingLoaded;
  const rows = useMemo(() => (ready ? planHelpers(h, inventory, naming, changes) : []), [ready, h, inventory, naming, changes]);
  const lines = useMemo(
    () =>
      rows.map((row): Line => {
        // A conflict has nothing to wait for; everything else waits once it's in the list.
        const pending = row.status !== "conflict" && hasPendingChange(row, changes);
        return { row, pending, shown: pending ? "in-changes" : row.status, selectable: row.actionable && !pending };
      }),
    [rows, changes],
  );
  return { ready, lines };
}

const change = (added: number, removed: number) => `add ${added} and remove ${removed}`;
const membershipSummary = (row: HelperRow) => row.membersUnreadable
  ? "Replace the group's members with the selected entities"
  : `Change group membership: ${change(row.added.length, row.removed.length)}`;

// The same explanation is shown in the area capability card and Helpers table.
function MembershipExplanation({ h, row }: { h: Hierarchy; row: HelperRow }) {
  if (row.status !== "update-members" && !(row.status === "adopt" && row.membersDiffer)) return null;
  const noun = row.key === "lights" ? "lights" : "entities";
  const list = (ids: string[]) => <ul className="ml-4 list-disc">{ids.map(id => <li key={id}>{h.entities[id]?.name ?? id} <code className="font-mono text-[11px] text-muted">{id}</code></li>)}</ul>;
  return <div className="text-xs text-muted">
    <p>Updates which {noun} belong to this group. No {noun} are deleted. Nothing changes in Home Assistant until you apply the change list.</p>
    <details className="mt-1">
      <summary className="cursor-pointer text-accent">See exactly what changes</summary>
      <div className="mt-2 flex flex-col gap-2">
        {row.added.length > 0 ? <div><p className="font-medium text-fg">Add to the group ({row.added.length})</p>{list(row.added)}</div> : <p>No {noun} will be added.</p>}
        {row.membersUnreadable ? <p>Home Assistant cannot report the current members, so the removals cannot be determined.</p> : row.removed.length > 0 ? <div><p className="font-medium text-fg">Remove from the group ({row.removed.length})</p>{list(row.removed)}</div> : <p>No {noun} will be removed.</p>}
        <div><p className="font-medium text-fg">Group after applying ({row.sources.length})</p>{list(row.sources)}</div>
      </div>
    </details>
  </div>;
}

function StatusCell({ h, line, go }: { h: Hierarchy; line: Line; go: (r: Route) => void }) {
  const { row } = line;
  const settings = (
    <button type="button" className="text-accent hover:underline" onClick={() => go({ page: "settings" })}>
      change the name in Settings
    </button>
  );
  let main: ReactNode;
  let tone = "text-muted";
  if (line.pending) {
    main = "In changes";
    tone = "text-accent";
  } else {
    switch (row.status) {
      case "in-place":
        main = "In place";
        tone = "text-on";
        break;
      case "update-members":
        main = membershipSummary(row);
        tone = "text-warn";
        break;
      case "adopt":
        main = (
          <>
            Adopt: rename <code className="font-mono text-xs">{row.adoptFrom}</code> → <code className="font-mono text-xs">{row.canonicalId}</code>
            {row.membersDiffer && ` and change group membership: ${change(row.added.length, row.removed.length)}`}
          </>
        );
        tone = "text-warn";
        break;
      case "create":
        main = "Create";
        tone = "text-warn";
        break;
      case "conflict":
        main =
          row.conflict === "not-editable" ? (
            <>
              Conflict: <code className="font-mono text-xs">{row.heldBy}</code> is a group written in YAML, so its members can't be changed here
            </>
          ) : (
            <>
              Conflict: held by <code className="font-mono text-xs">{row.heldBy}</code> ({row.heldByName}); {settings}
            </>
          );
        tone = "text-danger";
        break;
    }
  }
  const notes: string[] = [];
  if (!line.pending && row.status === "in-place" && row.membersUnknown) notes.push("members not checked");
  if (!line.pending && row.status === "update-members" && row.membersUnreadable) notes.push("Current members could not be read because the group is unavailable; the exact removals are unknown");
  else if (!line.pending && row.status === "update-members" && row.missing && row.missing.length > 0) notes.push(`members that don't exist: ${row.missing.join(", ")}`);
  if (row.areaSensor) notes.push(`Area ${row.key} sensor: ${row.areaSensor.current ?? "not set"} → ${row.canonicalId}`);
  return (
    <div className="flex flex-col gap-0.5">
      <span className={tone}>{main}</span>
      {!line.pending && <MembershipExplanation h={h} row={row} />}
      {notes.length > 0 && <span className="text-[11px] text-muted">{notes.join("; ")}</span>}
    </div>
  );
}

function Sources({ h, row }: { h: Hierarchy; row: HelperRow }) {
  return (
    <details>
      <summary className="cursor-pointer whitespace-nowrap tabular-nums" title={row.sources.map((id) => h.entities[id]?.name ?? id).join(", ")}>
        {row.sources.length}
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5 text-left text-xs">
        {row.sources.map((id) => (
          <li key={id}>
            {h.entities[id]?.name ?? id} <code className="font-mono text-muted">{id}</code>
          </li>
        ))}
      </ul>
    </details>
  );
}

const keyOf = (row: HelperRow) => row.canonicalId;

// Where a floor's or the house's group sits.
const levelText = (row: HelperRow) => (row.level === "house" ? "House" : `Floor · ${row.areaName}`);

// The table, its filter, its selection and its Add button. `lines` are the rows
// to show; `showArea` adds the Area column (for the floors and the house, the
// Level column).
function HelperTable({ h, lines, showArea, go }: { h: Hierarchy; lines: Line[]; showArea: boolean; go: (r: Route) => void }) {
  const { propose, busy } = useTaxis();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const count = (k: (typeof FILTERS)[number]["key"]) => lines.filter((l) => matches(l, k)).length;
  const shown = useMemo(() => lines.filter((l) => matches(l, filter)), [lines, filter]);
  const columns = useMemo(
    () => ({
      area: (l: Line) => (l.row.level === "area" ? l.row.areaName : levelText(l.row)),
      helper: (l: Line) => l.row.canonicalId,
      sources: (l: Line) => l.row.sources.length,
      status: (l: Line) => ORDER.indexOf(l.shown),
    }),
    [],
  );
  const { rows, sort, toggle } = useSort(shown, columns, { key: showArea ? "area" : "helper", dir: "asc" });

  // Only rows that are still on screen and still waiting count as picked.
  const selectable = rows.filter((l) => l.selectable);
  const chosen = selectable.filter((l) => picked.has(keyOf(l.row)));
  const allChosen = selectable.length > 0 && chosen.length === selectable.length;

  const add = async () => {
    const inputs = chosen.flatMap((l) => helperChangeInputs(l.row));
    if (inputs.length === 0) return;
    if (await propose(inputs)) setPicked(new Set());
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-[2rem] flex-wrap items-center gap-3">
        <div role="group" aria-label="Show" className="flex flex-1 flex-wrap gap-1 text-xs">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-md border px-2 py-1 ${filter === f.key ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}
            >
              {f.label} {count(f.key)}
            </button>
          ))}
        </div>
        {chosen.length > 0 && (
          <Button tone="primary" disabled={busy} onClick={() => void add()}>
            Add {chosen.length} to changes
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">Nothing here.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead className="bg-sunken text-left text-xs text-muted">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all that can be added"
                    disabled={selectable.length === 0}
                    checked={allChosen}
                    onChange={() => setPicked(allChosen ? new Set() : new Set(selectable.map((l) => keyOf(l.row))))}
                    className="accent-[var(--accent)]"
                  />
                </th>
                {showArea && <SortHeader label={lines.some((l) => l.row.level !== "area") ? "Level" : "Area"} help="The area, floor or house this helper serves." k="area" sort={sort} onToggle={toggle} />}
                <SortHeader label="Helper" help="The combined entity Taxis will create or update." k="helper" sort={sort} onToggle={toggle} />
                <SortHeader label="Sources" help="How many entities feed this helper; expand the count to see them." className="px-3 py-2 text-center" k="sources" sort={sort} onToggle={toggle} />
                <SortHeader label="Status" help="Whether the helper is ready, needs changes or has a conflict." k="status" sort={sort} onToggle={toggle} />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={keyOf(l.row)} className="border-t border-line align-top">
                  <td className="px-3 py-1.5">
                    {l.selectable && (
                      <input
                        type="checkbox"
                        aria-label={`Add ${l.row.canonicalId}`}
                        checked={picked.has(keyOf(l.row))}
                        onChange={() =>
                          setPicked((p) => {
                            const n = new Set(p);
                            if (!n.delete(keyOf(l.row))) n.add(keyOf(l.row));
                            return n;
                          })
                        }
                        className="accent-[var(--accent)]"
                      />
                    )}
                  </td>
                  {showArea && <td className="px-3 py-1.5">{l.row.level === "area" ? l.row.areaName : levelText(l.row)}</td>}
                  <td className="px-3 py-1.5">
                    <code className="font-mono text-xs">{l.row.canonicalId}</code>
                    <div className="text-[11px] text-muted">{NAME_OF[l.row.key]}</div>
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <Sources h={h} row={l.row} />
                  </td>
                  <td className="px-3 py-1.5">
                    <StatusCell h={h} line={l} go={go} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function matches(l: Line, f: (typeof FILTERS)[number]["key"]): boolean {
  if (f === "all") return true;
  if (f === "todo") return l.selectable;
  return l.shown === f;
}

// The Parameters page: every area, then the floors and the house.
export function HelpersTab({ h, go }: { h: Hierarchy; go: (r: Route) => void }) {
  const [view, setView] = useState<"overview" | "details">("overview");
  const { ready, lines } = usePlan(h);
  const areas = useMemo(() => lines.filter((l) => l.row.level === "area"), [lines]);
  const upper = useMemo(() => lines.filter((l) => l.row.level !== "area"), [lines]);
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[68ch] text-[13px] text-muted">{HELPERS_NOTE}</p>
      <div role="tablist" aria-label="Helper view" className="flex gap-1 border-b border-line">
        {(["overview", "details"] as const).map(tab => <button key={tab} id={`helper-view-${tab}`} type="button" role="tab" aria-selected={view === tab} aria-controls="helper-view-panel" onClick={() => setView(tab)} className={`border-b-2 px-3 py-2 text-[13px] ${view === tab ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-fg"}`}>{tab === "overview" ? "Overview" : "Details"}</button>)}
      </div>
      {!ready ? (
        <p className="text-[13px] text-muted">Loading the settings…</p>
      ) : (
        <div id="helper-view-panel" role="tabpanel" aria-labelledby={`helper-view-${view}`} className="flex min-w-0 flex-col gap-6">
          {view === "overview" ? <HelpersOverview h={h} lines={areas} go={go} /> : <>
          {areas.length === 0 ? <p className="text-[13px] text-muted">No area has anything to roll up yet.</p> : <HelperTable h={h} lines={areas} showArea go={go} />}
          <section className="flex flex-col gap-2" aria-label="Floors and house">
            <h2 className="text-sm font-semibold">Floors and house</h2>
            <HelpDisclosure summary="Floor groups gather room lights; the house group gathers floors." label="How groups are built"><HelpTopic title="Membership and order">{UPPER_NOTE}</HelpTopic></HelpDisclosure>
            {upper.length === 0 ? <p className="text-[13px] text-muted">No area has a light group yet, so there is nothing for the floors and the house to gather. Add the areas' light groups to the changes first.</p> : <HelperTable h={h} lines={upper} showArea go={go} />}
          </section>
          </>}
        </div>
      )}
    </div>
  );
}

function HelpersOverview({ h, lines, go }: { h: Hierarchy; lines: Line[]; go: (route: Route) => void }) {
  const { inventory, naming } = useTaxis();
  const all = useMemo(() => inventoryMatrix(h, inventory, helperExclusions(h, naming)).sort((a, b) => a.name.localeCompare(b.name)), [h, inventory, naming]);
  const codes = useMemo(() => areaCodes(h, naming), [h, naming]);
  const suffixes = useMemo(() => helperSuffixes(naming), [naming]);
  const byArea = useMemo(() => {
    const out = new Map<string, Map<HelperKey, Line>>();
    for (const line of lines) {
      const id = line.row.areaId!;
      if (!out.has(id)) out.set(id, new Map());
      out.get(id)!.set(line.row.key, line);
    }
    return out;
  }, [lines]);
  const columns = useMemo(() => ({
    floor: (area: MatrixRow) => area.floorId ? h.floors.findIndex(floor => floor.id === area.floorId) : null,
    area: (area: MatrixRow) => area.name,
  }), [h]);
  const { rows, sort, toggle } = useSort(all, columns, { key: "floor", dir: "asc" });
  return <section aria-label="Helper coverage" className="flex min-w-0 flex-col gap-3">
    <p className="text-xs text-muted">Every area and capability, using the helper names from Settings. Present, Create, Adopt, Update members, Conflict and In changes show different states. Expand a cell for details. Speakers and TVs share one media helper.</p>
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table aria-label="Area helper coverage" className="w-full text-[13px]">
        <thead className="bg-sunken text-left text-xs text-muted"><tr>
          <SortHeader label="Floor" k="floor" sort={sort} onToggle={toggle} />
          <SortHeader label="Area" k="area" sort={sort} onToggle={toggle} className="sticky left-0 z-10 bg-sunken px-3 py-2" />
          {CAPABILITIES.map(capability => <ColumnHeader key={capability.key}>{capability.label}</ColumnHeader>)}
        </tr></thead>
        <tbody>{rows.map(area => <tr key={area.areaId} className="border-t border-line align-top">
          <td className="px-3 py-2 text-xs text-muted">{area.floorName ?? "No floor"}</td>
          <td className="sticky left-0 z-10 bg-surface px-3 py-2"><button type="button" className="text-left text-accent hover:underline" onClick={() => go({ page: "areas", sel: { kind: "area", id: area.areaId }, tab: "capabilities" })}>{area.name}</button></td>
          {CAPABILITIES.map(capability => {
            const key = helperKeyFor(capability.key);
            if (!key) return <td key={capability.key} className="px-3 py-2 text-xs text-muted">No helper in Taxis</td>;
            const spec = HELPER_SPEC[key];
            const id = canonicalId(spec.domain, codes[area.areaId].code, suffixes[key]);
            const line = byArea.get(area.areaId)?.get(key);
            const exists = h.entities[id];
            let label = "Not needed";
            let tone = "text-muted";
            if (line) {
              label = line.pending ? "In changes" : line.row.status === "in-place" ? "Present" : line.row.status === "update-members" ? "Update members" : line.row.status === "adopt" ? "Adopt" : line.row.status === "conflict" ? "Conflict" : "Create";
              tone = line.pending ? "text-accent" : line.row.status === "in-place" ? "text-on" : line.row.status === "conflict" ? "text-danger" : "text-warn";
              if (!line.pending && line.row.status === "in-place" && (exists?.disabled || exists?.state === "unavailable")) { label += exists.disabled ? " · disabled" : " · unavailable"; tone = "text-warn"; }
              if (!line.pending && line.row.membersUnknown) label += " · members unchecked";
            } else if (exists) {
              label = exists.platform === spec.helper ? "Present · not required" : "Conflict";
              tone = exists.platform === spec.helper ? "text-muted" : "text-danger";
              if (exists.platform === spec.helper && (exists.disabled || exists.state === "unavailable")) { label += exists.disabled ? " · disabled" : " · unavailable"; tone = "text-warn"; }
            }
            return <td key={capability.key} className="px-3 py-2 text-xs">
              {line ? <details><summary aria-label={`${area.name} ${capability.label} helper details`} className="cursor-pointer"><code className="break-all">{id}</code><span className={`mt-1 block font-medium ${tone}`}>{label}</span></summary><div className="mt-2"><StatusCell h={h} line={line} go={go} /><Sources h={h} row={line.row} /></div></details> : <><code className="block break-all">{id}</code><span className={`mt-1 block ${tone}`}>{label}</span>{!exists && <span className="mt-1 block text-muted">{key === "media" ? "Needs at least two counted media players." : "No counted sources."}</span>}</>}
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

// An area's own helper lines, for its Capabilities tab (the same plan as the
// Parameters page, so the two always agree).
export function useAreaHelperLines(h: Hierarchy, areaId: string): { ready: boolean; lines: Line[] } {
  const { ready, lines } = usePlan(h);
  const mine = useMemo(() => lines.filter((l) => l.row.level === "area" && l.row.areaId === areaId), [lines, areaId]);
  return { ready, lines: mine };
}

// The one entity that rolls up a capability, under that capability's table: its
// id, where it stands, and a button when there is something to add. `counted`
// is how many entities of the capability count; `line` is undefined when the area
// gets no helper for it.
export function CombinedHelperRow({ h, area, helperKey, line, counted, go }: { h: Hierarchy; area: AreaNode; helperKey: HelperKey; line: Line | undefined; counted: number; go: (r: Route) => void }) {
  const { propose, busy, naming } = useTaxis();
  const spec = HELPER_SPEC[helperKey];
  const name = spec.label.toLowerCase();
  const id = line?.row.canonicalId ?? canonicalId(spec.domain, areaCodes(h, naming)[area.id].code, helperSuffixes(naming)[helperKey]);
  const row = line?.row;
  let status: ReactNode;
  let tone = "text-muted";
  if (!line || !row) {
    status = spec.min > 1 ? `Not needed: a combined ${name} group takes at least ${spec.min} players, and ${counted} count${counted === 1 ? "s" : ""}.` : "Not needed: nothing of this counts yet.";
  } else if (line.pending) {
    status = "In changes";
    tone = "text-accent";
  } else {
    switch (row.status) {
      case "in-place":
        status = "In place";
        tone = "text-on";
        break;
      case "create":
        status = `Will be created as ${row.canonicalId}`;
        tone = "text-warn";
        break;
      case "adopt":
        status = `Adopt: ${row.adoptFrom} renamed to ${row.canonicalId}${row.membersDiffer ? `, and change group membership: ${change(row.added.length, row.removed.length)}` : ""}`;
        tone = "text-warn";
        break;
      case "update-members":
        status = membershipSummary(row);
        tone = "text-warn";
        break;
      case "conflict":
        tone = "text-danger";
        status =
          row.conflict === "not-editable" ? (
            `Conflict: ${row.heldBy} is a group written in YAML, so its members can't be changed here`
          ) : (
            <>
              Conflict: held by {row.heldBy} ({row.heldByName});{" "}
              <button type="button" className="text-accent hover:underline" onClick={() => go({ page: "settings" })}>
                change it in Settings → Type words and Aggregation markers
              </button>
            </>
          );
        break;
    }
  }
  const note = row?.areaSensor && !line?.pending ? `Area ${row.key} sensor: ${row.areaSensor.current ?? "not set"} → ${row.canonicalId}` : row?.membersUnknown && row.status === "in-place" && !line?.pending ? "members not checked" : null;
  const add = async () => {
    if (!row) return;
    await propose(helperChangeInputs(row));
  };
  return (
    <div role="group" aria-label={`Combined ${name}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
      <span className="font-medium">Combined {name}</span>
      <code className="font-mono text-xs">{id}</code>
      <div className="flex min-w-[10rem] flex-1 flex-col gap-1">
        <span className={tone}>{status}</span>
        {note && <span className="text-[11px] text-muted">{note}</span>}
        {row && !line?.pending && <MembershipExplanation h={h} row={row} />}
      </div>
      {line?.selectable && (
        <Button tone="primary" disabled={busy} onClick={() => void add()}>
          Add to changes
        </Button>
      )}
    </div>
  );
}
