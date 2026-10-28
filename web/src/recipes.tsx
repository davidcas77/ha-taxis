import { RecipeRecords } from "./recipe-records.tsx";
import { useStoredChoice } from "./storage.ts";
import { HelpDisclosure, HelpTopic } from "./help.tsx";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  HOUSE_RECIPE_LABEL,
  RECIPES,
  planRecipes,
  recipeChangeInputs,
  type RecipeCell,
  type RecipeInstalled,
  type RecipeStatus,
} from "../../shared/recipes.ts";
import { planHouseRecipes } from "../../shared/recipes-house.ts";
import { HOUSE_RECIPE_KEYS } from "../../shared/blueprints.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { api } from "./api.ts";
import { useTaxis } from "./state.tsx";
import { ColumnHeader, SortHeader, useSort } from "./table.tsx";
import { Button } from "./ui.tsx";

// Recipes: an automation Taxis makes for an area from a blueprint of its own,
// with the helpers it needs and the parameters of the area. One table, areas by
// recipes. A cell says whether the recipe can be installed, what is missing when
// it can't, and whether an installed one still matches. Adding cells puts
// changes in the list; nothing reaches Home Assistant until the list is applied.
// The recipes of the house (Announce, Goodbye, House presence, Low batteries, Not
// reporting) are not for one room: they are listed under the table, one row each.

const NOTE = "Choose recipes for each room. Review and apply installations in Changes.";

const RECIPE_HELP: Record<string, string> = {
  occupancy: "Keeps a room occupied while activity or its hold timer continues.",
  motion_lights: "Turns room lights on with occupancy and off when the room clears.",
  media_off: "Turns speakers and TVs off after the room clears.",
  area_climate: "Sets thermostats from season, occupancy, schedules and home modes.",
  bathroom_fan: "Runs the fan while humidity indicates steam or a shower.",
  exterior_lights: "Controls outdoor lights using sunset and activity.",
  left_open: "Notifies when a door or window stays open too long.",
  appliance_done: "Notifies when an appliance's power use indicates it has finished.",
  leak_alert: "Notifies, repeatedly while wet, when a leak sensor reports water, and closes a water valve if one is chosen.",
  covers_sun: "Closes covers against the sun on warm days and opens them again in the morning.",
  announce: "Speaks a message in occupied rooms using text-to-speech.",
  goodbye: "A script that turns off lights and media and switches away mode on.",
  house_presence: "Makes the house occupied sensor and switches away mode on when everyone has left.",
  battery_low: "One daily message listing the batteries that are low.",
  unavailable_watch: "Notifies when a sensor the recipes rely on stops reporting.",
};

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
          <p className="mt-0.5 text-muted">
            Installing this would make two automations control the same {cell.controls === "lights" ? "lights" : "thermostats"}.
          </p>
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

