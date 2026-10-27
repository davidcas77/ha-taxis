import { useStoredChoice } from "./storage.ts";
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
import { SortHeader, useSort } from "./table.tsx";

// The House, Occupancy, Lighting, Media, Climate, Bathroom fan, Exterior and Safety
// tabs of the Parameters page: one table per tab, a row for the house, for interior
// and exterior areas, for each
// floor and for each area, and a column per parameter. A cell shows the value set
// at that level, or the one it inherits in grey with where it comes from. Click a
// cell to set it (a yes/no flips at once); empty it to inherit again. Saved at
// once, in Taxis only.

const GUIDES: Record<ParamTab, { summary: string; topics: [string, string][] }> = {
  house: { summary: "Set night hours, home modes and notification destinations.", topics: [
    ["Night hours", "Lights use night brightness and colour during this window; Area climate uses the night temperature."],
    ["Away and sleep", "Choose existing switches, or leave them blank so Taxis creates its own when you install Area climate."],
    ["Notifications", "Enter notify services separated by commas, such as notify.mobile_app_phone. Leave blank to use Home Assistant notifications."],
    ["Speech", "Choose the text-to-speech entity for Announce. Notification destinations and speech are set for the whole house."],
  ] },
  occupancy: { summary: "Set how long rooms stay occupied after activity stops.", topics: [
    ["Hold times", "Normal is the usual timeout. Extended applies after prolonged occupancy. Sleep applies in bedrooms while a bed sensor detects someone."],
    ["Shower detection", "A humidity rise can hold an already-occupied room. Set the rate in % per second; 0 disables it. Requires the rate sensor made by Bathroom fan."],
  ] },
  lighting: { summary: "Set light levels, transitions and manual override timing.", topics: [
    ["Brightness and colour", "Choose day and night levels, the darkness threshold and transition times."],
    ["Manual override", "After someone changes a light, automation waits this long. Set 0 to wait until the room next clears."],
    ["Entry lights", "Choose which lights come on when the room becomes occupied by day. This is per room, not inherited. Blank uses the room's only light or its main lights."],
  ] },
  media: { summary: "Set when speakers and TVs turn off after a room clears.", topics: [
    ["Turn-off delays", "Speakers and TVs have separate delays, measured from when occupancy clears."],
    ["Announcement volume", "House-wide default for Announce. Set 0 to keep the current volume; an individual announcement can override it."],
  ] },
  climate: { summary: "Set heating and cooling targets, schedules and switching permissions.", topics: [
    ["Priority", "Open window → away → sleep → night → occupied during comfort periods → eco. The first matching rule wins."],
    ["Season and targets", "ACs can heat or cool; heating devices and radiator valves run only in the heating season. Cooling uses the Cool targets. Lowest and highest bound heating targets only."],
    ["Comfort periods", "Use day and time ranges, e.g. Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun 08:00-23:00. The latest end is 23:59."],
    ["Presets", "Use preset names offered by each thermostat. A device without the chosen preset receives a temperature target instead."],
    ["Automatic switching", "Enable Switch on and off itself to allow mode changes and window-triggered shutdown. Otherwise devices that are off or in the opposite seasonal mode are left alone."],
    ["Bedroom comfort", "Bedrooms do not require occupancy for comfort unless you enable that requirement."],
  ] },
  fan: { summary: "Set when humidity starts the bathroom fan and when it stops.", topics: [
    ["Start", "Triggered by a rapid humidity rise, a difference above a reference sensor, or the absolute humidity level. Rates use % per second."],
    ["Stop", "Stops when humidity returns near the reference, the rise stays flat for the configured time, or the maximum run time is reached."],
    ["Reference sensor", "Choose another room's humidity sensor or a house average. Without one, the starting humidity is used for stopping; only rise rate and absolute level start the fan."],
  ] },
  exterior: { summary: "Set sunset timing and how long outdoor lights stay on.", topics: [
    ["Sunset and sunrise", "A negative sunset offset turns lights on earlier. Lights turn off at sunrise."],
    ["Activity", "Motion or someone arriving home restarts the timer. Applies to areas marked exterior."],
  ] },
  safety: { summary: "Set open-door alerts and appliance-finished detection.", topics: [
    ["Left open", "Notify after a door or window has stayed open for the delay. Repeat 0 sends one notification."],
    ["Appliance done", "Mark a power sensor as an appliance in Capabilities. Above the running threshold for its duration means running; below the done threshold for its duration means finished. Thresholds use watts."],
  ] },
};

