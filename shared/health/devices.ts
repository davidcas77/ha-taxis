import { deviceUses } from "../health-scan.ts";
import { type HealthFinding } from "./types.ts";
import { entityEquivalents } from "./automations.ts";
import { itemKey, itemName, asItem, plural, names, type Ctx, areaOf } from "./context.ts";

// ---------------------------------------------------------------------------
// 9: device-based triggers, conditions and actions.
// ---------------------------------------------------------------------------

export function deviceChecks(c: Ctx): HealthFinding[] {
  const out: HealthFinding[] = [];
  for (const item of c.readable) {
    if (item.kind !== "automation" && item.kind !== "script") continue;
    const uses = deviceUses(item.config);
    if (uses.length === 0) continue;
    const ids = [...new Set(uses.map((u) => u.deviceId))].sort();
    const gone = ids.filter((id) => !c.h.devices[id]);
    const sections = (["triggers", "conditions", "actions"] as const)
      .map((s) => ({ s, n: uses.filter((u) => u.section === s).length }))
      .filter((x) => x.n > 0)
      .map((x) => `${plural(x.n, x.s.slice(0, -1))} in ${x.s}`);
    const devices = ids.map((id) => c.h.devices[id]?.name ?? `${id} (not in Home Assistant)`);
    const equivalents = entityEquivalents(c, item.config);
    out.push({
      id: `devices:${itemKey(item)}`,
      check: "devices",
      severity: gone.length > 0 ? "warning" : "info",
      area: areaOf(c, item.entityId),
      item: asItem(item),
      title: `${itemName(item)} is tied to ${plural(ids.length, "device")} by id`,
      detail: `${sections.join(", ")}: ${names(devices)}. ${
        gone.length > 0 ? "Some of these devices are not in Home Assistant any more. " : ""
      }A device id changes when the device is removed and added again, and the automation stops working. Entity-based triggers and actions survive that.${
        equivalents.length > 0
          ? ` These do the same by entity, and keep working if the device is re-paired: ${equivalents.map((e) => `${e.device} → ${names(e.entities)}`).join("; ")}.`
          : ""
      }`,
    });
  }
  return out;
}
