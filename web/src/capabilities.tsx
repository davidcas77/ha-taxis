import { useMemo, useState } from "react";

import {
  AREA_TYPES,
  CAPABILITIES,
  LIGHT_ROLES,
  areaChoice,
  areaInventory,
  inventoryMatrix,
  matrixTotals,
  resetEntity,
  setAreaType,
  setBed,
  setBedroom,
  setCounts,
  setKind,
  setLightRole,
  setRole,
  type AreaType,
  type Capability,
  type InventoryFlag,
  type InventoryRow,
  type InventorySettings,
  type LightRole,
  type MatrixRow,
  type MotionRole,
  type Tally,
} from "../../shared/inventory.ts";
import type { AreaNode, Hierarchy } from "../../shared/types.ts";
import { helperExclusions } from "../../shared/helpers.ts";
import { AreaHelpersSection } from "./helpers.tsx";
import { useTaxis, type Route } from "./state.tsx";
import { SortHeader, useSort } from "./table.tsx";
import { Button, EditedDot } from "./ui.tsx";

// The capability inventory: a matrix of areas by capability, and for each area
// the entities behind it with the choices Taxis keeps (what counts, roles).
// Everything here is saved at once, in Taxis only; Home Assistant is not
// touched.

const selectClass = "rounded-md border border-line bg-bg px-2 py-1 text-[13px] outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50";

export const CAPABILITIES_NOTE = "Detected from each entity's area, domain and device class. Choices are stored in Taxis only; nothing changes in Home Assistant.";

// ---------------------------------------------------------------------------
// The matrix.
// ---------------------------------------------------------------------------

function cellText(t: Tally) {
  if (t.total === 0) return null;
  const left = t.total - t.counted;
  return (
    <>
      {t.counted}
      {left > 0 && <span className="ml-1 text-xs text-muted">+{left}</span>}
    </>
  );
}

