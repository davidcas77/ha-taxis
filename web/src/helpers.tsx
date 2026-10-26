import { useMemo, useState, type ReactNode } from "react";

import { HELPERS, hasPendingChange, helperChangeInputs, planHelpers, type HelperRow, type HelperStatus } from "../../shared/helpers.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { useTaxis, type Route } from "./state.tsx";
import { SortHeader, useSort } from "./table.tsx";
import { Button } from "./ui.tsx";

// Canonical helpers: what Taxis proposes per area, from the capabilities. One
// table, used on the Parameters page (every area) and at the end of an area's
// Capabilities tab (that area). Adding rows puts changes in the list; nothing
// reaches Home Assistant until the list is applied.

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

type Line = { row: HelperRow; shown: Shown; pending: boolean; selectable: boolean };

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

const change = (added: number, removed: number) => `+${added} −${removed}`;

function StatusCell({ line, go }: { line: Line; go: (r: Route) => void }) {
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
        main = `Update members ${change(row.added.length, row.removed.length)}`;
        tone = "text-warn";
        break;
      case "adopt":
        main = (
          <>
            Adopt: rename <code className="font-mono text-xs">{row.adoptFrom}</code> → <code className="font-mono text-xs">{row.canonicalId}</code>
            {row.membersDiffer && ` and update members ${change(row.added.length, row.removed.length)}`}
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
  if (row.areaSensor) notes.push(`Area ${row.key} sensor: ${row.areaSensor.current ?? "not set"} → ${row.canonicalId}`);
  return (
    <div className="flex flex-col gap-0.5">
      <span className={tone}>{main}</span>
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
      <ul className="mt-1 flex flex-col gap-0.5 text-xs">
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
                {showArea && <SortHeader label={lines.some((l) => l.row.level !== "area") ? "Level" : "Area"} k="area" sort={sort} onToggle={toggle} />}
                <SortHeader label="Helper" k="helper" sort={sort} onToggle={toggle} />
                <SortHeader label="Sources" k="sources" sort={sort} onToggle={toggle} />
                <SortHeader label="Status" k="status" sort={sort} onToggle={toggle} />
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
                  <td className="px-3 py-1.5">
                    <Sources h={h} row={l.row} />
                  </td>
                  <td className="px-3 py-1.5">
                    <StatusCell line={l} go={go} />
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
  const { ready, lines } = usePlan(h);
  const areas = useMemo(() => lines.filter((l) => l.row.level === "area"), [lines]);
  const upper = useMemo(() => lines.filter((l) => l.row.level !== "area"), [lines]);
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[68ch] text-[13px] text-muted">{HELPERS_NOTE}</p>
      {!ready ? (
        <p className="text-[13px] text-muted">Loading the settings…</p>
      ) : (
        <>
          {areas.length === 0 ? <p className="text-[13px] text-muted">No area has anything to roll up yet.</p> : <HelperTable h={h} lines={areas} showArea go={go} />}
          <section className="flex flex-col gap-2" aria-label="Floors and house">
            <h2 className="text-sm font-semibold">Floors and house</h2>
            <p className="max-w-[68ch] text-xs text-muted">{UPPER_NOTE}</p>
            {upper.length === 0 ? <p className="text-[13px] text-muted">No area has a light group yet, so there is nothing for the floors and the house to gather. Add the areas' light groups to the changes first.</p> : <HelperTable h={h} lines={upper} showArea go={go} />}
          </section>
        </>
      )}
    </div>
  );
}

// The end of an area's Capabilities tab: that area only.
export function AreaHelpersSection({ h, areaId, go }: { h: Hierarchy; areaId: string; go: (r: Route) => void }) {
  const { ready, lines } = usePlan(h);
  const mine = useMemo(() => lines.filter((l) => l.row.level === "area" && l.row.areaId === areaId), [lines, areaId]);
  if (!ready || mine.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Helpers</h2>
      <p className="text-xs text-muted">{HELPERS_NOTE}</p>
      <HelperTable h={h} lines={mine} showArea={false} go={go} />
    </section>
  );
}
