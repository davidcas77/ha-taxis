import { type HealthFinding } from "./types.ts";
import { DAY, asItem, timeOf, plural, ageText, type Ctx } from "./context.ts";

// ---------------------------------------------------------------------------
// 3: automations that are off, never fired, or have not fired for a while.
// ---------------------------------------------------------------------------

export function activityChecks(c: Ctx): HealthFinding[] {
  const out: HealthFinding[] = [];
  const limit = c.opts.staleDays * DAY;
  for (const e of Object.values(c.h.entities)) {
    if (e.domain !== "automation" || e.disabled) continue;
    const st = c.states[e.entityId];
    if (!st) continue;
    const item = c.byEntity.get(e.entityId);
    const ref = item ? asItem(item) : { kind: "automation" as const, id: e.entityId, name: e.name, entityId: e.entityId };
    const base = { check: "activity" as const, area: e.areaId ?? undefined, entity: e.entityId, item: ref };
    if (st.state === "off") {
      out.push({
        ...base,
        id: `activity:${e.entityId}:off`,
        severity: "info",
        title: `Automation “${e.name}” is turned off`,
        detail: "It does nothing while it is off. Turn it on in Home Assistant, or delete it if it is no longer needed.",
      });
    } else if (st.state === "on") {
      const last = timeOf(st.lastTriggered);
      if (last === null) {
        out.push({
          ...base,
          id: `activity:${e.entityId}:never`,
          severity: "info",
          title: `Automation “${e.name}” has never fired`,
          detail:
            "Home Assistant has no record of it running. It may be new, or what triggers it may never happen (a sensor that is gone, a condition that is never met).",
        });
      } else if (c.now - last > limit) {
        out.push({
          ...base,
          id: `activity:${e.entityId}:stale`,
          severity: "warning",
          title: `Automation “${e.name}” has not fired for ${ageText(c.now - last)}`,
          detail: `It last ran on ${new Date(last).toISOString().slice(0, 10)}. Anything not seen for ${plural(c.opts.staleDays, "day")} is listed.`,
        });
      }
    }
  }
  return out;
}
