import { areaThermostats, canonicalLightGroups } from "../../shared/recipes.ts";
import type { AppContext } from "../context.ts";
import type { Read } from "../ha/reader.ts";
import { readInstalled } from "./recipes.ts";
import type { SpaceGuardContext } from "./space-safety.ts";

/** Server-owned settings and installed configurations for scope authorization. */
export async function spaceContext(ctx: AppContext, read: Read): Promise<SpaceGuardContext> {
  const naming = ctx.settings.naming();
  const inventory = ctx.settings.inventory();
  const parameters = ctx.settings.parameters();
  if (!ctx.ha || !ctx.rest) throw new Error(ctx.notConfigured);
  const installed = await readInstalled({ ha: ctx.ha, rest: ctx.rest }, read.raw, canonicalLightGroups(read.live, naming), areaThermostats(read.live));
  return { naming, inventory, parameters, installed };
}
