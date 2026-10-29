import { isSilentGroup } from "../entity-diagnosis.ts";
import { hasPendingChange, helperChangeInputs, planHelpers } from "../helpers.ts";
import { type HealthFinding } from "./types.ts";
import { plural, names, type Ctx } from "./context.ts";

// ---------------------------------------------------------------------------
// 2b: groups that point at entities that don't exist.
// ---------------------------------------------------------------------------

// A group helper whose members were renamed or removed. A group that is
// unavailable reports no members at all, so one of those is told by its platform:
// its members can't be listed, and it is unavailable because none of them is
// there. An area's own group (<code>_all) gets its members fixed in one change.
export function groupChecks(c: Ctx): HealthFinding[] {
  const plan = new Map(
    planHelpers(c.h, c.inventory, c.naming, c.changes)
      .filter((r) => r.status === "update-members")
      .map((r) => [r.canonicalId, r]),
  );
  const out: HealthFinding[] = [];
  for (const e of Object.values(c.h.entities)) {
    if (e.disabled) continue;
    const missing = e.members.filter((m) => !c.h.entities[m]);
    const silent = isSilentGroup(e);
    if (missing.length === 0 && !silent) continue;
    const row = plan.get(e.entityId);
    // The fix is already in the change list.
    if (row && hasPendingChange(row, c.changes)) continue;
    const all = missing.length === e.members.length;
    out.push({
      id: `groups:${e.entityId}`,
      check: "groups",
      severity: "warning",
      area: e.areaId ?? undefined,
      entity: e.entityId,
      entities: [e.entityId, ...missing],
      title: silent
        ? `${e.name} is unavailable and its members can't be read`
        : `${e.name} points at ${plural(missing.length, "entity", "entities")} that ${missing.length === 1 ? "doesn't" : "don't"} exist`,
      detail: silent
        ? `Home Assistant reports no members for a group while it is unavailable, and a group goes unavailable when none of its members is, so they are probably all gone (renamed or removed). Open the helper and pick the entities that exist now.`
        : `${names(missing)} ${missing.length === 1 ? "is" : "are"} not in Home Assistant${all ? ", so nothing in the group works" : `, so the group follows ${plural(e.members.length - missing.length, "entity", "entities")} only`}. A member that was renamed has to be replaced in the group; Home Assistant does not do it.${row ? ` Taxis can give it the ${plural(row.sources.length, "entity", "entities")} the area counts now.` : ""}`,
      fix: row
        ? { kind: "changes", label: "Fix in Taxis: use the area's current ones", inputs: helperChangeInputs(row) }
        : { kind: "link", label: "Fix in Taxis", to: { page: "parameters", tab: "helpers" } },
    });
  }
  return out;
}
