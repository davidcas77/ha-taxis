import { CAPABILITY_LABEL, type AreaInventory } from "../inventory.ts";
import { type EntityItem } from "../types.ts";
import { type Severity, type HealthItem, type HealthFinding } from "./types.ts";
import { HOUR, itemKey, itemName, bump, timeOf, ageText, names, type Ctx, inventoryOf } from "./context.ts";

// ---------------------------------------------------------------------------
// 2: entities that have not reported for a long time.
// ---------------------------------------------------------------------------

// Entities whose state is often unknown without anything being wrong.
const QUIET_DOMAINS = new Set(["button", "input_button", "event", "scene", "tts", "stt", "notify", "wake_word", "conversation", "ai_task"]);

type Out = { entity: EntityItem; since: number; ms: number };

export function unavailableChecks(c: Ctx): HealthFinding[] {
  const threshold = c.opts.unavailableHours * HOUR;
  const groups = new Map<string, { label: string; areaId: string | null; out: Out[] }>();
  for (const e of Object.values(c.h.entities)) {
    if (e.disabled || QUIET_DOMAINS.has(e.domain)) continue;
    const state = c.stateOf(e.entityId);
    if (state !== "unavailable" && state !== "unknown") continue;
    const since = timeOf(c.states[e.entityId]?.lastChanged);
    if (since === null || c.now - since < threshold) continue;
    const device = e.deviceId ? c.h.devices[e.deviceId] : undefined;
    if (device?.disabled) continue;
    const key = device ? `device:${device.id}` : `entity:${e.entityId}`;
    const g = groups.get(key) ?? { label: device ? device.name : e.name, areaId: device?.areaId ?? e.areaId, out: [] };
    g.out.push({ entity: e, since, ms: c.now - since });
    groups.set(key, g);
  }

  const out: HealthFinding[] = [];
  for (const [key, g] of groups) {
    g.out.sort((a, b) => a.entity.name.localeCompare(b.entity.name) || a.entity.entityId.localeCompare(b.entity.entityId));
    const ids = g.out.map((o) => o.entity.entityId);
    const gone = g.out.some((o) => c.stateOf(o.entity.entityId) === "unavailable");
    // Used by something that runs: one level up.
    const users = new Map<string, HealthItem>();
    for (const id of ids) for (const i of c.usedBy.get(id) ?? []) if (i.kind !== "dashboard") users.set(itemKey(i), i);
    const dashboards = new Set<string>();
    for (const id of ids) for (const i of c.usedBy.get(id) ?? []) if (i.kind === "dashboard") dashboards.add(itemName(i));
    const base: Severity = gone ? "warning" : "info";
    const severity = users.size > 0 ? bump(base) : base;
    const shortest = Math.min(...g.out.map((o) => o.ms));

    const lines = g.out.map((o) => {
      const counted = countedAs(c, o.entity);
      return `${o.entity.name} (${o.entity.entityId}) has been ${c.stateOf(o.entity.entityId)} for ${ageText(o.ms)}${c.states[o.entity.entityId]?.restored ? ", and its integration no longer provides it" : ""}${counted ? `; counts as ${counted}` : ""}`;
    });
    const usedLine = users.size > 0 ? ` Used by ${names([...users.values()].map(itemName).sort())}.` : "";
    const dashLine = dashboards.size > 0 ? ` On ${names([...dashboards].sort())}.` : "";
    out.push({
      id: `unavailable:${key}`,
      check: "unavailable",
      severity,
      area: g.areaId ?? undefined,
      entity: ids[0],
      entities: ids,
      title: `${g.label} has not reported for ${ageText(shortest)}`,
      detail: `${lines.join(". ")}.${usedLine}${dashLine}`,
    });
  }
  return out;
}

// "a Motion sensor in the Hallway", for an entity an area counts.
function countedAs(c: Ctx, e: EntityItem): string | null {
  if (!e.areaId) return null;
  const inv = inventoryOf(c, e.areaId);
  for (const cap of Object.keys(inv) as (keyof AreaInventory)[]) {
    if (inv[cap].some((r) => r.entityId === e.entityId && r.counts))
      return `${CAPABILITY_LABEL[cap].toLowerCase()} in ${c.h.areas[e.areaId]?.name ?? e.areaId}`;
  }
  return null;
}
