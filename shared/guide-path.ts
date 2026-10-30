import { CAPABILITIES, type InventorySettings, inventoryMatrix } from "./inventory.ts";
import { hasPendingChange, type HelperRow } from "./helpers.ts";
import type { ButtonInventory } from "./buttons.ts";
import { analyzeArea, areaCodes, type NamingSettings } from "./naming.ts";
import { namingFit, type NamingIgnores } from "./naming-ignores.ts";
import type { ParameterSettings } from "./parameters.ts";
import { areaFacts as fitFacts, recipeFits } from "./recipe-fit.ts";
import { unavailableRecipeMessage, type RecipeCell, type RecipeStatus } from "./recipes.ts";
import type { Change, Hierarchy } from "./types.ts";

// "Your path": the steps to a complete, well-organised Home Assistant, in the
// order that works: floors and areas, every entity in an area, naming,
// capabilities, helpers, parameters, recipes, buttons, then a clean Health.
// Each step gets a status from data Taxis has already read. Pure: the page
// gathers the facts (the `*Facts` functions below) and `buildGuidePath` turns
// them into steps, so the rules are tested without a browser.
//
// Below the nine steps are the goals: the recipes that look after the house
// (leaks, batteries and silent sensors, who is home, covers). A goal is listed
// only when it applies to this house, and is done when its recipes are installed
// or waiting in Changes.

export const PATH_STEPS = ["areas", "entities", "naming", "capabilities", "helpers", "parameters", "recipes"] as const;
export type PathStepKey = (typeof PATH_STEPS)[number] | "buttons" | "health";

// done: nothing left. attention: started, with something to fix. todo: not
// started. unknown: not read yet, or the read failed (never shown as done).
export type PathStatus = "done" | "attention" | "todo" | "unknown";

// Where a step's button goes. Structurally the app's Route, so the page passes it to `go` as it is.
export type PathTarget =
  | {
      page: "areas";
      sel: { kind: "home" } | { kind: "unassigned" } | { kind: "loose" } | { kind: "area"; id: string };
      tab: "overview" | "naming" | "capabilities";
    }
  | { page: "organize"; type: "spaces" | "entities"; id: null }
  | { page: "parameters"; tab: "capabilities" | "helpers" | "area-codes" | "house" }
  | { page: "automations"; tab: "recipes" | "buttons"; controlId: null }
  | { page: "health" }
  | { page: "changes" };

// A source of facts: still being read, failed, or here.
export type Loaded<T> = { state: "loading" } | { state: "error"; error: string } | { state: "ready"; value: T };
export const loading = <T>(): Loaded<T> => ({ state: "loading" });
export const ready = <T>(value: T): Loaded<T> => ({ state: "ready", value });
export const failed = <T>(error: string): Loaded<T> => ({ state: "error", error });

export type AreaFacts = { areas: number; floors: number; withoutFloor: number };
export type EntityFacts = { entities: number; unassigned: number };
export type NamingFacts = { fits: number; total: number; areasWithGaps: number; firstAreaWithGaps: string | null };
export type CapabilityFacts = { areasWithCandidates: number; areasCounting: number };
export type HelperFacts = { total: number; inPlace: number; toDo: number; inChanges: number; conflicts: number };
export type ParameterFacts = { houseValues: number; typeValues: number; areaValues: number };
export type RecipeFacts = { cells: number; ready: number; outOfDate: number; installed: number; inChanges: number; roomsReady: number; failed?: number };
export type ButtonFacts = { controls: number; gestures: number; unassigned: number };
export type HealthFacts = { errors: number; warnings: number; infos: number };

export type PathInput = {
  areas: Loaded<AreaFacts>;
  entities: Loaded<EntityFacts>;
  naming: Loaded<NamingFacts>;
  capabilities: Loaded<CapabilityFacts>;
  helpers: Loaded<HelperFacts>;
  parameters: Loaded<ParameterFacts>;
  recipes: Loaded<RecipeFacts>;
  buttons: Loaded<ButtonFacts>;
  health: Loaded<HealthFacts>;
};

