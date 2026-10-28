import { Hono } from "hono";

import { validateInput } from "../../shared/changes.ts";
import type { ChangeInput, ChangesResponse } from "../../shared/types.ts";
import type { AppContext } from "../context.ts";

const BUSY = "Changes are being applied. Try again in a moment.";

// The change list: what the user has queued, kept in Taxis until Apply. Nothing
// here writes to Home Assistant. While an Apply runs the list is frozen, so an
// edit can't be folded into a change that is being applied and then be lost when
// that change is marked done.
export function changeRoutes(ctx: AppContext): Hono {
  const { reader, changes, history } = ctx;
  const app = new Hono();

  const listResponse = (): ChangesResponse => ({ ok: true, changes: changes.list(), version: changes.version() });

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
      const refused = changes.add(input!, read.live);
      if (refused) return c.json<ChangesResponse>({ ok: false, error: refused }, 409);
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
  app.get("/history", (c) => c.json({ ok: true, runs: history.runs() }));
  app.get("/repairs", (c) => c.json({ ok: true, repairs: history.repairs() }));
  app.post("/repairs/:id/acknowledge", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id < 1) return c.json({ ok: false, error: "Invalid repair id." }, 400);
    if (!history.acknowledge(id)) return c.json({ ok: false, error: "This repair is already acknowledged or does not exist." }, 404);
    return c.json({ ok: true, repairs: history.repairs() });
  });

  return app;
}
