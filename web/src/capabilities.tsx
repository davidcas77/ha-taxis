import { useMemo, useState, type ReactNode } from "react";

import {
  AREA_TYPES,
  CAPABILITIES,
  CLIMATE_KINDS,
  CLIMATE_KIND_LABEL,
  LIGHT_ROLES,
  areaChoice,
  areaInventory,
  inventoryMatrix,
  setAppliance,
  setAreaType,
  setBed,
  setBedroom,
  setClimateKind,
  setCounts,
  setKind,
  setLightRole,
  setRole,
  type AreaType,
  type Capability,
  type InventoryFlag,
  type InventoryRow,
  type InventorySettings,
  type MatrixRow,
  type MotionRole,
} from "../../shared/inventory.ts";
import { entryLights, setParameter } from "../../shared/parameters.ts";
import type { AreaNode, EntityItem, Hierarchy } from "../../shared/types.ts";
import { helperExclusions, helperKeyFor, type HelperKey } from "../../shared/helpers.ts";
import { CombinedHelperRow, useAreaHelperLines } from "./helpers.tsx";
import { useTaxis, type Route } from "./state.tsx";
import { CapabilityIcon } from "./capability-icons.tsx";
import { DataTable, type Column } from "./data-table.tsx";
import { TooltipButton } from "./tooltip.tsx";
import { AreaSelect, Button, EditedDot, EmptyState, Toolbar } from "./ui.tsx";

// The capability inventory: a matrix of areas by capability, and for each area
// the entities behind it with the choices Taxis keeps (what counts, roles).
// Everything here is saved at once, in Taxis only; Home Assistant is not
// touched.

const selectClass =
  "rounded-md border border-line bg-bg px-2 py-1 text-[13px] outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50";

const CAPABILITIES_NOTE = "Detected from each entity's area, domain and device class. Choices are stored in Taxis only; nothing changes in Home Assistant.";

// ---------------------------------------------------------------------------
// Lights without an area.
// ---------------------------------------------------------------------------

// Lights, not groups: the groups of the floors and the house have no area on purpose.
const lightsWithoutArea = (h: Hierarchy): EntityItem[] =>
  Object.values(h.entities)
    .filter((e) => e.domain === "light" && !e.disabled && e.areaId === null && e.platform !== "group" && e.members.length === 0)
    .sort((a, b) => a.name.localeCompare(b.name) || a.entityId.localeCompare(b.entityId));

// A device's main entity with no name of its own: Home Assistant only allows it an
// area of its own once it has one, so the same edit gives it the name it shows now.
const needsName = (e: EntityItem) => e.needsOwnName && !e.customName;

// Why a light's own area can't be set here yet, or null when it can. `named`: the
// user agreed to give it its current name.
function cannotPlace(e: EntityItem, named: boolean): string | null {
  if (!e.inRegistry) return "Not in the entity registry, so Home Assistant won't give it an area.";
  if (needsName(e) && !named) return "Its device's main entity: Home Assistant only allows it an area of its own once it has a name.";
  return null;
}