// A cell: its checkbox (when it can be added) and what it says.
function CellBox({
  c,
  label,
  areaName,
  picked,
  setPicked,
}: {
  c: RecipeCell;
  label: string;
  areaName: string;
  picked: Set<string>;
  setPicked: (f: (p: Set<string>) => Set<string>) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      {c.actionable ? (
        <input
          type="checkbox"
          aria-label={`Add ${label} for ${areaName}`}
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
  );
}

// The table, once what Home Assistant holds is known.
export function RecipesTable({ h, installed }: { h: Hierarchy; installed: RecipeInstalled }) {
  const { inventory, naming, parameters, changes, propose, busy } = useTaxis();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const areaCells = useMemo(() => planRecipes(h, inventory, naming, parameters, installed, changes), [h, inventory, naming, parameters, installed, changes]);
  const houseCells = useMemo(
    () => planHouseRecipes(h, inventory, naming, parameters, installed, changes),
    [h, inventory, naming, parameters, installed, changes],
  );
  const cells = useMemo(() => [...areaCells, ...houseCells], [areaCells, houseCells]);
  const lines = useMemo(() => {
    const byArea = new Map<string, Line>();
    for (const c of areaCells) {
      let line = byArea.get(c.areaId);
      if (!line) {
        const floor = h.floors.find((f) => f.id === h.areas[c.areaId]?.floorId);
        line = { areaId: c.areaId, areaName: c.areaName, floorName: floor?.name ?? "", cells: {} };
        byArea.set(c.areaId, line);
      }
      line.cells[c.recipe] = c;
    }
    return [...byArea.values()];
  }, [areaCells, h]);

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
  const shownHouse = houseCells.filter((c) => matches(c, filter));
  const selectable = [...rows.flatMap((l) => Object.values(l.cells)), ...shownHouse].filter((c) => c.actionable);
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

      {rows.length === 0 && shownHouse.length === 0 ? (
        <p className="text-[13px] text-muted">Nothing here.</p>
      ) : (
        <>
          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full text-[13px]">
                <thead className="bg-sunken text-left text-xs text-muted">
                  <tr>
                    <SortHeader label="Area" help="The room this recipe will automate." k="area" sort={sort} onToggle={toggle} />
                    {RECIPES.map((r) => (
                      <SortHeader key={r.key} label={r.label} help={RECIPE_HELP[r.key]} k={r.key} sort={sort} onToggle={toggle} />
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
                      {RECIPES.map((r) => (
                        <td key={r.key} className="px-3 py-1.5">
                          <CellBox c={l.cells[r.key]} label={r.label} areaName={l.areaName} picked={picked} setPicked={setPicked} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {shownHouse.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full text-[13px]" aria-label="House recipes">
                <thead className="bg-sunken text-left text-xs text-muted">
                  <tr>
                    <ColumnHeader aria-label="House" help="Recipes for the whole house, not one room." className="px-3 py-2 font-medium">
                      House
                    </ColumnHeader>
                    <ColumnHeader
                      aria-label="Status"
                      help="Whether the recipe can be installed, and what is missing when it can't."
                      className="px-3 py-2 font-medium"
                    >
                      Status
                    </ColumnHeader>
                  </tr>
                </thead>
                <tbody>
                  {shownHouse.map((c) => (
                    <tr key={c.recipe} className="border-t border-line align-top">
                      <th scope="row" className="px-3 py-1.5 text-left font-normal">
                        {HOUSE_RECIPE_LABEL[c.recipe as (typeof HOUSE_RECIPE_KEYS)[number]]}
                        <div className="max-w-xs text-[11px] text-muted">{RECIPE_HELP[c.recipe]}</div>
                      </th>
                      <td className="px-3 py-1.5">
                        <CellBox
                          c={c}
                          label={HOUSE_RECIPE_LABEL[c.recipe as (typeof HOUSE_RECIPE_KEYS)[number]]}
                          areaName="the house"
                          picked={picked}
                          setPicked={setPicked}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function RecipesTab({ h, view = "table" }: { h: Hierarchy; view?: "table" | "records" }) {
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <HelpDisclosure summary={NOTE}>
        <HelpTopic title="Requirements">Recipes use the entities counted in Capabilities and your parameter values.</HelpTopic>
        <HelpTopic title="Installation">
          Creates a reusable blueprint, required helpers and one automation per room. Announce creates one house-wide script.
        </HelpTopic>
        <HelpTopic title="Review first">Nothing changes in Home Assistant until you apply the queued installation.</HelpTopic>
      </HelpDisclosure>
      {!ready ? (
        <p className="text-[13px] text-muted">Loading the settings…</p>
      ) : error ? (
        <p role="alert" className="text-[13px] text-danger">
          Taxis couldn't check what is installed in Home Assistant, so it can't say what is ready. {error}
        </p>
      ) : !installed ? (
        <p className="text-[13px] text-muted">Checking what is installed in Home Assistant…</p>
      ) : view === "records" ? (
        <RecipeRecords h={h} installed={installed} descriptions={RECIPE_HELP} />
      ) : (
        <div className="min-h-0 overflow-auto">
          <RecipesTable h={h} installed={installed} />
        </div>
      )}
    </div>
  );
}

export function RecipesPage({ h }: { h: Hierarchy }) {
  const [view, setView] = useStoredChoice("taxis:recipes:view", ["table", "records"] as const, "records");
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4 md:p-6">
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <h1 className="flex-1 text-xl font-semibold">Recipes</h1>
        <div role="group" aria-label="Recipe view" className="flex gap-1">
          {(["table", "records"] as const).map((mode) => (
            <Button key={mode} aria-pressed={view === mode} onClick={() => setView(mode)}>
              {mode === "table" ? "Table" : "Records"}
            </Button>
          ))}
        </div>
      </header>
      <RecipesTab h={h} view={view} />
    </main>
  );
}
