import { CATEGORY_SCOPES, type CategoryScope } from "../../shared/types.ts";
import type {
  RawArea,
  RawCategory,
  RawConfig,
  RawConfigEntry,
  RawDevice,
  RawEntity,
  RawFloor,
  RawLabel,
  RawRegistry,
  RawState,
} from "../model/hierarchy.ts";
import type { HaSocket } from "./socket.ts";

// One read of everything the hierarchy needs. The commands run in parallel over
// the same connection; all of them are read-only (see READ_COMMANDS).
export async function readRegistry(ha: Pick<HaSocket, "command">): Promise<RawRegistry> {
  const [config, floors, areas, devices, entities, labels, states, integrations, ...categoryLists] = await Promise.all([
    ha.command<RawConfig>("get_config"),
    ha.command<RawFloor[]>("config/floor_registry/list"),
    ha.command<RawArea[]>("config/area_registry/list"),
    ha.command<RawDevice[]>("config/device_registry/list"),
    ha.command<RawEntity[]>("config/entity_registry/list"),
    ha.command<RawLabel[]>("config/label_registry/list"),
    ha.command<RawState[]>("get_states"),
    // Which integrations work, to say why an entity does not. Not needed for anything
    // else, so an answer that doesn't come leaves the rest of the read as it was.
    ha.command<RawConfigEntry[]>("config_entries/get").catch(() => [] as RawConfigEntry[]),
    ...CATEGORY_SCOPES.map((scope) => ha.command<RawCategory[]>("config/category_registry/list", { scope })),
  ]);
  const categories = Object.fromEntries(
    CATEGORY_SCOPES.map((scope, i) => [scope, categoryLists[i] as RawCategory[]]),
  ) as Record<CategoryScope, RawCategory[]>;
  return { config, floors, areas, devices, entities, labels, categories, integrations: Array.isArray(integrations) ? integrations : [], states };
}