// A value in a table cell is a button that opens the field: it shows a box on hover
// and on focus, and a small pencil, so it reads as something to click.
const EDITABLE =
  "group inline-flex items-center gap-1 rounded border border-transparent px-1.5 py-0.5 text-left hover:border-line hover:bg-sunken focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-60";
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
    if (def.kind === "entity") return Object.values(h.entities).filter((e) => e.domain === def.domain && !e.disabled).map((e) => e.entityId).sort();
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
        className="rounded-md border border-accent bg-bg px-1.5 py-0.5 text-[13px] outline-none"
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
          className={`${wide ? "w-72" : "w-24"} rounded-md border border-accent bg-bg px-1.5 py-0.5 text-[13px] tabular-nums outline-none ${def.kind === "number" || def.kind === "time" ? "text-center" : ""}`}
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
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={parametersSaving}
        onClick={() => (def.kind === "bool" ? void save(!shown.value) : onEdit(true))}
        title={`${def.kind === "periods" ? `${describePeriods(String(shown.value))}. ` : ""}${own === undefined ? `From ${sourceName(h, shown.source)}. Click to set it here.` : "Set here. Click to change it."}`}
        aria-label={`${def.label} for ${row.label}: ${show(def, shown.value)}${def.unit && def.kind === "number" ? ` ${def.unit}` : ""}, ${own === undefined ? `from ${sourceName(h, shown.source)}` : "set here"}`}
        className={`${EDITABLE} min-w-[3rem] ${def.kind === "periods" || def.kind === "entity" || def.kind === "services" ? "max-w-[20rem] truncate" : "tabular-nums"} ${own === undefined ? "text-muted" : "font-medium"}`}
      >
        {show(def, shown.value)}
        <Pencil className={PENCIL} aria-hidden />
      </button>
      {own !== undefined && (
        <button type="button" disabled={parametersSaving} onClick={() => void save(null)} aria-label={`Clear ${def.label} for ${row.label}`} title="Clear, so it inherits again" className="rounded p-0.5 text-muted hover:text-fg disabled:opacity-60">
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
  const areaId = row.scope.level === "area" ? row.scope.id : null;
  const entry = useMemo(() => {
    if (!areaId) return null;
    const rows = areaInventory(h, inventory, areaId, helperExclusions(h, naming)(areaId)).lights;
    return { rows: rows.filter((r) => r.counts), resolved: entryLights(parameters, areaId, rows) };
  }, [h, inventory, naming, parameters, areaId]);
  if (!areaId || !entry) return <span className="px-1.5 text-muted" title="Set for one area only: it is not inherited from a floor or the house">—</span>;

  const name = (id: string) => h.entities[id]?.name ?? id;
  const { resolved, rows } = entry;
  const save = async (value: string[] | null) => {
    const error = await saveParameters((p) => setParameter(p, row.scope, def.key, value));
    if (error) notify({ tone: "error", text: error });
  };

  if (rows.length === 0) return <span className="px-1.5 text-muted">–</span>;

  if (editing) {
    return (
      <div role="group" aria-label={`${def.label} for ${row.label}`} className="flex min-w-[12rem] flex-col gap-1 rounded-md border border-accent bg-bg p-2">
        {rows.map((r) => (
          <label key={r.entityId} className="flex cursor-pointer items-center gap-1.5 text-[13px]">
            <input
              type="checkbox"
              aria-label={`${r.name} is an entry light of ${row.label}`}
              checked={resolved.lights.includes(r.entityId)}
              disabled={parametersSaving}
              onChange={(e) => void save(rows.map((x) => x.entityId).filter((id) => (id === r.entityId ? e.target.checked : resolved.lights.includes(id))))}
              className="accent-[var(--accent)]"
            />
            {r.name}
          </label>
        ))}
        <button type="button" onClick={() => onEdit(false)} className="self-start rounded px-1.5 py-0.5 text-xs text-accent hover:bg-sunken">
          Done
        </button>
      </div>
    );
  }

  const own = resolved.source === "set";
  const text = resolved.lights.length === 0 ? "–" : resolved.lights.map(name).join(", ");
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={parametersSaving}
        onClick={() => onEdit(true)}
        title={own ? "Set here. Click to change it." : resolved.lights.length === 0 ? "Nothing to suggest: the area has several lights and none is a main light. Click to choose." : "Suggested: the only light of the area, or its main lights. Click to choose."}
        aria-label={`${def.label} for ${row.label}: ${text}, ${own ? "set here" : resolved.lights.length === 0 ? "none" : "suggested"}`}
        className={`${EDITABLE} max-w-[16rem] ${own ? "font-medium" : "text-muted"}`}
      >
        {text}
        {!own && resolved.lights.length > 0 && <span className="ml-1.5 rounded-full border border-line px-1.5 py-px text-[11px]">suggested</span>}
        <Pencil className={PENCIL} aria-hidden />
      </button>
      {resolved.set && (
        <button type="button" disabled={parametersSaving} onClick={() => void save(null)} aria-label={`Clear ${def.label} for ${row.label}`} title="Clear, so the suggestion is used again" className="rounded p-0.5 text-muted hover:text-fg disabled:opacity-60">
          <X className="size-3" aria-hidden />
        </button>
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

export function ParameterTable({ h, tab }: { h: Hierarchy; tab: ParamTab }) {
  const { inventory, inventoryLoaded, parameters, parametersLoaded } = useTaxis();
  const [climateGroup, setClimateGroup] = useStoredChoice("taxis:parameters:climate-group", CLIMATE_GROUPS.map(group => group.key), "heating");
  const group = CLIMATE_GROUPS.find(group => group.key === climateGroup) ?? CLIMATE_GROUPS[0];
  const defs = paramsOf(tab).filter(def => tab !== "climate" || group.keys.includes(def.key));
  const [editing, setEditing] = useState<string | null>(null);
  const ready = inventoryLoaded && parametersLoaded;
  const { fixed, rest, floors } = useMemo(() => paramRows(h, inventory), [h, inventory]);

  // Sorting covers the areas; the house, interior and exterior rows stay on top.
  // The default order groups each floor's areas under a heading with the floor's
  // name (a floor has no values); sorted by anything else, the headings go.
  const columns = useMemo(
    () => ({
      order: (r: ParamRow) => r.order,
      name: (r: ParamRow) => r.label,
      ...Object.fromEntries(
        defs.map((d) => [
          d.key,
          (r: ParamRow) => {
            const v = resolveIn(parameters, r.chain, d.key).value;
            return typeof v === "boolean" ? Number(v) : Array.isArray(v) ? v.join(",") : v;
          },
        ]),
      ),
    }),
    [defs, parameters],
  );
  const { rows, sort, toggle } = useSort(rest, columns, { key: "order", dir: "asc" });

  if (!ready) return <p className="text-[13px] text-muted">Loading the settings…</p>;

  const grouped = sort.key === "order";
  const heading = (f: { floorId: string; name: string }) => (
    <tr key={`floor:${f.floorId}`} className="border-t border-line bg-sunken/50">
      <th scope="rowgroup" colSpan={defs.length + 1} className="px-3 py-1.5 text-left font-normal text-muted">
        {f.name}
        <span className="ml-2 text-[11px]">floor</span>
      </th>
    </tr>
  );
  const line = (r: ParamRow, kind: "fixed" | "area") => (
    <tr key={rowKey(r)} className="border-t border-line">
      <th scope="row" className={`sticky left-0 z-10 bg-bg px-3 py-1.5 text-left font-normal ${kind === "fixed" ? "font-medium" : ""}`}>
        <span className={kind === "area" && grouped && r.floorId ? "pl-3" : ""}>{r.label}</span>
        {kind === "area" && !grouped && r.floorName && <span className="ml-2 text-[11px] text-muted">{r.floorName}</span>}
      </th>
      {defs.map((d) => (
        <td key={d.key} className={`px-3 py-1.5 ${d.kind === "number" || d.kind === "time" ? "text-center tabular-nums" : "text-left"}`}>
          {d.houseOnly && r.scope.level !== "house" ? (
            <span className="px-1.5 text-muted" title="Set for the house only: it is not set for a floor, an area or the interior or exterior areas">—</span>
          ) : d.kind === "entities" ? (
            <EntryLightsCell h={h} row={r} def={d} editing={editing === `${rowKey(r)}|${d.key}`} onEdit={(on) => setEditing(on ? `${rowKey(r)}|${d.key}` : null)} />
          ) : (
            <Cell h={h} row={r} def={d} editing={editing === `${rowKey(r)}|${d.key}`} onEdit={(on) => setEditing(on ? `${rowKey(r)}|${d.key}` : null)} />
          )}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="flex flex-col gap-3">
      <HelpDisclosure key={tab} summary={`${GUIDES[tab].summary} Click a value to edit.`}>
        <HelpTopic title="Inheritance">Set a house default, an interior/exterior default, or a room override. Clear a value to inherit. Floors only group rooms.</HelpTopic>
        <HelpTopic title="Saving">Saved in Taxis immediately. Install or update a recipe through Changes to apply these settings to Home Assistant.</HelpTopic>
        {GUIDES[tab].topics.map(([title, body]) => <HelpTopic key={title} title={title}>{body}</HelpTopic>)}
      </HelpDisclosure>
      {tab === "climate" && <div role="group" aria-label="Climate settings sections" className="flex flex-wrap gap-2">
        {CLIMATE_GROUPS.map(section => <button key={section.key} type="button" aria-pressed={climateGroup === section.key} onClick={() => { setEditing(null); setClimateGroup(section.key); }} className={`rounded-md border px-3 py-1.5 text-[13px] ${climateGroup === section.key ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{section.label}</button>)}
      </div>}
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table key={tab === "climate" ? climateGroup : tab} aria-label={PARAM_TAB_LABEL[tab]} className="w-full text-[13px]">
          <thead className="bg-sunken text-left text-xs text-muted">
            <tr>
              <SortHeader className="sticky left-0 z-20 bg-sunken px-3 py-2 text-left" label="Level" help="Choose a house default, area-type default or room override." k="name" sort={sort} onToggle={toggle} />
              {defs.map((d) => (
                <SortHeader key={d.key} label={header(d)} help={PARAM_HELP[d.key]} k={d.key} sort={sort} onToggle={toggle} className={`px-3 py-2 ${d.kind === "number" || d.kind === "time" ? "text-center" : "text-left"}`} />
              ))}
            </tr>
          </thead>
          <tbody>
            {fixed.map((r) => line(r, "fixed"))}
            {rows.map((r, i) => {
              // A floor's heading goes in front of its first area, when the areas are in their default order.
              const head = grouped && r.floorId && rows[i - 1]?.floorId !== r.floorId ? floors.find((f) => f.floorId === r.floorId) : undefined;
              return [head && heading(head), line(r, "area")];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
