import { useEffect, useMemo, useState, type ReactNode } from "react";

import { RECIPES, planRecipes, recipeChangeInputs, type RecipeCell, type RecipeInstalled, type RecipeStatus } from "../../shared/recipes.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { api } from "./api.ts";
import { useTaxis } from "./state.tsx";
import { SortHeader, useSort } from "./table.tsx";
import { Button } from "./ui.tsx";

// Recipes: an automation Taxis makes for an area from a blueprint of its own,
// with the helpers it needs and the parameters of the area. One table, areas by
// recipes. A cell says whether the recipe can be installed, what is missing when
// it can't, and whether an installed one still matches. Adding cells puts
// changes in the list; nothing reaches Home Assistant until the list is applied.

const NOTE =
  "Recipes Taxis can install per area, from the sensors and lights that count in the Capabilities tab and the parameters. Installing writes a blueprint (once), the helpers the recipe needs and one automation per area. Nothing is written until you apply the change list.";

// Most useful first.
const ORDER: RecipeStatus[] = ["ready", "out-of-date", "in-changes", "missing", "installed"];

const FILTERS: { key: RecipeStatus | "all" | "todo"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "todo", label: "To do" },
  { key: "ready", label: "Ready" },
  { key: "out-of-date", label: "Out of date" },
  { key: "installed", label: "Installed" },
  { key: "missing", label: "Missing" },
  { key: "in-changes", label: "In changes" },
];

type Line = { areaId: string; areaName: string; floorName: string; cells: Record<string, RecipeCell> };

const keyOf = (c: RecipeCell) => `${c.areaId}|${c.recipe}`;

function matches(c: RecipeCell, f: (typeof FILTERS)[number]["key"]): boolean {
  if (f === "all") return true;
  if (f === "todo") return c.actionable;
  return c.status === f;
}

