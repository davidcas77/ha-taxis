import { automationIdFor } from "../recipes.ts";
import { THERMOSTAT_UNAVAILABLE_MINUTES, type HealthItem, type HealthFinding } from "./types.ts";
import {
  itemKey,
  asItem,
  timeOf,
  plural,
  ageText,
  names,
  type Ctx,
  isTaxisItem,
  enabled,
  areaOf,
  nameOf,
  reached,
  callCollector,
  stringList,
} from "./context.ts";

// ---------------------------------------------------------------------------
// 6b: the thermostats Area climate controls.
// ---------------------------------------------------------------------------

const CLIMATE_SERVICES = new Set([
  "climate.set_temperature",
  "climate.set_hvac_mode",
  "climate.set_preset_mode",
  "climate.turn_on",
  "climate.turn_off",
  "climate.toggle",
  "homeassistant.turn_on",
  "homeassistant.turn_off",
  "homeassistant.toggle",
]);

export function climateChecks(c: Ctx): HealthFinding[] {
  const out: HealthFinding[] = [];
  const areaName = (id: string) => c.h.areas[id]?.name ?? id;

  for (const [areaId, input] of c.climateAreas) {
    // A thermostat that has stopped answering: the area keeps whatever it was last set to.
    const down: { id: string; ms: number | null }[] = [];
    for (const id of stringList(input.climate_entities)) {
      const s = c.states[id];
      if (s && (s.state === "unavailable" || s.state === "unknown")) {
        const t = timeOf(s.lastChanged);
        const ms = t === null ? null : c.now - t;
        if (ms === null || ms >= THERMOSTAT_UNAVAILABLE_MINUTES * 60_000) down.push({ id, ms });
      }
    }
    if (down.length > 0) {
      out.push({
        id: `climate:thermostat:${areaId}`,
        check: "climate",
        severity: "warning",
        area: areaId,
        entity: down[0].id,
        entities: down.map((d) => d.id),
        title: `${areaName(areaId)} has ${plural(down.length, "thermostat")} that ${down.length === 1 ? "is" : "are"} not answering`,
        detail: `${down.map((d) => `${nameOf(c, d.id)}${d.ms === null ? "" : ` for ${ageText(d.ms)}`}`).join(", ")}. Area climate cannot set ${down.length === 1 ? "it" : "them"} meanwhile, and ${down.length === 1 ? "it keeps" : "they keep"} the last setpoint. Check the batteries, the hub or the integration.`,
        fix: { kind: "link", label: "Open the area's Capabilities", to: { page: "area", areaId, tab: "capabilities" } },
      });
    }

    // No temperature reference: a thermostat is switched on again without looking at the room.
    if (typeof input.temperature_entity !== "string" || input.temperature_entity === "") {
      out.push({
        id: `climate:reference:${areaId}`,
        check: "climate",
        severity: input.auto_hvac_on === true ? "warning" : "info",
        area: areaId,
        title: `${areaName(areaId)} has Area climate but no temperature reference`,
        detail: `The area has no temperature helper, so ${
          input.auto_hvac_on === true
            ? "a thermostat that is off is switched on again without checking whether the room needs it"
            : "nothing can tell Area climate how warm the room is, and a thermostat that takes an outside sensor has none to take"
        }. The helper averages the area's temperature sensors; make it on the Helpers tab.`,
        fix: { kind: "link", label: "Open Helpers", to: { page: "parameters", tab: "helpers" } },
      });
    }
  }

  // Other automations that set the same thermostats. Only where Area climate is one
  // of the controllers: its target is worked out again at every change and would be
  // undone by, or would undo, theirs.
  const callsOf = callCollector(c);
  const controllers = new Map<string, Set<string>>();
  const taxis = new Set<string>();
  for (const item of c.readable.filter((i) => i.kind === "automation" && enabled(c, i))) {
    const key = itemKey(item);
    const set = new Set<string>();
    const area = [...c.climateAreas.keys()].find((a) => item.id === automationIdFor("area_climate", c.codes[a].code));
    if (area !== undefined) {
      for (const id of stringList(c.climateAreas.get(area)!.climate_entities)) set.add(id);
      taxis.add(key);
    } else if (!isTaxisItem(item)) {
      for (const call of callsOf(item)) if (CLIMATE_SERVICES.has(call.service)) for (const id of reached(c, call, "climate")) set.add(id);
    }
    for (const id of set) controllers.set(id, (controllers.get(id) ?? new Set<string>()).add(key));
  }
  const groups = new Map<string, { controllers: string[]; thermostats: string[] }>();
  for (const [id, who] of controllers) {
    if (who.size < 2 || ![...who].some((k) => taxis.has(k))) continue;
    const list = [...who].sort();
    const g = groups.get(list.join("+")) ?? { controllers: list, thermostats: [] };
    g.thermostats.push(id);
    groups.set(list.join("+"), g);
  }
  for (const [key, g] of groups) {
    const thermostats = g.thermostats.sort((a, b) => nameOf(c, a).localeCompare(nameOf(c, b)) || a.localeCompare(b));
    const items = g.controllers.map((k) => c.readable.find((i) => itemKey(i) === k)!);
    const areas = new Set(thermostats.map((id) => areaOf(c, id) ?? ""));
    const label = (i: HealthItem) => `${i.name}${taxis.has(itemKey(i)) ? " (Taxis recipe)" : ""}`;
    out.push({
      id: `climate:competing:${key}`,
      check: "climate",
      severity: "warning",
      area: areas.size === 1 && [...areas][0] ? [...areas][0] : undefined,
      entity: thermostats[0],
      entities: thermostats,
      item: asItem(items[0]),
      title: `${items.length} automations set ${nameOf(c, thermostats[0])}${thermostats.length > 1 ? ` and ${plural(thermostats.length - 1, "other thermostat")}` : ""}`,
      detail: `${names(items.map(label))} ${items.length === 2 ? "both" : "all"} set the same thermostats: ${names(thermostats.map((id) => nameOf(c, id)))}. Area climate works out the target again at every change of the area, so they can undo each other. Scripts they call count. Keep one automation in charge of these thermostats.`,
    });
  }
  return out;
}
