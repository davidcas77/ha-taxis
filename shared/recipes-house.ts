import { scopeProblem, spaceIds, type RecipeScope, type Space } from "./spaces.ts";
import { GOODBYE_PATH, GOODBYE_SCRIPT_ID, blueprintForRecipe, type HouseRecipeKey } from "./blueprints.ts";
import { ENTITY_ID_RE } from "./changes.ts";
import { HOUSE_AREAS_OCCUPIED_ID, HOUSE_OCCUPIED_ID, HOUSE_OCCUPIED_TEMPLATE, HOUSE_PAUSE_ID } from "./climate.ts";
import { areaCodeConflicts, helperExclusions, planSpaceLightGroup } from "./helpers.ts";
import { planHouseModes } from "./house-modes.ts";
import { areaInventory, type AreaInventory, type Capability, type InventorySettings } from "./inventory.ts";
import { areaCodes, houseGroupId, type NamingSettings } from "./naming.ts";
import { resolveIn, withSeconds, type ParameterSettings, type ParamKey } from "./parameters.ts";
import {
  automationAlias,
  automationIdFor,
  heldBy,
  inputDifferences,
  pendingAutomation,
  pendingBlueprint,
  pendingHelper,
  pendingRename,
  pendingScript,
  planAnnounce,
  runtimeIds,
  show,
  taken,
  type RecipeCell,
  type RecipeInstalled,
  type RecipeStatus,
  unavailableRecipe,
  unavailableRecipeMessage,
} from "./recipes.ts";
import type { Change, ChangeInput, Hierarchy } from "./types.ts";

// The recipes of the house: not one per area but one for the whole home. Announce
// is planned in recipes.ts; the rest are here.
//
//   goodbye            a script (script.taxis_goodbye): lights off, media off, away mode on
//   house_presence     the house occupied sensor, and away mode switched on when everyone
//                      has been away for a while
//   battery_low        one summary of the low batteries a day
//   unavailable_watch  a message when a sensor Taxis relies on stops reporting
//
// Like the area recipes these are pure functions of what Taxis knows, and nothing
// here changes anything. They share the house pause switch (input_boolean.taxis_paused).

export const HOUSE_AUTOMATION_CODE = "house";

type Env = {
  h: Hierarchy;
  inventory: InventorySettings;
  naming: NamingSettings;
  params: ParameterSettings;
  installed: RecipeInstalled;
  changes: readonly Change[];
  projectDesired: boolean;
  scope: RecipeScope;
};

const scopedSpace = (e: Env): Space | null => (e.scope.kind === "space" ? e.scope.space : null);
const scopedIds = (e: Env) => {
  const space = scopedSpace(e);
  return space ? spaceIds(space.id) : null;
};
const automationId = (e: Env, recipe: HouseRecipeKey) => scopedIds(e)?.automation(recipe) ?? automationIdFor(recipe, HOUSE_AUTOMATION_CODE);

const houseValue = (e: Env, key: ParamKey) =>
  resolveIn(e.params, scopedSpace(e) ? [{ level: "space", id: scopedSpace(e)!.id }, { level: "house" }] : [{ level: "house" }], key).value;

const cell = (recipe: HouseRecipeKey, status: RecipeStatus, missing: string[], reasons: string[], notes: string[], inputs: ChangeInput[]): RecipeCell => ({
  areaId: "",
  areaName: "House",
  recipe,
  status,
  missing: status === "missing" ? missing : [],
  reasons: status === "out-of-date" ? reasons : [],
  notes: status === "missing" ? [] : notes,
  controlledBy: [],
  controls: "lights",
  inputs,
  actionable: inputs.length > 0,
});

// The blueprint is written when Home Assistant has none, or one of another version.
function blueprintInput(e: Env, recipe: HouseRecipeKey): ChangeInput[] {
  const bp = blueprintForRecipe(recipe);
  const there = e.installed.blueprints[bp.path] ?? null;
  if (there === bp.version || pendingBlueprint(e.changes, bp.path, bp.version)) return [];
  return [{ kind: "blueprint", op: there === null ? "create" : "update", fields: { path: bp.path, version: bp.version } }];
}

