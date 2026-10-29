import { emptyRange, gatingConditions, stateConditions } from "../health-scan.ts";
import { type HealthFinding } from "./types.ts";
import { itemKey, itemName, asItem, plural, names, type Ctx, isTaxisItem, enabled, areaOf, nameOf, unreadableNote, type Writers } from "./context.ts";

// ---------------------------------------------------------------------------
// 1 and 4: references to entities that do not exist, and conditions that can
// never pass.
// ---------------------------------------------------------------------------

export function referenceChecks(c: Ctx, w: Writers): HealthFinding[] {
  const out: HealthFinding[] = [];
  for (const item of c.readable) {
    // The recipes' own automations are checked with the recipes (Taxis setup).
    if (isTaxisItem(item)) continue;
    const key = itemKey(item);
    const area = areaOf(c, item.entityId);
    const live = enabled(c, item);

    // 4: conditions that gate the whole run and can never be true.
    const dead = new Set<string>();
    const why: string[] = [];
    if (item.kind === "automation" || item.kind === "script") {
      for (const cond of gatingConditions(item.config, c.domains)) {
        const gone = [...cond.entityIds, ...cond.limitIds].filter((id) => !c.exists(id));
        for (const id of gone) {
          dead.add(id);
          why.push(`The ${cond.condition === "state" ? "state" : "numeric"} condition uses ${id}, which does not exist, so it is always false.`);
        }
        const range = emptyRange(cond);
        if (range) why.push(`A numeric condition needs a value above ${range.above} and below ${range.below}, which no value is.`);
      }
      if (why.length > 0) {
        out.push({
          id: `conditions:${key}:never`,
          check: "conditions",
          severity: live ? "error" : "warning",
          area,
          entity: [...dead][0],
          entities: dead.size > 0 ? [...dead].sort() : undefined,
          item: asItem(item),
          title: `${itemName(item)} has a condition that can never pass`,
          detail: `${why.join(" ")} ${item.kind === "automation" ? "It never gets as far as its actions." : "The script stops at that step."}`,
        });
      }
    }

    // 1: everything else it uses that is not there.
    const missing = [...(c.refs.get(key) ?? [])].filter((id) => !c.exists(id) && !dead.has(id)).sort();
    if (missing.length > 0) {
      out.push({
        id: `references:${key}`,
        check: "references",
        severity: (item.kind === "automation" || item.kind === "script") && live ? "error" : "warning",
        area,
        entity: missing[0],
        entities: missing,
        item: asItem(item),
        title: `${itemName(item)} uses ${plural(missing.length, "entity", "entities")} that ${missing.length === 1 ? "does" : "do"} not exist`,
        detail: `Not in Home Assistant: ${missing.join(", ")}. ${
          item.kind === "dashboard" ? "The card shows an error." : item.kind === "scene" ? "The scene skips them." : "Whatever depends on them cannot work."
        } Pick the entity it should use now, or take it out.`,
      });
    }

    // 4: a state condition on a switch nothing changes.
    if (item.kind === "automation" || item.kind === "script") {
      const byHand = new Set<string>();
      for (const cond of stateConditions(item.config, c.domains)) {
        for (const id of cond.entityIds) {
          if (!id.startsWith("input_boolean.") || !c.exists(id) || c.taxisIds.has(id) || w.on.has(id) || w.off.has(id) || w.dynamicOn || w.dynamicOff) continue;
          byHand.add(id);
        }
      }
      if (byHand.size > 0) {
        const ids = [...byHand].sort();
        out.push({
          id: `conditions:${key}:by-hand`,
          check: "conditions",
          severity: "info",
          area,
          entity: ids[0],
          entities: ids,
          item: asItem(item),
          title: `${itemName(item)} tests a switch only a person changes`,
          detail: `${names(ids.map((id) => nameOf(c, id)))} ${ids.length === 1 ? "is" : "are"} never turned on or off by any automation, script or scene Taxis can read, so ${ids.length === 1 ? "it" : "they"} can only be changed by hand (a dashboard, a voice command, Home Assistant).${unreadableNote(c)}`,
        });
      }
    }
  }
  return out;
}
