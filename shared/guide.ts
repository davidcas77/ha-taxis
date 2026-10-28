import { helperExclusions, hasPendingChange, planHelpers, type HelperKey, type HelperRow } from "./helpers.ts";
import {
  areaInventory,
  areaChoice,
  defaultCapability,
  INVENTORY_AREA_ID,
  type Capability,
  type InventorySettings,
} from "./inventory.ts";
import { areaCodes, type NamingSettings } from "./naming.ts";
import { automationIdFor, planRecipes, type RecipeCell, type RecipeInstalled } from "./recipes.ts";
import { blueprintForRecipe, type AreaRecipeKey } from "./blueprints.ts";
import { resolveAll, type ParameterSettings } from "./parameters.ts";
import type { Change, Hierarchy } from "./types.ts";
import { GUIDE_CHECKS, currentRoomTest, guideConfiguration, roomChecks, type GuideTestRecord } from "./guide-checks.ts";
import { planHouseModes } from "./house-modes.ts";

// The guide describes chosen outcomes. It does not replace inventory choices,
// helper naming or recipe planning, and never controls a device.
export const GUIDE_GOALS = [
  {
    key: "lighting",
    label: "Comfortable automatic lighting",
    recipes: ["occupancy", "motion_lights"],
    helpers: ["lights", "motion", "presence", "illuminance"],
  },
  {
    key: "night",
    label: "Gentle night lighting",
    recipes: ["occupancy", "motion_lights"],
    helpers: ["lights", "motion", "presence", "illuminance"],
  },
  { key: "occupancy", label: "Reliable room occupancy", recipes: ["occupancy"], helpers: ["motion", "presence"] },
  {
    key: "climate",
    label: "Comfortable room climate",
    recipes: ["occupancy", "area_climate"],
    helpers: ["motion", "presence", "temperature", "humidity", "door", "window"],
  },
  {
    key: "media",
    label: "Switch media off in empty rooms",
    recipes: ["occupancy", "media_off"],
    helpers: ["motion", "presence", "media"],
  },
  { key: "ventilation", label: "Humidity-controlled ventilation", recipes: ["bathroom_fan"], helpers: ["humidity"] },
  { key: "exterior", label: "Outdoor evening lighting", recipes: ["exterior_lights"], helpers: ["lights"] },
  { key: "openings", label: "Door and window reminders", recipes: ["left_open"], helpers: ["door", "window"] },
  { key: "appliances", label: "Appliance-finished notifications", recipes: ["appliance_done"], helpers: [] },
] as const satisfies readonly {
  key: string;
  label: string;
  recipes: readonly AreaRecipeKey[];
  helpers: readonly HelperKey[];
}[];
export type GuideGoal = (typeof GUIDE_GOALS)[number]["key"];
export const ROOM_PROFILES = [
  {
    key: "bedroom",
    label: "Bedroom",
    goals: ["lighting", "night", "climate"],
    advice: "Check presence while someone is still or asleep. Keep night lights low and away from the sleeper's face.",
  },
  {
    key: "living",
    label: "Living / dining room",
    goals: ["lighting", "climate", "media"],
    advice: "Check coverage from each seat. Motion alone may miss someone reading or watching a film.",
  },
  {
    key: "bathroom",
    label: "Bathroom",
    goals: ["lighting", "night", "ventilation"],
    advice:
      "Check presence at the shower and toilet. Place humidity sensing where it follows the room, not direct spray.",
  },
  {
    key: "kitchen",
    label: "Kitchen",
    goals: ["lighting", "appliances"],
    advice: "Cover entrances and worktops. Keep task lighting under manual control when cooking.",
  },
  {
    key: "hallway",
    label: "Hallway / stairs",
    goals: ["lighting", "night"],
    advice: "Detect entry from both directions. Use gentle path lighting that does not disturb nearby bedrooms.",
  },
  {
    key: "office",
    label: "Office / study",
    goals: ["lighting", "climate"],
    advice: "Test detection while seated and working quietly. Preserve a physical light control.",
  },
  {
    key: "utility",
    label: "Utility / laundry",
    goals: ["lighting", "appliances"],
    advice:
      "Use power sensing appropriate for the appliance's electrical load; learn its normal cycle before setting thresholds.",
  },
  {
    key: "exterior",
    label: "Outdoor area",
    goals: ["exterior", "openings"],
    advice: "Keep motion coverage within your property and avoid glare into windows or neighbouring areas.",
  },
  {
    key: "garage",
    label: "Garage / storage",
    goals: ["lighting", "openings"],
    advice: "Cover entrances and work areas. Door reminders do not imply that automatic closing is safe.",
  },
  {
    key: "other",
    label: "Other area",
    goals: ["lighting"],
    advice:
      "Choose only outcomes that are useful here. Equipment is recommended for your chosen goals, not a universal checklist.",
  },
] as const satisfies readonly { key: string; label: string; goals: readonly GuideGoal[]; advice: string }[];
export type RoomProfile = (typeof ROOM_PROFILES)[number]["key"];
export type AreaGuideChoice = { profile: RoomProfile; goals: GuideGoal[] };
export type GuideSettings = { areas: Record<string, AreaGuideChoice>; tests?: Record<string, GuideTestRecord> };
export const EMPTY_GUIDE: GuideSettings = { areas: {} };
export type GuideResponse = { ok: true; guide: GuideSettings; revision?: string } | { ok: false; error: string };

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
export function validateGuide(input: unknown): { ok: true; value: GuideSettings } | { ok: false; error: string } {
  if (!record(input) || !record(input.areas)) return { ok: false, error: "The area guide choices weren't readable." };
  const entries = Object.entries(input.areas);
  if (entries.length > 500) return { ok: false, error: "Choose up to 500 areas in the guide." };
  const areas: [string, AreaGuideChoice][] = [];
  for (const [id, value] of entries) {
    if (
      !INVENTORY_AREA_ID.test(id) ||
      !record(value) ||
      !ROOM_PROFILES.some((profile) => profile.key === value.profile)
    )
      return { ok: false, error: "Choose a valid room type for each area." };
    if (
      !Array.isArray(value.goals) ||
      value.goals.length > GUIDE_GOALS.length ||
      value.goals.some((goal) => !GUIDE_GOALS.some((item) => item.key === goal))
    )
      return { ok: false, error: "Choose valid automation goals for each area." };
    areas.push([id, { profile: value.profile as RoomProfile, goals: [...new Set(value.goals)] as GuideGoal[] }]);
  }
  const value: GuideSettings = { areas: Object.fromEntries(areas) };
  if (input.tests !== undefined) {
    if (!record(input.tests) || Object.keys(input.tests).length > 500)
      return { ok: false, error: "Store room tests for up to 500 areas." };
    const tests: [string, GuideTestRecord][] = [];
    for (const [id, test] of Object.entries(input.tests)) {
      if (
        !INVENTORY_AREA_ID.test(id) ||
        !record(test) ||
        typeof test.configuration !== "string" ||
        !/^room-v1-[a-f0-9]{16}$/.test(test.configuration) ||
        !Array.isArray(test.checked) ||
        test.checked.length > GUIDE_CHECKS.length ||
        test.checked.some((key) => !GUIDE_CHECKS.some((check) => check.key === key)) ||
        typeof test.notes !== "string" ||
        test.notes.length > 2000 ||
        typeof test.testedAt !== "string" ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(test.testedAt) ||
        !Number.isFinite(Date.parse(test.testedAt))
      )
        return { ok: false, error: "The room test record wasn't readable. Check its answers, date and notes." };
      tests.push([
        id,
        {
          configuration: test.configuration,
          checked: [...new Set(test.checked)] as GuideTestRecord["checked"],
          notes: test.notes,
          testedAt: test.testedAt,
        },
      ]);
    }
    value.tests = Object.fromEntries(tests);
  }
  return { ok: true, value };
}

