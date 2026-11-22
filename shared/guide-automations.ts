import { blueprintForRecipe, type AreaRecipeKey } from "./blueprints.ts";
import { currentRoomTest, guideConfiguration, roomChecks, type GuideTestRecord } from "./guide-checks.ts";
import type { AreaGuideChoice, GuideGoal, GuideHelper, GuideRecipe, GuideStage } from "./guide.ts";
import type { HelperKey } from "./helpers.ts";
import { entityIdsIn, ENTITY_DOMAINS } from "./health-scan.ts";
import {
  areaChoice,
  defaultCapability,
  tvOccupancyNotApplicable,
  type AreaInventory,
  type Capability,
  type InventoryRow,
  type InventorySettings,
} from "./inventory.ts";
import { roleLights, type ParameterSettings, type resolveAll } from "./parameters.ts";
import { automationIdFor, pendingAutomation, type RecipeCell, type RecipeInstalled } from "./recipes.ts";
import type { AreaNode, Change, EntityItem, Hierarchy } from "./types.ts";

export const ROOM_AUTOMATIONS = [
  { key: "motion_lights", label: "Automatic lighting", goals: ["lighting", "night"] },
  { key: "occupancy", label: "Room occupancy", goals: ["occupancy"] },
  { key: "area_climate", label: "Room climate", goals: ["climate"] },
  { key: "media_off", label: "Media off in empty rooms", goals: ["media"] },
  { key: "bathroom_fan", label: "Humidity-controlled ventilation", goals: ["ventilation"] },
  { key: "exterior_lights", label: "Outdoor evening lighting", goals: ["exterior"] },
  { key: "left_open", label: "Door and window reminders", goals: ["openings"] },
  { key: "appliance_done", label: "Appliance-finished notifications", goals: ["appliances"] },
] as const satisfies readonly { key: AreaRecipeKey; label: string; goals: readonly GuideGoal[] }[];

export type RoomAutomationKey = (typeof ROOM_AUTOMATIONS)[number]["key"];
export type AutomationTests = Record<string, Partial<Record<RoomAutomationKey, GuideTestRecord>>>;
export type AutomationEquipmentStatus = "ready" | "missing" | "unavailable" | "review" | "queued";
export type AutomationEquipmentCheck = {
  key: string;
  label: string;
  advice: string;
  capabilities: readonly Capability[];
  candidateRole?: "starts" | "holds" | "appliance";
  status: AutomationEquipmentStatus;
  entityIds: string[];
  usableEntityIds: string[];
  queuedEntityIds: string[];
};

export type RoomAutomation = {
  key: RoomAutomationKey;
  label: string;
  goals: readonly GuideGoal[];
  selected: boolean;
  required: AutomationEquipmentCheck[];
  optional: AutomationEquipmentCheck[];
  readyRequired: number;
  totalRequired: number;
  helpers: (GuideHelper & { required: boolean })[];
  recipes: GuideRecipe[];
  inactiveRecipes: AreaRecipeKey[];
  stage: GuideStage;
  configured: boolean | null;
  installed: boolean | null;
  runtime: "enabled" | "disabled" | "unavailable" | "unknown";
  configuration: string;
  checks: ReturnType<typeof roomChecks>;
  testRecord: GuideTestRecord | null;
  testCurrent: boolean;
};

type Assessment = {
  h: Hierarchy;
  area: AreaNode;
  code: string;
  inventory: InventorySettings;
  inv: AreaInventory;
  actual: readonly EntityItem[];
  parameters: ParameterSettings;
  values: ReturnType<typeof resolveAll>;
  choice: AreaGuideChoice | null;
  installed: RecipeInstalled | null;
  changes: readonly Change[];
  helperRows: readonly GuideHelper[];
  cells: ReadonlyMap<AreaRecipeKey, RecipeCell>;
  tests: Partial<Record<RoomAutomationKey, GuideTestRecord>> | undefined;
  legacyTest: GuideTestRecord | null;
};

// The hierarchy includes the Changes preview. An entity moved into this area in
// that preview or assigned a new id/class is not yet usable here in Home Assistant.
function pendingEquipment(h: Hierarchy, areaId: string, changes: readonly Change[]): Set<string> {
  const ids = new Set<string>();
  for (const change of changes) {
    if (change.kind === "entity") {
      const after = change.after;
      const id = typeof after.new_entity_id === "string" ? after.new_entity_id : change.targetId;
      const projected = h.entities[id];
      if (!projected || projected.areaId !== areaId) continue;
      if (["new_entity_id", "device_class", "disabled_by"].some((key) => Object.hasOwn(after, key))) ids.add(id);
      else if (Object.hasOwn(after, "area_id")) {
        const beforeDevice = changes.find((item) => item.kind === "device" && item.targetId === projected.deviceId && Object.hasOwn(item.after, "area_id"));
        const originalDeviceArea = beforeDevice ? beforeDevice.before.area_id : projected.deviceId ? h.devices[projected.deviceId]?.areaId : null;
        if ((change.before.area_id ?? originalDeviceArea) !== areaId) ids.add(id);
      }
    } else if (change.kind === "device" && Object.hasOwn(change.after, "area_id") && change.before.area_id !== areaId) {
      for (const id of h.devices[change.targetId]?.entityIds ?? []) {
        const entity = h.entities[id];
        if (entity?.areaId === areaId && !entity.ownAreaId) ids.add(id);
      }
    }
  }
  return ids;
}

