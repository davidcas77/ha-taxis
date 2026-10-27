import { isHelperEntity } from "./roles.ts";
import type { EntityItem } from "./types.ts";

export const ORGANIZE_ENTITY_TYPES = ["entities", "automations", "helpers"] as const;
export type OrganizeEntityType = (typeof ORGANIZE_ENTITY_TYPES)[number];

export const isOrganizeEntityType = (type: string): type is OrganizeEntityType => (ORGANIZE_ENTITY_TYPES as readonly string[]).includes(type);

// One partition for the sidebar counts, both list views and entity links. State-
// only helpers and integration groups may not have a category scope in HA.
export function organizeEntityType(entity: Pick<EntityItem, "domain" | "categoryScope" | "platform" | "members">): OrganizeEntityType {
  if (entity.domain === "automation") return "automations";
  if (entity.categoryScope === "helpers" || isHelperEntity(entity)) return "helpers";
  return "entities";
}

export const entityMatchesSection = (entity: EntityItem, section: OrganizeEntityType): boolean => organizeEntityType(entity) === section;
