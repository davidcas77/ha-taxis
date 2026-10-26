import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  PARAM_TAB_LABEL,
  checkValue,
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

// The House, Occupancy, Lighting, Media and Climate tabs of the Parameters page: one
// table per tab, a row for the house, for interior and exterior areas, for each
// floor and for each area, and a column per parameter. A cell shows the value set
// at that level, or the one it inherits in grey with where it comes from. Click a
// cell to set it (a yes/no flips at once); empty it to inherit again. Saved at
// once, in Taxis only.

const NOTES: Record<ParamTab, string> = {
  house:
    "When night starts and ends. The lights use the night brightness and colour inside this window, and Area climate its night temperature. The away and sleep mode switches are the toggles Area climate reads: leave them empty and Taxis makes its own (input_boolean.taxis_away and taxis_sleep) when it installs Area climate, or pick toggles you already have.",
  occupancy: "How long an area stays occupied after its sensors last changed: normally, once it has been occupied for a long time (extended), and while someone is in bed (bedrooms with a bed sensor).",
  lighting: "How the lights come on and go off. Brightness, colour, light level and timing. Manual override: how long the automation leaves an area alone after a light is changed by hand; 0 is until the area next clears.",
  media: "How long an area is clear before its speakers and its TVs are turned off.",
  climate:
    "Area climate sets an area's thermostats by fixed rules, first match wins: a window open for a while (frost protection, or off), away mode, sleep, the night window, comfort while the comfort periods are on and the area is occupied, eco otherwise. Temperatures are in the unit Home Assistant uses and stay between lowest and highest. Comfort periods are days, then times, like Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun 08:00-23:00 (the end can be 23:59 at the latest). Presets are the thermostat's own names, offered from what each thermostat reports; a thermostat that has one gets the preset, the others a temperature. Switch on and off itself lets Area climate switch a thermostat on, and a window switch it off; otherwise a thermostat that is off is left alone. A bedroom needs no one in the room for comfort unless you set it. Cooling uses the same temperatures.",
};

const SCOPE_NOTE =
  "Set a value at the level that fits: the house, interior or exterior areas, a floor or one area. An empty cell takes the value of the level above it (area, then floor, then interior or exterior, then the house). Saved here at once; nothing is written to Home Assistant until you install a recipe.";

const header = (d: ParamDef) => (d.unit ? `${d.label} (${d.unit})` : d.label);

const rowKey = (r: ParamRow) => `${r.scope.level}:${"id" in r.scope ? r.scope.id : ""}`;

// What the box takes: a time, a number in the parameter's range, a word, an entity
// id or comfort periods (kept in one spelling).
function parseInput(def: ParamDef, text: string): { value: ParamValue | null } | { error: string } {
  const t = text.trim();
  if (t === "") return { value: null };
  const value = def.kind === "number" ? Number(t) : t;
  const problem = checkValue(def, value);
  if (problem) return { error: problem };
  return { value: def.kind === "periods" ? canonicalPeriods(t)! : value };
}

// How a value reads in a cell.
function show(def: ParamDef, value: ParamValue): string {
  if (def.kind === "bool") return value ? "yes" : "no";
  if (value === "") return "–";
  return String(value);
}

// Names to offer for a preset: what the thermostats of the row report.
function presetNames(h: Hierarchy, row: ParamRow): string[] {
  const names = new Set<string>();
  for (const e of Object.values(h.entities)) {
    if (e.domain !== "climate" || e.presetModes.length === 0) continue;
    const inRow =
      row.scope.level === "area" ? e.areaId === row.scope.id : row.scope.level === "floor" ? Boolean(e.areaId && h.areas[e.areaId]?.floorId === row.scope.id) : true;
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
    const wide = def.kind === "periods" || def.kind === "entity";
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
        className={`min-w-[3rem] rounded px-1.5 py-0.5 text-left hover:bg-sunken disabled:opacity-60 ${def.kind === "periods" ? "max-w-[20rem]" : "tabular-nums"} ${own === undefined ? "text-muted" : "font-medium"}`}
      >
        {show(def, shown.value)}
      </button>
      {own !== undefined && (
        <button type="button" disabled={parametersSaving} onClick={() => void save(null)} aria-label={`Clear ${def.label} for ${row.label}`} title="Clear, so it inherits again" className="rounded p-0.5 text-muted hover:text-fg disabled:opacity-60">
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
  const { fixed, rest } = useMemo(() => paramRows(h, inventory), [h, inventory]);

  // Sorting covers the floors and areas; the house, interior and exterior rows
  // stay on top. The default order groups each floor's areas under the floor.
  const columns = useMemo(
    () => ({
      order: (r: ParamRow) => r.order,
      name: (r: ParamRow) => r.label,
      ...Object.fromEntries(
        defs.map((d) => [
          d.key,
          (r: ParamRow) => {
            const v = resolveIn(parameters, r.chain, d.key).value;
            return typeof v === "boolean" ? Number(v) : v;
          },
        ]),
      ),
    }),
    [defs, parameters],
  );
  const { rows, sort, toggle } = useSort(rest, columns, { key: "order", dir: "asc" });

  if (!ready) return <p className="text-[13px] text-muted">Loading the settings…</p>;

  const line = (r: ParamRow, kind: "fixed" | "floor" | "area") => (
    <tr key={rowKey(r)} className="border-t border-line">
      <th scope="row" className={`px-3 py-1.5 text-left font-normal ${kind === "fixed" || kind === "floor" ? "font-medium" : ""}`}>
        <span className={kind === "area" ? "pl-3" : ""}>{r.label}</span>
        {kind === "floor" && <span className="ml-2 text-[11px] text-muted">floor</span>}
        {kind === "area" && sort.key !== "order" && r.floorName && <span className="ml-2 text-[11px] text-muted">{r.floorName}</span>}
      </th>
      {defs.map((d) => (
        <td key={d.key} className="px-3 py-1.5">
          <Cell h={h} row={r} def={d} editing={editing === `${rowKey(r)}|${d.key}`} onEdit={(on) => setEditing(on ? `${rowKey(r)}|${d.key}` : null)} />
        </td>
      ))}
    </tr>
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[68ch] text-[13px] text-muted">{NOTES[tab]}</p>
      <p className="max-w-[68ch] text-[13px] text-muted">{SCOPE_NOTE}</p>
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
            {rows.map((r) => line(r, r.scope.level === "floor" ? "floor" : "area"))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