export const guideChoice = (settings: GuideSettings, areaId: string): AreaGuideChoice | null =>
  Object.hasOwn(settings.areas, areaId) ? settings.areas[areaId] : null;
export type EquipmentCheck = {
  key: string;
  label: string;
  required: boolean;
  status: "ready" | "missing" | "review";
  entityIds: string[];
  advice: string;
};
export type GuideHelper = { row: HelperRow; pending: boolean; available: boolean };
export type GuideRecipe = { key: AreaRecipeKey; cell: RecipeCell | null; enabled: boolean };
export const GUIDE_STAGES = {
  choose: "Choose room type and goals",
  unplanned: "No automation goals selected",
  equipment: "Review equipment",
  helpers: "Prepare helpers",
  changes: "Review queued changes",
  unread: "Read automation status",
  recipes: "Set up automations",
  check: "Check installed automations",
  test: "Ready for a room test",
  tested: "Tested by you for this configuration",
} as const;
export type GuideStage = keyof typeof GUIDE_STAGES;
export type AreaReadiness = {
  areaId: string;
  name: string;
  floor: string;
  choice: AreaGuideChoice | null;
  stage: GuideStage;
  equipment: EquipmentCheck[];
  helpers: GuideHelper[];
  recipes: GuideRecipe[];
  switches: string[];
  unavailable: string[];
  hasEntities: boolean;
  configuration: string;
  checks: ReturnType<typeof roomChecks>;
  testRecord: GuideTestRecord | null;
  testCurrent: boolean;
};
const known = (state: string | null | undefined): boolean =>
  state !== null && state !== undefined && !["", "unknown", "unavailable"].includes(state);

