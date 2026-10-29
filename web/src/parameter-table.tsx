import { useStoredChoice, useStoredFlag } from "./storage.ts";
import { PARAM_HELP } from "./parameter-help.ts";
import { Pencil, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { helperExclusions } from "../../shared/helpers.ts";
import { areaInventory } from "../../shared/inventory.ts";
import {
  PARAM_TAB_LABEL,
  checkValue,
  entryLights,
  ownValue,
  paramRows,
  paramsOf,
  resolveIn,
  setParameter,
  sourceName,
  type ParamDef,
  type ParamKey,
  type ParamRow,
  type ParamTab,
  type ParamValue,
} from "../../shared/parameters.ts";
import { canonicalPeriods, describePeriods } from "../../shared/periods.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { useTaxis } from "./state.tsx";
import { HelpDisclosure, HelpTopic } from "./help.tsx";
import { DataTable, useSortState, type Column } from "./data-table.tsx";
import { Chip, EmptyState, Toolbar } from "./ui.tsx";
import { TooltipButton } from "./tooltip.tsx";
import { ParameterPopover } from "./parameter-popover.tsx";

// The House, Occupancy, Lighting, Media, Climate, Bathroom fan, Exterior and Safety
// tabs of the Parameters page: one table per tab, a row for the house, for interior
// and exterior areas, for each
// floor and for each area, and a column per parameter. A cell shows the value set
// at that level, or the one it inherits in grey with where it comes from. Click a
// cell to set it (a yes/no flips at once); empty it to inherit again. Saved at
// once, in Taxis only.

const GUIDES: Record<ParamTab, { summary: string; topics: [string, string][] }> = {
  house: {
    summary: "Set night hours, home modes and notification destinations.",
    topics: [
      ["Night hours", "Lights use night brightness and colour during this window; Area climate uses the night temperature."],
      ["Away and sleep", "Choose existing switches, or leave them blank so Taxis creates its own when you install Area climate."],
      ["Notifications", "Enter notify services separated by commas, such as notify.mobile_app_phone. Leave blank to use Home Assistant notifications."],
      ["Speech", "Choose the text-to-speech entity for Announce. Notification destinations and speech are set for the whole house."],
    ],
  },
  occupancy: {
    summary: "Set how long rooms stay occupied after activity stops.",
    topics: [
      ["Hold times", "Normal is the usual timeout. Extended applies after prolonged occupancy. Sleep applies in bedrooms while a bed sensor detects someone."],
      [
        "Shower detection",
        "A humidity rise can hold an already-occupied room. Set the rate in % per second; 0 disables it. Requires the rate sensor made by Bathroom fan.",
      ],
    ],
  },
  lighting: {
    summary: "Set light levels, transitions and manual override timing.",
    topics: [
      ["Brightness and colour", "Choose day and night levels, the darkness threshold and transition times."],
      ["Manual override", "After someone changes a light, automation waits this long. Set 0 to wait until the room next clears."],
      [
        "Entry lights",
        "Choose which lights come on when the room becomes occupied by day. This is per room, not inherited. Blank uses the room's only light or its main lights.",
      ],
    ],
  },
  media: {
    summary: "Set when speakers and TVs turn off after a room clears.",
    topics: [
      ["Turn-off delays", "Speakers and TVs have separate delays, measured from when occupancy clears."],
      ["Announcement volume", "House-wide default for Announce. Set 0 to keep the current volume; an individual announcement can override it."],
    ],
  },
  climate: {
    summary: "Set heating and cooling targets, schedules and switching permissions.",
    topics: [
      ["Priority", "Open window → away → sleep → night → occupied during comfort periods → eco. The first matching rule wins."],
      [
        "Season and targets",
        "ACs can heat or cool; heating devices and radiator valves run only in the heating season. Cooling uses the Cool targets. Lowest and highest bound heating targets only.",
      ],
      ["Comfort periods", "Use day and time ranges, e.g. Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun 08:00-23:00. The latest end is 23:59."],
      ["Presets", "Use preset names offered by each thermostat. A device without the chosen preset receives a temperature target instead."],
      [
        "Automatic switching",
        "Enable Switch on and off itself to allow mode changes and window-triggered shutdown. Otherwise devices that are off or in the opposite seasonal mode are left alone.",
      ],
      ["Bedroom comfort", "Bedrooms do not require occupancy for comfort unless you enable that requirement."],
    ],
  },
  fan: {
    summary: "Set when humidity starts the bathroom fan and when it stops.",
    topics: [
      ["Start", "Triggered by a rapid humidity rise, a difference above a reference sensor, or the absolute humidity level. Rates use % per second."],
      ["Stop", "Stops when humidity returns near the reference, the rise stays flat for the configured time, or the maximum run time is reached."],
      [
        "Reference sensor",
        "Choose another room's humidity sensor or a house average. Without one, the starting humidity is used for stopping; only rise rate and absolute level start the fan.",
      ],
    ],
  },
  exterior: {
    summary: "Set sunset timing and how long outdoor lights stay on.",
    topics: [
      ["Sunset and sunrise", "A negative sunset offset turns lights on earlier. Lights turn off at sunrise."],
      ["Activity", "Motion or someone arriving home restarts the timer. Applies to areas marked exterior."],
    ],
  },
  safety: {
    summary: "Set open-door alerts and appliance-finished detection.",
    topics: [
      ["Left open", "Notify after a door or window has stayed open for the delay. Repeat 0 sends one notification."],
      [
        "Appliance done",
        "Mark a power sensor as an appliance in Capabilities. Above the running threshold for its duration means running; below the done threshold for its duration means finished. Thresholds use watts.",
      ],
    ],
  },
};

// A value in a table cell is a button that opens the field: it shows a box on hover
// and on focus, and a small pencil, so it reads as something to click.
const EDITABLE =
  "group inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded border border-transparent px-1.5 py-0.5 text-left hover:border-line hover:bg-sunken focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-60";
const PENCIL = "size-3 shrink-0 text-muted opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60";

const header = (d: ParamDef) => (d.unit ? `${d.label} (${d.unit})` : d.label);

const rowKey = (r: ParamRow) => `${r.scope.level}:${"id" in r.scope ? r.scope.id : ""}`;

// What the box takes: a time, a number in the parameter's range, a word, an entity
// id, a list of notify services or comfort periods (kept in one spelling).
function parseInput(def: ParamDef, text: string): { value: ParamValue | null } | { error: string } {
  const t = text.trim();
  if (t === "") return { value: null };
  const value = def.kind === "number" ? Number(t) : def.kind === "services" ? t.split(/[\s,;]+/).filter(Boolean) : t;
  const problem = checkValue(def, value);
  if (problem) return { error: problem };
  return { value: def.kind === "periods" ? canonicalPeriods(t)! : value };
}

// How a value reads in a cell.
function show(def: ParamDef, value: ParamValue): string {
  if (def.kind === "bool") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.length === 0 ? "–" : value.join(", ");
  if (value === "") return "–";
  return String(value);
}

// Names to offer for a preset: what the thermostats of the row report.
function presetNames(h: Hierarchy, row: ParamRow): string[] {
  const names = new Set<string>();
  for (const e of Object.values(h.entities)) {
    if (e.domain !== "climate" || e.presetModes.length === 0) continue;
    const inRow = row.scope.level === "area" ? e.areaId === row.scope.id : true;
    if (inRow) for (const m of e.presetModes) names.add(m);
  }
  return [...names].sort();
}

function Cell({ h, row, def, editing, onEdit }: { h: Hierarchy; row: ParamRow; def: ParamDef; editing: boolean; onEdit: (on: boolean) => void }) {
  const { parameters, parametersSaving, saveParameters, notify } = useTaxis();
  const own = ownValue(parameters, row.scope, def.key);
  const shown = resolveIn(parameters, row.chain, def.key);
  const input = useRef<HTMLInputElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const [text, setText] = useState("");
  const listId = `list-${rowKey(row)}-${def.key}`;
  // The suggestions of a text or entity box.
  const suggestions = useMemo(() => {
    if (def.kind === "entity")
      return Object.values(h.entities)
        .filter((e) => e.domain === def.domain && !e.disabled)
        .map((e) => e.entityId)
        .sort();
    if (def.kind === "text") return presetNames(h, row);
    return [];
  }, [h, row, def]);
  // Enter, Escape and leaving the box all end the edit once; the others are ignored.
  const ended = useRef(false);

  useEffect(() => {
    if (!editing) return;
    ended.current = false;
    setText(own === undefined ? "" : String(own));
    input.current?.focus();
    input.current?.select();
    select.current?.focus();
  }, [editing]);

  const save = async (value: ParamValue | null) => {
    onEdit(false);
    const error = await saveParameters((p) => setParameter(p, row.scope, def.key, value));
    if (error) notify({ tone: "error", text: error });
  };

  const commit = () => {
    if (ended.current) return;
    ended.current = true;
    const parsed = parseInput(def, text);
    if ("error" in parsed) {
      notify({ tone: "error", text: parsed.error });
      onEdit(false);
      return;
    }
    void save(parsed.value);
  };

  if (editing && def.kind === "enum") {
    return (
      <select
        ref={select}
        aria-label={`${def.label} for ${row.label}`}
        value={own === undefined ? "" : String(own)}
        onChange={(e) => {
          ended.current = true;
          if (e.target.value) void save(e.target.value);
        }}
        onBlur={() => {
          if (!ended.current) onEdit(false);
        }}
        className="min-w-0 max-w-full rounded-md border border-accent bg-bg px-1.5 py-0.5 text-[13px] outline-none"
      >
        <option value="" disabled>
          {String(shown.value)} (inherited)
        </option>
        {(def.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  if (editing) {
    const wide = def.kind === "periods" || def.kind === "entity" || def.kind === "services";
    return (
      <>
        <input
          ref={input}
          type={def.kind === "time" ? "time" : def.kind === "number" ? "number" : "text"}
          list={suggestions.length > 0 ? listId : undefined}
          aria-label={`${def.label} for ${row.label}`}
          value={text}
          min={def.min}
          max={def.max}
          step={def.step}
          placeholder={String(shown.value)}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              ended.current = true;
              onEdit(false);
            }
          }}
          className={`${wide ? "w-72" : "w-24"} min-w-0 max-w-full rounded-md border border-accent bg-bg px-1.5 py-0.5 text-[13px] tabular-nums outline-none ${def.kind === "number" || def.kind === "time" ? "text-center" : ""}`}
        />
        {suggestions.length > 0 && (
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}
      </>
    );
  }

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1">
      <button
        type="button"
        disabled={parametersSaving}
        onClick={() => (def.kind === "bool" ? void save(!shown.value) : onEdit(true))}
        title={`${def.kind === "periods" ? `${describePeriods(String(shown.value))}. ` : ""}${own === undefined ? `From ${sourceName(h, shown.source)}. Click to set it here.` : "Set here. Click to change it."}`}
        aria-label={`${def.label} for ${row.label}: ${show(def, shown.value)}${def.unit && def.kind === "number" ? ` ${def.unit}` : ""}, ${own === undefined ? `from ${sourceName(h, shown.source)}` : "set here"}`}
        className={`${EDITABLE} min-w-0 ${def.kind === "periods" || def.kind === "entity" || def.kind === "services" ? "max-w-[20rem] truncate" : "tabular-nums"} ${own === undefined ? "text-muted" : "font-medium"}`}
      >
        {show(def, shown.value)}
        <Pencil className={PENCIL} aria-hidden />
      </button>
      {own !== undefined && (
        <button
          type="button"
          disabled={parametersSaving}
          onClick={() => void save(null)}
          aria-label={`Clear ${def.label} for ${row.label}`}
          title="Clear, so it inherits again"
          className="rounded p-0.5 text-muted hover:text-fg disabled:opacity-60"
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </span>
  );
}

// The entry lights of an area: the ones chosen, or the suggested ones in grey. Other
// levels show a dash, since the parameter is not inherited.
function EntryLightsCell({ h, row, def, editing, onEdit }: { h: Hierarchy; row: ParamRow; def: ParamDef; editing: boolean; onEdit: (on: boolean) => void }) {
  const { parameters, parametersSaving, saveParameters, notify, inventory, naming } = useTaxis();
  const anchor = useRef<HTMLSpanElement>(null);
  const areaId = row.scope.level === "area" ? row.scope.id : null;
  const entry = useMemo(() => {
    if (!areaId) return null;
    const rows = areaInventory(h, inventory, areaId, helperExclusions(h, naming)(areaId)).lights;
    return { rows: rows.filter((r) => r.counts), resolved: entryLights(parameters, areaId, rows) };
  }, [h, inventory, naming, parameters, areaId]);
  if (!areaId || !entry)
    return (
      <span className="px-1.5 text-muted" title="Set for one area only: it is not inherited from a floor or the house">
        —
      </span>
    );

  const name = (id: string) => h.entities[id]?.name ?? id;
  const { resolved, rows } = entry;
  const save = async (value: string[] | null) => {
    const error = await saveParameters((p) => setParameter(p, row.scope, def.key, value));
    if (error) notify({ tone: "error", text: error });
  };

  if (rows.length === 0) return <span className="px-1.5 text-muted">–</span>;

  const own = resolved.source === "set";
  const text = `${resolved.lights.length} ${resolved.lights.length === 1 ? "light" : "lights"}`;
  return (
    <span ref={anchor} className="inline-flex max-w-full items-center gap-1">
      <TooltipButton
        label={`${def.label} for ${row.label}: ${text}, ${own ? "set here" : resolved.lights.length === 0 ? "none" : "suggested"}`}
        onClick={() => {
          if (!parametersSaving) onEdit(true);
        }}
        className={`${EDITABLE} flex-nowrap whitespace-nowrap ${own ? "font-medium" : "text-muted"}`}
        content={
          <div className="flex flex-col gap-2">
            <p className="font-medium">
              {text}
              {!own && resolved.lights.length > 0 ? " · Suggested" : ""}
            </p>
            {resolved.lights.length ? (
              resolved.lights.map((id) => (
                <div key={id}>
                  <p className="break-words">{name(id)}</p>
                  <code className="block break-all text-[11px] text-muted">{id}</code>
                </div>
              ))
            ) : (
              <p>No entry lights are selected or suggested. Click to choose.</p>
            )}
          </div>
        }
      >
        {text}
        {!own && resolved.lights.length > 0 && <span className="rounded-full border border-line px-1 py-px text-[10px]">Suggested</span>}
        <Pencil className={PENCIL} aria-hidden />
      </TooltipButton>
      {resolved.set && (
        <button
          type="button"
          disabled={parametersSaving}
          onClick={() => void save(null)}
          aria-label={`Clear ${def.label} for ${row.label}`}
          title="Clear, so the suggestion is used again"
          className="shrink-0 rounded p-0.5 text-muted hover:text-fg disabled:opacity-60"
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
      {editing && (
        <ParameterPopover anchor={anchor} title={`${def.label} for ${row.label}`} onClose={() => onEdit(false)}>
          <p className="mb-3 text-xs text-muted">
            Choose this area's entry lights. Saved in Taxis immediately. Clear the choice to use the area's suggested lights again.
          </p>
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <label key={r.entityId} className="flex cursor-pointer items-start gap-2 rounded border border-line p-2 text-[13px]">
                <input
                  type="checkbox"
                  aria-label={`${r.name} is an entry light of ${row.label}`}
                  checked={resolved.lights.includes(r.entityId)}
                  disabled={parametersSaving}
                  onChange={(event) =>
                    void save(rows.map((light) => light.entityId).filter((id) => (id === r.entityId ? event.target.checked : resolved.lights.includes(id))))
                  }
                  className="mt-0.5 shrink-0 accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="block break-words">{r.name}</span>
                  <code className="block break-all text-[11px] text-muted">{r.entityId}</code>
                </span>
              </label>
            ))}
          </div>
        </ParameterPopover>
      )}
    </span>
  );
}

const CLIMATE_GROUPS: { key: string; label: string; keys: ParamKey[] }[] = [
  { key: "heating", label: "Heating", keys: ["comfort_temp", "eco_temp", "night_temp", "sleep_temp", "away_temp", "frost_temp", "min_temp", "max_temp"] },
  { key: "cooling", label: "Cooling", keys: ["cool_comfort_temp", "cool_eco_temp", "cool_night_temp", "cool_away_temp"] },
  { key: "timing", label: "Timing & schedule", keys: ["window_delay", "restore_delay", "eco_after_clear", "comfort_periods"] },
  { key: "rules", label: "Rules & switching", keys: ["season", "comfort_needs_occupancy", "auto_hvac_on", "doors_open_count"] },
  { key: "presets", label: "Presets", keys: ["preset_comfort", "preset_eco", "preset_away", "preset_sleep"] },
];

// The header over a run of columns, a shorter name for the header (the full one
// is the tooltip and the Columns menu), and which columns are the first to give
// way when there is no room. A tab that is not listed has plain columns.
const COLUMN_ORDER: Partial<Record<ParamTab, ParamKey[]>> = {
  lighting: [
    "lux_threshold",
    "day_brightness",
    "day_kelvin",
    "night_brightness",
    "night_kelvin",
    "transition",
    "dim_before_off",
    "dim_level",
    "override_duration",
    "entry_lights",
    "guest_pause_lighting",
  ],
};

const GROUP: Partial<Record<ParamTab, Partial<Record<ParamKey, string>>>> = {
  lighting: {
    lux_threshold: "Darkness",
    day_brightness: "Day",
    day_kelvin: "Day",
    night_brightness: "Night",
    night_kelvin: "Night",
    transition: "Fading",
    dim_before_off: "Fading",
    dim_level: "Fading",
    override_duration: "Manual and entry",
    entry_lights: "Manual and entry",
    guest_pause_lighting: "Manual and entry",
  },
  fan: {
    fan_rate_on: "Start",
    fan_delta_on: "Start",
    fan_abs_on: "Start",
    fan_delta_off: "Stop",
    fan_flat_minutes: "Stop",
    fan_max_minutes: "Stop",
    fan_reference: "Reference",
    fan_suppress_in_sleep: "Reference",
  },
  safety: {
    door_open_after: "Left open",
    window_open_after: "Left open",
    left_open_repeat: "Left open",
    appliance_run_watts: "Appliance done",
    appliance_run_minutes: "Appliance done",
    appliance_idle_watts: "Appliance done",
    appliance_idle_minutes: "Appliance done",
  },
};

const SHORT: Partial<Record<ParamKey, string>> = {
  lux_threshold: "Dark below (lx)",
  day_brightness: "Brightness (%)",
  day_kelvin: "Colour (K)",
  night_brightness: "Brightness (%)",
  night_kelvin: "Colour (K)",
  transition: "Transition (s)",
  dim_before_off: "Dim before off (s)",
  dim_level: "Dim level (%)",
  override_duration: "Override (min)",
  guest_pause_lighting: "Guest pauses",
  fan_rate_on: "Rise rate (%/s)",
  fan_delta_on: "Above reference (%)",
  fan_abs_on: "Humidity (%)",
  fan_delta_off: "Within reference (%)",
  fan_flat_minutes: "Flat for (min)",
  fan_max_minutes: "At most (min)",
  fan_suppress_in_sleep: "Not while asleep",
  door_open_after: "Doors (min)",
  window_open_after: "Windows (min)",
  left_open_repeat: "Repeat every (min)",
};

// Lighting shows its everyday columns at 1280px; the others are one click away in Columns.
const RARELY_USED: Partial<Record<ParamKey, true>> = { dim_level: true, guest_pause_lighting: true };
const FIRST_TO_GO: Partial<Record<ParamKey, true>> = {
  dim_before_off: true,
  transition: true,
  day_kelvin: true,
  night_kelvin: true,
  window_open_after: true,
  left_open_repeat: true,
};

const wide = (d: ParamDef) => d.kind === "entity" || d.kind === "entities" || d.kind === "services" || d.kind === "periods" || d.kind === "text";

export function ParameterTable({ h, tab }: { h: Hierarchy; tab: ParamTab }) {
  const { inventory, inventoryLoaded, parameters, parametersLoaded, naming } = useTaxis();
  const [showAllFanAreas, setShowAllFanAreas] = useStoredFlag("taxis:parameters:fan:show-all-areas", false);
  const [climateGroup, setClimateGroup] = useStoredChoice(
    "taxis:parameters:climate-group",
    CLIMATE_GROUPS.map((group) => group.key),
    "heating",
  );
  const group = CLIMATE_GROUPS.find((group) => group.key === climateGroup) ?? CLIMATE_GROUPS[0];
  const defs = useMemo(() => {
    const all = paramsOf(tab).filter((def) => tab !== "climate" || group.keys.includes(def.key));
    const order = COLUMN_ORDER[tab];
    return order ? [...all].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : all;
  }, [tab, group]);
  const [editing, setEditing] = useState<string | null>(null);
  const ready = inventoryLoaded && parametersLoaded;
  const { fixed, rest, floors } = useMemo(() => paramRows(h, inventory), [h, inventory]);
  const relevant = useMemo(() => {
    if (tab !== "fan" || showAllFanAreas) return rest;
    const exclude = helperExclusions(h, naming);
    return rest.filter((row) => {
      if (row.scope.level !== "area") return true;
      const capabilities = areaInventory(h, inventory, row.scope.id, exclude(row.scope.id));
      return capabilities.fan.some((item) => item.counts) && capabilities.humidity.some((item) => item.counts);
    });
  }, [rest, tab, showAllFanAreas, h, inventory, naming]);

  // Sorting covers the areas; the house, interior and exterior rows stay on top.
  // The default order groups each floor's areas under a heading with the floor's
  // name (a floor has no values); sorted by anything else, the headings go.
  const { sort, toggle } = useSortState({ key: "order", dir: "asc" });
  const grouped = sort.key === "order";
  const floorName = useMemo(() => new Map(floors.map((f) => [f.floorId, f.name])), [floors]);
  const groupOf = useMemo(
    () =>
      grouped
        ? (r: ParamRow) =>
            r.floorId
              ? {
                  key: r.floorId,
                  label: (
                    <>
                      {floorName.get(r.floorId) ?? r.floorName}
                      <span className="ml-2 text-[11px] font-normal text-muted">floor</span>
                    </>
                  ),
                }
              : null
        : undefined,
    [grouped, floorName],
  );

  const columns = useMemo<Column<ParamRow>[]>(
    () => [
      {
        id: "name",
        header: "Level",
        help: "Choose a house default, area-type default or room override.",
        priority: 1,
        sticky: true,
        width: 190,
        sort: (r) => r.label,
        cell: (r) => (
          <>
            <span className={`block text-left ${r.scope.level !== "area" ? "font-medium" : ""}`}>{r.label}</span>
            {r.scope.level === "area" && !grouped && r.floorName && <span className="text-[11px] text-muted">{r.floorName}</span>}
          </>
        ),
      },
      ...defs.map((d): Column<ParamRow> => {
        const short = SHORT[d.key] ?? header(d);
        const ownGroup = GROUP[tab]?.[d.key];
        return {
          id: d.key,
          header: short,
          label: header(d),
          help: PARAM_HELP[d.key],
          group: ownGroup,
          priority: FIRST_TO_GO[d.key] ? 3 : 2,
          defaultHidden: RARELY_USED[d.key] === true,
          minWidth: Math.max(wide(d) ? 170 : 92, Math.round(short.length * 5.8) + 40),
          align: d.kind === "number" || d.kind === "time" ? "center" : "left",
          sort: (r) => {
            const v = resolveIn(parameters, r.chain, d.key).value;
            return typeof v === "boolean" ? Number(v) : Array.isArray(v) ? v.join(",") : v;
          },
          cell: (r) => {
            const here = `${rowKey(r)}|${d.key}`;
            if (d.houseOnly && r.scope.level !== "house") {
              return (
                <span className="px-1.5 text-muted" title="Set for the house only: it is not set for a floor, an area or the interior or exterior areas">
                  —
                </span>
              );
            }
            return d.kind === "entities" ? (
              <EntryLightsCell h={h} row={r} def={d} editing={editing === here} onEdit={(on) => setEditing(on ? here : null)} />
            ) : (
              <Cell h={h} row={r} def={d} editing={editing === here} onEdit={(on) => setEditing(on ? here : null)} />
            );
          },
        };
      }),
    ],
    [defs, tab, grouped, parameters, h, editing],
  );

  if (!ready) return <p className="text-[13px] text-muted">Loading the settings…</p>;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <HelpDisclosure key={tab} summary={`${GUIDES[tab].summary} Click a value to edit.`}>
        <HelpTopic title="Inheritance">
          Set a house default, an interior/exterior default, or a room override. Clear a value to inherit. Floors only group rooms.
        </HelpTopic>
        <HelpTopic title="Saving">Saved in Taxis immediately. Install or update a recipe through Changes to apply these settings to Home Assistant.</HelpTopic>
        {GUIDES[tab].topics.map(([title, body]) => (
          <HelpTopic key={title} title={title}>
            {body}
          </HelpTopic>
        ))}
      </HelpDisclosure>
      {tab === "climate" && (
        <Toolbar label="Climate settings sections">
          {CLIMATE_GROUPS.map((section) => (
            <Chip
              key={section.key}
              pressed={climateGroup === section.key}
              onClick={() => {
                setEditing(null);
                setClimateGroup(section.key);
              }}
            >
              {section.label}
            </Chip>
          ))}
        </Toolbar>
      )}
      {tab === "fan" && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <p className="flex-1">Used only where Bathroom fan recipe is installed. By default, areas need a counted fan and humidity sensor in Capabilities.</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showAllFanAreas} onChange={(event) => setShowAllFanAreas(event.target.checked)} />
            Show all areas
          </label>
        </div>
      )}
      {tab === "fan" && !relevant.length && (
        <EmptyState>
          No areas have both a counted fan and humidity sensor. Check{" "}
          <a className="text-accent underline" href="#parameters/capabilities">
            Capabilities
          </a>{" "}
          or enable Show all areas to inspect other areas' saved settings.
        </EmptyState>
      )}
      <DataTable
        key={tab === "climate" ? climateGroup : tab}
        id={`parameters-${tab}`}
        label={PARAM_TAB_LABEL[tab]}
        rows={relevant}
        pinned={fixed}
        rowKey={rowKey}
        columns={columns}
        sort={sort}
        onSort={toggle}
        groupOf={groupOf}
        collapsible={false}
      />
    </div>
  );
}
