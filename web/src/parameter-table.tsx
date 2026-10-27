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
  type ParamRow,
  type ParamTab,
  type ParamValue,
} from "../../shared/parameters.ts";
import { canonicalPeriods, describePeriods } from "../../shared/periods.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { useTaxis } from "./state.tsx";
import { SortHeader, useSort } from "./table.tsx";

// The House, Occupancy, Lighting, Media, Climate, Bathroom fan, Exterior and Safety
// tabs of the Parameters page: one table per tab, a row for the house, for interior
// and exterior areas, for each
// floor and for each area, and a column per parameter. A cell shows the value set
// at that level, or the one it inherits in grey with where it comes from. Click a
// cell to set it (a yes/no flips at once); empty it to inherit again. Saved at
// once, in Taxis only.

const NOTES: Record<ParamTab, string> = {
  house:
    "When night starts and ends. The lights use the night brightness and colour inside this window, and Area climate its night temperature. The away and sleep mode switches are the toggles Area climate reads: leave them empty and Taxis makes its own (input_boolean.taxis_away and taxis_sleep) when it installs Area climate, or pick toggles you already have. Notify services (separate them with commas, like notify.mobile_app_phone) are where Left open and Appliance done send their messages; left empty, the messages appear in Home Assistant's own notifications. The text-to-speech entity is what Announce speaks with. Both are set for the house only.",
  occupancy:
    "How long an area stays occupied after its sensors last changed: normally, once it has been occupied for a long time (extended), and while someone is in bed (bedrooms with a bed sensor). A shower holds the area occupied when the humidity rises at least this fast (in % per second; 0 is off): it needs the area's humidity rate sensor, which the Bathroom fan recipe makes.",
  lighting:
    "How the lights come on and go off. Brightness, colour, light level and timing. Manual override: how long the automation leaves an area alone after a light is changed by hand; 0 is until the area next clears. Entry lights: the lights that come on by day when the area becomes occupied. They are set for one area only and never inherited; left empty, the area's only light, or else its main lights, is used (shown in grey as suggested).",
  media: "How long an area is clear before its speakers and its TVs are turned off. The announcement volume is what Announce speaks at when it is not given one (0 leaves the volume as it is); it is set for the house only.",
  climate:
    "Area climate sets an area's thermostats by fixed rules, first match wins: a window open for a while (frost protection, or off), away mode, sleep, the night window, comfort while the comfort periods are on and the area is occupied, eco otherwise. Temperatures are in the unit Home Assistant uses. In the heating season the target stays between lowest and highest; in the cooling season the Cool temperatures are used instead (night and sleep share one) and lowest and highest do not limit them. Comfort periods are days, then times, like Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun 08:00-23:00 (the end can be 23:59 at the latest). The Season picks what runs: an AC (see the Climate section of Capabilities) in both seasons, heating and radiator valves in the heating season only. Presets are the thermostat's own names, offered from what each thermostat reports, an AC's included; a thermostat that has one gets the preset, the others a temperature. Switch on and off itself lets Area climate switch a thermostat on, and a window switch it off; otherwise a thermostat that is off is left alone. A bedroom needs no one in the room for comfort unless you set it.",
  fan:
    "The Bathroom fan starts when the humidity rises at least this fast, is this far above the reference sensor, or reaches this level, and stops when it is back within this of the reference (without a reference sensor, of where it started), when the rate has been flat for this long, or after at most this long. The reference is another area's humidity sensor or a house average, picked here; left empty, only the rise rate and the humidity level start the fan. Rates are in % of humidity per second.",
  exterior:
    "Exterior lights, for areas whose type is exterior: the lights go on at sunset (moved by this many minutes; negative is earlier), stay on for the time shown, and the time starts again at every motion or person arriving home. At sunrise they go off.",
  safety:
    "Left open reports a door or a window that stays open: after the time shown, and again every so often if you set a repeat (0 is once). Appliance done reports a machine that has finished: a power sensor marked as an appliance on the Capabilities tab that stays above the running level for the running time is running, and it is done once it stays below the done level for the done time. Levels are in watts.",
};

const SCOPE_NOTE =
  "Set a value at the level that fits: the house, interior or exterior areas, or one area. An empty cell takes the value of the level above it (area, then interior or exterior, then the house). Floors only group the areas and have no values of their own. Saved here at once; nothing is written to Home Assistant until you install a recipe.";

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
          className={`${wide ? "w-72" : "w-24"} rounded-md border border-accent bg-bg px-1.5 py-0.5 text-[13px] tabular-nums outline-none`}
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
        className={`${EDITABLE} min-w-[3rem] ${def.kind === "periods" ? "max-w-[20rem]" : "tabular-nums"} ${own === undefined ? "text-muted" : "font-medium"}`}
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

export function ParameterTable({ h, tab }: { h: Hierarchy; tab: ParamTab }) {
  const { inventory, inventoryLoaded, parameters, parametersLoaded } = useTaxis();
  const defs = paramsOf(tab);
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
      <th scope="row" className={`px-3 py-1.5 text-left font-normal ${kind === "fixed" ? "font-medium" : ""}`}>
        <span className={kind === "area" && grouped && r.floorId ? "pl-3" : ""}>{r.label}</span>
        {kind === "area" && !grouped && r.floorName && <span className="ml-2 text-[11px] text-muted">{r.floorName}</span>}
      </th>
      {defs.map((d) => (
        <td key={d.key} className="px-3 py-1.5">
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
      <p className="max-w-[68ch] text-[13px] text-muted">{NOTES[tab]}</p>
      <p className="max-w-[68ch] text-[13px] text-muted">{SCOPE_NOTE}</p>
      <p className="text-[13px] font-medium">Click a value to change it.</p>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table aria-label={PARAM_TAB_LABEL[tab]} className="w-full text-[13px]">
          <thead className="bg-sunken text-left text-xs text-muted">
            <tr>
              <SortHeader label="Level" k="name" sort={sort} onToggle={toggle} />
              {defs.map((d) => (
                <SortHeader key={d.key} label={header(d)} k={d.key} sort={sort} onToggle={toggle} />
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
