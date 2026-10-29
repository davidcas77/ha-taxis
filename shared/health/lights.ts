import { entityIdsIn } from "../health-scan.ts";
import { type HealthItem, type HealthFinding } from "./types.ts";
import { isObject, itemKey, asItem, plural, names, type Ctx, isTaxisItem, enabled, areaOf, nameOf, reached, callCollector } from "./context.ts";

// ---------------------------------------------------------------------------
// 6: several automations switching the same lights.
// ---------------------------------------------------------------------------

const LIGHT_SERVICES = new Set(["light.turn_on", "light.turn_off", "light.toggle", "homeassistant.turn_on", "homeassistant.turn_off", "homeassistant.toggle"]);

// The lights a light entity stands for: itself, and the members if it is a group.
function lightsBehind(c: Ctx, id: string, seen = new Set<string>()): string[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const e = c.h.entities[id];
  return [id, ...(e?.members ?? []).filter((m) => m.startsWith("light.")).flatMap((m) => lightsBehind(c, m, seen))];
}

export function lightChecks(c: Ctx): HealthFinding[] {
  const callsOf = callCollector(c);

  const controllers = new Map<string, Set<string>>();
  const automations = c.readable.filter((i) => i.kind === "automation" && enabled(c, i));
  for (const item of automations) {
    const key = itemKey(item);
    const lights = new Set<string>();
    if (isTaxisItem(item)) {
      // The recipes' automations take their lights as blueprint inputs.
      const input = isObject(item.config) && isObject(item.config.use_blueprint) ? item.config.use_blueprint.input : undefined;
      if (isObject(input)) {
        for (const k of ["light_target", "entry_lights", "main_lights", "accent_lights", "night_lights"]) {
          for (const id of entityIdsIn(input[k], c.domains)) if (id.startsWith("light.")) for (const l of lightsBehind(c, id)) lights.add(l);
        }
      }
    } else {
      for (const call of callsOf(item)) {
        if (!LIGHT_SERVICES.has(call.service)) continue;
        for (const id of reached(c, call, "light")) for (const l of lightsBehind(c, id)) lights.add(l);
      }
    }
    for (const l of lights) controllers.set(l, (controllers.get(l) ?? new Set<string>()).add(key));
  }

  // Lights with the same controllers are one finding.
  const groups = new Map<string, { controllers: string[]; lights: string[] }>();
  for (const [light, who] of controllers) {
    if (who.size < 2) continue;
    const list = [...who].sort();
    const g = groups.get(list.join("+")) ?? { controllers: list, lights: [] };
    g.lights.push(light);
    groups.set(list.join("+"), g);
  }

  const out: HealthFinding[] = [];
  for (const [key, g] of groups) {
    const lights = g.lights.sort((a, b) => nameOf(c, a).localeCompare(nameOf(c, b)) || a.localeCompare(b));
    // The group first: it names what the controllers have in common best.
    const lead = lights.find((id) => (c.h.entities[id]?.members.length ?? 0) > 0) ?? lights[0];
    const items = g.controllers.map((k) => c.readable.find((i) => itemKey(i) === k)!);
    const areas = new Set(lights.map((id) => areaOf(c, id) ?? ""));
    const label = (i: HealthItem) => `${i.name}${isTaxisItem(i) ? " (Taxis recipe)" : ""}`;
    out.push({
      id: `lights:${key}`,
      check: "lights",
      severity: "warning",
      area: areas.size === 1 && [...areas][0] ? [...areas][0] : undefined,
      entity: lead,
      entities: lights,
      item: asItem(items[0]),
      title: `${items.length} automations switch ${nameOf(c, lead)}${lights.length > 1 ? ` and ${plural(lights.length - 1, "other light")}` : ""}`,
      detail: `${names(items.map(label))} ${items.length === 2 ? "both" : "all"} turn the same lights on or off: ${names(lights.map((id) => nameOf(c, id)))}. They can undo each other. Scripts they call count. Keep one automation in charge of these lights, or make the others wait for it.`,
    });
  }
  return out;
}