function blueprintReason(e: Env, recipe: HouseRecipeKey): string[] {
  const bp = blueprintForRecipe(recipe);
  const there = e.installed.blueprints[bp.path] ?? null;
  if (there === null) return ["The blueprint is missing"];
  return there === bp.version ? [] : [`The blueprint is version ${there}, Taxis has ${bp.version}`];
}

// ---------------------------------------------------------------------------
// The helpers the house recipes share.
// ---------------------------------------------------------------------------

type Pause = { missing: string[]; create: ChangeInput[]; gone: string[] };

// The house pause switch: made by the first recipe that needs it.
function housePause(e: Env, installedHere: boolean): Pause {
  const pauseId = scopedIds(e)?.pause ?? HOUSE_PAUSE_ID;
  const held = heldBy(e.h, pauseId, "input_boolean");
  const queued = pendingHelper(e.changes, pauseId);
  if (held.state === "taken") return { missing: [taken(pauseId, held)!], create: [], gone: [] };
  if (held.state === "ok" || queued) return { missing: [], create: [], gone: [] };
  return {
    missing: [],
    create: [
      {
        kind: "helper",
        op: "create",
        fields: {
          helper: "input_boolean",
          name: scopedSpace(e) ? `Taxis ${scopedSpace(e)!.name} Space automations paused` : "Taxis house automations paused",
          entity_id: pauseId,
          icon: "mdi:pause-circle-outline",
        },
      },
    ],
    gone: installedHere ? [`${pauseId} is missing`] : [],
  };
}

// The away switch of the house: the one the user picked, else the one Taxis makes
// (shared/house-modes.ts). A switch that cannot be used stops the recipe.
function awaySwitch(e: Env): { id: string; missing: string[]; create: ChangeInput[] } {
  const row = planHouseModes(e.h, e.params, e.inventory, e.changes, null, e.scope).find((r) => r.key === "away")!;
  if (row.status === "review") return { id: row.id, missing: [`Away mode: ${row.detail} (Parameters, ${scopedSpace(e) ? "Space" : "House"})`], create: [] };
  return { id: row.id, missing: [], create: row.status === "create" ? row.inputs : [] };
}

// The guest switch, when there is one in place: away mode is not switched on by
// itself while guests are home.
function guestSwitch(e: Env): string {
  const row = planHouseModes(e.h, e.params, e.inventory, e.changes, null, e.scope).find((r) => r.key === "guest")!;
  return row.status === "present" || row.status === "in-changes" ? row.id : "";
}

