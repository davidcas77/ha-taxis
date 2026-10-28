import { Hono } from "hono";

import { closureFor } from "../../shared/apply-plan.ts";
import type { ApplyResponse, ApplyResult, Change } from "../../shared/types.ts";
import { applyAll } from "../changes/all.ts";
import { applyPreflight } from "../changes/preflight.ts";
import type { AppContext } from "../context.ts";
import { ConfigCache } from "../ha/reader.ts";
import { FULL_READ, READS, type ReadScope } from "../ha/registry.ts";

// Only these need the naming preflight (they name helpers after area codes).
const NEEDS_PREFLIGHT = new Set(["helper", "automation", "script"]);

// The most changes one Apply may name with `only`.
const MAX_ONLY = 500;

type ApplyBody = { allowWithoutBackup?: boolean; version?: unknown; only?: unknown };

// `only` is a non-empty list of change ids, none repeated beyond reason.
function validOnly(only: unknown): only is number[] {
  return Array.isArray(only) && only.length > 0 && only.length <= MAX_ONLY && only.every((n) => Number.isInteger(n));
}

// POST /api/apply: the one route that writes to Home Assistant.
//
//   1. take the Apply lock (one at a time, and no edits while it runs);
//   2. check the list is the one the user confirmed (`version`), and which part
//      of it `only` asks for;
//   3. preflight the naming, so nothing is written under ambiguous area codes;
//   4. make a Supervisor backup (required in app mode, explicit in dev mode);
//   5. apply, in the order changes/all.ts documents;
//   6. let the finished changes leave the list, drop every cache, and read Home
//      Assistant once more, so the next view is current and a snapshot is kept.
export function applyRoutes(ctx: AppContext): Hono {
  const { reader, changes, history, settings, logger, ha, rest, target, mode, clock } = ctx;
  const app = new Hono();

  app.post("/apply", async (c) => {
    if (!ha || !rest || !target.ok) {
      return c.json<ApplyResponse>({ ok: false, error: ctx.notConfigured }, 503);
    }
    if (reader.isApplying()) return c.json<ApplyResponse>({ ok: false, error: "Changes are already being applied." }, 409);
    // The body is read before the lock is taken; check the lock again after it.
    const body = (await c.req.json().catch(() => ({}))) as ApplyBody;
    if (reader.isApplying()) return c.json<ApplyResponse>({ ok: false, error: "Changes are already being applied." }, 409);

    // Apply exactly the list the user confirmed: if anything in it changed since
    // (another tab, another device, an edit folded into a change), they must look
    // again.
    // With `only`, just those changes and the ones they need (shared/apply-plan.ts),
    // through the same steps and in the same order as the whole list.
    const everything = changes.list();
    if (body.only !== undefined && !validOnly(body.only)) {
      return c.json<ApplyResponse>({ ok: false, error: "The changes to apply weren't readable." }, 400);
    }
    const pending: Change[] = body.only === undefined ? everything : closureFor(everything, body.only as number[]);
    if (pending.length === 0) return c.json<ApplyResponse>({ ok: false, error: "There are no changes to apply." }, 400);
    if (body.version !== changes.version()) {
      return c.json<ApplyResponse>({ ok: false, error: "The list of changes changed since you looked at it. Check it again, then apply." }, 409);
    }

    if (!reader.tryBeginApply()) return c.json<ApplyResponse>({ ok: false, error: "Changes are already being applied." }, 409);
    let runId: number | null = null;
    try {
      runId = history.begin(pending);

      if (pending.some((change) => NEEDS_PREFLIGHT.has(change.kind))) {
        const raw = await reader.readParts(READS.hierarchy);
        const error = applyPreflight(raw, pending, settings.naming());
        if (error) {
          history.finish(runId, [], error, false);
          return c.json<ApplyResponse>({ ok: false, error }, 409);
        }
      }

      // Backup first. Inside Home Assistant it's required: no backup, no changes.
      // In development there's no Supervisor, so applying needs an explicit OK.
      let backup: ApplyResult["backup"];
      if (mode === "app") {
        const name = `Taxis before applying ${pending.length} change${pending.length === 1 ? "" : "s"}`;
        logger.info(`Making a backup: ${name}`);
        const made = await ctx.backup(name);
        if (!made.ok) {
          history.finish(runId, [], `Backup failed; nothing was changed. ${made.reason}`, false);
          logger.error("Backup failed, nothing was applied", made.reason);
          return c.json<ApplyResponse>({ ok: false, error: `Nothing was changed. ${made.reason}` }, 502);
        }
        backup = { made: true, name, slug: made.slug };
      } else if (body.allowWithoutBackup) {
        backup = { made: false, reason: "Running outside Home Assistant, so no backup was possible." };
      } else {
        history.finish(runId, [], "Development Apply requires explicit confirmation without a backup; nothing was changed.", false);
        return c.json<ApplyResponse>({ ok: false, error: "Outside Home Assistant, Taxis can't make a backup. Confirm to apply without one." }, 409);
      }

      history.backup(runId, backup);
      logger.info(`Applying ${pending.length} change(s) to Home Assistant`);

      // Configs read during this Apply are shared between its steps (the rename
      // step reads every automation; the button step wants the same ones) and
      // forgotten as soon as Apply itself writes them. Verification never uses
      // this cache: it reads Home Assistant through `rest`.
      const configs = new ConfigCache(rest, clock, Number.POSITIVE_INFINITY);
      const outcome = await applyAll(pending, {
        ha,
        rest: configs.observing(rest),
        configReads: configs.view(),
        // Each check reads only what it looks at (registry.ts).
        readFresh: (scope?: ReadScope) => reader.readParts(scope ?? FULL_READ),
      });
      const { results } = outcome;
      const appliedIds = results.filter((r) => r.ok).map((r) => r.changeId);
      for (const r of results) {
        const change = pending.find((x) => x.id === r.changeId)!;
        const line = `${change.op} ${change.kind} ${change.targetId}: ${r.message}`;
        if (r.ok) logger.info(line);
        else logger.error(line);
        for (const d of r.details ?? []) logger.info(`  ${d}`);
      }
      // Done changes leave the list; the rest stay. Creations that happened hand
      // their real ids to the changes still pointing at them.
      changes.settle(outcome, () => history.finish(runId!, results));
      logger.info(`Applied ${appliedIds.length} of ${pending.length} change(s)`);
      await refreshAfterApply(ctx);
      return c.json<ApplyResponse>({ ok: true, backup, results });
    } catch (e) {
      if (runId !== null) history.finish(runId, [], ctx.errorText(e));
      logger.error("Applying changes failed", e);
      reader.invalidate();
      return c.json<ApplyResponse>({ ok: false, error: ctx.errorText(e) }, 502);
    } finally {
      reader.endApply();
    }
  });

  return app;
}

// Whatever happened, the next view must come from a fresh read, of the
// registries and of what uses entity ids. One full read now (the only one Apply
// makes) fills the cache and keeps a snapshot; if it fails the next view reads
// again, and the Apply result still stands.
async function refreshAfterApply(ctx: AppContext): Promise<void> {
  ctx.reader.invalidate();
  try {
    await ctx.reader.readAfterApply();
  } catch (e) {
    ctx.logger.warn(`Reading Home Assistant after Apply failed; the next view will read it again: ${ctx.errorText(e)}`);
  }
}
