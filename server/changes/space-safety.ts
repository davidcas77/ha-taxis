import { createHash } from "node:crypto";
import { areaSpace, resolveSpaces, spaceIds } from "../../shared/spaces.ts";
import { helperChangeInputs, planHelpers, planSpaceLightGroup } from "../../shared/helpers.ts";
import { sameValue } from "../../shared/changes.ts";
import type { InventorySettings } from "../../shared/inventory.ts";
import { areaCodes, type NamingSettings } from "../../shared/naming.ts";
import { planRecipes, runtimeIds } from "../../shared/recipes.ts";
import { planHouseRecipes } from "../../shared/recipes-house.ts";
import { inputEntityIds } from "../../shared/blueprints.ts";
import type { RecipeInstalled } from "../../shared/recipes.ts";
import type { ParameterSettings } from "../../shared/parameters.ts";
import { settingEffects } from "./direct-settings.ts";
import type { Change, ChangeInput, Hierarchy } from "../../shared/types.ts";

type DesiredSettings = { inventory: InventorySettings; parameters: ParameterSettings };
export type SpaceGuardContext = {
  inventory: InventorySettings;
  naming: NamingSettings;
  parameters?: ParameterSettings;
  installed?: RecipeInstalled;
  transition?: { before: DesiredSettings; after: DesiredSettings };
};
export type SpaceBaseline = { labelId: string; areaIds: string[]; fingerprint: string; transition?: SpaceGuardContext["transition"] };

/** Capture only ownership and group closure evidence, never entity state or secrets. */
export function spaceBaseline(
  proposal: NonNullable<ChangeInput["space"]>,
  h: Hierarchy,
  pending: readonly Change[],
  context?: SpaceGuardContext,
): SpaceBaseline | string {
  if (
    !proposal ||
    typeof proposal.labelId !== "string" ||
    !Array.isArray(proposal.areaIds) ||
    !proposal.areaIds.every((id) => typeof id === "string") ||
    new Set(proposal.areaIds).size !== proposal.areaIds.length
  )
    return "The Space membership was not readable.";
  if (
    pending.some(
      (change) =>
        ["area", "device", "entity", "label"].includes(change.kind) &&
        !(
          change.kind === "entity" &&
          (change.before.spaceSnapshot as SpaceBaseline | undefined)?.labelId === proposal.labelId &&
          Object.keys(change.after).length === 1 &&
          typeof change.after.new_entity_id === "string"
        ),
    )
  )
    return "Apply pending area, device, entity and label changes before planning Space objects.";
  const space = resolveSpaces(h, pending).find((item) => item.id === proposal.labelId);
  if (!space || space.blocked || !space.areaIds.length) return space?.blocked ?? "The Space label or its areas are unavailable.";
  const expected = [...proposal.areaIds].sort();
  if (expected.length !== space.areaIds.length || expected.some((id, i) => id !== space.areaIds[i]))
    return "Space membership changed. Refresh and review again.";
  const areas = Object.values(h.areas)
    .map((area) => [area.id, [...area.labels].sort()])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const entities = Object.values(h.entities)
    .map((entity) => [entity.entityId, entity.areaId, entity.platform, entity.disabled, [...entity.members].sort()])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const labels = Object.values(h.labels)
    .map((label) => [label.id, label.name])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        areas,
        entities,
        labels,
        inventory: context?.inventory,
        naming: context?.naming,
        parameters: context?.parameters,
        transition: context?.transition,
      }),
    )
    .digest("hex");
  return { labelId: space.id, areaIds: space.areaIds, fingerprint, ...(context?.transition ? { transition: context.transition } : {}) };
}

