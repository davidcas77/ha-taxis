import { Hono } from "hono";

import { validateInput } from "../../shared/changes.ts";
import type { ChangeInput, ChangesResponse } from "../../shared/types.ts";
import type { AppContext } from "../context.ts";
import { publicChange } from "../changes/store.ts";

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

  // Capture the actual stored config on the server, not a client-provided baseline.
  const configBaseline = async (input: ChangeInput): Promise<unknown> => {
    if ((input.kind !== "automation" && input.kind !== "script") || input.fields?.button_map) return undefined;
    if (!ctx.rest) throw new Error(ctx.notConfigured);
    const id = String(input.kind === "automation" ? input.fields?.automation_id : input.fields?.script_id);
    return ctx.rest.get(input.kind, id);
  };

  const listResponse = (): ChangesResponse => ({ ok: true, changes: changes.list().map(publicChange), version: changes.version() });

  app.get("/changes", (c) => c.json<ChangesResponse>(listResponse()));

  app.post("/changes", async (c) => {
    if (reader.isApplying()) return c.json<ChangesResponse>({ ok: false, error: BUSY }, 409);
    const input = (await c.req.json().catch(() => null)) as ChangeInput | null;
    const invalid = input ? validateInput(input) : "The request wasn't JSON.";
    if (invalid) return c.json<ChangesResponse>({ ok: false, error: invalid }, 400);
    try {
      const { read } = await reader.read(false);
      // Apply may have started while Home Assistant was being read.
      if (reader.isApplying()) return c.json<ChangesResponse>({ ok: false, error: BUSY }, 409);
      const baseline = await configBaseline(input!);
      if (reader.isApplying()) return c.json<ChangesResponse>({ ok: false, error: BUSY }, 409);
      const refused = changes.add(input!, read.live, baseline);
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
      const { read } = await reader.read(false);
      // Apply may have started while Home Assistant was being read.
      if (reader.isApplying()) return c.json<ChangesResponse>({ ok: false, error: BUSY }, 409);
      const configs = new Map<number, unknown>();
      for (const [index, input] of (inputs as ChangeInput[]).entries()) {
        const baseline = await configBaseline(input);
        if (baseline !== undefined) configs.set(index, baseline);
      }
      if (reader.isApplying()) return c.json<ChangesResponse>({ ok: false, error: BUSY }, 409);
      const refused = changes.addMany(inputs as ChangeInput[], read.live, configs);
      if (refused) return c.json<ChangesResponse>({ ok: false, error: `${where(refused.index)}${refused.error} Nothing was added.` }, 409);
      return c.json<ChangesResponse>(listResponse());
    } catch (e) {
      return c.json<ChangesResponse>({ ok: false, error: ctx.errorText(e) }, 502);
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
  app.get("/history", (c) => c.json({ ok: true, runs: history.runs().map((run) => ({ ...run, changes: run.changes?.map(publicChange) })) }));
  app.get("/repairs", (c) => c.json({ ok: true, repairs: history.repairs() }));
  app.post("/repairs/:id/acknowledge", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id < 1) return c.json({ ok: false, error: "Invalid repair id." }, 400);
    if (!history.acknowledge(id)) return c.json({ ok: false, error: "This repair is already acknowledged or does not exist." }, 404);
    return c.json({ ok: true, repairs: history.repairs() });
  });

  return app;
}