export type PathStep = {
  key: PathStepKey;
  // 1-based position.
  number: number;
  title: string;
  status: PathStatus;
  summary: string;
  // The label of the button that opens `target`.
  action: string;
  target: PathTarget;
  // Set while the step's data is being read, and when reading failed.
  loading: boolean;
  error: string | null;
};

export type GuidePath = {
  steps: PathStep[];
  done: number;
  total: number;
  // The first step with something to do. Null when everything readable is done.
  next: PathStep | null;
  // True when every step is done.
  complete: boolean;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// ---- facts ------------------------------------------------------------------

export function areaFacts(h: Hierarchy): AreaFacts {
  return { areas: Object.keys(h.areas).length, floors: h.floors.length, withoutFloor: h.looseAreaIds.length };
}

export function entityFacts(h: Hierarchy): EntityFacts {
  return { entities: h.counts.entities, unassigned: h.counts.unassigned };
}

// How many entity ids already say their area (or were left alone on purpose).
// The area with the most still to fix is where the button goes.
export function namingFacts(h: Hierarchy, naming: NamingSettings, ignores: NamingIgnores): NamingFacts {
  const codes = areaCodes(h, naming);
  let fits = 0;
  let total = 0;
  let areasWithGaps = 0;
  let first: { id: string; gap: number } | null = null;
  for (const area of Object.values(h.areas)) {
    const fit = namingFit(analyzeArea(area, h, naming, codes), ignores);
    fits += fit.fits;
    total += fit.total;
    const gap = fit.total - fit.fits;
    if (gap > 0) {
      areasWithGaps += 1;
      if (!first || gap > first.gap) first = { id: area.id, gap };
    }
  }
  return { fits, total, areasWithGaps, firstAreaWithGaps: first?.id ?? null };
}

export function capabilityFacts(h: Hierarchy, inventory: InventorySettings, exclude?: (areaId: string) => ReadonlySet<string>): CapabilityFacts {
  let candidates = 0;
  let counting = 0;
  for (const row of inventoryMatrix(h, inventory, exclude)) {
    if (row.total === 0) continue;
    candidates += 1;
    if (CAPABILITIES.some((c) => row.perCapability[c.key].counted > 0)) counting += 1;
  }
  return { areasWithCandidates: candidates, areasCounting: counting };
}

export function helperFacts(rows: readonly HelperRow[], changes: readonly Change[]): HelperFacts {
  let inPlace = 0;
  let toDo = 0;
  let inChanges = 0;
  let conflicts = 0;
  for (const row of rows) {
    if (row.status === "conflict") conflicts += 1;
    else if (row.status === "in-place") inPlace += 1;
    else if (hasPendingChange(row, changes)) inChanges += 1;
    else toDo += 1;
  }
  return { total: rows.length, inPlace, toDo, inChanges, conflicts };
}

export function parameterFacts(p: ParameterSettings): ParameterFacts {
  const count = (o: object | undefined) => Object.keys(o ?? {}).length;
  const nested = (o: Record<string, object | undefined>) => Object.values(o).reduce((n, v) => n + count(v), 0);
  return { houseValues: count(p.house), typeValues: nested(p.types), areaValues: nested(p.areas) };
}

export function recipeFacts(cells: readonly RecipeCell[]): RecipeFacts {
  const roomsReady = new Set<string>();
  const n = { ready: 0, outOfDate: 0, installed: 0, inChanges: 0 };
  let failed = 0;
  for (const cell of cells) {
    if (cell.missing.includes(unavailableRecipeMessage)) failed += 1;
    if (cell.status === "ready") n.ready += 1;
    else if (cell.status === "out-of-date") n.outOfDate += 1;
    else if (cell.status === "installed") n.installed += 1;
    else if (cell.status === "in-changes") n.inChanges += 1;
    if (cell.status === "ready" || cell.status === "out-of-date") roomsReady.add(cell.areaId);
  }
  return { cells: cells.length, ...n, roomsReady: roomsReady.size, ...(failed ? { failed } : {}) };
}

// A gesture is assigned when Taxis manages a binding for it, or an automation
// that already answers it was found.
export function buttonFacts(inventory: ButtonInventory): ButtonFacts {
  const bound = new Set(inventory.managed.flatMap((m) => m.map.bindings.map((b) => `${b.controlId}\u0000${b.gestureKey}`)));
  let gestures = 0;
  let unassigned = 0;
  for (const control of inventory.controls) {
    for (const gesture of control.gestures) {
      gestures += 1;
      if (!bound.has(`${control.id}\u0000${gesture.key}`) && (control.existing[gesture.key]?.length ?? 0) === 0) unassigned += 1;
    }
  }
  return { controls: inventory.controls.length, gestures, unassigned };
}

// ---- the steps ----------------------------------------------------------------

type Rule<T> = {
  title: string;
  action: string;
  target: PathTarget;
  evaluate: (facts: T) => { status: Exclude<PathStatus, "unknown">; summary: string; action?: string; target?: PathTarget };
};

const AREAS_HOME: PathTarget = { page: "areas", sel: { kind: "home" }, tab: "overview" };

const RULES: { [K in PathStepKey]: Rule<Extract<PathInput[K], { state: "ready" }>["value"]> } = {
  areas: {
    title: "Floors and areas",
    action: "Open floors and areas",
    target: { page: "organize", type: "spaces", id: null },
    evaluate: (f) => {
      if (f.areas === 0) return { status: "todo", summary: "No areas yet. Add the rooms of the house in Home Assistant, or here." };
      const on = `${plural(f.areas, "area")} on ${plural(f.floors, "floor")}`;
      if (f.withoutFloor > 0)
        return {
          status: "attention",
          summary: `${on}; ${plural(f.withoutFloor, "area")} ${f.withoutFloor === 1 ? "has" : "have"} no floor.`,
          action: "Give areas a floor",
          target: { page: "areas", sel: { kind: "loose" }, tab: "overview" },
        };
      return { status: "done", summary: `${on}; every area is on a floor.` };
    },
  },
  entities: {
    title: "Every entity in an area",
    action: "Open the entities",
    target: { page: "organize", type: "entities", id: null },
    evaluate: (f) => {
      if (f.entities === 0) return { status: "todo", summary: "No entities were found." };
      if (f.unassigned > 0)
        return {
          status: "attention",
          summary: `${plural(f.unassigned, "entity", "entities")} not in any area, of ${f.entities.toLocaleString()}.`,
          action: "Place the entities",
          target: { page: "areas", sel: { kind: "unassigned" }, tab: "overview" },
        };
      return { status: "done", summary: `All ${f.entities.toLocaleString()} entities are in an area.` };
    },
  },
  naming: {
    title: "Naming",
    action: "Open area codes",
    target: { page: "parameters", tab: "area-codes" },
    evaluate: (f) => {
      if (f.total === 0) return { status: "todo", summary: "No entities in areas to name yet." };
      if (f.fits < f.total) {
        const target: PathTarget = f.firstAreaWithGaps ? { page: "areas", sel: { kind: "area", id: f.firstAreaWithGaps }, tab: "naming" } : AREAS_HOME;
        return {
          status: "attention",
          summary: `${f.fits.toLocaleString()}/${f.total.toLocaleString()} entity ids match their area; ${plural(f.areasWithGaps, "area")} to review.`,
          action: "Review naming",
          target,
        };
      }
      return { status: "done", summary: `${f.fits.toLocaleString()}/${f.total.toLocaleString()} entity ids match their area.` };
    },
  },
  capabilities: {
    title: "Capabilities",
    action: "Open capabilities",
    target: { page: "parameters", tab: "capabilities" },
    evaluate: (f) => {
      if (f.areasWithCandidates === 0) return { status: "todo", summary: "No area has lights, sensors or other equipment Taxis can count yet." };
      const idle = f.areasWithCandidates - f.areasCounting;
      if (idle > 0)
        return {
          status: "attention",
          summary: `${f.areasCounting} of ${plural(f.areasWithCandidates, "area")} count equipment; ${idle} ${idle === 1 ? "has" : "have"} equipment but nothing counted.`,
        };
      return { status: "done", summary: `All ${plural(f.areasWithCandidates, "area")} with equipment count it.` };
    },
  },
  helpers: {
    title: "Helpers",
    action: "Open helpers",
    target: { page: "parameters", tab: "helpers" },
    evaluate: (f) => {
      if (f.total === 0) return { status: "todo", summary: "No helpers can be planned until areas count equipment." };
      if (f.toDo + f.conflicts + f.inChanges > 0) {
        const parts = [
          f.toDo > 0 ? `${f.toDo} to create or update` : "",
          f.conflicts > 0 ? plural(f.conflicts, "conflict") : "",
          f.inChanges > 0 ? `${f.inChanges} in changes` : "",
          `${f.inPlace} in place`,
        ];
        return { status: f.inPlace === 0 && f.conflicts === 0 ? "todo" : "attention", summary: `${parts.filter(Boolean).join(", ")}.` };
      }
      return { status: "done", summary: `All ${plural(f.total, "helper")} in place.` };
    },
  },
  parameters: {
    title: "Parameters",
    action: "Open house settings",
    target: { page: "parameters", tab: "house" },
    evaluate: (f) => {
      const set = f.houseValues + f.typeValues + f.areaValues;
      if (set === 0)
        return { status: "done", summary: "Using Taxis's default values. You can keep them, or review house settings and override individual rooms." };
      return {
        status: "done",
        summary: `${plural(f.houseValues, "house setting")}, ${plural(f.typeValues, "interior/exterior setting")} and ${plural(f.areaValues, "room setting")} chosen.`,
      };
    },
  },
  recipes: {
    title: "Recipes",
    action: "Open recipes",
    target: { page: "automations", tab: "recipes", controlId: null },
    evaluate: (f) => {
      if (f.failed)
        return { status: "attention", summary: `${plural(f.failed, "recipe")} could not load in Home Assistant. Check the reported errors before continuing.` };
      const note = f.inChanges > 0 ? `, ${f.inChanges} in changes` : "";
      const head = `${plural(f.roomsReady, "room")} ready, ${f.installed} installed${note}`;
      if (f.outOfDate > 0) return { status: "attention", summary: `${head}; ${plural(f.outOfDate, "installed recipe")} need review.` };
      if (f.inChanges > 0)
        return { status: "attention", summary: `${head}. Review and Apply them.`, action: "Review the changes", target: { page: "changes" } };
      if (f.installed > 0) return { status: "done", summary: `${head}. Additional ready recipes are optional; choose only the outcomes you want.` };
      if (f.roomsReady > 0) return { status: "todo", summary: `${head}.` };
      return { status: "todo", summary: `${head}. Finish the steps above to make rooms ready.` };
    },
  },
  buttons: {
    title: "Buttons",
    action: "Open buttons",
    target: { page: "automations", tab: "buttons", controlId: null },
    evaluate: (f) => {
      if (f.controls === 0) return { status: "done", summary: "No buttons or remotes found; nothing to assign." };
      const head = `${plural(f.controls, "control")}, ${plural(f.unassigned, "gesture")} unassigned`;
      if (f.unassigned === 0) return { status: "done", summary: `${plural(f.controls, "control")}, every gesture assigned.` };
      return { status: f.unassigned === f.gestures ? "todo" : "attention", summary: `${head}.` };
    },
  },
  health: {
    title: "Health",
    action: "Open health",
    target: { page: "health" },
    evaluate: (f) => {
      if (f.errors === 0 && f.warnings === 0)
        return { status: "done", summary: f.infos > 0 ? `No errors or warnings (${plural(f.infos, "note")}).` : "No errors or warnings." };
      return { status: "attention", summary: `${plural(f.errors, "error")}, ${plural(f.warnings, "warning")}.` };
    },
  },
};

function step<K extends PathStepKey>(key: K, number: number, source: PathInput[K]): PathStep {
  const rule = RULES[key] as Rule<unknown>;
  const base = { key, number, title: rule.title, action: rule.action, target: rule.target };
  if (source.state === "loading") return { ...base, status: "unknown", summary: "Reading…", loading: true, error: null };
  if (source.state === "error") return { ...base, status: "unknown", summary: `Couldn't read this: ${source.error}`, loading: false, error: source.error };
  const result = rule.evaluate(source.value);
  return {
    ...base,
    status: result.status,
    summary: result.summary,
    action: result.action ?? base.action,
    target: result.target ?? base.target,
    loading: false,
    error: null,
  };
}

export function buildGuidePath(input: PathInput): GuidePath {
  const steps = PATH_STEPS.map((key, i) => step(key, i + 1, input[key]));
  const done = steps.filter((s) => s.status === "done").length;
  return {
    steps,
    done,
    total: steps.length,
    next: steps.find((s) => s.status === "todo" || s.status === "attention") ?? null,
    complete: done === steps.length,
  };
}

// ---- goals ----------------------------------------------------------------------
//
// The recipes of 0.7.7 that a house does not get by finishing the nine steps:
// they start nothing until the user adds them on the Recipes page, so the Guide
// leads there. Each goal looks only at the cells of the recipes it is about.

export const PATH_GOALS = ["leak", "watch", "presence", "goodbye", "covers"] as const;
export type PathGoalKey = (typeof PATH_GOALS)[number];

// The house recipes a goal can be about.
const WATCH_RECIPES = ["battery_low", "unavailable_watch"] as const;
export type GoalHouseRecipe = "house_presence" | "goodbye" | (typeof WATCH_RECIPES)[number];

// Per area recipe (leak alert, covers and sun), over the areas it applies to: an
// area applies when it has the thing the recipe is about, or already has the recipe.
export type AreaGoalFacts = {
  // Areas the recipe applies to.
  areas: number;
  // Of those: installed and up to date, installed and out of date, waiting in Changes.
  installed: number;
  outOfDate: number;
  inChanges: number;
};
export type GoalFacts = {
  leak: AreaGoalFacts;
  covers: AreaGoalFacts;
  // The status of each house recipe's cell; absent when there is none.
  house: Partial<Record<GoalHouseRecipe, RecipeStatus>>;
};

export type PathGoal = {
  key: PathGoalKey;
  title: string;
  status: Exclude<PathStatus, "unknown">;
  summary: string;
  // The label of the button that opens `target`.
  action: string;
  target: PathTarget;
};

export type GuideGoals = { state: "loading" } | { state: "error"; error: string } | { state: "ready"; goals: PathGoal[] };

const RECIPES_PAGE: PathTarget = { page: "automations", tab: "recipes", controlId: null };

function areaGoalFacts(h: Hierarchy, inventory: InventorySettings, naming: NamingSettings, cells: readonly RecipeCell[], recipe: "leak_alert" | "covers_sun") {
  const n: AreaGoalFacts = { areas: 0, installed: 0, outOfDate: 0, inChanges: 0 };
  const facts = new Map<string, ReturnType<typeof fitFacts>>();
  for (const cell of cells) {
    if (cell.recipe !== recipe) continue;
    let f = facts.get(cell.areaId);
    if (!f) {
      f = fitFacts(h, inventory, naming, cell.areaId);
      facts.set(cell.areaId, f);
    }
    if (!recipeFits(f, recipe, cell.status)) continue;
    n.areas += 1;
    if (cell.status === "installed") n.installed += 1;
    else if (cell.status === "out-of-date") n.outOfDate += 1;
    else if (cell.status === "in-changes") n.inChanges += 1;
  }
  return n;
}

// `areaCells` are the area recipes (planRecipes), `houseCells` the house ones (planHouseRecipes).
export function goalFacts(
  h: Hierarchy,
  inventory: InventorySettings,
  naming: NamingSettings,
  areaCells: readonly RecipeCell[],
  houseCells: readonly RecipeCell[],
): GoalFacts {
  const house: GoalFacts["house"] = {};
  for (const cell of houseCells)
    if (cell.recipe === "house_presence" || cell.recipe === "goodbye" || cell.recipe === "battery_low" || cell.recipe === "unavailable_watch")
      house[cell.recipe] = cell.status;
  return { leak: areaGoalFacts(h, inventory, naming, areaCells, "leak_alert"), covers: areaGoalFacts(h, inventory, naming, areaCells, "covers_sun"), house };
}

// A recipe counts as looked after when it is installed (even out of date) or waiting in Changes.
const covered = (s: RecipeStatus | undefined) => s === "installed" || s === "out-of-date" || s === "in-changes";
const STATUS_WORDS: Record<RecipeStatus, string> = {
  installed: "installed",
  "out-of-date": "installed, out of date",
  "in-changes": "in changes",
  ready: "ready to add",
  missing: "needs something first",
};
const words = (s: RecipeStatus | undefined) => (s ? STATUS_WORDS[s] : "not available");

// "3 of 4 areas ...": the shared rule for a goal over several areas.
// `what` names the recipes in the buttons: "Add the leak alerts", "Open the leak alerts", "Update the leak alerts".
function areaGoal(key: PathGoalKey, title: string, noun: string, f: AreaGoalFacts, what: string): PathGoal | null {
  if (f.areas === 0) return null;
  const have = f.installed + f.outOfDate + f.inChanges;
  const head = `${have} of ${plural(f.areas, "area")} ${noun}`;
  const notes = [f.inChanges > 0 ? `${f.inChanges} in changes: review and Apply` : "", f.outOfDate > 0 ? `${f.outOfDate} out of date` : ""].filter(Boolean);
  const summary = `${head}${notes.length ? ` (${notes.join(", ")})` : ""}.`;
  if (have === f.areas && f.outOfDate === 0) return { key, title, status: "done", summary, action: `Open ${what}`, target: RECIPES_PAGE };
  if (have === f.areas) return { key, title, status: "attention", summary, action: `Update ${what}`, target: RECIPES_PAGE };
  return {
    key,
    title,
    status: have === 0 ? "todo" : "attention",
    summary: have === 0 ? summary : `${summary} The others need a recipe added, or something set up first.`,
    action: `Add ${what}`,
    target: RECIPES_PAGE,
  };
}

// One or two house recipes: done when all are covered, started when some are.
function houseGoal(key: PathGoalKey, title: string, recipes: readonly { recipe: GoalHouseRecipe; label: string }[], facts: GoalFacts, what: string): PathGoal {
  const states = recipes.map((r) => facts.house[r.recipe]);
  const have = states.filter(covered).length;
  const summary = `${recipes.map((r, i) => `${r.label}: ${words(states[i])}`).join(". ")}.`;
  if (have === recipes.length)
    return states.includes("out-of-date")
      ? { key, title, status: "attention", summary, action: `Update ${what}`, target: RECIPES_PAGE }
      : { key, title, status: "done", summary, action: `Open ${what}`, target: RECIPES_PAGE };
  return { key, title, status: have === 0 ? "todo" : "attention", summary, action: `Add ${what}`, target: RECIPES_PAGE };
}

export function buildGuideGoals(source: Loaded<GoalFacts>): GuideGoals {
  if (source.state !== "ready") return source.state === "loading" ? { state: "loading" } : { state: "error", error: source.error };
  const f = source.value;
  const goals = [
    areaGoal("leak", "Add a leak alert for every area with a leak sensor", "have a leak alert", f.leak, "the leak alerts"),
    houseGoal(
      "watch",
      "Watch batteries and sensors that stop reporting",
      [
        { recipe: "battery_low", label: "Low batteries" },
        { recipe: "unavailable_watch", label: "Not reporting" },
      ],
      f,
      "the battery and sensor watchers",
    ),
    houseGoal("presence", "Know when everyone is away", [{ recipe: "house_presence", label: "House presence" }], f, "house presence"),
    houseGoal("goodbye", "Say goodbye to the house in one go", [{ recipe: "goodbye", label: "Goodbye" }], f, "the goodbye script"),
    areaGoal("covers", "Close the covers against the sun in every area with covers", "close covers against the sun", f.covers, "covers and sun"),
  ];
  return { state: "ready", goals: goals.filter((g): g is PathGoal => g !== null) };
}
