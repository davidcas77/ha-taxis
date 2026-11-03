import { Hono } from "hono";

import { validateInput } from "../../shared/changes.ts";
import type { ChangeInput, ChangesResponse } from "../../shared/types.ts";
import type { AppContext } from "../context.ts";
import { enrichPreview, previewChanges, previewVersion, visiblePreview } from "../changes/direct-preview.ts";
import { runLockedApply } from "./apply.ts";
import { blueprintVersions } from "../changes/recipes.ts";
import { directReferences } from "../changes/direct-references.ts";
import { spaceContext } from "../changes/space-context.ts";

const BUSY = "Changes are being applied. Try again in a moment.";
// The most edits one batch may hold: a bulk edit of a big home, not a bulk import.
export const MAX_BATCH = 500;

// The change list: what the user has queued, kept in Taxis until Apply. Nothing
// here writes to Home Assistant. While an Apply runs the list is frozen, so an
// edit can't be folded into a change that is being applied and then be lost when
// that change is marked done.
export function changeRoutes(ctx: AppContext): Hono {
  const { reader, changes, history } = ctx;
  const app = new Hono();
  const revision = () =>
    String(
      (ctx.db.prepare("SELECT revision FROM setting_revisions WHERE path = ?").get("/api/settings/general") as { revision: number } | undefined)?.revision ?? 0,
    );
  const reviewGuard = (expected: string) => settingsReview() && revision() === expected;
  const settingsReview = () => ctx.settings.general().reviewChangesBeforeApplying;
  const modeError = "The review setting changed. Reload the page before editing.";

  // Capture the actual stored config on the server, not a client-provided baseline.
  const configBaseline = async (input: ChangeInput): Promise<unknown> => {
    if ((input.kind !== "automation" && input.kind !== "script") || input.fields?.button_map) return undefined;
    if (!ctx.rest) throw new Error(ctx.notConfigured);
    const id = String(input.kind === "automation" ? input.fields?.automation_id : input.fields?.script_id);
    return ctx.rest.get(input.kind, id);
  };

  const listResponse = (): ChangesResponse => ({ ok: true, changes: changes.list().map(visiblePreview), version: changes.version() });

  app.get("/changes", (c) => c.json<ChangesResponse>(listResponse()));

  app.post("/changes", async (c) => {
    const rev = revision();
    if (!reviewGuard(rev)) return c.json<ChangesResponse>({ ok: false, error: modeError }, 409);
    if (reader.isApplying()) return c.json<ChangesResponse>({ ok: false, error: BUSY }, 409);
    const input = (await c.req.json().catch(() => null)) as ChangeInput | null;
    const invalid = input ? validateInput(input) : "The request wasn't JSON.";
    if (invalid) return c.json<ChangesResponse>({ ok: false, error: invalid }, 400);
    try {
      const { read } = await reader.read(Boolean(input!.space) || (input!.kind === "helper" && input!.op === "update" && "duration" in (input!.fields ?? {})));
      // Apply may have started while Home Assistant was being read.
      if (reader.isApplying()) return c.json<ChangesResponse>({ ok: false, error: BUSY }, 409);
      const baseline = await configBaseline(input!);
      const context = input!.space ? await spaceContext(ctx, read) : undefined;
      if (reader.isApplying()) return c.json<ChangesResponse>({ ok: false, error: BUSY }, 409);
      if (!reviewGuard(rev)) return c.json<ChangesResponse>({ ok: false, error: modeError }, 409);
      const refused = changes.add(input!, read.live, baseline, false, context);
      if (refused) return c.json<ChangesResponse>({ ok: false, error: refused }, 409);
      return c.json<ChangesResponse>(listResponse());
    } catch (e) {
      return c.json<ChangesResponse>({ ok: false, error: ctx.errorText(e) }, 502);
    }
  });

  // Several edits at once, all or nothing: `{ "changes": ChangeInput[] }`. Each is
  // checked like the single endpoint checks one; if any is invalid (400) or
  // refused (409) nothing from the batch is kept and the list is as it was.
  app.post("/changes/batch", async (c) => {
    const rev = revision();
    if (!reviewGuard(rev)) return c.json<ChangesResponse>({ ok: false, error: modeError }, 409);
    if (reader.isApplying()) return c.json<ChangesResponse>({ ok: false, error: BUSY }, 409);
    const body = (await c.req.json().catch(() => null)) as { changes?: unknown } | null;
    const inputs = body && typeof body === "object" ? body.changes : undefined;
    if (!Array.isArray(inputs) || inputs.length === 0)
      return c.json<ChangesResponse>({ ok: false, error: 'Send { "changes": [...] } with at least one change.' }, 400);
    if (inputs.length > MAX_BATCH)
      return c.json<ChangesResponse>({ ok: false, error: `Too many changes at once: ${inputs.length}. The most is ${MAX_BATCH}.` }, 400);
    const where = (i: number) => (inputs.length > 1 ? `Change ${i + 1} of ${inputs.length}: ` : "");
    for (const [i, input] of inputs.entries()) {
      const invalid = input && typeof input === "object" ? validateInput(input as ChangeInput) : "That change wasn't an object.";
      if (invalid) return c.json<ChangesResponse>({ ok: false, error: `${where(i)}${invalid} Nothing was added.` }, 400);
    }
    try {
      const { read } = await reader.read(
        (inputs as ChangeInput[]).some(
          (input) => input.space !== undefined || (input.kind === "helper" && input.op === "update" && "duration" in (input.fields ?? {})),
        ),
      );
      // Apply may have started while Home Assistant was being read.
      if (reader.isApplying()) return c.json<ChangesResponse>({ ok: false, error: BUSY }, 409);
      const configs = new Map<number, unknown>();
      for (const [index, input] of (inputs as ChangeInput[]).entries()) {
        const baseline = await configBaseline(input);
        if (baseline !== undefined) configs.set(index, baseline);
      }
      const context = (inputs as ChangeInput[]).some((input) => input.space) ? await spaceContext(ctx, read) : undefined;
      if (reader.isApplying()) return c.json<ChangesResponse>({ ok: false, error: BUSY }, 409);
      if (!reviewGuard(rev)) return c.json<ChangesResponse>({ ok: false, error: modeError }, 409);
      const refused = changes.addMany(inputs as ChangeInput[], read.live, configs, undefined, false, context);
      if (refused) return c.json<ChangesResponse>({ ok: false, error: `${where(refused.index)}${refused.error} Nothing was added.` }, 409);
      return c.json<ChangesResponse>(listResponse());
    } catch (e) {
      return c.json<ChangesResponse>({ ok: false, error: ctx.errorText(e) }, 502);
    }
  });

  // Preview from fresh data using an isolated in-memory change store; this never
  // changes the persisted queue. The token includes private configuration baselines.
  app.post("/direct-preview", async (c) => {
    if (!ctx.ha || !ctx.rest || !ctx.target.ok) return c.json({ ok: false, error: ctx.notConfigured }, 503);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((k) => !["changes", "settingsRevision"].includes(k)) ||
      typeof body.settingsRevision !== "string"
    )
      return c.json({ ok: false, error: "The preview request wasn't readable." }, 400);
    const inputs = body.changes;
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > MAX_BATCH)
      return c.json({ ok: false, error: `Send between 1 and ${MAX_BATCH} changes.` }, 400);
    for (const [i, input] of inputs.entries()) {
      const invalid = input && typeof input === "object" ? validateInput(input as ChangeInput) : "That change wasn't an object.";
      if (invalid) return c.json({ ok: false, error: `Change ${i + 1}: ${invalid} Nothing was added.` }, 400);
    }
    if (!reader.tryBeginApply()) return c.json({ ok: false, error: BUSY }, 409);
    try {
      const current = () => !settingsReview() && revision() === body.settingsRevision;
      if (!current()) return c.json({ ok: false, error: modeError }, 409);
      if (changes.list().length) return c.json({ ok: false, error: "Review or discard pending changes before applying a direct edit." }, 409);
      const { read } = await reader.read(true);
      const configs = new Map<number, unknown>();
      for (const [index, input] of (inputs as ChangeInput[]).entries()) {
        const baseline = await configBaseline(input);
        if (baseline !== undefined) configs.set(index, baseline);
      }
      const context = (inputs as ChangeInput[]).some((input) => input.space) ? await spaceContext(ctx, read) : undefined;
      if (!current() || changes.list().length) return c.json({ ok: false, error: "The settings or pending changes changed. Review again." }, 409);
      const planned = previewChanges(inputs as ChangeInput[], read.live, configs, false, context);
      if ("error" in planned) return c.json({ ok: false, error: planned.error }, 409);
      if (!planned.changes.length) return c.json({ ok: false, error: "There are no changes to apply." }, 400);
      const blueprints = planned.changes.some((change) => change.kind === "blueprint") ? await blueprintVersions(ctx.ha!) : {};
      if (!current() || changes.list().length) return c.json({ ok: false, error: "The settings or pending changes changed. Review again." }, 409);
      const enriched = enrichPreview(planned.changes, read.raw, blueprints);
      const references = await directReferences(ctx, read, enriched);
      if (!current() || changes.list().length) return c.json({ ok: false, error: "The settings or pending changes changed. Review again." }, 409);
      return c.json({
        ok: true,
        changes: enriched.map(visiblePreview),
        notes: references?.notes ?? [],
        previewVersion: previewVersion(body.settingsRevision as string, enriched, references?.evidence),
        requiresNoBackupConfirmation: false,
      });
    } catch (e) {
      return c.json({ ok: false, error: ctx.errorText(e) }, 502);
    } finally {
      reader.endApply();
    }
  });

  // Explicit direct intent. Take the same lock before reading baselines, so no
  // setting or queue edit can cross the validation and apply boundary.
  app.post("/direct-changes", async (c) => {
    if (!ctx.ha || !ctx.rest || !ctx.target.ok) return c.json({ ok: false, error: ctx.notConfigured }, 503);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((k) => !["changes", "settingsRevision", "previewVersion", "allowWithoutBackup"].includes(k)) ||
      typeof body.settingsRevision !== "string" ||
      typeof body.previewVersion !== "string" ||
      (body.allowWithoutBackup !== undefined && typeof body.allowWithoutBackup !== "boolean")
    ) {
      return c.json({ ok: false, error: "The direct changes request wasn't readable." }, 400);
    }
    const inputs = body.changes;
    if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MAX_BATCH)
      return c.json({ ok: false, error: `Send between 1 and ${MAX_BATCH} changes.` }, 400);
    for (const [i, input] of inputs.entries()) {
      const invalid = input && typeof input === "object" ? validateInput(input as ChangeInput) : "That change wasn't an object.";
      if (invalid) return c.json({ ok: false, error: `Change ${i + 1}: ${invalid} Nothing was added.` }, 400);
    }
    if (!reader.tryBeginApply()) return c.json({ ok: false, error: BUSY }, 409);
    let handedOver = false;
    try {
      const current = () => !settingsReview() && revision() === body.settingsRevision;
      if (!current()) return c.json({ ok: false, error: modeError }, 409);
      if (changes.list().length) return c.json({ ok: false, error: "Review or discard pending changes before applying a direct edit." }, 409);
      const { read } = await reader.read(true);
      const configs = new Map<number, unknown>();
      for (const [index, input] of (inputs as ChangeInput[]).entries()) {
        const baseline = await configBaseline(input);
        if (baseline !== undefined) configs.set(index, baseline);
      }
      const context = (inputs as ChangeInput[]).some((input) => input.space) ? await spaceContext(ctx, read) : undefined;
      if (!current()) return c.json({ ok: false, error: modeError }, 409);
      if (changes.list().length) return c.json({ ok: false, error: "Review or discard pending changes before applying a direct edit." }, 409);
      const planned = previewChanges(inputs as ChangeInput[], read.live, configs, false, context);
      if ("error" in planned) return c.json({ ok: false, error: planned.error }, 409);
      const blueprints = planned.changes.some((change) => change.kind === "blueprint") ? await blueprintVersions(ctx.ha!) : {};
      if (!current() || changes.list().length) return c.json({ ok: false, error: "The settings or pending changes changed. Review again." }, 409);
      const enriched = enrichPreview(planned.changes, read.raw, blueprints);
      const references = await directReferences(ctx, read, enriched);
      if (!current() || changes.list().length) return c.json({ ok: false, error: "The settings or pending changes changed. Review again." }, 409);
      if (body.previewVersion !== previewVersion(body.settingsRevision as string, enriched, references?.evidence))
        return c.json({ ok: false, error: "The Home Assistant changes have changed. Review them again before applying." }, 409);
      const refused = changes.addMany(inputs as ChangeInput[], read.live, configs, undefined, false, context);
      if (refused) return c.json({ ok: false, error: `Change ${refused.index + 1}: ${refused.error} Nothing was added.` }, 409);
      const pending = changes.list();
      if (!pending.length) return c.json({ ok: false, error: "There are no changes to apply." }, 400);
      handedOver = true;
      const checkReferences = references
        ? async () => {
            const latest = await reader.read(true);
            const now = await directReferences(ctx, latest.read, enriched);
            return now &&
              previewVersion(body.settingsRevision as string, [], now.evidence) === previewVersion(body.settingsRevision as string, [], references.evidence)
              ? now.confirmed
              : null;
          }
        : undefined;
      return await runLockedApply(ctx, c, pending, { allowWithoutBackup: body.allowWithoutBackup === true }, checkReferences);
    } catch (e) {
      return c.json({ ok: false, error: ctx.errorText(e) }, 502);
    } finally {
      if (!handedOver) reader.endApply();
    }
  });

  app.delete("/changes/:id", (c) => {
    if (reader.isApplying()) return c.json<ChangesResponse>({ ok: false, error: BUSY }, 409);
    changes.remove(Number(c.req.param("id")));
    return c.json<ChangesResponse>(listResponse());
  });

  app.delete("/changes", (c) => {
    if (reader.isApplying()) return c.json<ChangesResponse>({ ok: false, error: BUSY }, 409);
    changes.clear();
    ctx.logger.info("Discarded every change in the list");
    return c.json<ChangesResponse>(listResponse());
  });

  // What past Applies did, and what is left for the user to look at.
  app.get("/history", (c) => c.json({ ok: true, runs: history.runs().map((run) => ({ ...run, changes: run.changes?.map(visiblePreview) })) }));
  app.get("/repairs", (c) => c.json({ ok: true, repairs: history.repairs() }));
  app.post("/repairs/:id/acknowledge", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id < 1) return c.json({ ok: false, error: "Invalid repair id." }, 400);
    if (!history.acknowledge(id)) return c.json({ ok: false, error: "This repair is already acknowledged or does not exist." }, 404);
    return c.json({ ok: true, repairs: history.repairs() });
  });

  return app;
}
