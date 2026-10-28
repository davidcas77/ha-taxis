import { Hono } from "hono";

import { areaThermostats, canonicalLightGroups, type RecipesResponse } from "../../shared/recipes.ts";
import type { HierarchyResponse } from "../../shared/types.ts";
import { readBlueprintInventory } from "../blueprints.ts";
import { previewHierarchy } from "../changes/preview.ts";
import { readInstalled } from "../changes/recipes.ts";
import type { AppContext } from "../context.ts";

// Read-only views of Home Assistant: the hierarchy (with the change list laid
// over it), the blueprint inventory, and what the recipes installed.
export function hierarchyRoutes(ctx: AppContext): Hono {
  const { reader, changes, settings, logger, ha, rest } = ctx;
  const app = new Hono();

  app.get("/hierarchy", async (c) => {
    const refresh = c.req.query("refresh") === "1";
    try {
      // Refresh is the explicit "read it again" of the main page, so it is also
      // when a snapshot is kept.
      const { read, cached } = await reader.read(refresh, { snapshot: refresh });
      return c.json<HierarchyResponse>({ ok: true, hierarchy: previewHierarchy(read, changes.list()), cached });
    } catch (e) {
      const message = ctx.errorText(e);
      logger.error("Reading Home Assistant failed", message);
      return c.json<HierarchyResponse>({ ok: false, error: message }, 502);
    }
  });

  app.get("/blueprints", async (c) => {
    if (!ha) return c.json({ ok: false, error: "Home Assistant is not configured." }, 503);
    return c.json(await readBlueprintInventory(ha, ctx.redact));
  });

  // What recipes need to know that the registries don't say: which Taxis
  // blueprints Home Assistant has, the recipes' automations and timers it holds,
  // and what else controls each area's light group. Read-only.
  app.get("/recipes/state", async (c) => {
    if (!ha || !rest) return c.json<RecipesResponse>({ ok: false, error: ctx.notConfigured }, 503);
    try {
      const refresh = c.req.query("refresh") === "1";
      const { read } = await reader.read(refresh);
      const installed = await readInstalled(
        { ha, rest: reader.configs.view(refresh) },
        read.raw,
        canonicalLightGroups(read.live, settings.naming()),
        areaThermostats(read.live),
      );
      return c.json<RecipesResponse>({ ok: true, installed });
    } catch (e) {
      const message = ctx.errorText(e);
      logger.error("Reading what the recipes installed failed", message);
      return c.json<RecipesResponse>({ ok: false, error: message }, 502);
    }
  });

  return app;
}
