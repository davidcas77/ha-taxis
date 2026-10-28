import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { pruneGroups, type GroupListKey } from "../../shared/groups.ts";
import { CATEGORY_SCOPES } from "../../shared/types.ts";
import type { GroupsResponse, InventoryResponse, NamingIgnoresResponse, NamingResponse, ParametersResponse } from "../../shared/types.ts";
import type { AppContext } from "../context.ts";
import { guideRoutes } from "../guide.ts";
import { checkAreaCodes, validateGroups, validateInventory, validateNaming, validateNamingIgnores, validateParameters } from "../settings.ts";

// Taxis's own settings: naming, groups, ignored suggestions, the capability
// inventory and the recipe parameters. Stored in Taxis only. Saving one never
// makes a Home Assistant request that changes anything; naming and groups only
// read Home Assistant to drop ids it no longer has.
export function settingsRoutes(ctx: AppContext): Hono {
  const { reader, settings, logger } = ctx;
  const app = new Hono();

  // Naming settings: area codes, patterns, type words. Nothing in Home
  // Assistant changes when they do.
  app.get("/settings/naming", (c) => c.json<NamingResponse>({ ok: true, naming: settings.naming() }));

  app.put(
    "/settings/naming",
    bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json<NamingResponse>({ ok: false, error: "The settings are too large." }, 413) }),
    async (c) => {
      // Codes are kept only for areas Home Assistant has (when it can be read).
      const live = await reader.read(false).then(
        ({ read }) => read,
        () => undefined,
      );
      const areaIds = live && new Set(Object.keys(live.live.areas));
      const floorIds = live && new Set(live.live.floors.map((f) => f.id));
      const checked = validateNaming(await c.req.json().catch(() => null), areaIds, floorIds);
      if (!checked.ok) return c.json<NamingResponse>({ ok: false, error: checked.error }, 400);
      // Two areas can't share a code, nor two floors, detected or set. Skipped when Home Assistant
      // can't be read, since the detected codes can't be worked out then.
      const clash =
        live &&
        checkAreaCodes(
          checked.value,
          live.live,
          live.raw.areas.map((a) => a.area_id),
        );
      if (clash) return c.json<NamingResponse>({ ok: false, error: clash }, 400);
      settings.saveNaming(checked.value);
      logger.info("Saved naming settings");
      return c.json<NamingResponse>({ ok: true, naming: checked.value });
    },
  );

  // Groups for labels and categories. Home Assistant has no such thing, and
  // nothing in it changes when they do.
  app.get("/settings/groups", (c) => c.json<GroupsResponse>({ ok: true, groups: settings.groups() }));

  app.put(
    "/settings/groups",
    bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json<GroupsResponse>({ ok: false, error: "The groups are too large." }, 413) }),
    async (c) => {
      const checked = validateGroups(await c.req.json().catch(() => null));
      if (!checked.ok) return c.json<GroupsResponse>({ ok: false, error: checked.error }, 400);
      // Drop ids Home Assistant no longer has (when it can be read).
      const live = await reader.read(false).then(
        ({ read }) => {
          const out: Partial<Record<GroupListKey, ReadonlySet<string>>> = { labels: new Set(Object.keys(read.live.labels)) };
          for (const scope of CATEGORY_SCOPES) out[`category:${scope}`] = new Set(read.live.categories[scope].map((x) => x.id));
          return out;
        },
        () => undefined,
      );
      const value = live ? pruneGroups(checked.value, live) : checked.value;
      settings.saveGroups(value);
      logger.info("Saved groups");
      return c.json<GroupsResponse>({ ok: true, groups: value });
    },
  );

  // The naming suggestions the user ignored. Home Assistant doesn't know about them.
  app.get("/settings/naming-ignores", (c) => c.json<NamingIgnoresResponse>({ ok: true, ignores: settings.namingIgnores() }));

  app.put(
    "/settings/naming-ignores",
    bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json<NamingIgnoresResponse>({ ok: false, error: "The ignored suggestions are too large." }, 413) }),
    async (c) => {
      const checked = validateNamingIgnores(await c.req.json().catch(() => null));
      if (!checked.ok) return c.json<NamingIgnoresResponse>({ ok: false, error: checked.error }, 400);
      settings.saveNamingIgnores(checked.value);
      logger.info("Saved ignored naming suggestions");
      return c.json<NamingIgnoresResponse>({ ok: true, ignores: checked.value });
    },
  );

  // The capability inventory: what each area has, and the user's choices on top
  // of it. Nothing in Home Assistant changes when they do.
  app.get("/settings/inventory", (c) => c.json<InventoryResponse>({ ok: true, inventory: settings.inventory() }));

  app.put(
    "/settings/inventory",
    bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json<InventoryResponse>({ ok: false, error: "The inventory settings are too large." }, 413) }),
    async (c) => {
      const checked = validateInventory(await c.req.json().catch(() => null));
      if (!checked.ok) return c.json<InventoryResponse>({ ok: false, error: checked.error }, 400);
      settings.saveInventory(checked.value);
      logger.info("Saved inventory settings");
      return c.json<InventoryResponse>({ ok: true, inventory: checked.value });
    },
  );

  // The recipe parameters: house, interior/exterior, floor and area values. They
  // reach Home Assistant only when a recipe is installed.
  app.get("/settings/parameters", (c) => c.json<ParametersResponse>({ ok: true, parameters: settings.parameters() }));

  app.route("/", guideRoutes(settings));

  app.put(
    "/settings/parameters",
    bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json<ParametersResponse>({ ok: false, error: "The parameters are too large." }, 413) }),
    async (c) => {
      const checked = validateParameters(await c.req.json().catch(() => null));
      if (!checked.ok) return c.json<ParametersResponse>({ ok: false, error: checked.error }, 400);
      settings.saveParameters(checked.value);
      logger.info("Saved parameters");
      return c.json<ParametersResponse>({ ok: true, parameters: checked.value });
    },
  );

  return app;
}