// Counted entities of the chosen capabilities in every area, sorted and unique.
function countedIn(e: Env, capabilities: readonly Capability[]): string[] {
  const exclusions = helperExclusions(e.h, e.naming);
  const out = new Set<string>();
  for (const area of Object.values(e.h.areas)) {
    if (scopedSpace(e) && !scopedSpace(e)!.areaIds.includes(area.id)) continue;
    const inv: AreaInventory = areaInventory(e.h, e.inventory, area.id, exclusions(area.id));
    for (const cap of capabilities) for (const row of inv[cap]) if (row.counts && (cap !== "power" || row.appliance)) out.add(row.entityId);
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// An automation of the house.
// ---------------------------------------------------------------------------

function automationCell(
  e: Env,
  recipe: HouseRecipeKey,
  input: Record<string, unknown>,
  parts: { missing: string[]; notes: string[]; pause: Pause; extraReasons?: string[]; extraInputs?: ChangeInput[]; ignore?: string[] },
): RecipeCell {
  const id = automationId(e, recipe);
  const alias = automationAlias(scopedSpace(e)?.name ?? "House", recipe);
  const bp = blueprintForRecipe(recipe);
  const there = e.installed.automations[id] ?? null;
  const missing = [...parts.missing, ...parts.pause.missing];
  if (unavailableRecipe(there)) missing.push(unavailableRecipeMessage);

  const reasons: string[] = [];
  if (there) {
    if (there.path !== bp.path) reasons.push("It isn't made from the Taxis blueprint");
    else {
      // Keys left out of the comparison are reported in the recipe's own words.
      const drop = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !(parts.ignore ?? []).includes(k)));
      reasons.push(...inputDifferences(drop(there.input), drop(input)));
    }
    if (there.alias !== alias) reasons.push(`Name: ${show(there.alias)} → ${alias}`);
    reasons.push(...blueprintReason(e, recipe), ...parts.pause.gone, ...(parts.extraReasons ?? []));
  }

  const status: RecipeStatus = pendingAutomation(e.changes, id)
    ? "in-changes"
    : missing.length > 0
      ? "missing"
      : there
        ? reasons.length === 0
          ? "installed"
          : "out-of-date"
        : "ready";
  const inputs: ChangeInput[] =
    status === "ready" || status === "out-of-date" || e.projectDesired
      ? [
          ...blueprintInput(e, recipe),
          ...parts.pause.create,
          ...(parts.extraInputs ?? []),
          { kind: "automation", op: there ? "update" : "create", fields: { automation_id: id, recipe, alias, use_blueprint: { path: bp.path, input } } },
        ]
      : [];
  return cell(recipe, status, missing, reasons, parts.notes, inputs);
}

const noTargets = (e: Env) =>
  `No notify services are set (Parameters, ${scopedSpace(e) ? "Space" : "House"}), so the message appears in Home Assistant's notifications`;

function planBatteryLow(e: Env): RecipeCell {
  const id = automationId(e, "battery_low");
  const targets = houseValue(e, "notify_targets") as string[];
  const input = {
    threshold: houseValue(e, "battery_threshold"),
    report_time: withSeconds(String(houseValue(e, "battery_report_time"))),
    notify_targets: targets,
    pause_switch: scopedIds(e)?.pause ?? HOUSE_PAUSE_ID,
  };
  const notes = [
    "Every battery sensor Home Assistant has is looked at when the report runs, so a new one is included without changing anything",
    "Nothing is sent when no battery is low",
  ];
  if (targets.length === 0) notes.unshift(noTargets(e));
  return automationCell(e, "battery_low", input, { missing: [], notes, pause: housePause(e, Boolean(e.installed.automations[id])) });
}

// Entities the recipes rely on: motion, presence, doors, windows, temperature,
// humidity, light level, thermostats, leak sensors and appliance power sensors.
const WATCHED: readonly Capability[] = ["motion", "presence", "door", "window", "temperature", "humidity", "illuminance", "thermostat", "leak", "power"];
const WATCH_LIMIT = 500;