const cellLabel = (area: string, capability: string, t: Tally) => `${area}, ${capability}: ${t.counted} counted${t.total > t.counted ? `, ${t.total - t.counted} not counted` : ""}`;

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
  const totals = useMemo(() => matrixTotals(all), [all]);
  const shown = useMemo(() => (showEmpty ? all : all.filter((r) => r.total > 0)), [all, showEmpty]);
  const empty = all.length - all.filter((r) => r.total > 0).length;

  const columns = useMemo(() => {
    const cols: Record<string, (r: MatrixRow) => string | number | null> = {
      floor: floorKey,
      area: (r) => r.name,
    };
    for (const c of CAPABILITIES) cols[c.key] = (r) => (r.perCapability[c.key].total === 0 ? null : r.perCapability[c.key].counted + r.perCapability[c.key].total / 1000);
    return cols;
  }, []);
  const { rows, sort, toggle } = useSort(shown, columns, { key: "floor", dir: "asc" });

  const open = (areaId: string) => go({ page: "areas", sel: { kind: "area", id: areaId }, tab: "capabilities" });

  if (!inventoryLoaded) return <p className="text-[13px] text-muted">Loading the inventory settings…</p>;

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[68ch] text-[13px] text-muted">{CAPABILITIES_NOTE}</p>
      <label htmlFor="show-empty-areas" className="flex w-fit cursor-pointer items-center gap-2 text-[13px]">
        <input id="show-empty-areas" type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} className="accent-[var(--accent)]" />
        Show empty areas{empty > 0 && <span className="text-muted tabular-nums">({empty})</span>}
      </label>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">{all.length === 0 ? "Home Assistant has no areas yet." : "No area has anything Taxis can use yet."}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead className="bg-sunken text-left text-xs text-muted">
              <tr>
                <SortHeader label="Floor" k="floor" sort={sort} onToggle={toggle} />
                <SortHeader label="Area" k="area" sort={sort} onToggle={toggle} />
                {CAPABILITIES.map((c) => (
                  <SortHeader key={c.key} label={c.short} title={c.label} k={c.key} sort={sort} onToggle={toggle} className="px-2 py-2 text-center" />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.areaId} className="border-t border-line">
                  <td className="whitespace-nowrap px-3 py-1.5 text-muted">{r.floorName ?? "No floor"}</td>
                  <td className="px-3 py-1.5">
                    <button type="button" className="text-left text-accent hover:underline" onClick={() => open(r.areaId)}>
                      {r.name}
                    </button>
                  </td>
                  {CAPABILITIES.map((c) => {
                    const t = r.perCapability[c.key];
                    return (
                      <td key={c.key} className="p-0 text-center tabular-nums">
                        {t.total > 0 && (
                          <button type="button" aria-label={cellLabel(r.name, c.label, t)} onClick={() => open(r.areaId)} className="w-full px-2 py-1.5 hover:bg-sunken">
                            {cellText(t)}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line bg-sunken font-medium">
              <tr>
                <td className="px-3 py-1.5" colSpan={2}>
                  Total
                </td>
                {CAPABILITIES.map((c) => (
                  <td key={c.key} className="px-2 py-1.5 text-center tabular-nums">
                    {cellText(totals[c.key])}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
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

  const run = async (edit: (s: InventorySettings) => InventorySettings) => {
    setError(null);
    const err = await saveInventory(edit);
    if (err) setError(err);
  };

  if (!inventoryLoaded) return <p className="text-[13px] text-muted">Loading the inventory settings…</p>;

  const present = CAPABILITIES.filter((c) => inv[c.key].length > 0);
  const absent = CAPABILITIES.filter((c) => inv[c.key].length === 0);

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-[68ch] text-[13px] text-muted">{CAPABILITIES_NOTE}</p>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px]">
        <label className="flex items-center gap-2">
          Type
          <select className={selectClass} value={choice.type} disabled={locked} onChange={(e) => void run((s) => setAreaType(s, area.id, e.target.value as AreaType))}>
            {AREA_TYPES.map((t) => (
              <option key={t} value={t}>
                {cap(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={choice.bedroom} disabled={locked} onChange={(e) => void run((s) => setBedroom(s, area.id, e.target.checked))} className="accent-[var(--accent)]" />
          Bedroom
        </label>
      </div>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      {present.map((c) => {
        const rows = inv[c.key];
        const counted = rows.filter((r) => r.counts).length;
        return (
          <section key={c.key} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">
              {c.label} · {counted} of {rows.length} count{rows.length === 1 ? "s" : ""}
            </h2>
            {(c.key === "motion" || c.key === "presence") && <p className="text-xs text-muted">{ROLE_HINT}</p>}
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
              {rows.map((r) => (
                <CapabilityRow key={r.entityId} h={h} row={r} locked={locked} run={run} />
              ))}
            </ul>
          </section>
        );
      })}

      <p className="text-[13px] text-muted">{absent.length === 0 ? "This area has every capability." : `Not in this area: ${absent.map((c) => c.label).join(", ")}.`}</p>

      <AreaHelpersSection h={h} areaId={area.id} go={go} />
    </div>
  );
}

function CapabilityRow({ h, row, locked, run }: { h: Hierarchy; row: InventoryRow; locked: boolean; run: (edit: (s: InventorySettings) => InventorySettings) => Promise<void> }) {
  const e = h.entities[row.entityId];
  const state = e?.state === null || e === undefined ? "no state" : e.unit ? `${e.state} ${e.unit}` : e.state;
  const pair = SWITCHABLE[row.capability];
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 text-[13px]">
      <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          aria-label={`Counts: ${row.name}`}
          checked={row.counts}
          disabled={locked}
          onChange={(ev) => void run((s) => setCounts(h, s, row.entityId, ev.target.checked))}
          className="accent-[var(--accent)]"
        />
        Counts
      </label>
      <div className="flex min-w-[10rem] flex-1 flex-col">
        <span className="flex items-center gap-1.5 font-medium">
          {row.name}
          {row.overridden && <EditedDot title="Differs from what Taxis detected" />}
        </span>
        <code className="font-mono text-xs text-muted">{row.entityId}</code>
      </div>
      <span className="text-xs text-muted tabular-nums">{state}</span>
      {row.flags.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {row.flags.map((f) => (
            <span key={f} title={FLAGS[f].hint} className={`rounded-full border px-1.5 py-0.5 text-[11px] ${FLAGS[f].tone}`}>
              {FLAGS[f].label}
            </span>
          ))}
        </span>
      )}
      <span className="flex items-center gap-3">
        {(row.capability === "motion" || row.capability === "presence") && (
          <select aria-label={`Role of ${row.name}`} className={selectClass} value={row.role} disabled={locked} onChange={(ev) => void run((s) => setRole(h, s, row.entityId, ev.target.value as MotionRole))}>
            <option value="starts">Starts</option>
            <option value="holds">Holds</option>
          </select>
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
        {pair && (
          <select aria-label={`Kind of ${row.name}`} className={selectClass} value={row.capability} disabled={locked} onChange={(ev) => void run((s) => setKind(h, s, row.entityId, ev.target.value as Capability))}>
            {pair.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        )}
        {row.capability === "lights" && (
          <select aria-label={`Light role of ${row.name}`} className={selectClass} value={row.light} disabled={locked} onChange={(ev) => void run((s) => setLightRole(s, row.entityId, ev.target.value as LightRole))}>
            {LIGHT_ROLES.map((l) => (
              <option key={l} value={l}>
                {cap(l)}
              </option>
            ))}
          </select>
        )}
        {row.overridden && (
          <Button tone="ghost" className="px-2 py-1 text-xs" disabled={locked} aria-label={`Reset ${row.name}`} onClick={() => void run((s) => resetEntity(s, row.entityId))}>
            Reset
          </Button>
        )}
      </span>
    </li>
  );
}
