// Health: rule-based checks over what Taxis already reads, to find what is broken
// or has been forgotten. No AI. Pure functions: the server gathers a snapshot
// (the hierarchy, the stored configs of automations, scripts, scenes and
// dashboards, the live states) and this turns it into findings. Nothing here
// reads or writes Home Assistant, and a finding never changes anything: a fix is
// either a link to the place in Taxis that deals with it or a change (of a kind
// that already exists) for the user to add to the change list.
//
// One file per family of checks; this one runs them all and builds the report.

import { type RefKind } from "../types.ts";
import { HEALTH_CHECKS, type HealthCheck, type Severity, type HealthInput, type HealthFinding, type HealthReport } from "./types.ts";
import { RANK, plural, context, writers } from "./context.ts";
import { referenceChecks } from "./references.ts";
import { unavailableChecks } from "./unavailable.ts";
import { groupChecks } from "./groups.ts";
import { activityChecks } from "./activity.ts";
import { switchChecks } from "./switches.ts";
import { lightChecks } from "./lights.ts";
import { climateChecks } from "./climate.ts";
import { setupChecks } from "./setup.ts";
import { placementChecks } from "./placement.ts";
import { helperChecks } from "./unused-helpers.ts";
import { deviceChecks } from "./devices.ts";
import { buttonChecks, conflictChecks, idChecks, peopleChecks, startupChecks } from "./automations.ts";

export * from "./types.ts";
export { ageText, healthOptions } from "./context.ts";

// ---------------------------------------------------------------------------
// Everything.
// ---------------------------------------------------------------------------

const CHECK_ORDER = HEALTH_CHECKS.map((x) => x.key) as readonly HealthCheck[];

export function runHealth(input: HealthInput): HealthReport {
  const c = context(input);
  const w = writers(c);
  const findings = [
    ...referenceChecks(c, w),
    ...unavailableChecks(c),
    ...groupChecks(c),
    ...activityChecks(c),
    ...switchChecks(c, w),
    ...lightChecks(c),
    ...climateChecks(c),
    ...setupChecks(c, input.snapshot.installed),
    ...placementChecks(c),
    ...helperChecks(c),
    ...deviceChecks(c),
    ...startupChecks(c),
    ...conflictChecks(c),
    ...buttonChecks(c),
    ...idChecks(c),
    ...peopleChecks(c),
  ].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      CHECK_ORDER.indexOf(a.check) - CHECK_ORDER.indexOf(b.check) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );

  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  const byCheck = Object.fromEntries(HEALTH_CHECKS.map((x) => [x.key, 0])) as Record<HealthCheck, number>;
  for (const f of findings) {
    counts[f.severity] += 1;
    byCheck[f.check] += 1;
  }

  const notes = [...input.snapshot.notes];
  if (!input.snapshot.installed) notes.push("Taxis could not read the recipes' blueprints, so the recipe checks were skipped.");
  const yaml = c.unreadable.length;
  if (yaml > 0)
    notes.push(`${plural(yaml, "automation, script or scene")} could not be read (written in YAML, or unreadable), so what they use was not checked.`);

  const count = (kind: RefKind) => c.items.filter((i) => i.kind === kind).length;
  return {
    generatedAt: new Date(input.now).toISOString(),
    readAt: c.h.fetchedAt,
    options: c.opts,
    findings,
    counts,
    byCheck,
    checked: {
      entities: Object.keys(c.h.entities).length,
      automations: count("automation"),
      scripts: count("script"),
      scenes: count("scene"),
      dashboards: count("dashboard"),
      unreadable: yaml,
    },
    notes,
  };
}

// The findings that belong to one area, in the order they came.
export const findingsForArea = (report: HealthReport, areaId: string): HealthFinding[] => report.findings.filter((f) => f.area === areaId);
