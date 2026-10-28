// Health: the types, names and limits (see index.ts for what Health is).

import { type InventorySettings } from "../inventory.ts";
import { type NamingSettings } from "../naming.ts";
import { type ParameterSettings } from "../parameters.ts";
import { type RecipeInstalled } from "../recipes.ts";
import { type Change, type ChangeInput, type Hierarchy, type RefKind } from "../types.ts";

export const HEALTH_CHECKS = [
  { key: "references", label: "Missing references" },
  { key: "unavailable", label: "Not reporting" },
  { key: "groups", label: "Broken groups" },
  { key: "activity", label: "Automation activity" },
  { key: "conditions", label: "Conditions" },
  { key: "switches", label: "One-way switches" },
  { key: "lights", label: "Competing automations" },
  { key: "climate", label: "Climate" },
  { key: "setup", label: "Taxis setup" },
  { key: "light-areas", label: "Lights without an area" },
  { key: "area-floors", label: "Areas without a floor" },
  { key: "helpers", label: "Unused helpers" },
  { key: "devices", label: "Device-based" },
  { key: "automation-startup", label: "Start-up actions" },
  { key: "automation-conflicts", label: "Conflicting automations" },
  { key: "automation-buttons", label: "Button automations" },
  { key: "automation-ids", label: "Duplicate ids" },
  { key: "away-people", label: "Arrival and away" },
] as const;

export type HealthCheck = (typeof HEALTH_CHECKS)[number]["key"];
export const HEALTH_CHECK_LABEL = Object.fromEntries(HEALTH_CHECKS.map((c) => [c.key, c.label])) as Record<HealthCheck, string>;

export type Severity = "error" | "warning" | "info";
export const SEVERITIES: readonly Severity[] = ["error", "warning", "info"];
export const SEVERITY_LABEL: Record<Severity, string> = { error: "Error", warning: "Warning", info: "Info" };

export type HealthOptions = {
  // An entity has to have been unavailable or unknown this many hours to be reported.
  unavailableHours: number;
  // An enabled automation that has not fired for this many days is reported.
  staleDays: number;
};

export const DEFAULT_HEALTH_OPTIONS: HealthOptions = { unavailableHours: 24, staleDays: 30 };
export const HEALTH_LIMITS = { unavailableHours: { min: 1, max: 720 }, staleDays: { min: 1, max: 365 } } as const;

// A thermostat that Area climate controls is reported after this long (check "Climate").
export const THERMOSTAT_UNAVAILABLE_MINUTES = 10;

// A sensor an area counts on is reported after this long (check "Taxis setup"),
// which is sooner than the general check so a dead sensor shows up the same day.
export const SOURCE_UNAVAILABLE_HOURS = 1;

// ---------------------------------------------------------------------------
// The snapshot, and what comes out.
// ---------------------------------------------------------------------------

// An automation, script or scene made in the UI, or a dashboard, with its stored
// config. Null when there is none to read (written in YAML, or unreadable).
export type HealthItem = { kind: RefKind; id: string; entityId: string | null; name: string; config: unknown | null; yaml: boolean };

// What the live states say, by entity id.
export type HealthState = { state: string; lastChanged: string | null; lastTriggered: string | null; restored: boolean };

export type HealthSnapshot = {
  hierarchy: Hierarchy;
  states: Record<string, HealthState>;
  items: HealthItem[];
  // What Home Assistant holds of the recipes (their blueprints and automations).
  // Null when it could not be read: the checks that need it are skipped.
  installed: RecipeInstalled | null;
  // Things the server could not read, in words.
  notes: string[];
};

export type HealthInput = {
  snapshot: HealthSnapshot;
  inventory: InventorySettings;
  naming: NamingSettings;
  parameters: ParameterSettings;
  // The change list: a fix already in it is not offered again.
  changes: readonly Change[];
  // Milliseconds since the epoch. Passed in so a test can fix the clock.
  now: number;
  options?: Partial<HealthOptions>;
};

// Where Taxis can take the user to deal with a finding.
export type HealthTarget =
  | { page: "area"; areaId: string; tab: "overview" | "capabilities" | "devices-entities" | "health" }
  | { page: "parameters"; tab: "capabilities" | "helpers" | "recipes" | "house" }
  | { page: "recipes" }
  | { page: "settings" };

export type HealthFix = { kind: "changes"; label: string; inputs: ChangeInput[] } | { kind: "link"; label: string; to: HealthTarget };

export type HealthFinding = {
  // The same problem has the same id on the next run.
  id: string;
  check: HealthCheck;
  severity: Severity;
  // The area it is about, when it is about something in one.
  area?: string;
  entity?: string;
  // Every entity it is about, when there are several (entity is the first).
  entities?: string[];
  // The automation, script, scene or dashboard it is about.
  item?: { kind: RefKind; id: string; name: string; entityId: string | null };
  title: string;
  detail: string;
  fix?: HealthFix;
};

export type HealthReport = {
  generatedAt: string;
  readAt: string;
  options: HealthOptions;
  findings: HealthFinding[];
  counts: Record<Severity, number>;
  byCheck: Record<HealthCheck, number>;
  checked: { entities: number; automations: number; scripts: number; scenes: number; dashboards: number; unreadable: number };
  notes: string[];
};

export type HealthReportResponse = { ok: true; report: HealthReport; cached: boolean } | { ok: false; error: string };
