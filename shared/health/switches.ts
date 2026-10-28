import { type HealthFinding } from "./types.ts";
import { names, type Ctx, unreadableNote, type Writers, itemNames } from "./context.ts";

// ---------------------------------------------------------------------------
// 5: switches only ever turned one way.
// ---------------------------------------------------------------------------

export function switchChecks(c: Ctx, w: Writers): HealthFinding[] {
  const out: HealthFinding[] = [];
  for (const e of Object.values(c.h.entities)) {
    if (e.domain !== "input_boolean" || e.disabled || c.taxisIds.has(e.entityId)) continue;
    const on = w.on.get(e.entityId);
    const off = w.off.get(e.entityId);
    const [turned, other, dynamic] =
      on && !off ? (["on", "off", w.dynamicOff] as const) : off && !on ? (["off", "on", w.dynamicOn] as const) : ([null, null, false] as const);
    if (!turned || dynamic) continue;
    const by = itemNames(c, (turned === "on" ? on : off)!);
    out.push({
      id: `switches:${e.entityId}:${turned}-only`,
      check: "switches",
      severity: "warning",
      area: e.areaId ?? undefined,
      entity: e.entityId,
      title: `${e.name} is turned ${turned} but never ${other}`,
      detail: `Turned ${turned} by ${names(by)}. Nothing Taxis can read turns it ${other}, so once it is ${turned} it stays ${turned} until someone changes it by hand.${unreadableNote(c)}`,
    });
  }
  return out;
}
