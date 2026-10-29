import {
  BatteryLow,
  Blinds,
  DoorOpen,
  Droplet,
  Fan,
  House,
  Lightbulb,
  LogOut,
  Megaphone,
  Sunset,
  Thermometer,
  Tv,
  Users,
  WashingMachine,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { isHouseRecipe, type HouseRecipeKey } from "../../shared/blueprints.ts";
import { splitByFit } from "../../shared/recipe-fit.ts";
import { planHouseRecipes } from "../../shared/recipes-house.ts";
import {
  HOUSE_RECIPE_LABEL,
  RECIPES,
  planRecipes,
  recipeChangeInputs,
  type RecipeCell,
  type RecipeInstalled,
  type RecipeStatus,
} from "../../shared/recipes.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { api } from "./api.ts";
import { DataTable, type Column } from "./data-table.tsx";
import { HelpDisclosure, HelpTopic } from "./help.tsx";
import { RecipeRecords } from "./recipe-records.tsx";
import { useTaxis, type Route } from "./state.tsx";
import { useStoredChoice, useStoredFlag } from "./storage.ts";
import { Button, Chip, EmptyState, TONE_TEXT, Toolbar, type Tone } from "./ui.tsx";

// Recipes: an automation Taxis makes for an area from a blueprint of its own,
// with the helpers it needs and the parameters of the area. One table, areas by
// recipes. A cell says whether the recipe can be installed, what is missing when
// it can't, and whether an installed one still matches. Adding cells puts
// changes in the list; nothing reaches Home Assistant until the list is applied.
// The recipes of the house (Announce, Goodbye, House presence, Low batteries, Not
// reporting) are not for one room: they are listed under the table, one row each.
//
// Only the recipes that fit an area are listed for it (shared/recipe-fit.ts), so
// "Missing requirements" always means something; "Show all recipes" lists the rest.

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

const RECIPE_ICON: Record<string, LucideIcon> = {
  occupancy: Users,
  motion_lights: Lightbulb,
  media_off: Tv,
  area_climate: Thermometer,
  bathroom_fan: Fan,
  exterior_lights: Sunset,
  left_open: DoorOpen,
  appliance_done: WashingMachine,
  leak_alert: Droplet,
  covers_sun: Blinds,
  announce: Megaphone,
  goodbye: LogOut,
  house_presence: House,
  battery_low: BatteryLow,
  unavailable_watch: WifiOff,
};

// The recipes the table shows beside the area; the rest wait behind their
// arrow when the table is narrow (the least used go first).
const RECIPE_PRIORITY: Record<string, 2 | 3> = {
  occupancy: 2,
  motion_lights: 2,
  media_off: 2,
  area_climate: 2,
  bathroom_fan: 3,
  exterior_lights: 3,
  left_open: 3,
  appliance_done: 3,
  leak_alert: 3,
  covers_sun: 3,
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

type Line = { key: string; areaId: string; areaName: string; floorName: string; cells: Record<string, RecipeCell> };

const keyOf = (c: RecipeCell) => `${c.areaId}|${c.recipe}`;

function matches(c: RecipeCell, f: (typeof FILTERS)[number]["key"]): boolean {
  if (f === "all") return true;
  if (f === "todo") return c.actionable;
  return c.status === f;
}

const STATUS_TONE: Record<RecipeStatus, Tone> = { ready: "warn", installed: "ok", "out-of-date": "warn", "in-changes": "info", missing: "muted" };

function StatusCell({ cell }: { cell: RecipeCell }) {
  let main: ReactNode;
  switch (cell.status) {
    case "ready":
      main = "Ready";
      break;
    case "installed":
      main = "Installed";
      break;
    case "out-of-date":
      main = "Out of date";
      break;
    case "in-changes":
      main = "In changes";
      break;
    case "missing":
      main = `Missing: ${cell.missing.join("; ")}`;
      break;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className={TONE_TEXT[STATUS_TONE[cell.status]]}>{main}</span>
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

// The table, once what Home Assistant holds is known. `cells` is every cell of
// the plan; `shown` the keys of the ones that fit their area (or all of them).
export function RecipesTable({ h, cells, shown }: { h: Hierarchy; cells: readonly RecipeCell[]; shown: ReadonlySet<string> }) {
  const { propose, busy } = useTaxis();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [query, setQuery] = useState("");
  const [houseQuery, setHouseQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const { lines, houseCells } = useMemo(() => {
    const byArea = new Map<string, Line>();
    const house: RecipeCell[] = [];
    for (const c of cells) {
      if (isHouseRecipe(c.recipe)) {
        house.push(c);
        continue;
      }
      let line = byArea.get(c.areaId);
      if (!line) {
        const floor = h.floors.find((f) => f.id === h.areas[c.areaId]?.floorId);
        line = { key: c.areaId, areaId: c.areaId, areaName: c.areaName, floorName: floor?.name ?? "", cells: {} };
        byArea.set(c.areaId, line);
      }
      line.cells[c.recipe] = c;
    }
    return { lines: [...byArea.values()], houseCells: house };
  }, [cells, h]);

  const visible = (c: RecipeCell) => shown.has(keyOf(c));
  const rows = useMemo(
    () =>
      lines.filter(
        (l) =>
          `${l.areaName} ${l.floorName}`.toLowerCase().includes(query.trim().toLowerCase()) &&
          Object.values(l.cells).some((c) => visible(c) && matches(c, filter)),
      ),
    [lines, filter, shown, query],
  );
  const houseRows = useMemo(
    () =>
      houseCells.filter(
        (c) =>
          visible(c) &&
          matches(c, filter) &&
          `${c.recipe} ${HOUSE_RECIPE_LABEL[c.recipe as HouseRecipeKey]} ${c.status}`.toLowerCase().includes(houseQuery.trim().toLowerCase()),
      ),
    [houseCells, filter, shown, houseQuery],
  );

  const shownCells = useMemo(() => cells.filter(visible), [cells, shown]);
  const count = (f: (typeof FILTERS)[number]["key"]) => shownCells.filter((c) => matches(c, f)).length;
  // Only cells that are on screen and can still be added count as picked.
  const selectable = [...rows.flatMap((l) => Object.values(l.cells).filter(visible)), ...houseRows].filter((c) => c.actionable);
  const chosen = selectable.filter((c) => picked.has(keyOf(c)));
  const allChosen = selectable.length > 0 && chosen.length === selectable.length;

  const add = async () => {
    const inputs = recipeChangeInputs(chosen);
    if (inputs.length === 0) return;
    if (await propose(inputs)) setPicked(new Set());
  };

  const dash = (title: string) => (
    <span className="text-muted/60" title={title}>
      –
    </span>
  );
  const columns: Column<Line>[] = [
    {
      id: "area",
      header: "Area",
      help: "The room this recipe will automate.",
      priority: 1,
      sticky: true,
      minWidth: 140,
      sort: (l) => l.areaName,
      text: (l) => l.areaName,
      cell: (l) => (
        <>
          {l.areaName}
          {l.floorName && <div className="text-[11px] text-muted">{l.floorName}</div>}
        </>
      ),
    },
    ...RECIPES.map<Column<Line>>((r) => {
      const Icon = RECIPE_ICON[r.key];
      return {
        id: r.key,
        header: r.label,
        icon: <Icon className="size-3.5 shrink-0" aria-hidden />,
        help: RECIPE_HELP[r.key],
        priority: RECIPE_PRIORITY[r.key],
        minWidth: 140,
        sort: (l) => (l.cells[r.key] && visible(l.cells[r.key]) ? ORDER.indexOf(l.cells[r.key].status) : null),
        cell: (l) => {
          const c = l.cells[r.key];
          if (!c) return dash("Nothing for the house here");
          if (!visible(c)) return dash(`${r.label} doesn't fit this area. Choose Show all recipes to see it.`);
          return <CellBox c={c} label={r.label} areaName={l.areaName} picked={picked} setPicked={setPicked} />;
        },
      };
    }),
  ];

  // The recipes of the whole house: a table of their own under the areas, one row each.
  const houseColumns: Column<RecipeCell>[] = [
    {
      id: "recipe",
      header: "House",
      help: "Recipes for the whole house, not one room.",
      priority: 1,
      sticky: true,
      minWidth: 200,
      sort: (c) => HOUSE_RECIPE_LABEL[c.recipe as HouseRecipeKey],
      text: (c) => HOUSE_RECIPE_LABEL[c.recipe as HouseRecipeKey],
      cell: (c) => {
        const Icon = RECIPE_ICON[c.recipe];
        return (
          <>
            <span className="inline-flex items-center gap-1.5">
              <Icon className="size-3.5 shrink-0 text-muted" aria-hidden />
              {HOUSE_RECIPE_LABEL[c.recipe as HouseRecipeKey]}
            </span>
            <div className="max-w-xs text-[11px] text-muted">{RECIPE_HELP[c.recipe]}</div>
          </>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      help: "Whether the recipe can be installed, and what is missing when it can't.",
      priority: 1,
      minWidth: 180,
      sort: (c) => ORDER.indexOf(c.status),
      cell: (c) => <CellBox c={c} label={HOUSE_RECIPE_LABEL[c.recipe as HouseRecipeKey]} areaName="the house" picked={picked} setPicked={setPicked} />,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Toolbar label="Recipe filters">
        <div role="group" aria-label="Show" className="flex flex-1 flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Chip key={f.key} pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label} {count(f.key)}
            </Chip>
          ))}
        </div>
      </Toolbar>

      <DataTable
        id="recipes"
        search={{ value: query, onChange: setQuery, placeholder: "Find a room or floor", label: "Find area recipes" }}
        actions={
          <>
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
          </>
        }
        label="Recipes by area"
        rows={rows}
        rowKey={(l) => l.key}
        columns={columns}
        defaultSort={{ key: "area", dir: "asc" }}
        empty={<EmptyState>{houseRows.length > 0 ? "No area has a recipe to show here." : "Nothing here."}</EmptyState>}
        maxHeight="none"
      />
      {(houseCells.some(visible) || houseQuery.length > 0) && (
        <DataTable
          id="recipes-house"
          search={{ value: houseQuery, onChange: setHouseQuery, placeholder: "Find a house recipe", label: "Find house recipes" }}
          label="House recipes"
          rows={houseRows}
          rowKey={keyOf}
          columns={houseColumns}
          defaultSort={{ key: "", dir: "asc" }}
          empty={<EmptyState>Nothing here.</EmptyState>}
          maxHeight="none"
        />
      )}
    </div>
  );
}

// The toolbar above both views: how many recipes were left out, and the way to see them.
function FitNote({ hidden, showAll, setShowAll }: { hidden: number; showAll: boolean; setShowAll: (on: boolean) => void }) {
  if (hidden === 0 && !showAll) return null;
  return (
    <Toolbar label="Recipes that fit">
      <p className="flex-1 text-xs text-muted">
        {showAll
          ? "Showing every recipe for every area, including the ones that don't fit."
          : `${hidden} recipe${hidden === 1 ? "" : "s"} ${hidden === 1 ? "doesn't" : "don't"} fit these areas (an exterior light in a bathroom, a bathroom fan in a hall) and ${hidden === 1 ? "is" : "are"} left out.`}
      </p>
      <Chip pressed={showAll} onClick={() => setShowAll(!showAll)} title="List recipes for areas they don't fit too">
        Show all recipes
      </Chip>
    </Toolbar>
  );
}

function RecipesBody({ h, installed, view }: { h: Hierarchy; installed: RecipeInstalled; view: "table" | "records" }) {
  const { inventory, naming, parameters, changes } = useTaxis();
  const [showAll, setShowAll] = useStoredFlag("taxis:recipes:show-all", false);
  const all = useMemo(
    () => [...planRecipes(h, inventory, naming, parameters, installed, changes), ...planHouseRecipes(h, inventory, naming, parameters, installed, changes)],
    [h, inventory, naming, parameters, installed, changes],
  );
  const split = useMemo(() => splitByFit(h, inventory, naming, all), [h, inventory, naming, all]);
  const shown = useMemo(() => new Set((showAll ? all : split.fits).map(keyOf)), [showAll, all, split]);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <FitNote hidden={split.hidden.length} showAll={showAll} setShowAll={setShowAll} />
      {view === "records" ? (
        <RecipeRecords h={h} installed={installed} descriptions={RECIPE_HELP} cells={all.filter((c) => shown.has(keyOf(c)))} />
      ) : (
        <RecipesTable h={h} cells={all} shown={shown} />
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <HelpDisclosure summary={NOTE}>
        <HelpTopic title="Requirements">Recipes use the entities counted in Capabilities and your parameter values.</HelpTopic>
        <HelpTopic title="Installation">
          Creates a reusable blueprint, required helpers and one automation per room. The house recipes (Announce, Goodbye, House presence, Low batteries, Not
          reporting) are one script or automation for the whole house, listed under the areas.
        </HelpTopic>
        <HelpTopic title="Review first">Nothing changes in Home Assistant until you apply the installation in Changes.</HelpTopic>
        <HelpTopic title="Which recipes are listed">
          Only the recipes that fit a room: Exterior lights for an exterior area, Bathroom fan for a fan or a bathroom, Media off for a speaker or a TV, Leak
          alert for a leak sensor, Covers and sun for a cover, and so on. Show all recipes lists the rest. The house recipes are always listed.
        </HelpTopic>
      </HelpDisclosure>
      {!ready ? (
        <p className="text-[13px] text-muted">Loading the settings…</p>
      ) : error ? (
        <p role="alert" className="text-[13px] text-danger">
          Taxis couldn't check what is installed in Home Assistant, so it can't say what is ready. {error}
        </p>
      ) : !installed ? (
        <p className="text-[13px] text-muted">Checking what is installed in Home Assistant…</p>
      ) : (
        <RecipesBody h={h} installed={installed} view={view} />
      )}
    </div>
  );
}

// The Recipes tab of the Automations page: content only, the page supplies the header.
export function RecipesPanel({ h }: { h: Hierarchy; go?: (r: Route) => void }) {
  const [view, setView] = useStoredChoice("taxis:recipes:view", ["table", "records"] as const, "records");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <Toolbar label="Recipe view" className="w-fit gap-x-1">
        {(["table", "records"] as const).map((mode) => (
          <Chip key={mode} pressed={view === mode} onClick={() => setView(mode)}>
            {mode === "table" ? "Table" : "Records"}
          </Chip>
        ))}
      </Toolbar>
      <RecipesTab h={h} view={view} />
    </div>
  );
}