const numericCapabilities: readonly Capability[] = ["humidity", "illuminance", "power", "temperature"];
const binaryCapabilities: readonly Capability[] = ["motion", "presence", "door", "window", "lights", "fan"];

export function equipmentIsReporting(entity: EntityItem, capability: Capability): boolean {
  const state = entity.state?.trim();
  if (!state || entity.disabled || entity.restored || state === "unavailable" || state === "unknown") return false;
  if (numericCapabilities.includes(capability)) return Number.isFinite(Number(state));
  if (binaryCapabilities.includes(capability)) return state === "on" || state === "off";
  return true;
}

type CheckSpec = Pick<AutomationEquipmentCheck, "key" | "label" | "advice" | "capabilities" | "candidateRole"> & {
  matches?: (row: InventoryRow) => boolean;
};

function equipmentCheck({ h, inv, actual }: Assessment, pending: ReadonlySet<string>, { matches, ...spec }: CheckSpec): AutomationEquipmentCheck {
  const rows = spec.capabilities.flatMap((capability) => inv[capability]);
  const installed = new Set(rows.map((row) => row.entityId));
  const outOfInventory = actual.filter((entity) => {
    const capability = defaultCapability(entity);
    return capability && spec.capabilities.includes(capability) && !installed.has(entity.entityId) && !entity.maintenance;
  });
  const selected = rows.filter((row) => row.counts && (!matches || matches(row)));
  const usableEntityIds = selected
    .filter((row) => !pending.has(row.entityId) && equipmentIsReporting(h.entities[row.entityId], row.capability))
    .map((row) => row.entityId);
  const queuedEntityIds = selected.filter((row) => pending.has(row.entityId)).map((row) => row.entityId);
  const entityIds = [...rows.map((row) => row.entityId), ...outOfInventory.map((entity) => entity.entityId)];
  const status: AutomationEquipmentStatus =
    usableEntityIds.length > 0
      ? "ready"
      : queuedEntityIds.length > 0
        ? "queued"
        : selected.length > 0 || (entityIds.length > 0 && outOfInventory.length === entityIds.length && outOfInventory.every((entity) => entity.disabled))
          ? "unavailable"
          : entityIds.length > 0
            ? "review"
            : "missing";
  return { ...spec, status, entityIds, usableEntityIds, queuedEntityIds };
}

