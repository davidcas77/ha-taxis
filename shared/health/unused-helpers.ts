import { type HealthFinding } from "./types.ts";
import { type Ctx, unreadableNote } from "./context.ts";

// ---------------------------------------------------------------------------
// 8: helpers nothing uses.
// ---------------------------------------------------------------------------

const HELPER_DOMAINS = new Set([
  "input_boolean",
  "input_number",
  "input_select",
  "input_text",
  "input_datetime",
  "input_button",
  "counter",
  "timer",
  "schedule",
]);
const HELPER_PLATFORMS = new Set([
  "template",
  "group",
  "min_max",
  "threshold",
  "derivative",
  "statistics",
  "bayesian",
  "trend",
  "filter",
  "utility_meter",
  "integration",
  "history_stats",
]);

export function helperChecks(c: Ctx): HealthFinding[] {
  // Everything that points at an entity: configs, the members of groups, and the
  // temperature and humidity sensors the areas use.
  const used = new Set<string>();
  for (const ids of c.refs.values()) for (const id of ids) used.add(id);
  for (const e of Object.values(c.h.entities)) for (const m of e.members) used.add(m);
  for (const a of Object.values(c.h.areas)) for (const id of [a.temperatureEntityId, a.humidityEntityId]) if (id) used.add(id);

  const out: HealthFinding[] = [];
  for (const e of Object.values(c.h.entities)) {
    const helper = HELPER_DOMAINS.has(e.domain) || (e.configEntryId !== null && HELPER_PLATFORMS.has(e.platform));
    if (!helper || e.disabled || used.has(e.entityId) || c.taxisIds.has(e.entityId)) continue;
    out.push({
      id: `helpers:${e.entityId}`,
      check: "helpers",
      severity: "info",
      area: e.areaId ?? undefined,
      entity: e.entityId,
      title: `${e.name} is not used by anything Taxis can read`,
      detail: `No automation, script, scene, dashboard or group uses ${e.entityId}. A template or a YAML package that Taxis cannot read may still use it, so check before removing it.${unreadableNote(c)}`,
    });
  }
  return out;
}