export function assessHouse(
  h: Hierarchy,
  inventory: InventorySettings,
  naming: NamingSettings,
  parameters: ParameterSettings,
  guide: GuideSettings,
  installed: RecipeInstalled | null,
  changes: readonly Change[],
): AreaReadiness[] {
  const exclusions = helperExclusions(h, naming);
  const helpers = planHelpers(h, inventory, naming, changes);
  const recipes = installed ? planRecipes(h, inventory, naming, parameters, installed, changes) : [];
  const codes = areaCodes(h, naming);
  const floorOrder = (areaId: string) => {
    const index = h.floors.findIndex((floor) => floor.id === h.areas[areaId].floorId);
    return index < 0 ? h.floors.length : index;
  };
  return Object.values(h.areas)
    .map((area) => {
      const choice = guideChoice(guide, area.id);
      const selected = new Set(choice?.goals ?? []);
      const inv = areaInventory(h, inventory, area.id, exclusions(area.id));
      const actual = area.entityIds
        .map((id) => h.entities[id])
        .filter((entity) => Boolean(entity) && !exclusions(area.id).has(entity.entityId));
      const areaEntities = new Set(area.entityIds);
      const pendingAreaChanges = changes.some(
        (change) =>
          (change.kind === "area" && change.targetId === area.id) ||
          (change.kind === "entity" &&
            (areaEntities.has(change.targetId) || areaEntities.has(String(change.after.new_entity_id ?? "")))) ||
          (change.kind === "device" && area.deviceIds.includes(change.targetId)) ||
          change.after.area_id === area.id ||
          change.before?.area_id === area.id,
      );
      const equipment: EquipmentCheck[] = [];
      if (
        choice?.profile === "bedroom" &&
        (selected.has("night") || selected.has("climate")) &&
        !areaChoice(inventory, area.id).bedroom
      ) {
        equipment.push({
          key: "bedroom_behavior",
          label: "Bedroom behavior in Capabilities",
          required: true,
          status: "review",
          entityIds: [],
          advice:
            "This guide profile is a bedroom. Mark the area as a bedroom in Capabilities before preparing sleep-sensitive lighting or climate. Changing guide goals does not overwrite your inventory choices.",
        });
      }
      const equipmentFor = (
        key: string,
        label: string,
        caps: Capability[],
        required: boolean,
        advice: string,
        predicate?: (id: string) => boolean,
      ) => {
        const counted = caps
          .flatMap((cap) => inv[cap])
          .filter((row) => row.counts && (!predicate || predicate(row.entityId)));
        const healthy = counted.filter((row) => {
          const entity = h.entities[row.entityId];
          return (
            known(entity.state) &&
            (!["temperature", "humidity", "illuminance", "power"].includes(row.capability) ||
              Number.isFinite(Number(entity.state)))
          );
        });
        const existing = actual.filter((entity) => caps.includes(defaultCapability(entity) as Capability));
        equipment.push({
          key,
          label,
          required,
          status: healthy.length ? "ready" : counted.length || existing.length ? "review" : "missing",
          entityIds: [
            ...new Set([...counted.map((row) => row.entityId), ...existing.map((entity) => entity.entityId)]),
          ],
          advice: healthy.length
            ? advice
            : existing.length
              ? `Entities already exist here. Review their enabled state, availability and capability choices before buying anything. ${advice}`
              : advice,
        });
      };
      const occupiedGoal = ["lighting", "night", "occupancy", "climate", "media"].some((goal) =>
        selected.has(goal as GuideGoal),
      );
      if (selected.has("lighting") || selected.has("night") || selected.has("exterior"))
        equipmentFor(
          "lights",
          "Controllable room lights",
          ["lights"],
          true,
          "Use controllable lights or a suitable relay exposed as a light. A raw switch may control something else; confirm its purpose.",
        );
      if (occupiedGoal) {
        equipmentFor(
          "activity",
          "Motion or presence detection",
          ["motion", "presence"],
          true,
          "Motion is useful at entrances. Stationary presence sensing is useful at seats, desks and beds. Test coverage and false detections before relying on automatic off.",
        );
        equipmentFor(
          "lux",
          "Room light level",
          ["illuminance"],
          false,
          "A room light-level sensor can avoid turning lights on when daylight is sufficient. Keep it away from direct glare from the controlled lights.",
        );
      }
      if (selected.has("night"))
        equipmentFor(
          "night-target",
          "A chosen gentle night-light target",
          ["lights"],
          true,
          "Assign suitable lights the Night role under the area's Capabilities, then review night brightness and hours in Parameters.",
          (id) => inv.lights.some((row) => row.entityId === id && row.light === "night"),
        );
      if (selected.has("climate")) {
        equipmentFor(
          "climate",
          "Controllable heating or cooling",
          ["thermostat"],
          true,
          "Connect the thermostat, radiator valve or AC to Home Assistant. Review its operating modes and supported temperature range.",
        );
        equipmentFor(
          "temperature",
          "Room temperature",
          ["temperature"],
          false,
          "Measure where people spend time, away from heaters, direct sunlight and warm electronics.",
        );
        equipmentFor(
          "window",
          "Window or exterior-door contacts",
          ["window", "door"],
          false,
          "Contacts can pause climate control while a window is open. Choose relevant openings rather than every contact in the area.",
        );
      }
      if (selected.has("media"))
        equipmentFor(
          "media",
          "Controllable speakers or TV",
          ["speaker", "tv"],
          true,
          "Confirm that turning this player off is appropriate. Do not interrupt guests, active listening or a film just because a motion timer expired.",
        );
      if (selected.has("ventilation")) {
        equipmentFor(
          "fan",
          "A confirmed ventilation fan",
          ["fan"],
          true,
          "Confirm which fan or switch actually controls ventilation in Capabilities; Taxis does not infer a switch's electrical purpose.",
        );
        equipmentFor(
          "humidity",
          "Room humidity",
          ["humidity"],
          true,
          "Place the sensor where it follows room humidity without direct steam or water spray. Review a reference sensor and humidity thresholds.",
        );
      }
      if (selected.has("openings"))
        equipmentFor(
          "contacts",
          "Relevant door or window contacts",
          ["door", "window"],
          true,
          "Choose the openings worth a reminder and the notification destination. A contact sensor is not proof that a door can safely be closed automatically.",
        );
      if (selected.has("appliances"))
        equipmentFor(
          "power",
          "An appliance's power sensor",
          ["power"],
          true,
          "Mark the correct power sensor as Appliance in Capabilities. Choose metering equipment appropriate for the electrical load; learn a full cycle before setting thresholds.",
          (id) => inv.power.some((row) => row.entityId === id && row.appliance),
        );
      const definitions = GUIDE_GOALS.filter((goal) => selected.has(goal.key));
      const helperKeys = new Set<HelperKey>(definitions.flatMap((goal) => [...goal.helpers]));
      const neededHelpers = helpers
        .filter((row) => row.areaId === area.id && helperKeys.has(row.key))
        .map((row) => ({
          row,
          pending: row.status !== "conflict" && hasPendingChange(row, changes),
          available: known(h.entities[row.canonicalId]?.state) && !h.entities[row.canonicalId]?.disabled,
        }));
      const recipeKeys = new Set<AreaRecipeKey>(definitions.flatMap((goal) => [...goal.recipes]));
      const neededRecipes = [...recipeKeys].map((key) => ({
        key,
        cell: recipes.find((cell) => cell.areaId === area.id && cell.recipe === key) ?? null,
        enabled:
          h.entities[`automation.${automationIdFor(key, codes[area.id].code)}`]?.state === "on" &&
          !h.entities[`automation.${automationIdFor(key, codes[area.id].code)}`]?.disabled,
      }));
      let stage: GuideStage = "test";
      if (!choice) stage = "choose";
      else if (!choice.goals.length) stage = "unplanned";
      else if (equipment.some((check) => check.required && check.status !== "ready")) stage = "equipment";
      else if (
        neededHelpers.some(
          (helper) =>
            !helper.pending && (helper.row.status !== "in-place" || helper.row.actionable || !helper.available),
        )
      )
        stage = "helpers";
      else if (neededHelpers.some((helper) => helper.pending) || pendingAreaChanges) stage = "changes";
      else if (installed === null) stage = "unread";
      else if (neededRecipes.some((recipe) => recipe.cell?.status === "in-changes")) stage = "changes";
      else if (neededRecipes.some((recipe) => recipe.cell?.status !== "installed")) stage = "recipes";
      else if (neededRecipes.some((recipe) => !recipe.enabled || recipe.cell!.controlledBy.length)) stage = "check";
      const modes = planHouseModes(h, parameters, inventory, changes, area.id);
      const integrated = (key: "guest" | "away" | "sleep") =>
        modes.some((mode) => mode.key === key && (mode.status === "present" || mode.status === "in-changes"));
      const checks = roomChecks(choice, {
        guest: integrated("guest"),
        away: integrated("away"),
        sleep: integrated("sleep"),
      });
      const recipeState = neededRecipes.map((recipe) => {
        const bp = blueprintForRecipe(recipe.key);
        return {
          key: recipe.key,
          enabled: recipe.enabled,
          version: installed?.blueprints[bp.path] ?? null,
          automation: installed?.automations[automationIdFor(recipe.key, codes[area.id].code)] ?? null,
        };
      });
      const relevantIds = new Set([...area.entityIds, ...neededHelpers.map((helper) => helper.row.canonicalId)]);
      const configuration = guideConfiguration({
        choice: choice && { ...choice, goals: [...choice.goals].sort() },
        area: { id: area.id, floorId: area.floorId, choice: areaChoice(inventory, area.id), code: codes[area.id].code },
        parameters: resolveAll(parameters, h, inventory, area.id),
        inventory: [...relevantIds].sort().map((id) => [id, inventory.entities[id] ?? null]),
        entities: [...relevantIds].sort().map((id) => {
          const e = h.entities[id];
          return e
            ? {
                id,
                domain: e.domain,
                platform: e.platform,
                device: e.deviceId,
                deviceClass: e.deviceClass,
                disabled: e.disabled,
                members: [...e.members].sort(),
              }
            : { id };
        }),
        recipes: recipeState,
        modes: modes.map((mode) => ({ key: mode.key, id: mode.id })),
        checks: checks.map((check) => check.key),
      });
      const testRecord = guide.tests && Object.hasOwn(guide.tests, area.id) ? guide.tests[area.id] : null;
      const testCurrent = stage === "test" && currentRoomTest(testRecord, configuration, checks);
      if (testCurrent) stage = "tested";
      return {
        areaId: area.id,
        name: area.name,
        floor: h.floors.find((floor) => floor.id === area.floorId)?.name ?? "No floor",
        choice,
        configuration,
        checks,
        testRecord,
        testCurrent,
        stage,
        equipment,
        helpers: neededHelpers,
        recipes: neededRecipes,
        switches: actual
          .filter((entity) => entity.domain === "switch" || entity.domain === "button")
          .map((entity) => entity.entityId),
        unavailable: actual
          .filter((entity) => !known(entity.state) && !entity.disabled && !entity.maintenance)
          .map((entity) => entity.entityId),
        hasEntities: area.entityIds.some((id) => Boolean(h.entities[id])),
      };
    })
    .sort((a, b) => floorOrder(a.areaId) - floorOrder(b.areaId) || a.name.localeCompare(b.name));
}