function equipmentFor(context: Assessment, key: RoomAutomationKey, withOccupancy: boolean, pending: ReadonlySet<string>) {
  const required: AutomationEquipmentCheck[] = [];
  const optional: AutomationEquipmentCheck[] = [];
  const addRequired = (spec: CheckSpec) => required.push(equipmentCheck(context, pending, spec));
  const addOptional = (spec: CheckSpec) => optional.push(equipmentCheck(context, pending, spec));
  const { area, inventory, values } = context;
  const useTV = !tvOccupancyNotApplicable(inventory, area.id);
  if (withOccupancy) {
    addRequired({
      key: "activity",
      label: "An occupancy start source",
      capabilities: useTV ? ["motion", "presence", "tv"] : ["motion", "presence"],
      candidateRole: "starts",
      advice: "Use motion, presence or an opted-in TV to start occupancy. A source that only holds occupancy cannot start it.",
      matches: (row) => (row.capability === "tv" ? row.tvOccupancyRole === "starts" : row.role === "starts"),
    });
    addOptional({
      key: "holds",
      label: "An occupancy hold source",
      capabilities: useTV ? ["presence", "motion", "tv"] : ["presence", "motion"],
      candidateRole: "holds",
      advice: "An additional source can keep the room occupied after it detects entry.",
      matches: (row) => (row.capability === "tv" ? row.tvOccupancyRole === "holds" : row.role === "holds"),
    });
  }
  switch (key) {
    case "motion_lights":
    case "exterior_lights":
      addRequired({
        key: "lights",
        label: "Controllable lights",
        capabilities: ["lights"],
        advice: "Use a reporting light entity. A raw switch needs to be exposed as a light if it controls one.",
      });
      if (key === "motion_lights")
        addOptional({
          key: "lux",
          label: "Room light level",
          capabilities: ["illuminance"],
          advice: "A light-level sensor and its helper can prevent automatic turn-on when the room is bright.",
        });
      else
        addOptional({
          key: "outside-motion",
          label: "Outdoor motion or presence",
          capabilities: ["motion", "presence"],
          advice: "These sources can extend outdoor lighting when movement is detected.",
        });
      break;
    case "area_climate":
      addRequired({
        key: "climate",
        label: "Controllable heating or cooling",
        capabilities: ["thermostat"],
        advice: "Use a reporting climate entity. In Parameters, choose a season supported by the room's equipment.",
      });
      addOptional({
        key: "windows",
        label: "Window contacts",
        capabilities: ["window"],
        advice: "A window contact and its helper can pause climate while a window is open.",
      });
      if (values.doors_open_count)
        addOptional({
          key: "doors",
          label: "Door contacts",
          capabilities: ["door"],
          advice: "When open doors count, a door contact and its helper can also pause climate.",
        });
      if (values.auto_hvac_on)
        addOptional({
          key: "temperature",
          label: "Room temperature",
          capabilities: ["temperature"],
          advice: "A temperature sensor and its helper can prevent turning on climate when the room is already within range.",
        });
      break;
    case "media_off":
      addRequired({
        key: "media",
        label: "A controllable speaker or TV",
        capabilities: ["speaker", "tv"],
        advice: "Choose a media player that should turn off when the room is empty.",
      });
      break;
    case "bathroom_fan":
      addRequired({
        key: "fan",
        label: "A ventilation fan",
        capabilities: ["fan"],
        advice: "Include the controllable fan or confirm that the selected switch actually runs ventilation.",
      });
      addRequired({
        key: "humidity",
        label: "Room humidity",
        capabilities: ["humidity"],
        advice: "Use a reporting humidity sensor away from direct spray.",
      });
      break;
    case "left_open":
      addRequired({
        key: "contacts",
        label: "A door or window contact",
        capabilities: ["door", "window"],
        advice: "Include a reporting contact for an opening worth a reminder.",
      });
      break;
    case "appliance_done":
      addRequired({
        key: "power",
        label: "An appliance power sensor",
        capabilities: ["power"],
        candidateRole: "appliance",
        advice: "Mark a reporting power sensor as Appliance and observe a full cycle before setting thresholds.",
        matches: (row) => row.appliance === true,
      });
      break;
  }
  return { required, optional };
}

function helpersFor(key: RoomAutomationKey, context: Assessment): RoomAutomation["helpers"] {
  const { values, helperRows } = context;
  const keys: Partial<Record<RoomAutomationKey, readonly HelperKey[]>> = {
    motion_lights: ["lights", "illuminance"],
    exterior_lights: ["lights"],
    bathroom_fan: ["humidity"],
    area_climate: ["window", ...(values.doors_open_count ? ["door" as const] : []), ...(values.auto_hvac_on ? ["temperature" as const] : [])],
    media_off: ["media"],
  };
  return helperRows
    .filter(({ row }) => keys[key]?.includes(row.key))
    .map((helper) => ({
      ...helper,
      required: helper.row.key === "lights" || (key === "bathroom_fan" && helper.row.key === "humidity"),
    }));
}

