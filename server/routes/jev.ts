import { Hono } from "hono";

import { assessHouse } from "../../shared/guide.ts";
import { helperExclusions } from "../../shared/helpers.ts";
import { previewHierarchy } from "../changes/preview.ts";
import { readInstalled } from "../changes/recipes.ts";
import type { AppContext } from "../context.ts";
import { jevRoutes } from "../jev/routes.ts";
import { JevError } from "../jev/service.ts";

// The route can prepare curated evidence through the existing read-only
// Home Assistant paths. The Jev service itself receives no Home Assistant client.
export function jevPageRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  app.route(
    "/",
    jevRoutes({
      settings: ctx.settings,
      ledger: ctx.jevLedger,
      protect: ctx.protectSecret ?? (() => {}),
      redact: ctx.redact,
      fetch: ctx.jevFetch,
      clock: ctx.clock,
      checkReaders: {
        buttons: (fresh) => ctx.reader.buttons(fresh),
        house: async (fresh) => previewHierarchy((await ctx.reader.read(fresh)).read, ctx.changes.list()),
        room: async (areaId, key, fresh) => {
          const { read } = await ctx.reader.read(fresh);
          if (!ctx.ha) throw new JevError("Home Assistant could not be read.");
          const changes = ctx.changes.list();
          const h = previewHierarchy(read, changes);
          if (!Object.hasOwn(h.areas, areaId)) throw new JevError("This room is no longer available.", 409);
          const inventory = ctx.settings.inventory();
          const naming = ctx.settings.naming();
          const parameters = ctx.settings.parameters();
          const guide = ctx.settings.guide();
          // This assessment needs installed recipe inputs, not a house-wide
          // search for unrelated light or thermostat controllers.
          const installed = await readInstalled({ ha: ctx.ha, rest: ctx.reader.configs.view(fresh) }, read.raw, []);
          const automation = assessHouse(h, inventory, naming, parameters, guide, installed, changes)
            .find((area) => area.areaId === areaId)
            ?.automations.find((item) => item.key === key);
          if (!automation) throw new JevError("This automation is no longer available in the selected room.", 409);
          return { h, automation, inventory, excluded: helperExclusions(h, naming)(areaId) };
        },
      },
    }),
  );
  return app;
}