export const GUIDE_IDEAS = [
  {
    title: "Motion starts; presence keeps the room comfortable",
    text: "Use motion at entry points and presence for still activity. Tune hold times with people in the room before enabling automatic off.",
    source: "https://www.reddit.com/r/homeassistant/comments/1i1q5eg/",
    implementation: "Occupancy and Motion lights recipes",
  },
  {
    title: "Gentle night paths",
    text: "Give night lights their own targets, hours and brightness. Keep task and bedroom lighting under deliberate control.",
    source:
      "https://community.home-assistant.io/t/sensor-light-motion-sensor-door-sensor-sun-elevation-lux-value-scenes-time-light-control-device-tracker-night-lights/481048/1148",
    implementation: "Night roles and Motion lights parameters",
  },
  {
    title: "Manual control takes precedence",
    text: "A visible pause and a documented override make the system understandable to residents and visitors. Explain when automation will resume.",
    source:
      "https://community.home-assistant.io/t/sensor-light-motion-sensor-door-sensor-sun-elevation-lux-value-scenes-time-light-control-device-tracker-night-lights/481048/970",
    implementation: "Existing per-area pause and manual override",
  },
  {
    title: "Guest-aware away mode",
    text: "Residents leaving must not make the house empty while visitors remain. Keep guest and resident-location signals separate from room occupancy.",
    source: "https://www.reddit.com/r/homeassistant/comments/1i3caly/",
    implementation: "Guided mode switches and guest-aware Motion lights, Media off and Area climate proposals",
  },
  {
    title: "Humidity ventilation and appliance reminders",
    text: "Useful everyday outcomes include a fan responding to shower humidity and a notification when a learned appliance cycle finishes.",
    source: "https://www.reddit.com/r/homeassistant/comments/1i1q5eg/",
    implementation: "Bathroom fan and Appliance done recipes",
  },
] as const;