function StatusCell({ cell }: { cell: RecipeCell }) {
  let main: ReactNode;
  let tone = "text-muted";
  switch (cell.status) {
    case "ready":
      main = "Ready";
      tone = "text-warn";
      break;
    case "installed":
      main = "Installed";
      tone = "text-on";
      break;
    case "out-of-date":
      main = "Out of date";
      tone = "text-warn";
      break;
    case "in-changes":
      main = "In changes";
      tone = "text-accent";
      break;
    case "missing":
      main = `Missing: ${cell.missing.join("; ")}`;
      break;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className={tone}>{main}</span>
      {cell.reasons.length > 0 && (
        <ul className="text-[11px] text-muted">
          {cell.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {cell.notes.map((n) => (
        <span key={n} className="text-[11px] text-muted">
          {n}
        </span>
      ))}
      {cell.controlledBy.length > 0 && (
        <details className="text-[11px] text-warn">
          <summary className="cursor-pointer">
            Already controlled by {cell.controlledBy.length} other automation{cell.controlledBy.length === 1 ? "" : "s"}
          </summary>
          <p className="mt-0.5 text-muted">Installing this would make two automations control the same {cell.controls === "lights" ? "lights" : "thermostats"}.</p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {cell.controlledBy.map((a) => (
              <li key={a.entityId}>
                {a.name} <code className="font-mono text-muted">{a.entityId}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// The table, once what Home Assistant holds is known.
export function RecipesTable({ h, installed }: { h: Hierarchy; installed: RecipeInstalled }) {
  const { inventory, naming, parameters, changes, propose, busy } = useTaxis();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const cells = useMemo(() => planRecipes(h, inventory, naming, parameters, installed, changes), [h, inventory, naming, parameters, installed, changes]);
  const lines = useMemo(() => {
    const byArea = new Map<string, Line>();
    for (const c of cells) {
      let line = byArea.get(c.areaId);
      if (!line) {
        const floor = h.floors.find((f) => f.id === h.areas[c.areaId]?.floorId);
        line = { areaId: c.areaId, areaName: c.areaName, floorName: floor?.name ?? "", cells: {} };
        byArea.set(c.areaId, line);
      }
      line.cells[c.recipe] = c;
    }
    return [...byArea.values()];
  }, [cells, h]);

  const shown = useMemo(() => lines.filter((l) => Object.values(l.cells).some((c) => matches(c, filter))), [lines, filter]);
  const columns = useMemo(
    () => ({
      area: (l: Line) => l.areaName,
      floor: (l: Line) => l.floorName,
      ...Object.fromEntries(RECIPES.map((r) => [r.key, (l: Line) => ORDER.indexOf(l.cells[r.key].status)])),
    }),
    [],
  );
  const { rows, sort, toggle } = useSort(shown, columns, { key: "area", dir: "asc" });

  const count = (f: (typeof FILTERS)[number]["key"]) => cells.filter((c) => matches(c, f)).length;
  // Only cells that are on screen and can still be added count as picked.
  const selectable = rows.flatMap((l) => Object.values(l.cells)).filter((c) => c.actionable);
  const chosen = selectable.filter((c) => picked.has(keyOf(c)));
  const allChosen = selectable.length > 0 && chosen.length === selectable.length;

  const add = async () => {
    const inputs = recipeChangeInputs(chosen);
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
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            aria-label="Select all that can be added"
            disabled={selectable.length === 0}
            checked={allChosen}
            onChange={() => setPicked(allChosen ? new Set() : new Set(selectable.map(keyOf)))}
            className="accent-[var(--accent)]"
          />
          Select all that can be added
        </label>
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
                <SortHeader label="Area" k="area" sort={sort} onToggle={toggle} />
                {RECIPES.map((r) => (
                  <SortHeader key={r.key} label={r.label} k={r.key} sort={sort} onToggle={toggle} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.areaId} className="border-t border-line align-top">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal">
                    {l.areaName}
                    {l.floorName && <div className="text-[11px] text-muted">{l.floorName}</div>}
                  </th>
                  {RECIPES.map((r) => {
                    const c = l.cells[r.key];
                    return (
                      <td key={r.key} className="px-3 py-1.5">
                        <div className="flex items-start gap-2">
                          {c.actionable ? (
                            <input
                              type="checkbox"
                              aria-label={`Add ${r.label} for ${l.areaName}`}
                              checked={picked.has(keyOf(c))}
                              onChange={() =>
                                setPicked((p) => {
                                  const n = new Set(p);
                                  if (!n.delete(keyOf(c))) n.add(keyOf(c));
                                  return n;
                                })
                              }
                              className="mt-0.5 accent-[var(--accent)]"
                            />
                          ) : (
                            <span className="w-[13px] shrink-0" aria-hidden />
                          )}
                          <StatusCell cell={c} />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function RecipesTab({ h }: { h: Hierarchy }) {
  const { inventoryLoaded, namingLoaded, parametersLoaded } = useTaxis();
  const ready = inventoryLoaded && namingLoaded && parametersLoaded;
  const [installed, setInstalled] = useState<RecipeInstalled | null>(null);
  const [error, setError] = useState<string | null>(null);

  // What Home Assistant holds, read again whenever the home is (Refresh, Apply).
  useEffect(() => {
    let stale = false;
    void api.recipesState().then((r) => {
      if (stale) return;
      setError(r.ok ? null : r.error);
      setInstalled(r.ok ? r.installed : null);
    });
    return () => {
      stale = true;
    };
  }, [h.fetchedAt]);

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[68ch] text-[13px] text-muted">{NOTE}</p>
      {!ready ? (
        <p className="text-[13px] text-muted">Loading the settings…</p>
      ) : error ? (
        <p role="alert" className="text-[13px] text-danger">
          Taxis couldn't check what is installed in Home Assistant, so it can't say what is ready. {error}
        </p>
      ) : !installed ? (
        <p className="text-[13px] text-muted">Checking what is installed in Home Assistant…</p>
      ) : (
        <RecipesTable h={h} installed={installed} />
      )}
    </div>
  );
}