// Scoped objects must not be accepted until their full target graph and their
// fresh membership have been verified by the server. In particular, a label
// supplied by the browser is not proof that a light group is confined to it.
export function spaceChangeGuard(input: ChangeInput, h: Hierarchy, pending: readonly Change[], context?: SpaceGuardContext): string | null {
  if (input.space !== undefined) {
    const baseline = spaceBaseline(input.space, h, pending);
    if (typeof baseline === "string") return baseline;
    const ids = spaceIds(baseline.labelId);
    const fields = input.fields ?? {};
    const target = input.op === "create" ? fields.entity_id : input.targetId;
    const directAuthorized = (): boolean => {
      if (!context?.transition || !context.installed) return false;
      const effects = settingEffects(h, context.naming, context.transition.before, context.transition.after, context.installed);
      return (
        !("error" in effects) &&
        effects.inputs.some(
          (candidate) =>
            candidate.kind === input.kind &&
            candidate.op === input.op &&
            (input.op === "create" || input.kind === "script" || input.kind === "automation" || candidate.targetId === input.targetId) &&
            sameValue(candidate.fields, fields) &&
            sameValue(candidate.space, input.space),
        )
      );
    };
    if (input.kind === "entity" && input.op === "update" && context && typeof input.targetId === "string") {
      const entity = h.entities[input.targetId];
      if (!entity?.areaId || !baseline.areaIds.includes(entity.areaId) || !entity.inRegistry || Object.keys(fields).some((key) => key !== "new_entity_id"))
        return "The helper to adopt is not an editable entity in this Space.";
      const otherChanges = pending.filter((change) => !(change.kind === "entity" && change.targetId === input.targetId && sameValue(change.after, fields)));
      const rows = planHelpers(h, context.inventory, context.naming, otherChanges).filter((row) => row.areaId === entity.areaId && row.status === "adopt");
      if (
        !rows
          .flatMap(helperChangeInputs)
          .some((candidate) => candidate.kind === "entity" && candidate.targetId === input.targetId && sameValue(candidate.fields, fields))
      )
        return "The helper adoption no longer matches the verified area plan.";
      const seen = new Set<string>();
      const safe = (id: string): boolean => {
        const member = h.entities[id];
        if (!member || member.disabled || seen.has(id) || !member.areaId || !baseline.areaIds.includes(member.areaId)) return false;
        if (!member.members.length) return member.platform !== "group";
        seen.add(id);
        const valid = member.members.every(safe);
        seen.delete(id);
        return valid;
      };
      return safe(input.targetId) ? null : "The helper has unknown, cyclic or out-of-Space members.";
    }
    if (input.kind === "area" && input.op === "update" && context && typeof input.targetId === "string") {
      if (!baseline.areaIds.includes(input.targetId)) return "The area does not belong to this Space.";
      const keys = Object.keys(fields);
      if (keys.length !== 1 || !["temperature_entity_id", "humidity_entity_id"].includes(keys[0])) return "Only an area's verified sensor can be set here.";
      const sensor = h.entities[String(fields[keys[0]])];
      if (!sensor || sensor.areaId !== input.targetId || sensor.domain !== "sensor" || sensor.disabled || !sensor.inRegistry)
        return "The area's sensor is unavailable or outside this Space.";
      const otherChanges = pending.filter((change) => !(change.kind === "area" && change.targetId === input.targetId && sameValue(change.after, fields)));
      const rows = planHelpers(h, context.inventory, context.naming, otherChanges).filter((row) => row.areaId === input.targetId);
      const row = rows.find((item) =>
        helperChangeInputs(item).some((candidate) => candidate.kind === "area" && candidate.targetId === input.targetId && sameValue(candidate.fields, fields)),
      );
      if (!row) return "The area's sensor no longer matches the verified area plan.";
      if (
        !sensor.members.length ||
        !sameValue([...sensor.members].sort(), [...row.sources].sort()) ||
        !sensor.members.every((id) => h.entities[id]?.areaId === input.targetId && !h.entities[id]?.disabled)
      )
        return "The area's sensor sources cannot be verified in this Space.";
      return null;
    }
    if (
      input.kind === "helper" &&
      input.op === "create" &&
      fields.helper === "input_boolean" &&
      [ids.away, ids.sleep, ids.guest, ids.pause].includes(String(target))
    ) {
      if (h.entities[String(target)]) return "The Space switch ID is already in use.";
      return null;
    }
    if (input.kind === "helper" && input.op === "create" && target === ids.areasOccupied) {
      if (!context || fields.helper !== "group" || fields.group_type !== "binary_sensor" || h.entities[ids.areasOccupied])
        return "The Space occupancy group cannot be verified.";
      const codes = areaCodes(h, context.naming);
      const allowed = new Map(baseline.areaIds.map((id) => [runtimeIds(codes[id].code).occupied, id]));
      const members = fields.entities;
      if (
        !Array.isArray(members) ||
        !members.length ||
        !members.every(
          (id) =>
            typeof id === "string" &&
            allowed.has(id) &&
            h.entities[id]?.platform === "template" &&
            h.entities[id]?.areaId === allowed.get(id) &&
            !h.entities[id]?.disabled,
        )
      )
        return "The Space occupancy group has unverified or out-of-Space members.";
      return null;
    }
    if (input.kind === "helper" && target === ids.lights) {
      if (!context) return "Space light groups require current naming and inventory settings.";
      if (input.op !== "create" && input.op !== "update") return "The Space light group operation is unavailable.";
      const space = resolveSpaces(h, pending).find((item) => item.id === baseline.labelId)!;
      const otherChanges = pending.filter((change) => !(change.kind === "helper" && change.targetId === target && sameValue(change.after, fields)));
      const plan = planSpaceLightGroup(h, context.inventory, context.naming, otherChanges, space);
      if (
        !plan.inputs.some(
          (candidate) =>
            candidate.op === input.op && (input.op === "create" || candidate.targetId === input.targetId) && sameValue(candidate.fields, input.fields),
        )
      )
        return "The Space light group no longer matches the verified area groups. Refresh and review again.";
      if (input.op === "create" && (fields.helper !== "group" || fields.group_type !== "light" || h.entities[ids.lights]))
        return "The Space light group already exists or has the wrong kind.";
      if (input.op === "update") {
        const existing = h.entities[ids.lights];
        if (!existing || existing.platform !== "group" || existing.domain !== "light" || !existing.inRegistry || !existing.configEntryId)
          return "The existing Space light group is not a registry-editable light group.";
      }
      const members = fields.entities;
      if (!Array.isArray(members) || !members.length || !members.every((id) => typeof id === "string")) return "The Space light group needs verified members.";
      const visiting = new Set<string>();
      const safe = (id: string): boolean => {
        const entity = h.entities[id];
        if (!entity || entity.domain !== "light" || entity.disabled || visiting.has(id) || (entity.areaId && !baseline.areaIds.includes(entity.areaId)))
          return false;
        if (entity.platform !== "group") return !!entity.areaId && baseline.areaIds.includes(entity.areaId);
        if (!entity.members.length) return false;
        visiting.add(id);
        const result = entity.members.every(safe);
        visiting.delete(id);
        return result;
      };
      if (!members.every((id) => h.entities[id]?.platform === "group" && !!h.entities[id]?.areaId && safe(id)))
        return "The Space light group has unknown, cyclic or out-of-Space members.";
      if (input.op === "update" && !safe(ids.lights))
        return "The existing Space light group has unknown, cyclic or out-of-Space members. Repair it in Home Assistant first.";
      return null;
    }
    if (input.kind === "helper" && context) {
      const areaId = typeof fields.area_id === "string" ? fields.area_id : typeof target === "string" ? h.entities[target]?.areaId : null;
      if (!areaId || !baseline.areaIds.includes(areaId)) return "The helper does not belong to this Space.";
      const otherChanges = pending.filter(
        (change) =>
          !(change.kind === "helper" && change.targetId === target && sameValue(change.after, fields)) &&
          !(
            change.kind === "entity" &&
            (change.before.spaceSnapshot as SpaceBaseline | undefined)?.labelId === baseline.labelId &&
            change.targetId === target
          ) &&
          !(
            change.kind === "automation" &&
            change.after.area_id === areaId &&
            (change.before.spaceSnapshot as SpaceBaseline | undefined)?.labelId === baseline.labelId
          ),
      );
      const rows = planHelpers(h, context.inventory, context.naming, otherChanges).filter((row) => row.level === "area" && row.areaId === areaId);
      const recipeInputs =
        context.parameters && context.installed
          ? planRecipes(h, context.inventory, context.naming, context.parameters, context.installed, otherChanges)
              .filter((cell) => cell.areaId === areaId && cell.status !== "missing")
              .flatMap((cell) => cell.inputs)
          : [];
      const expected = [...rows.flatMap(helperChangeInputs), ...recipeInputs].some(
        (candidate) =>
          candidate.kind === "helper" &&
          candidate.op === input.op &&
          (input.op === "create" || candidate.targetId === input.targetId) &&
          sameValue(candidate.fields, fields),
      );
      if (!expected && !directAuthorized()) return "The area helper no longer matches its verified plan.";
      const seen = new Set<string>();
      const safe = (id: string): boolean => {
        const entity = h.entities[id];
        if (!entity || entity.disabled || seen.has(id) || (entity.areaId && !baseline.areaIds.includes(entity.areaId))) return false;
        if (!entity.members.length) return entity.platform !== "group" && !!entity.areaId && baseline.areaIds.includes(entity.areaId);
        seen.add(id);
        const valid = entity.members.every(safe);
        seen.delete(id);
        return valid;
      };
      const members = fields.entities;
      if (Array.isArray(members) && !members.every((id) => typeof id === "string" && safe(id)))
        return "The helper has unknown, cyclic or out-of-Space members.";
      if (input.op === "update") {
        const existing = h.entities[String(target)];
        if ("duration" in fields || "periods" in fields) {
          const domain = "duration" in fields ? "timer" : "schedule";
          if (!existing?.inRegistry || existing.domain !== domain || existing.platform !== domain || existing.areaId !== areaId)
            return `The existing ${domain} is not an editable helper in this area.`;
        } else if (!existing?.inRegistry || !existing.configEntryId || existing.platform !== "group" || !safe(String(target)))
          return "The existing helper is not editable or has unsafe members.";
      }
      return null;
    }
    if ((input.kind === "script" || input.kind === "automation") && context?.parameters && context.installed) {
      const space = resolveSpaces(h, pending).find((item) => item.id === baseline.labelId)!;
      const recipeId = String(input.kind === "script" ? fields.script_id : fields.automation_id);
      const otherChanges = pending.filter((change) => !(change.kind === input.kind && change.targetId === recipeId && sameValue(change.after, fields)));
      const areaPlans = planRecipes(h, context.inventory, context.naming, context.parameters, context.installed, otherChanges).filter((cell) =>
        baseline.areaIds.includes(cell.areaId),
      );
      const housePlans = planHouseRecipes(h, context.inventory, context.naming, context.parameters, context.installed, otherChanges, false, {
        kind: "space",
        space,
      });
      const approved = [...areaPlans, ...housePlans]
        .filter((cell) => cell.status !== "missing")
        .flatMap((cell) => cell.inputs)
        .some((candidate) => candidate.kind === input.kind && candidate.op === input.op && sameValue(candidate.fields, fields));
      const directApproved = directAuthorized();
      if (!approved && !directApproved) return "The Space recipe no longer matches its verified plan. Refresh and review again.";
      const blueprint = fields.use_blueprint as { path?: unknown; input?: unknown } | undefined;
      if (!blueprint || typeof blueprint.path !== "string" || !blueprint.input || typeof blueprint.input !== "object" || Array.isArray(blueprint.input))
        return "The Space recipe inputs were not readable.";
      const refs = inputEntityIds(blueprint.path, blueprint.input as Record<string, unknown>);
      const modeKeys = ["away_mode_entity", "sleep_mode_entity", "guest_mode_entity"] as const;
      const foreignModes = new Set<string>(["input_boolean.taxis_away", "input_boolean.taxis_sleep", "input_boolean.taxis_guest"]);
      const addModes = (values: Record<string, unknown> | undefined) => {
        for (const key of modeKeys) if (typeof values?.[key] === "string" && values[key]) foreignModes.add(String(values[key]));
      };
      addModes(context.parameters.house);
      for (const other of resolveSpaces(h))
        if (other.id !== baseline.labelId && !other.id.startsWith("new:")) {
          const otherIds = spaceIds(other.id);
          [otherIds.away, otherIds.sleep, otherIds.guest].forEach((id) => foreignModes.add(id));
          addModes(context.parameters.spaces?.[other.id]);
          for (const area of other.areaIds) addModes(context.parameters.areas[area]);
        }
      const selectedModes = new Set<string>();
      const collectModes = (values: Record<string, unknown> | undefined) => {
        for (const key of modeKeys) if (typeof values?.[key] === "string" && values[key]) selectedModes.add(String(values[key]));
      };
      collectModes(context.parameters.spaces?.[baseline.labelId]);
      for (const area of baseline.areaIds) collectModes(context.parameters.areas[area]);
      const seen = new Set<string>();
      const safe = (id: string): boolean => {
        const entity = h.entities[id];
        if (!entity) {
          return pending.some(
            (change) =>
              change.kind === "helper" &&
              change.op === "create" &&
              change.after.entity_id === id &&
              (change.before.spaceSnapshot as SpaceBaseline | undefined)?.labelId === baseline.labelId,
          );
        }
        if (entity.disabled || seen.has(id) || (entity.areaId && !baseline.areaIds.includes(entity.areaId))) return false;
        if ([ids.away, ids.sleep, ids.guest, ids.pause].includes(id) || selectedModes.has(id))
          return (
            !foreignModes.has(id) && entity.platform === "input_boolean" && entity.inRegistry && (!entity.areaId || baseline.areaIds.includes(entity.areaId))
          );
        if (entity.platform === "group" && !entity.members.length) return false;
        if (id === ids.lights || id === ids.areasOccupied || entity.members.length) {
          if (
            !entity.members.length ||
            ((id === ids.lights || id === ids.areasOccupied) && (entity.platform !== "group" || !entity.inRegistry || !entity.configEntryId))
          )
            return false;
          seen.add(id);
          const valid = entity.members.every(safe);
          seen.delete(id);
          return valid;
        }
        if (entity.areaId && baseline.areaIds.includes(entity.areaId)) return true;
        return (
          entity.domain === "tts" &&
          (context.parameters?.spaces?.[baseline.labelId]?.tts_entity === id ||
            (directApproved && input.kind === "script" && context.installed?.scripts[recipeId]?.input.tts_entity === id))
        );
      };
      if (!refs.every(safe)) return "A Space recipe refers to an unknown, shared or out-of-Space entity.";
      return null;
    }
    return "This Space recipe change cannot yet be safely applied. No changes were added.";
  }
  const fields = input.fields ?? {};
  const ids = [input.targetId, fields.entity_id, fields.script_id, fields.automation_id];
  if (ids.some((id) => typeof id === "string" && /(?:^|\.)taxis_(?:space_s[0-9a-f]{16}_|[a-z_]+_space_s[0-9a-f]{16}$)/.test(id)))
    return "A Space object requires a verified Space scope.";
  if (input.kind === "helper" || input.kind === "automation") {
    const areaId = typeof fields.area_id === "string" ? fields.area_id : input.kind === "helper" && input.targetId ? h.entities[input.targetId]?.areaId : null;
    if (areaId && h.areas[areaId] && areaSpace(h, areaId, pending).kind !== "legacy")
      return "Apply Space assignments first and review this area through its Space.";
  }
  return null;
}