// The lights that sit in no area, with a picker per light. Adding them puts an
// area change per light in the list; the preview then shows them in their areas.
function LightsWithoutArea({ h }: { h: Hierarchy }) {
  const { propose, busy } = useTaxis();
  const lights = useMemo(() => lightsWithoutArea(h), [h]);
  const [chosen, setChosen] = useState<Record<string, string | null>>({});
  const [named, setNamed] = useState<Record<string, boolean>>({});
  const picked = lights.filter((e) => chosen[e.entityId] && !cannotPlace(e, named[e.entityId] === true));
  if (lights.length === 0) return null;

  const add = async () => {
    // The set of lights is read again when the preview reloads, so the ones that were placed drop out of the list.
    const inputs = picked.map((e) => ({
      kind: "entity" as const,
      op: "update" as const,
      targetId: e.entityId,
      fields: { area_id: chosen[e.entityId], ...(needsName(e) ? { name: e.name } : {}) },
    }));
    if (await propose(inputs)) {
      setChosen({});
      setNamed({});
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2.5" aria-label="Lights without an area">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-sm font-semibold">
          {lights.length} {lights.length === 1 ? "light has" : "lights have"} no area
        </h2>
        {picked.length > 0 && (
          <Button tone="primary" disabled={busy} onClick={() => void add()}>
            Add {picked.length} to changes
          </Button>
        )}
      </div>
      <p className="max-w-[68ch] text-xs text-muted">
        A light in no area is in none of the area light groups, so the recipes and the floor and house groups can't switch it. Choose its area; it is the
        light's own area, so its device stays where it is.
      </p>
      <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
        {lights.map((e) => {
          const why = cannotPlace(e, named[e.entityId] === true);
          const device = e.deviceId ? h.devices[e.deviceId]?.name : null;
          return (
            <li key={e.entityId} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 text-[13px]">
              <div className="flex min-w-[10rem] flex-1 flex-col">
                <span className="font-medium">{e.name}</span>
                <code className="font-mono text-xs text-muted">{e.entityId}</code>
                {why && <span className="mt-0.5 text-xs text-muted">{why}</span>}
                {needsName(e) && e.inRegistry && (
                  <label className="mt-0.5 flex cursor-pointer items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      aria-label={`Also name ${e.name} “${e.name}”`}
                      checked={named[e.entityId] === true}
                      onChange={(ev) => setNamed((n) => ({ ...n, [e.entityId]: ev.target.checked }))}
                      className="accent-[var(--accent)]"
                    />
                    Also give it the name “{e.name}” (set on the entity, so it no longer follows its device's name)
                  </label>
                )}
              </div>
              <span className="w-40 text-xs text-muted">{device ? `Device: ${device}` : "No device"}</span>
              <div className="w-48">
                <label className="sr-only" htmlFor={`light-area-${e.entityId}`}>
                  Area of {e.name}
                </label>
                <AreaSelect
                  h={h}
                  id={`light-area-${e.entityId}`}
                  value={e.inRegistry ? (chosen[e.entityId] ?? null) : null}
                  onChange={(v) => {
                    if (!e.inRegistry) return;
                    setChosen((c) => ({ ...c, [e.entityId]: v }));
                    // Picking an area for a device's main entity means giving it its name too;
                    // the box stays visible, so it can be unticked.
                    if (v && needsName(e)) setNamed((n) => (Object.hasOwn(n, e.entityId) ? n : { ...n, [e.entityId]: true }));
                  }}
                  noneLabel="Choose an area"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The matrix.
// ---------------------------------------------------------------------------

function CapabilityCount({ area, capability, entities, onOpen }: { area: string; capability: string; entities: InventoryRow[]; onOpen?: () => void }) {
  if (entities.length === 0) return null;
  const counted = entities.filter((entity) => entity.counts);
  const excluded = entities.filter((entity) => !entity.counts);
  const content = (rows: InventoryRow[], included: boolean) => (
    <>
      <p className="mb-2 font-semibold">
        {area} · {capability}: {rows.length} {included ? "counted" : "not counted"}
      </p>
      {rows.length === 0 ? (
        <p className="text-muted">No entities count for this capability.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((entity) => (
            <li key={entity.entityId}>
              <span className="block">{entity.name}</span>
              <code className="break-all font-mono text-[11px] text-muted">{entity.entityId}</code>
            </li>
          ))}
        </ul>
      )}
    </>
  );
  return (
    <span className="inline-flex items-center justify-center gap-1">
      <TooltipButton
        label={`${area}, ${capability}: ${counted.length} counted`}
        onClick={onOpen}
        content={content(counted, true)}
        className="rounded px-1 py-1.5 hover:bg-sunken focus-visible:outline-accent"
      >
        {counted.length}
      </TooltipButton>
      {excluded.length > 0 && (
        <TooltipButton
          label={`${area}, ${capability}: ${excluded.length} not counted`}
          onClick={onOpen}
          content={content(excluded, false)}
          className="rounded px-1 py-1.5 text-xs text-muted hover:bg-sunken focus-visible:outline-accent"
        >
          +{excluded.length}
        </TooltipButton>
      )}
    </span>
  );
}

// Floors sort by level (lowest first), then areas by name; areas on no floor
// come last. A string so one column can carry both.
function floorKey(r: MatrixRow): string | null {
  if (r.floorLevel !== null) return `0:${String(r.floorLevel + 1000).padStart(6, "0")}|${r.name}`;
  if (r.floorName) return `1:${r.floorName}|${r.name}`;
  return null;
}

export function CapabilitiesMatrix({ h, go }: { h: Hierarchy; go: (r: Route) => void }) {
  const { inventory, inventoryLoaded, naming } = useTaxis();
  const [showEmpty, setShowEmpty] = useState(false);
  // An area's own canonical helpers are under Helpers, not counted here.
  const all = useMemo(() => inventoryMatrix(h, inventory, helperExclusions(h, naming)).sort((a, b) => a.name.localeCompare(b.name)), [h, inventory, naming]);
  const shown = useMemo(() => (showEmpty ? all : all.filter((r) => r.total > 0)), [all, showEmpty]);
  const empty = all.length - all.filter((r) => r.total > 0).length;
  // Use the same inventory and canonical-helper exclusions as the displayed tallies.
  const inventories = useMemo(() => {
    const excluded = helperExclusions(h, naming);
    return Object.fromEntries(shown.map((row) => [row.areaId, areaInventory(h, inventory, row.areaId, excluded(row.areaId))]));
  }, [h, inventory, naming, shown]);
  const totals = useMemo(
    () => Object.fromEntries(CAPABILITIES.map((capability) => [capability.key, shown.flatMap((row) => inventories[row.areaId][capability.key])])),
    [shown, inventories],
  );

  const open = (areaId: string) => go({ page: "areas", sel: { kind: "area", id: areaId }, tab: "capabilities" });

  // Capability columns are always shown (priority 1): a matrix scrolls inside its card rather than lose a column.
  const columns: Column<MatrixRow>[] = [
    {
      id: "floor",
      header: "Floor",
      help: "The floor that contains this area.",
      priority: 3,
      minWidth: 110,
      maxWidth: 140,
      truncate: true,
      sort: floorKey,
      text: (r) => r.floorName ?? "No floor",
      cell: (r) => <span className="text-muted">{r.floorName ?? "No floor"}</span>,
    },
    {
      id: "area",
      header: "Area",
      help: "Open this area to choose which entities count.",
      priority: 1,
      sticky: true,
      width: 150,
      truncate: true,
      maxWidth: 126,
      sort: (r) => r.name,
      text: (r) => r.name,
      footer: "Total",
      cell: (r) => (
        <button type="button" className="text-left text-accent hover:underline" onClick={() => open(r.areaId)}>
          {r.name}
        </button>
      ),
    },
    ...CAPABILITIES.map((c): Column<MatrixRow> => ({
      id: c.key,
      header: c.short,
      label: c.label,
      icon: <CapabilityIcon capability={c.key} />,
      help: `Entities counted toward ${c.label.toLowerCase()} in this area.`,
      priority: 1,
      minWidth: 84,
      align: "center",
      sort: (r) => (r.perCapability[c.key].total === 0 ? null : r.perCapability[c.key].counted + r.perCapability[c.key].total / 1000),
      cell: (r) =>
        r.perCapability[c.key].total > 0 ? (
          <CapabilityCount area={r.name} capability={c.label} entities={inventories[r.areaId][c.key]} onOpen={() => open(r.areaId)} />
        ) : null,
      footer: <CapabilityCount area="Total" capability={c.label} entities={totals[c.key]} />,
    })),
  ];

  if (!inventoryLoaded) return <p className="text-[13px] text-muted">Loading the inventory settings…</p>;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <LightsWithoutArea h={h} />
      <p className="max-w-[68ch] text-[13px] text-muted">{CAPABILITIES_NOTE}</p>
      <Toolbar label="Capabilities filters">
        <label htmlFor="show-empty-areas" className="flex w-fit cursor-pointer items-center gap-2 text-[13px]">
          <input
            id="show-empty-areas"
            type="checkbox"
            checked={showEmpty}
            onChange={(e) => setShowEmpty(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          Show empty areas{empty > 0 && <span className="text-muted tabular-nums">({empty})</span>}
        </label>
      </Toolbar>
      <DataTable
        id="capabilities-matrix"
        label="Area capabilities"
        density="compact"
        rows={shown}
        rowKey={(r) => r.areaId}
        columns={columns}
        defaultSort={{ key: "floor", dir: "asc" }}
        empty={<EmptyState>{all.length === 0 ? "Home Assistant has no areas yet." : "No area has anything Taxis can use yet."}</EmptyState>}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// An area's Capabilities tab.
// ---------------------------------------------------------------------------

const FLAGS: Record<InventoryFlag, { label: string; hint: string; tone: string }> = {
  helper: { label: "Helper", hint: "Combines or derives from other entities, so it doesn't count unless you say so", tone: "border-line text-muted" },
  camera: { label: "Camera", hint: "On a device with a camera, so it may be looking outside this room", tone: "border-line text-muted" },
  unavailable: { label: "Unavailable", hint: "Not reporting right now", tone: "border-warn/40 bg-warn-soft text-warn" },
};

// What each motion and presence role means, shown once above the rows.
const ROLE_HINT = "Starts: turns the room occupied. Holds: keeps an occupied room occupied, but doesn't start it.";

const FAN_HINT =
  "A fan counts by default. A switch is listed too but doesn't count: tick Counts on the ones that run a fan, so the Bathroom fan recipe can switch them.";
const CLIMATE_HINT =
  "AC, Heating or Valve, read from the modes each one offers: one that can cool is an AC, one that only heats is Heating. Switch a radiator valve to Valve. Area climate runs an AC in both seasons, and heating and valves only in the heating season.";
const APPLIANCE_HINT =
  "Tick Appliance on the power sensors of machines (a washer, an oven): Appliance done tells you when one has finished. The levels are in watts.";

const SWITCHABLE: Partial<Record<Capability, [Capability, Capability]>> = {
  door: ["door", "window"],
  window: ["door", "window"],
  speaker: ["speaker", "tv"],
  tv: ["speaker", "tv"],
};

// One entity, so singular ("Doors" is the matrix column).
const KIND_LABEL: Partial<Record<Capability, string>> = { door: "Door", window: "Window", speaker: "Speaker", tv: "TV" };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function AreaCapabilitiesTab({ h, area, go }: { h: Hierarchy; area: AreaNode; go: (r: Route) => void }) {
  const { inventory, inventoryLoaded, inventorySaving, saveInventory, naming } = useTaxis();
  const [error, setError] = useState<string | null>(null);
  const locked = !inventoryLoaded || inventorySaving;
  const inv = useMemo(() => areaInventory(h, inventory, area.id, helperExclusions(h, naming)(area.id)), [h, inventory, naming, area.id]);
  const choice = areaChoice(inventory, area.id);
  // The combined entity of each capability, planned from the counts above, so
  // it follows a change to Counts at once.
  const helperLines = useAreaHelperLines(h, area.id);

  const run = async (edit: (s: InventorySettings) => InventorySettings) => {
    setError(null);
    const err = await saveInventory(edit);
    if (err) setError(err);
  };

  if (!inventoryLoaded) return <p className="text-[13px] text-muted">Loading the inventory settings…</p>;

  const present = CAPABILITIES.filter((c) => inv[c.key].length > 0);
  const absent = CAPABILITIES.filter((c) => inv[c.key].length === 0);
  // Speakers and TVs share one media group; it sits under the first of them the area has.
  const combinedUnder = (c: Capability): HelperKey | null => {
    const key = helperKeyFor(c);
    return key === "media" && present.find((p) => helperKeyFor(p.key) === "media")?.key !== c ? null : key;
  };
  const countedFor = (key: HelperKey) =>
    CAPABILITIES.filter((c) => helperKeyFor(c.key) === key).reduce((n, c) => n + inv[c.key].filter((r) => r.counts).length, 0);

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-[68ch] text-[13px] text-muted">{CAPABILITIES_NOTE}</p>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px]">
        <label className="flex items-center gap-2">
          Type
          <select
            className={selectClass}
            value={choice.type}
            disabled={locked}
            onChange={(e) => void run((s) => setAreaType(s, area.id, e.target.value as AreaType))}
          >
            {AREA_TYPES.map((t) => (
              <option key={t} value={t}>
                {cap(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={choice.bedroom}
            disabled={locked}
            onChange={(e) => void run((s) => setBedroom(s, area.id, e.target.checked))}
            className="accent-[var(--accent)]"
          />
          Bedroom
        </label>
      </div>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      {present.map((c) => {
        const key = combinedUnder(c.key);
        return (
          <CapabilitySection key={c.key} h={h} area={area} capability={c.key} label={c.label} rows={inv[c.key]} locked={locked} run={run}>
            {key && helperLines.ready && (
              <CombinedHelperRow h={h} area={area} helperKey={key} line={helperLines.lines.find((l) => l.row.key === key)} counted={countedFor(key)} go={go} />
            )}
          </CapabilitySection>
        );
      })}

      <p className="text-[13px] text-muted">
        {absent.length === 0 ? "This area has every capability." : `Not in this area: ${absent.map((c) => c.label).join(", ")}.`}
      </p>
    </div>
  );
}

// The light that comes on by day when the area becomes occupied. Left on the
// default, it is the area's only light, or else its main lights.
function EntryLightPicker({ area, rows }: { area: AreaNode; rows: InventoryRow[] }) {
  const { parameters, parametersLoaded, parametersSaving, saveParameters, notify } = useTaxis();
  if (!parametersLoaded || !rows.some((r) => r.counts)) return null;
  const entry = entryLights(parameters, area.id, rows);
  const name = (id: string) => rows.find((r) => r.entityId === id)?.name ?? id;
  const several = entry.source === "set" && entry.lights.length > 1;
  const value = entry.source !== "set" ? "" : several ? "*" : entry.lights[0];
  const save = async (next: string | null) => {
    const error = await saveParameters((p) => setParameter(p, { level: "area", id: area.id }, "entry_lights", next ? [next] : null));
    if (error) notify({ tone: "error", text: error });
  };
  return (
    <label className="flex flex-wrap items-center gap-2 text-[13px]">
      Entry light
      <select
        aria-label="Entry light"
        className={selectClass}
        value={value}
        disabled={parametersSaving}
        onChange={(ev) => (ev.target.value === "*" ? undefined : void save(ev.target.value || null))}
      >
        <option value="">{entry.suggested.length > 0 ? `Suggested: ${entry.suggested.map(name).join(", ")}` : "None suggested"}</option>
        {rows
          .filter((r) => r.counts)
          .map((r) => (
            <option key={r.entityId} value={r.entityId}>
              {r.name}
            </option>
          ))}
        {several && <option value="*">{entry.lights.length} lights (set on the Parameters page)</option>}
      </select>
      <span className="text-xs text-muted">Comes on by day when the area becomes occupied.</span>
    </label>
  );
}

type RunEdit = (edit: (s: InventorySettings) => InventorySettings) => Promise<void>;

const chipClass = (active: boolean) =>
  `rounded-md border px-2 py-0.5 text-xs outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50 ${active ? "border-accent bg-accent-soft text-accent" : "border-line bg-bg text-muted hover:text-fg"}`;

// A row of buttons in place of a select: the active one is pressed, and a click picks another.
function Chips<T extends string>({
  options,
  value,
  ariaLabel,
  disabled,
  onPick,
}: {
  options: { value: T; label: string }[];
  value: T;
  ariaLabel: (label: string) => string;
  disabled: boolean;
  onPick: (v: T) => void;
}) {
  return (
    <span role="group" className="inline-flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          aria-label={ariaLabel(o.label)}
          disabled={disabled}
          onClick={() => o.value !== value && onPick(o.value)}
          className={chipClass(o.value === value)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

const MOTION_ROLES: { value: MotionRole; label: string }[] = [
  { value: "starts", label: "Starts" },
  { value: "holds", label: "Holds" },
];

function stateText(h: Hierarchy, row: InventoryRow) {
  const e = h.entities[row.entityId];
  return e?.state === null || e === undefined ? "no state" : e.unit ? `${e.state} ${e.unit}` : e.state;
}

// One capability: a sortable table of its entities.
function CapabilitySection({
  h,
  area,
  capability,
  label,
  rows,
  locked,
  run,
  children,
}: {
  h: Hierarchy;
  area: AreaNode;
  capability: Capability;
  label: string;
  rows: InventoryRow[];
  locked: boolean;
  run: RunEdit;
  // Under the table: the capability's combined entity.
  children?: ReactNode;
}) {
  const counted = rows.filter((r) => r.counts).length;
  const columns = capabilityColumns(h, locked, run);
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-sm font-semibold">
        {label} · {counted} of {rows.length} count{rows.length === 1 ? "s" : ""}
      </h2>
      {(capability === "motion" || capability === "presence") && <p className="text-xs text-muted">{ROLE_HINT}</p>}
      {capability === "fan" && <p className="text-xs text-muted">{FAN_HINT}</p>}
      {capability === "power" && <p className="text-xs text-muted">{APPLIANCE_HINT}</p>}
      {capability === "thermostat" && <p className="text-xs text-muted">{CLIMATE_HINT}</p>}
      {capability === "lights" && <EntryLightPicker area={area} rows={rows} />}
      <DataTable
        id="area-capability-entities"
        label={`${label} of ${area.name}`}
        rows={rows}
        rowKey={(r) => r.entityId}
        columns={columns}
        defaultSort={{ key: "name", dir: "asc" }}
        maxHeight="none"
      />
      {children}
    </section>
  );
}

// The entities of one capability: whether each counts, its name and id, its
// state, flags, and the choices that belong to its kind.
function capabilityColumns(h: Hierarchy, locked: boolean, run: RunEdit): Column<InventoryRow>[] {
  return [
    {
      id: "counts",
      header: "Counts",
      priority: 1,
      width: 80,
      sort: (r) => (r.counts ? 0 : 1),
      cell: (row) => (
        <input
          type="checkbox"
          aria-label={`Counts: ${row.name}`}
          checked={row.counts}
          disabled={locked}
          onChange={(ev) => void run((s) => setCounts(h, s, row.entityId, ev.target.checked))}
          className="accent-[var(--accent)]"
        />
      ),
    },
    {
      id: "name",
      header: "Name",
      priority: 1,
      minWidth: 180,
      sort: (r) => r.name,
      cell: (row) => (
        <>
          <span className="flex items-center gap-1.5 font-medium">
            {row.name}
            {row.overridden && <EditedDot title="Differs from what Taxis detected" />}
          </span>
          <code className="block max-w-[26rem] truncate font-mono text-xs text-muted" title={row.entityId}>
            {row.entityId}
          </code>
        </>
      ),
    },
    {
      id: "state",
      header: "State",
      priority: 3,
      minWidth: 90,
      nowrap: true,
      sort: (r) => stateText(h, r),
      text: (r) => stateText(h, r),
      cell: (row) => <span className="text-xs tabular-nums text-muted">{stateText(h, row)}</span>,
    },
    {
      id: "type",
      header: "Type",
      priority: 2,
      minWidth: 100,
      sort: (r) => r.flags.map((f) => FLAGS[f].label).join(", "),
      text: (r) => r.flags.map((f) => FLAGS[f].label).join(", "),
      cell: (row) =>
        row.flags.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {row.flags.map((f) => (
              <span key={f} title={FLAGS[f].hint} className={`rounded-full border px-1.5 py-0.5 text-[11px] ${FLAGS[f].tone}`}>
                {FLAGS[f].label}
              </span>
            ))}
          </span>
        ) : null,
    },
    {
      id: "role",
      header: "Role",
      priority: 1,
      minWidth: 160,
      sort: (r) =>
        r.capability === "lights"
          ? r.light
          : r.capability === "motion" || r.capability === "presence"
            ? r.role
            : r.capability === "thermostat"
              ? r.climate
              : SWITCHABLE[r.capability]
                ? r.capability
                : null,
      cell: (row) => <RoleChoices h={h} row={row} locked={locked} run={run} />,
    },
  ];
}

function RoleChoices({ h, row, locked, run }: { h: Hierarchy; row: InventoryRow; locked: boolean; run: RunEdit }) {
  const pair = SWITCHABLE[row.capability];
  return (
    <span className="flex flex-wrap items-center gap-3">
      {(row.capability === "motion" || row.capability === "presence") && (
        <Chips
          options={MOTION_ROLES}
          value={row.role ?? "starts"}
          ariaLabel={(l) => `${l}: ${row.name}`}
          disabled={locked}
          onPick={(v) => void run((s) => setRole(h, s, row.entityId, v))}
        />
      )}
      {row.capability === "presence" && (
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            aria-label={`Bed sensor: ${row.name}`}
            checked={row.bed ?? false}
            disabled={locked}
            onChange={(ev) => void run((s) => setBed(s, row.entityId, ev.target.checked))}
            className="accent-[var(--accent)]"
          />
          Bed
        </label>
      )}
      {row.capability === "power" && (
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            aria-label={`Appliance: ${row.name}`}
            checked={row.appliance ?? false}
            disabled={locked}
            onChange={(ev) => void run((s) => setAppliance(s, row.entityId, ev.target.checked))}
            className="accent-[var(--accent)]"
          />
          Appliance
        </label>
      )}
      {pair && (
        <Chips
          options={pair.map((k) => ({ value: k, label: KIND_LABEL[k] ?? k }))}
          value={row.capability}
          ariaLabel={(l) => `${l}: ${row.name}`}
          disabled={locked}
          onPick={(v) => void run((s) => setKind(h, s, row.entityId, v))}
        />
      )}
      {row.capability === "thermostat" && (
        <Chips
          options={CLIMATE_KINDS.map((k) => ({ value: k, label: CLIMATE_KIND_LABEL[k] }))}
          value={row.climate ?? "heating"}
          ariaLabel={(l) => `${l}: ${row.name}`}
          disabled={locked}
          onPick={(v) => void run((s) => setClimateKind(h, s, row.entityId, v))}
        />
      )}
      {row.capability === "lights" && (
        <Chips
          options={LIGHT_ROLES.map((l) => ({ value: l, label: cap(l) }))}
          value={row.light ?? "main"}
          ariaLabel={(l) => `${l}: ${row.name}`}
          disabled={locked}
          onPick={(v) => void run((s) => setLightRole(s, row.entityId, v))}
        />
      )}
    </span>
  );
}