export function assessRoomAutomations(context: Assessment): RoomAutomation[] {
  const { h, area, code, choice, installed, inv, parameters, cells, tests, legacyTest } = context;
  const pending = pendingEquipment(h, area.id, context.changes);
  const installationOf = (key: AreaRecipeKey) => installed?.automations[automationIdFor(key, code)];
  const climateInput = installationOf("area_climate")?.input.occupied_entities;
  const climateUsesOccupancy = Array.isArray(climateInput) && climateInput.length > 0;
  const exteriorId = automationIdFor("exterior_lights", code);
  const showExterior =
    areaChoice(context.inventory, area.id, h).type === "exterior" ||
    choice?.goals.includes("exterior") ||
    Boolean(tests?.exterior_lights) ||
    Boolean(installationOf("exterior_lights")) ||
    (installed === null && Object.hasOwn(h.entities, `automation.${exteriorId}`)) ||
    pendingAutomation(context.changes, exteriorId) ||
    context.changes.some((change) => change.kind === "automation" && change.after.area_id === area.id && change.after.recipe === "exterior_lights");
  const applicable = ROOM_AUTOMATIONS.filter(({ key }) => key !== "exterior_lights" || showExterior);

  return applicable.map(({ key, label, goals: offered }): RoomAutomation => {
    const goals: readonly GuideGoal[] = offered;
    const selectedGoals = choice?.goals.filter((goal) => goals.includes(goal)) ?? [];
    const selected = selectedGoals.length > 0;
    const definitionRequiresOccupancy = key === "motion_lights" || key === "media_off";
    const occupancy = definitionRequiresOccupancy || key === "occupancy" || (key === "area_climate" && climateUsesOccupancy);
    const { required, optional } = equipmentFor(context, key, occupancy, pending);
    const readyRequired = required.filter((check) => check.status === "ready").length;
    const recipeKeys: AreaRecipeKey[] = occupancy && key !== "occupancy" ? ["occupancy", key] : [key];
    const nativeId = automationIdFor(key, code);
    const native = installationOf(key);
    const live = h.entities[`automation.${nativeId}`];
    const runtime =
      live?.disabled || live?.state === "off"
        ? "disabled"
        : live?.state === "on"
          ? "enabled"
          : live?.state === "unavailable" || native?.runtimeState === "unavailable"
            ? "unavailable"
            : "unknown";
    const recipes = recipeKeys.map((recipe): GuideRecipe => {
      const entity = h.entities[`automation.${automationIdFor(recipe, code)}`];
      return { key: recipe, cell: cells.get(recipe) ?? null, enabled: entity?.state === "on" && !entity.disabled };
    });
    const inactiveRecipes = recipes
      .filter(
        ({ key: recipe, cell }) =>
          (cell?.wanted === false || context.inventory.areas[area.id]?.recipePreferences?.[recipe] === false) &&
          (recipe === key || cell?.status !== "installed"),
      )
      .map(({ key: recipe }) => recipe);
    const helpers = helpersFor(key, context);
    const primary = cells.get(key);
    const hasChanges =
      [...required, ...optional].some((check) => check.queuedEntityIds.length > 0) ||
      helpers.some((helper) => helper.pending) ||
      recipes.some(({ cell }) => cell?.status === "in-changes");
    let stage: GuideStage = "test";
    if (!selected) stage = "choose";
    else if (context.inventory.areas[area.id]?.recipePreferences?.[key] === false) stage = "unplanned";
    else if (required.some((check) => check.status !== "ready" && check.status !== "queued")) stage = "equipment";
    else if (hasChanges) stage = "changes";
    else if (helpers.some((helper) => helper.required && (helper.row.status !== "in-place" || helper.row.actionable || !helper.available))) stage = "helpers";
    else if (installed === null) stage = "unread";
    else if (inactiveRecipes.length > 0 || recipes.some(({ cell }) => cell?.status !== "installed")) stage = "recipes";
    else if (recipes.some(({ enabled, cell }) => !enabled || (cell?.controlledBy.length ?? 0) > 0)) stage = "check";

    const nightTargets = key === "motion_lights" ? roleLights(parameters, area.id, inv.lights, "night_lights").lights : [];
    const testGoals: GuideGoal[] = selectedGoals.length ? [...selectedGoals] : [goals[0]];
    if (key === "motion_lights" && nightTargets.length > 0 && !testGoals.includes("night")) testGoals.push("night");
    const primaryInput = native?.input ?? {};
    const checks = roomChecks(
      { profile: choice?.profile ?? "other", goals: testGoals },
      {
        guest: Boolean(primaryInput.guest_entity || (Array.isArray(primaryInput.guest_entities) && primaryInput.guest_entities.length > 0)),
        away: Boolean(primaryInput.away_entity),
        sleep: Boolean(primaryInput.sleep_entity),
      },
    ).filter((check) => (occupancy || (check.key !== "entry" && check.key !== "still")) && (check.key !== "night" || nightTargets.length > 0));
    const relevantIds = new Set(required.flatMap((check) => check.usableEntityIds));
    const configurations = recipeKeys.map((recipe) => {
      const bp = blueprintForRecipe(recipe);
      const entry = installationOf(recipe);
      for (const id of entityIdsIn(entry?.input, ENTITY_DOMAINS)) relevantIds.add(id);
      return { recipe, version: installed?.blueprints[bp.path], path: entry?.path, input: entry?.input };
    });
    for (const id of relevantIds) for (const member of h.entities[id]?.members ?? []) relevantIds.add(member);
    const configuration = guideConfiguration({
      areaId: area.id,
      recipes: configurations,
      checks: checks.map((check) => check.key),
      entities: [...relevantIds].sort().map((id) => {
        const entity = h.entities[id];
        return [id, entity?.deviceId, entity?.domain, entity?.platform, entity?.deviceClass, entity?.members.slice().sort()];
      }),
    });
    const testRecord = tests?.[key] ?? (selected && legacyTest ? { ...legacyTest, configuration } : null);
    const testCurrent = stage === "test" && currentRoomTest(testRecord, configuration, checks);
    return {
      key,
      label,
      goals,
      selected,
      required,
      optional,
      readyRequired,
      totalRequired: required.length,
      helpers,
      recipes,
      inactiveRecipes,
      stage: testCurrent ? "tested" : stage,
      configured: installed ? primary?.status === "installed" : null,
      installed: installed ? Boolean(native) : null,
      runtime,
      configuration,
      checks,
      testRecord,
      testCurrent,
    };
  });
}