function planUnavailableWatch(e: Env): RecipeCell {
  const id = automationId(e, "unavailable_watch");
  const targets = houseValue(e, "notify_targets") as string[];
  const all = countedIn(e, WATCHED);
  const watched = all.slice(0, WATCH_LIMIT);
  const input = {
    watch_entities: watched,
    unavailable_minutes: houseValue(e, "unavailable_watch_minutes"),
    notify_targets: targets,
    pause_switch: scopedIds(e)?.pause ?? HOUSE_PAUSE_ID,
  };
  const missing =
    watched.length === 0 ? [scopedSpace(e) ? "A selected sensor in this Space (Capabilities)" : "A sensor that counts in an area (Capabilities)"] : [];
  // The list of entities is compared by what changed, not by printing both.
  const there = e.installed.automations[id]?.input.watch_entities;
  const was = Array.isArray(there) ? (there as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const added = watched.filter((x) => !was.includes(x)).length;
  const removed = was.filter((x) => !watched.includes(x)).length;
  const extraReasons = e.installed.automations[id] && (added > 0 || removed > 0) ? [`Watched entities: ${added} added, ${removed} no longer included`] : [];
  const notes = [
    scopedSpace(e)
      ? "Taxis includes sensors selected for this Space the next time this is updated"
      : "Taxis passes the sensors the area recipes rely on, so a sensor you start counting is added the next time this is updated",
    "One message per entity until it comes back; a flip between unavailable and unknown starts the count again",
  ];
  if (targets.length === 0) notes.unshift(noTargets(e));
  if (all.length > WATCH_LIMIT) notes.push(`Only the first ${WATCH_LIMIT} of ${all.length} entities are watched`);
  return automationCell(e, "unavailable_watch", input, {
    missing,
    notes,
    pause: housePause(e, Boolean(e.installed.automations[id])),
    extraReasons,
    ignore: ["watch_entities"],
  });
}

// ---------------------------------------------------------------------------
// House presence: the occupied sensor and the "everyone left" automation.
// ---------------------------------------------------------------------------

function planHousePresence(e: Env): RecipeCell {
  const { h, installed, changes } = e;
  const id = automationId(e, "house_presence");
  const there = Boolean(installed.automations[id]);
  const codes = areaCodes(h, e.naming);
  const conflicts = areaCodeConflicts(h, e.naming);

  // The areas the group gathers: the occupied sensors of those that have Occupancy.
  const members: string[] = [];
  const exists = (sensor: string, domain: string, platform?: string) => heldBy(h, sensor, domain, platform).state === "ok" || pendingHelper(changes, sensor);
  for (const area of Object.values(h.areas)) {
    if (scopedSpace(e) && !scopedSpace(e)!.areaIds.includes(area.id)) continue;
    if (conflicts.has(area.id)) continue;
    const ids = runtimeIds(codes[area.id].code);
    const occupancyId = automationIdFor("occupancy", codes[area.id].code);
    const ownedSensor =
      !scopedSpace(e) ||
      (h.entities[ids.occupied]
        ? h.entities[ids.occupied].areaId === area.id
        : changes.some((c) => c.kind === "helper" && c.op === "create" && c.after.entity_id === ids.occupied && c.after.area_id === area.id));
    if (
      ownedSensor &&
      ENTITY_ID_RE.test(ids.occupied) &&
      (installed.automations[occupancyId] || pendingAutomation(changes, occupancyId)) &&
      exists(ids.occupied, "binary_sensor", "template")
    )
      members.push(ids.occupied);
  }
  members.sort();

  const missing: string[] = [];
  const notes: string[] = [];
  if (members.length === 0) missing.push("An area with Occupancy installed (Recipes)");

  const pause = housePause(e, there);
  const away = awaySwitch(e);
  missing.push(...away.missing);
  const guest = guestSwitch(e);

  // Space presence uses the group directly; it must not read every HA person.
  const groupId = scopedIds(e)?.areasOccupied ?? HOUSE_AREAS_OCCUPIED_ID;
  const occupiedId = scopedSpace(e) ? groupId : HOUSE_OCCUPIED_ID;
  // The group of the areas' occupied sensors, and the sensor on top of it.
  const inputs: ChangeInput[] = [];
  const reasons: string[] = [];
  const group = heldBy(h, groupId, "binary_sensor", "group");
  const sensor = scopedSpace(e) ? null : heldBy(h, occupiedId, "binary_sensor", "template");
  for (const m of [taken(groupId, group), sensor ? taken(occupiedId, sensor) : null]) if (m) missing.push(m);

  if (scopedSpace(e) && group.state === "absent" && pendingHelper(changes, groupId))
    missing.push(`Apply the pending ${groupId} creation before using Space presence.`);
  if (group.state === "absent" && !pendingHelper(changes, groupId) && members.length > 0) {
    inputs.push({
      kind: "helper",
      op: "create",
      fields: {
        helper: "group",
        group_type: "binary_sensor",
        name: scopedSpace(e) ? `Taxis ${scopedSpace(e)!.name} Space areas occupied` : "Taxis areas occupied",
        entity_id: groupId,
        entities: members,
      },
    });
    if (there) reasons.push(`${groupId} is missing`);
  } else if (group.state === "ok" && members.length > 0) {
    const current = [...(h.entities[groupId]?.members ?? [])].sort();
    const same = current.length === members.length && current.every((x, i) => x === members[i]);
    if (!same) {
      if (scopedSpace(e)) missing.push(`Review ${groupId} members before using Space presence.`);
      if (!pendingHelper(changes, groupId)) {
        reasons.push(`The areas occupied group has ${current.length} sensors, ${members.length} areas have Occupancy`);
        inputs.push({ kind: "helper", op: "update", targetId: groupId, fields: { entities: members } });
      }
    }
  }
  if (sensor?.state === "absent" && !pendingHelper(changes, occupiedId)) {
    inputs.push({
      kind: "helper",
      op: "create",
      fields: { helper: "template", name: "Taxis occupied", entity_id: occupiedId, state_template: HOUSE_OCCUPIED_TEMPLATE, device_class: "occupancy" },
    });
    if (there) reasons.push(`${occupiedId} is missing`);
  }

  const input: Record<string, unknown> = {
    occupied_entity: occupiedId,
    away_entity: away.id,
    ...(guest ? { guest_entity: guest } : {}),
    away_after_minutes: houseValue(e, "everyone_left_minutes"),
    end_on_return: houseValue(e, "away_ends_on_return"),
    pause_switch: scopedIds(e)?.pause ?? HOUSE_PAUSE_ID,
  };
  if (!guest)
    notes.push(`No guest mode switch is in place, so away mode is switched on even while guests are home (Parameters, ${scopedSpace(e) ? "Space" : "House"})`);
  notes.push(
    scopedSpace(e)
      ? "The Space is occupied while one of its areas is occupied; people are not inferred globally."
      : "The house counts as occupied while any area is occupied or any person is home",
  );
  const persons = Object.values(h.entities).filter((x) => x.domain === "person" && !x.disabled);
  if (!scopedSpace(e) && persons.length === 0) notes.push("Home Assistant has no person, so only the areas' occupancy tells whether anyone is home");

  return automationCell(e, "house_presence", input, { missing, notes, pause, extraReasons: reasons, extraInputs: [...away.create, ...inputs] });
}

// ---------------------------------------------------------------------------
// Goodbye: the script.
// ---------------------------------------------------------------------------

function planGoodbye(e: Env): RecipeCell {
  const { h, changes, installed } = e;
  const space = scopedSpace(e);
  const scriptId = space ? spaceIds(space.id).goodbye : GOODBYE_SCRIPT_ID;
  const there = installed.scripts[scriptId] ?? null;
  const alias = space ? `${space.name} – Goodbye (Taxis)` : "Goodbye (Taxis)";
  const missing: string[] = [];
  if (unavailableRecipe(there)) missing.push(unavailableRecipeMessage);
  const notes: string[] = [];

  // The lights of the whole house: the house light group.
  const groupId = space ? spaceIds(space.id).lights : houseGroupId(e.naming);
  const group = h.entities[groupId];
  const spaceGroup = space ? planSpaceLightGroup(h, e.inventory, e.naming, changes, space) : null;
  if (spaceGroup && spaceGroup.status !== "ready") missing.push(spaceGroup.reason ?? "Create this Space light group first.");
  if (!space && !group) {
    if (!(pendingHelper(changes, groupId) || pendingRename(changes, groupId))) missing.push("The house light group (Helpers tab)");
  } else if (!space && group && (group.domain !== "light" || group.platform !== "group")) {
    missing.push(`${groupId} is already used by “${group.name}”`);
  }

  const media = countedIn(e, ["speaker", "tv"]).slice(0, 500);
  if (media.length === 0)
    notes.push(
      space ? "No speaker or TV is selected in this Space, so only the lights go off" : "No speaker or TV counts in any area, so only the lights go off",
    );

  const away = awaySwitch(e);
  missing.push(...away.missing);
  const held = h.entities[`script.${scriptId}`];
  if (held && !there && !pendingScript(changes, scriptId))
    missing.push(`script.${scriptId} is already used by “${held.name}”, which Taxis didn't make or can't edit`);

  const input: Record<string, unknown> = { light_target: groupId, media_entities: media, away_entity: away.id };
  const bp = blueprintForRecipe("goodbye");

  const reasons: string[] = [];
  if (there) {
    if (there.path !== GOODBYE_PATH) reasons.push("It isn't made from the Taxis blueprint");
    else reasons.push(...inputDifferences(there.input, input));
    if (there.alias !== alias) reasons.push(`Name: ${show(there.alias)} → ${alias}`);
    reasons.push(...blueprintReason(e, "goodbye"));
  }
  notes.push(
    space
      ? "Switches off this Space's light group and media players, then turns on its away mode, which Area climate follows"
      : "Switches off the house light group and the media players, then turns on away mode, which Area climate answers with its away setting",
    `Call script.${scriptId} from a button, an NFC tag or a voice command`,
  );

  const status: RecipeStatus = pendingScript(changes, scriptId)
    ? "in-changes"
    : missing.length > 0
      ? "missing"
      : there
        ? reasons.length === 0
          ? "installed"
          : "out-of-date"
        : "ready";
  const inputs: ChangeInput[] =
    status === "ready" || status === "out-of-date" || e.projectDesired
      ? [
          ...blueprintInput(e, "goodbye"),
          ...away.create,
          { kind: "script", op: there ? "update" : "create", fields: { script_id: scriptId, alias, use_blueprint: { path: bp.path, input } } },
        ]
      : [];
  return cell("goodbye", status, missing, reasons, notes, inputs);
}

// ---------------------------------------------------------------------------
// All of them, in the order the Recipes page lists them.
// ---------------------------------------------------------------------------

export function planHouseRecipes(
  h: Hierarchy,
  inventory: InventorySettings,
  naming: NamingSettings,
  params: ParameterSettings,
  installed: RecipeInstalled,
  changes: readonly Change[],
  projectDesired = false,
  scope: RecipeScope = { kind: "legacy" },
): RecipeCell[] {
  const blocked = scopeProblem(h, changes, scope);
  if (blocked)
    return (["announce", "goodbye", "house_presence", "battery_low", "unavailable_watch"] as HouseRecipeKey[]).map((recipe) => ({
      ...cell(recipe, "missing", [blocked], [], [], []),
      scope,
      scopeBlocked: blocked,
    }));
  const env: Env = { h, inventory, naming, params, installed, changes, projectDesired, scope };
  return [
    planAnnounce(h, inventory, naming, params, installed, changes, projectDesired, scope),
    planGoodbye(env),
    planHousePresence(env),
    ...(scope.kind === "space"
      ? [cell("battery_low", "missing", ["Low batteries is available only for the whole Home Assistant site."], [], [], [])]
      : [planBatteryLow(env)]),
    planUnavailableWatch(env),
  ].map((item) => {
    if (scope.kind !== "space") return { ...item, scope };
    const ids = spaceIds(scope.space.id);
    const targetId = item.recipe === "announce" ? ids.announce : item.recipe === "goodbye" ? ids.goodbye : ids.automation(item.recipe);
    const metadata = { labelId: scope.space.id, areaIds: [...scope.space.areaIds] };
    return {
      ...item,
      scope,
      targetId,
      areaName: scope.space.name,
      inputs: item.inputs.map((input) => (input.kind === "blueprint" ? input : { ...input, space: metadata })),
    };
  });
}
