import { areaSpace, resolveSpaces } from "../../shared/spaces.ts";
import { sameValue, validateInput } from "../../shared/changes.ts";
import { planHelpers, helperChangeInputs, type HelperRow } from "../../shared/helpers.ts";
import { areaInventory, type InventorySettings } from "../../shared/inventory.ts";
import type { NamingSettings } from "../../shared/naming.ts";
import type { ParameterSettings } from "../../shared/parameters.ts";
import { planRecipes, type RecipeCell, type RecipeInstalled } from "../../shared/recipes.ts";
import { planHouseRecipes } from "../../shared/recipes-house.ts";
import type { ChangeInput, Hierarchy } from "../../shared/types.ts";

type Desired = { inventory: InventorySettings; parameters: ParameterSettings };
const helperKey = (row: HelperRow) => [row.level, row.areaId, row.floorId, row.key, row.canonicalId].join("|");
const cellKey = (cell: RecipeCell) =>
  `${cell.scope?.kind === "space" ? `space:${cell.scope.space.id}` : "legacy"}|${cell.areaId}|${cell.recipe}|${cell.targetId ?? ""}`;
const same = (a: unknown, b: unknown) => sameValue(a, b);

// Compare what the old and new settings intend, not whether HA was already
// out-of-date. Apply only that delta to existing editable managed objects.
export function settingEffects(
  h: Hierarchy,
  naming: NamingSettings,
  before: Desired,
  after: Desired,
  installed: RecipeInstalled,
): { inputs: ChangeInput[]; notes: string[] } | { error: string } {
  const inputs: ChangeInput[] = [];
  const notes: string[] = [];
  const spaces = resolveSpaces(h);
  const problematic = spaces.filter((space) => space.blocked || !space.areaIds.length);
  for (const space of problematic) {
    const scopeChanged = !same(before.parameters.spaces?.[space.id], after.parameters.spaces?.[space.id]);
    const sharedChanged = !same(before.parameters.house, after.parameters.house) || !same(before.parameters.types, after.parameters.types);
    const areaChanged = space.areaIds.some(
      (id) => !same(before.inventory.areas[id], after.inventory.areas[id]) || !same(before.parameters.areas[id], after.parameters.areas[id]),
    );
    const entityChanged = [...new Set([...Object.keys(before.inventory.entities), ...Object.keys(after.inventory.entities)])].some(
      (id) => space.areaIds.includes(h.entities[id]?.areaId ?? "") && !same(before.inventory.entities[id], after.inventory.entities[id]),
    );
    if (scopeChanged || sharedChanged || areaChanged || entityChanged)
      return { error: `${space.name}: ${space.blocked ?? "Assign an area before changing settings for this Space."}` };
  }
  if (!same(before.inventory, after.inventory)) {
    for (const area of Object.values(h.areas)) {
      const rows = (inventory: InventorySettings) => Object.values(areaInventory(h, inventory, area.id)).flat();
      const previous = new Map(rows(before.inventory).map((row) => [`${row.entityId}|${row.capability}`, row]));
      const next = new Map(rows(after.inventory).map((row) => [`${row.entityId}|${row.capability}`, row]));
      for (const key of new Set([...previous.keys(), ...next.keys()])) {
        const a = previous.get(key),
          b = next.get(key);
        if (same(a, b)) continue;
        const show = (row: typeof a) =>
          row
            ? JSON.stringify({
                capability: row.capability,
                counts: row.counts,
                ...(row.role ? { role: row.role } : {}),
                ...(row.tvOccupancyRole ? { tvOccupancyRole: row.tvOccupancyRole } : {}),
                ...(row.light ? { light: row.light } : {}),
                ...(row.climate ? { climate: row.climate } : {}),
              })
            : "not selected";
        notes.push(`Taxis ${area.name} ${a?.entityId ?? b?.entityId}: ${show(a)} → ${show(b)}`);
      }
    }
  }
  const settingDiff = (a: unknown, b: unknown, path: string) => {
    if (same(a, b)) return;
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const left = a as Record<string, unknown>,
        right = b as Record<string, unknown>;
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) settingDiff(left[key], right[key], path ? `${path}.${key}` : key);
      return;
    }
    notes.push(`Taxis ${path}: ${a === undefined ? "default" : JSON.stringify(a)} → ${b === undefined ? "default" : JSON.stringify(b)}`);
  };
  // Include stored overrides too, including area choices and local-only edits.
  settingDiff(before.inventory, after.inventory, "inventory");
  settingDiff(before.parameters, after.parameters, "parameters");
  const oldHelpers = new Map(planHelpers(h, before.inventory, naming).map((row) => [helperKey(row), row]));
  const nextHelpers = new Map(planHelpers(h, after.inventory, naming).map((row) => [helperKey(row), row]));
  for (const key of new Set([...oldHelpers.keys(), ...nextHelpers.keys()])) {
    const old = oldHelpers.get(key);
    const row = nextHelpers.get(key);
    if (!old || !row) {
      const existing = old ?? row!;
      if (h.entities[existing.canonicalId])
        return { error: `The planned members of ${existing.canonicalId} cannot be updated safely from this setting. Review that helper first.` };
      notes.push(`${existing.canonicalId} is not installed; its members will not change in Home Assistant.`);
      continue;
    }
    if (same(old.sources, row.sources)) continue;
    const actual = h.entities[row.canonicalId];
    if (!actual) {
      notes.push(`${row.canonicalId} is not installed; its members will not change in Home Assistant.`);
      continue;
    }
    if (
      row.helper !== "group" ||
      actual.platform !== "group" ||
      !actual.inRegistry ||
      !actual.configEntryId ||
      row.membersUnreadable ||
      old.membersUnreadable ||
      row.status === "conflict"
    )
      return { error: `Cannot safely preview members of ${row.canonicalId}. Review that helper first.` };
    let metadata: { labelId: string; areaIds: string[] } | undefined;
    if (row.areaId) {
      const scope = areaSpace(h, row.areaId);
      if (scope.kind === "conflict") return { error: scope.error };
      if (scope.kind === "space") {
        if (scope.space.blocked) return { error: scope.space.blocked };
        metadata = { labelId: scope.space.id, areaIds: [...scope.space.areaIds] };
        const seen = new Set<string>();
        const belongs = (id: string): boolean => {
          if (seen.has(id)) return false;
          seen.add(id);
          const entity = h.entities[id];
          if (!entity || entity.areaId !== row.areaId) return false;
          if (entity.members.length) return entity.members.every(belongs);
          return true;
        };
        if (!actual.members.every(belongs))
          return { error: `Cannot safely preview ${row.canonicalId}: an existing member is outside this area or cannot be verified.` };
      }
    }
    const removed = new Set(old.sources.filter((x) => !row.sources.includes(x)));
    const added = row.sources.filter((x) => !old.sources.includes(x));
    const members = [...actual.members.filter((x) => !removed.has(x))];
    for (const id of added) if (!members.includes(id)) members.push(id);
    if (!same(actual.members, members))
      inputs.push(
        ...helperChangeInputs({ ...row, status: "update-members", sources: members }).map((input) => (metadata ? { ...input, space: metadata } : input)),
      );
  }

  // Ask the pure planners for desired inputs independently of status; this
  // never fabricates installed state or changes the normal actionable plan.
  // With Spaces configured, an area/Space selection must not silently
  // reconcile the legacy whole-site recipes, which include other Spaces.
  const explicitLegacy = spaces.length === 0 || !same(before.parameters.house, after.parameters.house);
  const cells = (state: Desired) => [
    ...planRecipes(h, state.inventory, naming, state.parameters, installed, [], true),
    ...(explicitLegacy ? planHouseRecipes(h, state.inventory, naming, state.parameters, installed, [], true) : []),
    ...spaces
      .filter((space) => !space.blocked && space.areaIds.length > 0)
      .flatMap((space) => planHouseRecipes(h, state.inventory, naming, state.parameters, installed, [], true, { kind: "space", space })),
  ];
  const beforeCells = new Map(cells(before).map((cell) => [cellKey(cell), cell]));
  const afterCells = cells(after);
  const selected = (cell: RecipeCell) => cell.inputs.find((input) => input.kind === "automation" || input.kind === "script");
  for (const next of afterCells) {
    const old = beforeCells.get(cellKey(next));
    if (!old) continue;
    const oldInput = selected(old);
    const nextInput = selected(next);
    // Rows without an installed automation are not installed by a setting edit.
    const proposed = nextInput ?? oldInput;
    const key = proposed?.kind === "script" ? "script_id" : "automation_id";
    const id = proposed?.fields?.[key];
    const existing = typeof id === "string" ? (proposed?.kind === "script" ? installed.scripts[id] : installed.automations[id]) : null;
    if (!existing) continue;
    if (!oldInput || !nextInput || !oldInput.fields || !nextInput.fields)
      return { error: `${next.areaName}: cannot safely plan ${next.recipe}; a dependency needs review first.` };
    const oldBlueprint = oldInput.fields.use_blueprint as { path?: string; input?: Record<string, unknown> } | undefined;
    const nextBlueprint = nextInput.fields.use_blueprint as { path?: string; input?: Record<string, unknown> } | undefined;
    if (!oldBlueprint?.input || !nextBlueprint?.input) return { error: `${id}: desired recipe inputs could not be compared safely.` };
    // Preserve old drift and update only timers/schedules whose desired values
    // changed with this setting. The preview shows available old values.
    const helperUpdates = (cell: RecipeCell) => cell.inputs.filter((item) => item.kind === "helper" && item.op === "update");
    const oldUpdates = helperUpdates(old);
    const nextUpdates = helperUpdates(next);
    for (const update of nextUpdates) {
      const prior = oldUpdates.find((item) => item.targetId === update.targetId);
      if (!prior || !same(prior.fields, update.fields)) {
        if (!update.targetId || !h.entities[update.targetId]) return { error: `${update.targetId}: the timer or schedule is no longer available.` };
        if (!inputs.some((item) => item.kind === "helper" && item.targetId === update.targetId && same(item.fields, update.fields))) inputs.push(update);
      }
    }
    const keys = new Set([...Object.keys(oldBlueprint.input), ...Object.keys(nextBlueprint.input)]);
    const changed = [...keys].filter((k) => !same(oldBlueprint.input![k], nextBlueprint.input![k]));
    if (!changed.length) continue;
    if (!nextBlueprint.path || existing.path !== nextBlueprint.path || !existing.alias)
      return { error: `${id}: its installed blueprint or alias needs review before applying this setting.` };
    if (old.status === "missing" || next.status === "missing")
      return { error: `${id} needs review before this setting can update it: ${[...new Set([...old.missing, ...next.missing])].join("; ")}` };
    const invalid = validateInput(nextInput);
    if (invalid) return { error: `${id}: ${invalid}` };
    const patched = { ...existing.input };
    for (const field of changed) {
      if (Object.hasOwn(nextBlueprint.input, field)) patched[field] = nextBlueprint.input[field];
      else delete patched[field];
    }
    if (same(existing.input, patched)) continue;
    // Do not silently create or update supporting helpers/blueprints as part of
    // a settings edit. A missing dependency requires explicit review.
    if (next.inputs.some((input) => input.kind === "helper" && input.op === "create"))
      return { error: `${id} needs a missing helper. Install or review it before changing this setting.` };
    inputs.push({ ...nextInput, fields: { ...nextInput.fields, alias: existing.alias, use_blueprint: { path: existing.path, input: patched } } });
  }
  return { inputs, notes };
}
