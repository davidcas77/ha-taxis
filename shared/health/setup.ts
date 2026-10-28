import { canonicalId, HELPERS, hasPendingChange, helperChangeInputs, planHelpers } from "../helpers.ts";
import { CAPABILITY_LABEL, type AreaInventory, type InventoryRow } from "../inventory.ts";
import { ANNOUNCE_SCRIPT_ID, GOODBYE_SCRIPT_ID } from "../blueprints.ts";
import { resolveIn } from "../parameters.ts";
import { automationIdFor, planAnnounce, planRecipes, RECIPE_LABEL, type RecipeInstalled } from "../recipes.ts";
import { HOUSE_AUTOMATION_CODE, planHouseRecipes } from "../recipes-house.ts";
import { SOURCE_UNAVAILABLE_HOURS, type HealthFinding } from "./types.ts";
import { HOUR, timeOf, plural, ageText, names, type Ctx, nameOf, inventoryOf } from "./context.ts";

// ---------------------------------------------------------------------------
// 7: the Taxis model.
// ---------------------------------------------------------------------------

export function setupChecks(c: Ctx, installed: RecipeInstalled | null): HealthFinding[] {
  const out: HealthFinding[] = [];
  const areaName = (id: string) => c.h.areas[id]?.name ?? id;
  const planned = new Map<RecipeInstalled, ReturnType<typeof planRecipes>>();
  const cells = (from: RecipeInstalled) => {
    let list = planned.get(from);
    if (!list) planned.set(from, (list = planRecipes(c.h, c.inventory, c.naming, c.parameters, from, c.changes)));
    return list;
  };

  // Recipes whose installed automation no longer matches what Taxis would write.
  if (installed) {
    for (const cell of cells(installed)) {
      if (cell.status === "out-of-date") {
        out.push({
          id: `setup:recipe:${cell.areaId}:${cell.recipe}`,
          check: "setup",
          severity: "warning",
          area: cell.areaId,
          title: `${areaName(cell.areaId)}: ${RECIPE_LABEL[cell.recipe]} is out of date`,
          detail: `${cell.reasons.join(". ")}.`,
          fix: cell.actionable
            ? { kind: "changes", label: "Update the recipe", inputs: cell.inputs }
            : { kind: "link", label: "Open Recipes", to: { page: "recipes" } },
        });
      }
      // Lights that nothing is in charge of.
      if (cell.recipe === "occupancy" && (cell.status === "ready" || cell.status === "missing")) {
        const lights = inventoryOf(c, cell.areaId).lights.filter((r) => r.counts);
        if (lights.length > 0) {
          out.push({
            id: `setup:occupancy:${cell.areaId}`,
            check: "setup",
            severity: "info",
            area: cell.areaId,
            entities: lights.map((r) => r.entityId),
            entity: lights[0].entityId,
            title: `${areaName(cell.areaId)} has lights but no Occupancy`,
            detail:
              cell.status === "ready"
                ? `${plural(lights.length, "light")} ${lights.length === 1 ? "counts" : "count"} here, and nothing tells the area when it is occupied. The Occupancy recipe can be installed.`
                : `${plural(lights.length, "light")} ${lights.length === 1 ? "counts" : "count"} here, and the area cannot be occupied yet. Missing: ${cell.missing.join("; ")}.`,
            fix:
              cell.status === "ready" && cell.actionable
                ? { kind: "changes", label: "Add Occupancy to changes", inputs: cell.inputs }
                : { kind: "link", label: "Open the area's Capabilities", to: { page: "area", areaId: cell.areaId, tab: "capabilities" } },
          });
        }
      }
    }
  }

  // The announce script, which is for the house; and the recipes that notify, which
  // do it through Home Assistant's own list when no notify service is set.
  if (installed) {
    const announce = planAnnounce(c.h, c.inventory, c.naming, c.parameters, installed, c.changes);
    const scriptThere = Boolean(installed.scripts[ANNOUNCE_SCRIPT_ID]);
    if (announce.status === "out-of-date") {
      out.push({
        id: "setup:announce",
        check: "setup",
        severity: "warning",
        title: "Announce is out of date",
        detail: `${announce.reasons.join(". ")}.`,
        fix: announce.actionable
          ? { kind: "changes", label: "Update the script", inputs: announce.inputs }
          : { kind: "link", label: "Open Recipes", to: { page: "recipes" } },
      });
    } else if (announce.status === "missing" && scriptThere) {
      out.push({
        id: "setup:announce",
        check: "setup",
        severity: "warning",
        title: "Announce cannot work as it is set up",
        detail: `The script script.${ANNOUNCE_SCRIPT_ID} is in Home Assistant, but Taxis would not write it now. Missing: ${announce.missing.join("; ")}.`,
        fix: { kind: "link", label: "Open Recipes", to: { page: "recipes" } },
      });
    }
    // The other recipes of the house (shared/recipes-house.ts).
    const houseCells = planHouseRecipes(c.h, c.inventory, c.naming, c.parameters, installed, c.changes).filter((cell) => cell.recipe !== "announce");
    const houseThere = (recipe: string) =>
      recipe === "goodbye"
        ? Boolean(installed.scripts[GOODBYE_SCRIPT_ID])
        : Boolean(installed.automations[automationIdFor(recipe as "battery_low", HOUSE_AUTOMATION_CODE)]);
    for (const cell of houseCells) {
      if (cell.status === "out-of-date") {
        out.push({
          id: `setup:house:${cell.recipe}`,
          check: "setup",
          severity: "warning",
          title: `${RECIPE_LABEL[cell.recipe]} is out of date`,
          detail: `${cell.reasons.join(". ")}.`,
          fix: cell.actionable
            ? { kind: "changes", label: "Update the recipe", inputs: cell.inputs }
            : { kind: "link", label: "Open Recipes", to: { page: "recipes" } },
        });
      } else if (cell.status === "missing" && houseThere(cell.recipe)) {
        out.push({
          id: `setup:house:${cell.recipe}`,
          check: "setup",
          severity: "warning",
          title: `${RECIPE_LABEL[cell.recipe]} cannot work as it is set up`,
          detail: `It is in Home Assistant, but Taxis would not write it now. Missing: ${cell.missing.join("; ")}.`,
          fix: { kind: "link", label: "Open Recipes", to: { page: "recipes" } },
        });
      }
    }
    const targets = resolveIn(c.parameters, [{ level: "house" }], "notify_targets").value;
    const asking = [
      ...cells(installed)
        .filter(
          (cell) =>
            (cell.recipe === "left_open" || cell.recipe === "appliance_done" || cell.recipe === "leak_alert") &&
            installed.automations[automationIdFor(cell.recipe, c.codes[cell.areaId].code)],
        )
        .map((cell) => `${RECIPE_LABEL[cell.recipe]} in ${areaName(cell.areaId)}`),
      ...houseCells
        .filter((cell) => (cell.recipe === "battery_low" || cell.recipe === "unavailable_watch") && houseThere(cell.recipe))
        .map((cell) => RECIPE_LABEL[cell.recipe]),
    ];
    if (asking.length > 0 && Array.isArray(targets) && targets.length === 0) {
      out.push({
        id: "setup:notify",
        check: "setup",
        severity: "info",
        title: "No notify service is set for the recipes that notify",
        detail: `${names([...new Set(asking)])} installed, and no notify service is set (Parameters, House), so their messages appear only in Home Assistant's own notifications. Taxis can't tell whether a service you add exists.`,
        fix: { kind: "link", label: "Set the notify services", to: { page: "parameters", tab: "house" } },
      });
    }
  }

  // Canonical helpers that something else is sitting on, and the light groups of
  // the floors and the house that lack members.
  for (const row of planHelpers(c.h, c.inventory, c.naming, c.changes)) {
    const spec = HELPERS.find((s) => s.key === row.key)!;
    // Where the helper is: an area, a floor or the house.
    const where = row.level === "area" ? areaName(row.areaId!) : row.level === "floor" ? `“${row.areaName}”` : "the house";
    if (row.status === "update-members" && row.level !== "area" && row.added.length > 0 && !hasPendingChange(row, c.changes)) {
      out.push({
        id: `setup:light-group:${row.floorId ?? "house"}`,
        check: "setup",
        severity: "warning",
        entity: row.canonicalId,
        entities: [row.canonicalId, ...row.added],
        title: `${row.canonicalId} is missing ${plural(row.added.length, "light group")}`,
        detail: `The light group of ${where} should gather ${names(row.sources.map((id) => nameOf(c, id)))}, and it lacks ${names(row.added.map((id) => nameOf(c, id)))}${row.removed.length > 0 ? `; it also has ${names(row.removed.map((id) => nameOf(c, id)))}, which are not among them` : ""}. Turning it on or off leaves ${row.added.length === 1 ? "that group" : "those groups"} as they are.`,
        fix: { kind: "changes", label: "Update the members", inputs: helperChangeInputs(row) },
      });
    }
    if (row.status !== "conflict") continue;
    out.push({
      id: row.level === "area" ? `setup:helper:${row.areaId}:${row.key}` : `setup:helper:${row.level}:${row.floorId ?? "house"}`,
      check: "setup",
      severity: "warning",
      area: row.areaId ?? undefined,
      entity: row.canonicalId,
      title:
        row.level === "area"
          ? `${row.canonicalId} cannot be the ${where} ${spec.label.toLowerCase()} helper`
          : `${row.canonicalId} cannot be the light group of ${where}`,
      detail:
        row.conflict === "not-editable"
          ? `It is a group set up in YAML whose members differ from the ${row.level === "area" ? `${spec.label.toLowerCase()} that count in ${where}` : "light groups it should gather"}, and Taxis can only change a group made in the UI. Edit the file, or pick another name.`
          : `The id is used by “${row.heldByName}”, which is not a ${spec.helper === "group" ? "group" : "min/max"} helper${row.level === "area" ? "" : " of its own"}, so Taxis cannot make the ${row.level === "area" ? "helper" : "group"} there. Pick another ${row.level === "area" ? "name for it" : "floor code or house group name"} in Settings.`,
      fix: { kind: "link", label: row.level === "area" ? "Change the helper names" : "Change the codes", to: { page: "settings" } },
    });
  }

  for (const area of Object.values(c.h.areas)) {
    const code = c.codes[area.id].code;
    // Counted sensors that stopped reporting, sooner than the general check.
    const since = Math.min(SOURCE_UNAVAILABLE_HOURS, c.opts.unavailableHours) * HOUR;
    const upTo = c.opts.unavailableHours * HOUR;
    const down: { row: InventoryRow; ms: number }[] = [];
    const inv = inventoryOf(c, area.id);
    for (const cap of Object.keys(inv) as (keyof AreaInventory)[]) {
      // Area climate reports its own thermostats (check "Climate").
      if (cap === "thermostat" && c.climateAreas.has(area.id)) continue;
      for (const row of inv[cap]) {
        if (!row.counts || !row.flags.includes("unavailable")) continue;
        const t = timeOf(c.states[row.entityId]?.lastChanged);
        if (t === null) continue;
        const ms = c.now - t;
        if (ms >= since && ms < upTo) down.push({ row, ms });
      }
    }
    if (down.length > 0) {
      out.push({
        id: `setup:sources:${area.id}`,
        check: "setup",
        severity: "warning",
        area: area.id,
        entities: down.map((d) => d.row.entityId),
        entity: down[0].row.entityId,
        title: `${area.name} counts on ${plural(down.length, "sensor")} that ${down.length === 1 ? "is" : "are"} not reporting`,
        detail: `${down.map((d) => `${d.row.name} (${CAPABILITY_LABEL[d.row.capability].toLowerCase()}) for ${ageText(d.ms)}`).join(", ")}. The area's recipes cannot see ${down.length === 1 ? "it" : "them"} meanwhile. Entities out for ${plural(c.opts.unavailableHours, "hour")} or more are listed under Not reporting.`,
        fix: { kind: "link", label: "Open the area's Capabilities", to: { page: "area", areaId: area.id, tab: "capabilities" } },
      });
    }

    // The area's own temperature and humidity setting.
    for (const [field, id, spec] of [
      ["temperature_entity_id", area.temperatureEntityId, "temperature"],
      ["humidity_entity_id", area.humidityEntityId, "humidity"],
    ] as const) {
      if (!id || c.exists(id)) continue;
      if (c.changes.some((ch) => ch.kind === "area" && ch.targetId === area.id && field in ch.after)) continue;
      const canonical = canonicalId("sensor", code, c.suffix[spec]);
      const better = c.h.entities[canonical]?.platform === "min_max" ? canonical : null;
      out.push({
        id: `setup:area-sensor:${area.id}:${spec}`,
        check: "setup",
        severity: "warning",
        area: area.id,
        entity: id,
        title: `${area.name}'s ${spec} sensor does not exist`,
        detail: `The area is set to use ${id} for its ${spec}, and Home Assistant has no such entity. ${better ? `${better} is this area's ${spec} helper.` : "Clear the setting or pick a sensor."}`,
        fix: {
          kind: "changes",
          label: better ? `Use ${better}` : "Clear the setting",
          inputs: [{ kind: "area", op: "update", targetId: area.id, fields: { [field]: better } }],
        },
      });
    }
  }
  return out;
}
