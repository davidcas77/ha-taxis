import { useMemo, useState, type ReactNode } from "react";

import {
  HELPERS,
  HELPER_SPEC,
  canonicalId,
  helperSuffixes,
  hasPendingChange,
  helperChangeInputs,
  helperExclusions,
  helperKeyFor,
  planHelpers,
  type HelperKey,
  type HelperRow,
  type HelperStatus,
} from "../../shared/helpers.ts";
import { CAPABILITIES, inventoryMatrix, type Capability, type MatrixRow } from "../../shared/inventory.ts";
import { cachedAreaCodes } from "../../shared/area-codes-cache.ts";
import type { AreaCode } from "../../shared/naming.ts";
import type { AreaNode, EntityItem, Hierarchy } from "../../shared/types.ts";
import { CapabilityIcon } from "./capability-icons.tsx";
import { DataTable, type Column } from "./data-table.tsx";
import { HelpDisclosure, HelpTopic } from "./help.tsx";
import { useTaxis, type Route } from "./state.tsx";
import { Button, Chip, EmptyState, Section, Tabs, Toolbar, inputClass, tabPanelId } from "./ui.tsx";

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
const membershipSummary = (row: HelperRow) =>
  row.membersUnreadable ? "Replace the group's members with the selected entities" : `Change group membership: ${change(row.added.length, row.removed.length)}`;

