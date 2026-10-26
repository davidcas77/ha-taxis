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
import type { Hierarchy } from "../../shared/types.ts";
import { useTaxis } from "./state.tsx";
import { SortHeader, useSort } from "./table.tsx";

// The House, Occupancy and Lighting tabs of the Parameters page: one table per
// tab, a row for the house, for interior and exterior areas, for each floor and
// for each area, and a column per parameter. A cell shows the value set at that
// level, or the one it inherits in grey with where it comes from. Click a cell
// to set it; empty it to inherit again. Saved at once, in Taxis only.

const NOTES: Record<ParamTab, string> = {
  house: "When night starts and ends. The lights use the night brightness and colour inside this window.",
  occupancy: "How long an area stays occupied after its sensors last changed.",
  lighting: "How the lights come on and go off. Brightness, colour, light level and timing.",
};

const SCOPE_NOTE =
  "Set a value at the level that fits: the house, interior or exterior areas, a floor or one area. An empty cell takes the value of the level above it (area, then floor, then interior or exterior, then the house). Saved here at once; nothing is written to Home Assistant until you install a recipe.";

const header = (d: ParamDef) => (d.unit ? `${d.label} (${d.unit})` : d.label);

const rowKey = (r: ParamRow) => `${r.scope.level}:${"id" in r.scope ? r.scope.id : ""}`;

// What the box takes: a time, or a number in the parameter's range.
function parseInput(def: ParamDef, text: string): { value: ParamValue | null } | { error: string } {
  const t = text.trim();
  if (t === "") return { value: null };
  const value = def.kind === "number" ? Number(t) : t;
  const problem = checkValue(def, value);
  return problem ? { error: problem } : { value };
}

function Cell({ h, row, def, editing, onEdit }: { h: Hierarchy; row: ParamRow; def: ParamDef; editing: boolean; onEdit: (on: boolean) => void }) {
  const { parameters, parametersSaving, saveParameters, notify } = useTaxis();
  const own = ownValue(parameters, row.scope, def.key);
  const shown = resolveIn(parameters, row.chain, def.key);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  // Enter, Escape and leaving the box all end the edit once; the others are ignored.
  const ended = useRef(false);

  useEffect(() => {
    if (!editing) return;
    ended.current = false;
    setText(own === undefined ? "" : String(own));
    input.current?.focus();
    input.current?.select();
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

  if (editing) {
    return (
      <input
        ref={input}
        type={def.kind === "time" ? "time" : "number"}
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
        className="w-24 rounded-md border border-accent bg-bg px-1.5 py-0.5 text-[13px] tabular-nums outline-none"
      />
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={parametersSaving}
        onClick={() => onEdit(true)}
        title={own === undefined ? `From ${sourceName(h, shown.source)}. Click to set it here.` : "Set here. Click to change it."}
        aria-label={`${def.label} for ${row.label}: ${shown.value}${def.unit ? ` ${def.unit}` : ""}, ${own === undefined ? `from ${sourceName(h, shown.source)}` : "set here"}`}
        className={`min-w-[3rem] rounded px-1.5 py-0.5 text-left tabular-nums hover:bg-sunken disabled:opacity-60 ${own === undefined ? "text-muted" : "font-medium"}`}
      >
        {shown.value}
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
      ...Object.fromEntries(defs.map((d) => [d.key, (r: ParamRow) => resolveIn(parameters, r.chain, d.key).value as string | number])),
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