// The same explanation is shown in the area capability card and Helpers table.
function MembershipExplanation({ h, row }: { h: Hierarchy; row: HelperRow }) {
  if (row.status !== "update-members" && !(row.status === "adopt" && row.membersDiffer)) return null;
  const noun = row.key === "lights" ? "lights" : "entities";
  const list = (ids: string[]) => (
    <ul className="ml-4 list-disc">
      {ids.map((id) => (
        <li key={id}>
          {h.entities[id]?.name ?? id} <code className="font-mono text-[11px] text-muted">{id}</code>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="text-xs text-muted">
      <p>
        Updates which {noun} belong to this group. No {noun} are deleted. Nothing changes in Home Assistant until you apply the change list.
      </p>
      <details className="mt-1">
        <summary className="cursor-pointer text-accent">See exactly what changes</summary>
        <div className="mt-2 flex flex-col gap-2">
          {row.added.length > 0 ? (
            <div>
              <p className="font-medium text-fg">Add to the group ({row.added.length})</p>
              {list(row.added)}
            </div>
          ) : (
            <p>No {noun} will be added.</p>
          )}
          {row.membersUnreadable ? (
            <p>Home Assistant cannot report the current members, so the removals cannot be determined.</p>
          ) : row.removed.length > 0 ? (
            <div>
              <p className="font-medium text-fg">Remove from the group ({row.removed.length})</p>
              {list(row.removed)}
            </div>
          ) : (
            <p>No {noun} will be removed.</p>
          )}
          <div>
            <p className="font-medium text-fg">Group after applying ({row.sources.length})</p>
            {list(row.sources)}
          </div>
        </div>
      </details>
    </div>
  );
}

function StatusCell({ h, line, go }: { h: Hierarchy; line: Line; go: (r: Route) => void }) {
  const { row } = line;
  const settings = (
    <button type="button" className="text-accent hover:underline" onClick={() => go({ page: "settings", tab: "general" })}>
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
  if (!line.pending && row.status === "update-members" && row.membersUnreadable)
    notes.push("Current members could not be read because the group is unavailable; the exact removals are unknown");
  else if (!line.pending && row.status === "update-members" && row.missing && row.missing.length > 0)
    notes.push(`members that don't exist: ${row.missing.join(", ")}`);
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
// Level column). `tableId` keeps each table's column choices apart.
function HelperTable({ h, lines, showArea, go, tableId }: { h: Hierarchy; lines: Line[]; showArea: boolean; go: (r: Route) => void; tableId: string }) {
  const { propose, busy } = useTaxis();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const count = (k: (typeof FILTERS)[number]["key"]) => lines.filter((l) => matches(l, k)).length;
  const shown = useMemo(
    () =>
      lines.filter(
        (l) => matches(l, filter) && `${l.row.areaName} ${l.row.canonicalId} ${l.row.key} ${l.shown}`.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [lines, filter, query],
  );

  // Only rows that are still on screen and still waiting count as picked.
  const selectable = shown.filter((l) => l.selectable);
  const chosen = selectable.filter((l) => picked.has(keyOf(l.row)));
  const allChosen = selectable.length > 0 && chosen.length === selectable.length;

  const add = async () => {
    const inputs = chosen.flatMap((l) => helperChangeInputs(l.row));
    if (inputs.length === 0) return;
    if (await propose(inputs)) setPicked(new Set());
  };

  const areaText = (l: Line) => (l.row.level === "area" ? l.row.areaName : levelText(l.row));
  const columns: Column<Line>[] = [
    {
      id: "pick",
      header: (
        <input
          type="checkbox"
          aria-label="Select all that can be added"
          disabled={selectable.length === 0}
          checked={allChosen}
          onChange={() => setPicked(allChosen ? new Set() : new Set(selectable.map((l) => keyOf(l.row))))}
          className="accent-[var(--accent)]"
        />
      ),
      label: "Select",
      locked: true,
      priority: 1,
      width: 40,
      cell: (l) =>
        l.selectable ? (
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
        ) : null,
    },
    ...(showArea
      ? [
          {
            id: "area",
            header: lines.some((l) => l.row.level !== "area") ? "Level" : "Area",
            help: "The area, floor or house this helper serves.",
            priority: 2,
            minWidth: 120,
            maxWidth: 220,
            truncate: true,
            sort: areaText,
            text: areaText,
            cell: areaText,
          } satisfies Column<Line>,
        ]
      : []),
    {
      id: "helper",
      header: "Helper",
      help: "The combined entity Taxis will create or update.",
      priority: 1,
      minWidth: 200,
      sort: (l) => l.row.canonicalId,
      cell: (l) => (
        <>
          <code className="block max-w-[22rem] truncate font-mono text-xs" title={l.row.canonicalId}>
            {l.row.canonicalId}
          </code>
          <div className="text-[11px] text-muted">{NAME_OF[l.row.key]}</div>
        </>
      ),
    },
    {
      id: "sources",
      header: "Sources",
      help: "How many entities feed this helper; expand the count to see them.",
      priority: 2,
      minWidth: 90,
      align: "center",
      sort: (l) => l.row.sources.length,
      cell: (l) => <Sources h={h} row={l.row} />,
    },
    {
      id: "status",
      header: "Status",
      help: "Whether the helper is ready, needs changes or has a conflict.",
      priority: 1,
      minWidth: 240,
      sort: (l) => ORDER.indexOf(l.shown),
      cell: (l) => <StatusCell h={h} line={l} go={go} />,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Toolbar label="Show">
        <div className="flex flex-1 flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Chip key={f.key} pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label} {count(f.key)}
            </Chip>
          ))}
        </div>
      </Toolbar>
      <DataTable
        id={`helpers-${tableId}`}
        search={{ value: query, onChange: setQuery, placeholder: "Find an area or helper", label: `Find ${tableId} helpers` }}
        actions={
          chosen.length > 0 && (
            <Button tone="primary" disabled={busy} onClick={() => void add()}>
              Add {chosen.length} to changes
            </Button>
          )
        }
        label={showArea && lines.some((l) => l.row.level !== "area") ? "Floor and house helpers" : "Area helpers"}
        rows={shown}
        rowKey={(l) => keyOf(l.row)}
        columns={columns}
        defaultSort={{ key: showArea ? "area" : "helper", dir: "asc" }}
        empty={<EmptyState>Nothing here.</EmptyState>}
      />
    </div>
  );
}

function matches(l: Line, f: (typeof FILTERS)[number]["key"]): boolean {
  if (f === "all") return true;
  if (f === "todo") return l.selectable;
  return l.shown === f;
}

// The Parameters page: every area, then the floors and the house.
type OverviewFilters = { hideNotNeeded: boolean; capability: Capability | "all"; hideEmpty: boolean };

export function HelpersTab({ h, go }: { h: Hierarchy; go: (r: Route) => void }) {
  const [view, setView] = useState<"overview" | "details">("overview");
  const [filters, setFilters] = useState<OverviewFilters>({ hideNotNeeded: true, capability: "all", hideEmpty: false });
  const { ready, lines } = usePlan(h);
  const areas = useMemo(() => lines.filter((l) => l.row.level === "area"), [lines]);
  const upper = useMemo(() => lines.filter((l) => l.row.level !== "area"), [lines]);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p className="max-w-[68ch] text-[13px] text-muted">{HELPERS_NOTE}</p>
      <Tabs
        label="Helper view"
        value={view}
        onChange={setView}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "details", label: "Details" },
        ]}
      />
      {!ready ? (
        <p className="text-[13px] text-muted">Loading the settings…</p>
      ) : (
        <div id={tabPanelId("Helper view")} role="tabpanel" className="flex min-w-0 flex-col gap-6">
          {view === "overview" ? (
            <HelpersOverview h={h} lines={areas} go={go} filters={filters} onFiltersChange={setFilters} />
          ) : (
            <>
              {areas.length === 0 ? (
                <EmptyState>No area has anything to roll up yet.</EmptyState>
              ) : (
                <HelperTable h={h} lines={areas} showArea go={go} tableId="areas" />
              )}
              <Section title="Floors and house" id="helpers-upper">
                <HelpDisclosure summary="Floor groups gather room lights; the house group gathers floors." label="How groups are built">
                  <HelpTopic title="Membership and order">{UPPER_NOTE}</HelpTopic>
                </HelpDisclosure>
                {upper.length === 0 ? (
                  <EmptyState>
                    No area has a light group yet, so there is nothing for the floors and the house to gather. Add the areas' light groups to the changes first.
                  </EmptyState>
                ) : (
                  <HelperTable h={h} lines={upper} showArea go={go} tableId="upper" />
                )}
              </Section>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// What an overview cell says about one helper of one area.
type OverviewCell = { id: string; line: Line | undefined; exists: EntityItem | undefined; label: string; tone: string; key: HelperKey; hidden: boolean };

function overviewCell(
  h: Hierarchy,
  area: MatrixRow,
  capability: Capability,
  codes: Record<string, AreaCode>,
  suffixes: ReturnType<typeof helperSuffixes>,
  byArea: Map<string, Map<HelperKey, Line>>,
  hideNotNeeded: boolean,
): OverviewCell | null {
  const key = helperKeyFor(capability);
  if (!key) return null;
  const spec = HELPER_SPEC[key];
  const id = canonicalId(spec.domain, codes[area.areaId].code, suffixes[key]);
  const line = byArea.get(area.areaId)?.get(key);
  const exists = h.entities[id];
  let label = "Not needed";
  let tone = "text-muted";
  if (line) {
    label = line.pending
      ? "In changes"
      : line.row.status === "in-place"
        ? "Present"
        : line.row.status === "update-members"
          ? "Update members"
          : line.row.status === "adopt"
            ? "Adopt"
            : line.row.status === "conflict"
              ? "Conflict"
              : "Create";
    tone = line.pending ? "text-accent" : line.row.status === "in-place" ? "text-on" : line.row.status === "conflict" ? "text-danger" : "text-warn";
    if (!line.pending && line.row.status === "in-place" && (exists?.disabled || exists?.state === "unavailable")) {
      label += exists.disabled ? " · disabled" : " · unavailable";
      tone = "text-warn";
    }
    if (!line.pending && line.row.membersUnknown) label += " · members unchecked";
  } else if (exists) {
    label = exists.platform === spec.helper ? "Present · not required" : "Conflict";
    tone = exists.platform === spec.helper ? "text-muted" : "text-danger";
    if (exists.platform === spec.helper && (exists.disabled || exists.state === "unavailable")) {
      label += exists.disabled ? " · disabled" : " · unavailable";
      tone = "text-warn";
    }
  }
  return { id, line, exists, label, tone, key, hidden: hideNotNeeded && !line && !exists };
}

function HelpersOverview({
  h,
  lines,
  go,
  filters,
  onFiltersChange,
}: {
  h: Hierarchy;
  lines: Line[];
  go: (route: Route) => void;
  filters: OverviewFilters;
  onFiltersChange: (filters: OverviewFilters) => void;
}) {
  const { inventory, naming, propose, busy } = useTaxis();
  const all = useMemo(() => inventoryMatrix(h, inventory, helperExclusions(h, naming)).sort((a, b) => a.name.localeCompare(b.name)), [h, inventory, naming]);
  // Empty means no actual entities, independent of the selected capability,
  // counting choices and canonical-helper exclusions used by the planner.
  const shown = useMemo(
    () => (filters.hideEmpty ? all.filter((area) => h.areas[area.areaId].entityIds.some((id) => Boolean(h.entities[id]))) : all),
    [all, h, filters.hideEmpty],
  );
  const capabilities = CAPABILITIES.filter((capability) => filters.capability === "all" || capability.key === filters.capability);
  const codes = useMemo(() => cachedAreaCodes(h, naming), [h, naming]);
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

  // Capability columns are always shown (priority 1): the matrix scrolls inside its card, with the area in view.
  const columns: Column<MatrixRow>[] = [
    {
      id: "floor",
      header: "Floor",
      priority: 3,
      minWidth: 110,
      maxWidth: 140,
      truncate: true,
      sort: (a) => (a.floorId ? h.floors.findIndex((floor) => floor.id === a.floorId) : null),
      text: (a) => a.floorName ?? "No floor",
      cell: (a) => <span className="text-xs text-muted">{a.floorName ?? "No floor"}</span>,
    },
    {
      id: "area",
      header: "Area",
      priority: 1,
      sticky: true,
      width: 160,
      truncate: true,
      maxWidth: 136,
      sort: (a) => a.name,
      text: (a) => a.name,
      cell: (a) => (
        <button
          type="button"
          className="text-left text-accent hover:underline"
          onClick={() => go({ page: "areas", sel: { kind: "area", id: a.areaId }, tab: "capabilities" })}
        >
          {a.name}
        </button>
      ),
    },
    ...capabilities.map((capability): Column<MatrixRow> => ({
      id: capability.key,
      header: capability.short,
      label: capability.label,
      icon: <CapabilityIcon capability={capability.key} />,
      help: `The ${capability.label.toLowerCase()} helper of each area: its id and status.`,
      priority: 1,
      minWidth: 170,
      cell: (area) => {
        const cell = overviewCell(h, area, capability.key, codes, suffixes, byArea, filters.hideNotNeeded);
        if (!cell) return <span className="text-xs text-muted">No helper in Taxis</span>;
        if (cell.hidden) return null;
        const { id, line, exists, label, tone, key } = cell;
        return (
          <div className="max-w-52 text-xs">
            {line ? (
              <details>
                <summary aria-label={`${area.name} ${capability.label} helper details`} className="cursor-pointer">
                  <code className="block truncate" title={id}>
                    {id}
                  </code>
                  <span className={`mt-1 block font-medium ${tone}`}>{label}</span>
                </summary>
                <div className="mt-2 flex flex-col items-start gap-2">
                  <StatusCell h={h} line={line} go={go} />
                  <Sources h={h} row={line.row} />
                  {line.selectable && (
                    <Button
                      disabled={busy}
                      title="Add this helper to the changes for review. Home Assistant changes only when you Apply."
                      onClick={() => void propose(helperChangeInputs(line.row))}
                    >
                      Add to changes
                    </Button>
                  )}
                </div>
              </details>
            ) : (
              <>
                <code className="block truncate" title={id}>
                  {id}
                </code>
                <span className={`mt-1 block ${tone}`}>{label}</span>
                {!exists && (
                  <span className="mt-1 block text-muted">{key === "media" ? "Needs at least two counted media players." : "No counted sources."}</span>
                )}
              </>
            )}
          </div>
        );
      },
    })),
  ];

  return (
    <section aria-label="Helper coverage" className="flex min-w-0 flex-col gap-3">
      <p className="text-xs text-muted">
        Each cell shows the configured helper ID and its status. Create means the helper is missing. Expand a cell for sources and Add to changes; review and
        Apply creates or updates it in Home Assistant. Speakers and TVs share one media helper.
      </p>
      <Toolbar label="Helper overview filters" className="text-[13px]">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="accent-[var(--accent)]"
            checked={filters.hideNotNeeded}
            onChange={(event) => onFiltersChange({ ...filters, hideNotNeeded: event.target.checked })}
          />
          Hide not needed
        </label>
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor="helper-capability">Capability</label>
          <select
            id="helper-capability"
            className={`${inputClass} w-auto!`}
            value={filters.capability}
            onChange={(event) => onFiltersChange({ ...filters, capability: event.target.value as OverviewFilters["capability"] })}
          >
            <option value="all">All capabilities</option>
            {CAPABILITIES.map((capability) => (
              <option key={capability.key} value={capability.key}>
                {capability.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="accent-[var(--accent)]"
            checked={filters.hideEmpty}
            onChange={(event) => onFiltersChange({ ...filters, hideEmpty: event.target.checked })}
          />
          Hide empty areas
        </label>
      </Toolbar>
      <DataTable
        id="helpers-coverage"
        label="Area helper coverage"
        density="compact"
        rows={shown}
        rowKey={(a) => a.areaId}
        columns={columns}
        defaultSort={{ key: "floor", dir: "asc" }}
        empty={
          <EmptyState>{all.length === 0 ? "Home Assistant has no areas yet." : "No areas have entities. Clear Hide empty areas to show all areas."}</EmptyState>
        }
      />
    </section>
  );
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
export function CombinedHelperRow({
  h,
  area,
  helperKey,
  line,
  counted,
  go,
}: {
  h: Hierarchy;
  area: AreaNode;
  helperKey: HelperKey;
  line: Line | undefined;
  counted: number;
  go: (r: Route) => void;
}) {
  const { propose, busy, naming } = useTaxis();
  const spec = HELPER_SPEC[helperKey];
  const name = spec.label.toLowerCase();
  const id = line?.row.canonicalId ?? canonicalId(spec.domain, cachedAreaCodes(h, naming)[area.id].code, helperSuffixes(naming)[helperKey]);
  const row = line?.row;
  let status: ReactNode;
  let tone = "text-muted";
  if (!line || !row) {
    status =
      spec.min > 1
        ? `Not needed: a combined ${name} group takes at least ${spec.min} players, and ${counted} count${counted === 1 ? "s" : ""}.`
        : "Not needed: nothing of this counts yet.";
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
              <button type="button" className="text-accent hover:underline" onClick={() => go({ page: "settings", tab: "general" })}>
                change it in Settings → Type words and Aggregation markers
              </button>
            </>
          );
        break;
    }
  }
  const note =
    row?.areaSensor && !line?.pending
      ? `Area ${row.key} sensor: ${row.areaSensor.current ?? "not set"} → ${row.canonicalId}`
      : row?.membersUnknown && row.status === "in-place" && !line?.pending
        ? "members not checked"
        : null;
  const add = async () => {
    if (!row) return;
    await propose(helperChangeInputs(row));
  };
  return (
    <div
      role="group"
      aria-label={`Combined ${name}`}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-[13px]"
    >
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
