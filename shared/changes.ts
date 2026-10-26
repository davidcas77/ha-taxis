import { CATEGORY_SCOPES, type CategoryScope, type Change, type ChangeInput, type ChangeKind, type Hierarchy } from "./types.ts";

// The change list: what may be changed, and how a new edit folds into the edits
// already waiting. Pure functions, used by the server (which stores the list)
// and tested on their own.

export const TEMP_PREFIX = "new:";
export const isTempId = (id: unknown): id is string => typeof id === "string" && id.startsWith(TEMP_PREFIX);
export const tempId = (kind: ChangeKind, changeId: number) => `${TEMP_PREFIX}${kind}:${changeId}`;

type Check = (v: unknown) => boolean;
const str = (max = 255): Check => (v) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const strOrNull = (max = 255): Check => (v) => v === null || str(max)(v);
const id: Check = (v) => typeof v === "string" && v.length > 0 && v.length <= 255;
const idOrNull: Check = (v) => v === null || id(v);
const ids: Check = (v) => Array.isArray(v) && v.length <= 200 && v.every(id);
const icon: Check = (v) => v === null || (typeof v === "string" && /^[a-z0-9]+:[a-z0-9-]+$/.test(v));
const userOrNull: Check = (v) => v === null || v === "user";
const level: Check = (v) => v === null || (Number.isInteger(v) && Math.abs(v as number) <= 1000);
// Home Assistant's own rule (valid_entity_id): lower-case letters, digits and
// single underscores, none at either end of either part.
export const ENTITY_ID_RE = /^(?!.*__)(?!_)[a-z0-9_]+(?<!_)\.(?!_)[a-z0-9_]+(?<!_)$/;
const entityIdCheck: Check = (v) => typeof v === "string" && v.length <= 255 && ENTITY_ID_RE.test(v);
const entityIdOrNull: Check = (v) => v === null || entityIdCheck(v);
const entityIdList: Check = (v) => Array.isArray(v) && v.length >= 1 && v.length <= 500 && v.every(entityIdCheck) && new Set(v).size === v.length;
const oneOf = (...values: string[]): Check => (v) => typeof v === "string" && values.includes(v);
const categoryMap: Check = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v) &&
  Object.entries(v).every(([k, c]) => (CATEGORY_SCOPES as readonly string[]).includes(k) && idOrNull(c));

// Every field each kind may change, named as Home Assistant names it. Anything
// else is refused before it is stored, let alone sent.
export const FIELDS: Record<ChangeKind, Record<string, Check>> = {
  entity: { new_entity_id: entityIdCheck, name: strOrNull(), icon, area_id: idOrNull, labels: ids, categories: categoryMap, hidden_by: userOrNull, disabled_by: userOrNull },
  device: { name_by_user: strOrNull(), area_id: idOrNull, labels: ids, disabled_by: userOrNull },
  area: { name: str(), floor_id: idOrNull, icon, labels: ids, temperature_entity_id: entityIdOrNull, humidity_entity_id: entityIdOrNull },
  floor: { name: str(), level, icon },
  label: { name: str(), color: strOrNull(32), icon, description: strOrNull(1000) },
  category: { name: str(), icon },
  helper: {
    helper: oneOf("group", "min_max"),
    group_type: oneOf("light", "binary_sensor", "media_player"),
    name: str(),
    entity_id: entityIdCheck,
    entities: entityIdList,
    area_id: id,
    set_area_sensor: oneOf("temperature", "humidity"),
  },
};

// What can be created and deleted. Entities and devices come from integrations:
// Taxis edits them but never creates or removes them. Helpers can be created
// but, like entities, are never deleted.
const CREATABLE = new Set<ChangeKind>(["area", "floor", "label", "category", "helper"]);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const an = (kind: string) => (/^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`);

export function validateInput(input: ChangeInput): string | null {
  if (!(input.kind in FIELDS)) return `Unknown kind "${String(input.kind)}".`;
  if (!["create", "update", "delete"].includes(input.op)) return `Unknown operation "${String(input.op)}".`;
  if (input.kind === "helper" && input.op === "delete") return "A helper can be created or updated, not deleted.";
  if (input.op !== "update" && !CREATABLE.has(input.kind)) return `${cap(an(input.kind))} can be edited, not created or deleted.`;
  if (input.kind === "category") {
    if (!(CATEGORY_SCOPES as readonly string[]).includes(input.scope ?? "")) return "A category change needs a scope: automation, script, scene or helpers.";
  } else if (input.scope !== undefined && input.scope !== null) {
    return "Only a category change has a scope.";
  }
  if (input.op !== "create" && !id(input.targetId)) return "Say which item to change.";
  if (input.op === "delete") return null;
  const fields = input.fields ?? {};
  const allowed = FIELDS[input.kind];
  for (const [key, value] of Object.entries(fields)) {
    if (!(key in allowed)) return `"${key}" can't be changed on ${an(input.kind)}.`;
    if (!allowed[key](value)) return `"${key}" has a value Home Assistant wouldn't accept.`;
  }
  if (input.op === "create" && !str()(fields.name)) return `A new ${input.kind} needs a name.`;
  if (input.op === "update" && Object.keys(fields).length === 0) return "Nothing to change.";
  if (input.kind === "helper") return validateHelper(input.op, fields);
  return null;
}

// What a helper change needs beyond each field being valid on its own: a group
// or min/max whose entity id and members are in the domain it works on.
function validateHelper(op: ChangeInput["op"], fields: Record<string, unknown>): string | null {
  if (op === "update") return Object.keys(fields).every((k) => k === "entities") ? null : "A helper update can only change its members.";
  if (!("helper" in fields)) return "A new helper needs a kind.";
  if (!("entity_id" in fields)) return "A new helper needs an entity id.";
  if (!("entities" in fields)) return "A new helper needs members.";
  if (!("area_id" in fields)) return "A new helper needs an area.";
  const domain = String(fields.entity_id).split(".")[0];
  if (fields.helper === "group") {
    if (!("group_type" in fields)) return "A new group needs a group type.";
    if (domain !== fields.group_type) return `A ${String(fields.group_type)} group's entity id has to start with “${String(fields.group_type)}.”.`;
  } else {
    if ("group_type" in fields) return "Only a group has a group type.";
    if (domain !== "sensor") return "A min/max helper's entity id has to start with “sensor.”.";
  }
  if (!(fields.entities as string[]).every((m) => m.startsWith(`${domain}.`))) return `Its members have to be ${domain} entities.`;
  if ("set_area_sensor" in fields && fields.helper !== "min_max") return "Only a min/max sensor can be the area's temperature or humidity sensor.";
  return null;
}

// The current value of each field, as last read from Home Assistant: the
// "before" side of a change.
export function currentValues(h: Hierarchy, kind: ChangeKind, targetId: string, scope: CategoryScope | null): Record<string, unknown> | null {
  switch (kind) {
    case "entity": {
      const e = h.entities[targetId];
      if (!e) return null;
      return {
        new_entity_id: e.entityId,
        name: e.customName,
        icon: e.icon,
        area_id: e.ownAreaId,
        labels: e.labels,
        categories: e.categories,
        hidden_by: e.hiddenBy,
        disabled_by: e.disabledBy,
      };
    }
    case "device": {
      const d = h.devices[targetId];
      return d ? { name_by_user: d.customName, area_id: d.areaId, labels: d.labels, disabled_by: d.disabledBy } : null;
    }
    case "area": {
      const a = h.areas[targetId];
      return a ? { name: a.name, floor_id: a.floorId, icon: a.icon, labels: a.labels, temperature_entity_id: a.temperatureEntityId, humidity_entity_id: a.humidityEntityId } : null;
    }
    case "floor": {
      const f = h.floors.find((x) => x.id === targetId);
      return f ? { name: f.name, level: f.level, icon: f.icon } : null;
    }
    case "label": {
      const l = h.labels[targetId];
      return l ? { name: l.name, color: l.color, icon: l.icon, description: l.description } : null;
    }
    case "category": {
      const c = scope ? h.categories[scope].find((x) => x.id === targetId) : undefined;
      return c ? { name: c.name, icon: c.icon } : null;
    }
    case "helper": {
      const e = h.entities[targetId];
      return e ? { entities: e.members } : null;
    }
  }
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    const x = [...a].sort();
    const y = [...b].sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] != null);
    const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] != null);
    return ka.length === kb.length && ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return (a ?? null) === (b ?? null);
}

// ---------------------------------------------------------------------------
// References: the ids a change points at (an area, a floor, labels, categories).
// ---------------------------------------------------------------------------

export type Ref = { kind: "area" | "floor" | "label" | "category"; id: string; scope?: CategoryScope };

// A labels change is "add these, remove those", measured against the labels the
// item had when the edit was first made (`before`). Applied that way to Home
// Assistant and to the preview, so labels added elsewhere in the meantime stay.
export type LabelDiff = { added: string[]; removed: string[] };

export function labelDiff(c: { before: Record<string, unknown>; after: Record<string, unknown> }): LabelDiff | null {
  if (!Array.isArray(c.after.labels)) return null;
  const was = Array.isArray(c.before.labels) ? (c.before.labels as string[]) : [];
  const want = c.after.labels as string[];
  return { added: want.filter((l) => !was.includes(l)), removed: was.filter((l) => !want.includes(l)) };
}

export function applyLabelDiff(current: string[], d: LabelDiff): string[] {
  return [...current.filter((l) => !d.removed.includes(l)), ...d.added.filter((l) => !current.includes(l))];
}

// What a change points at. Labels count only when the change adds them: a label
// an item merely keeps doesn't depend on the change.
export function refsOf(c: { before?: Record<string, unknown>; after: Record<string, unknown> }): Ref[] {
  const after = c.after;
  const out: Ref[] = [];
  if (typeof after.area_id === "string") out.push({ kind: "area", id: after.area_id });
  if (typeof after.floor_id === "string") out.push({ kind: "floor", id: after.floor_id });
  for (const l of labelDiff({ before: c.before ?? {}, after })?.added ?? []) out.push({ kind: "label", id: l });
  if (after.categories && typeof after.categories === "object") {
    for (const [scope, c] of Object.entries(after.categories)) if (typeof c === "string") out.push({ kind: "category", id: c, scope: scope as CategoryScope });
  }
  return out;
}

// The change without any reference to `id`: used when an item it points at
// leaves the list. Other fields of the change are kept.
export function stripRef(change: Change, ref: string): Record<string, unknown> {
  const after = { ...change.after };
  if (after.area_id === ref) delete after.area_id;
  if (after.floor_id === ref) delete after.floor_id;
  if (Array.isArray(after.labels) && after.labels.includes(ref)) {
    after.labels = after.labels.filter((l) => l !== ref);
    if (sameValue(after.labels, change.before.labels)) delete after.labels;
  }
  if (after.categories && typeof after.categories === "object") {
    const cats = Object.fromEntries(Object.entries(after.categories).filter(([, c]) => c !== ref));
    if (Object.keys(cats).length) after.categories = cats;
    else delete after.categories;
  }
  return after;
}

function itemExists(h: Hierarchy, ref: Ref): boolean {
  switch (ref.kind) {
    case "area":
      return Boolean(h.areas[ref.id]);
    case "floor":
      return h.floors.some((f) => f.id === ref.id);
    case "label":
      return Boolean(h.labels[ref.id]);
    case "category":
      return Boolean(ref.scope && h.categories[ref.scope]?.some((c) => c.id === ref.id));
  }
}

// Null when every reference points at something that exists (in Home
// Assistant or as a creation in the list) and isn't set to be deleted.
function checkRefs(existing: Change[], h: Hierarchy, before: Record<string, unknown>, after: Record<string, unknown>): string | null {
  for (const ref of refsOf({ before, after })) {
    const sameItem = (c: Change) => c.kind === ref.kind && c.targetId === ref.id && (ref.kind !== "category" || c.scope === ref.scope);
    if (existing.some((c) => c.op === "delete" && sameItem(c))) return `That ${ref.kind} is set to be deleted in the list of changes.`;
    if (isTempId(ref.id) ? !existing.some((c) => c.op === "create" && sameItem(c)) : !itemExists(h, ref)) {
      return `That ${ref.kind} isn't in Home Assistant or in the list of changes.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Merging an edit into the list.
// ---------------------------------------------------------------------------

export type MergePlan =
  | { action: "insert"; change: Omit<Change, "id" | "createdAt"> }
  | { action: "replace"; id: number; after: Record<string, unknown>; before: Record<string, unknown> }
  | { action: "remove"; ids: number[] }
  | { action: "removeThenInsert"; ids: number[]; change: Omit<Change, "id" | "createdAt"> }
  | { action: "none"; reason: string };

export function planMerge(existing: Change[], input: ChangeInput, h: Hierarchy): MergePlan {
  const kind = input.kind;
  const scope = input.scope ?? null;
  const fields = input.fields ?? {};
  if (kind === "helper") return planHelper(existing, input, h);

  if (input.op === "create") {
    const bad = checkRefs(existing, h, {}, fields);
    if (bad) return { action: "none", reason: bad };
    return { action: "insert", change: { kind, op: "create", targetId: "", scope, before: {}, after: { ...fields } } };
  }

  // The preview shows a pending rename under its new id; an edit made there
  // belongs to the change that renames it.
  let targetId = input.targetId!;
  if (kind === "entity") {
    const renamed = existing.find((c) => c.kind === "entity" && c.after.new_entity_id === targetId);
    if (renamed) targetId = renamed.targetId;
  }
  const sameTarget = existing.filter((c) => c.kind === kind && c.targetId === targetId && c.scope === scope);

  if (input.op === "delete") {
    // Deleting something only created in Taxis drops the creation (the store
    // also strips references to it from other changes).
    const created = sameTarget.find((c) => c.op === "create");
    if (created) return { action: "remove", ids: sameTarget.map((c) => c.id) };
    const current = currentValues(h, kind, targetId, scope);
    if (!current) return { action: "none", reason: `That ${kind} isn't in Home Assistant any more.` };
    // Deleting an item other changes point at would leave them pointing at
    // nothing once applied.
    const users = existing.filter((c) => !sameTarget.includes(c) && refsOf(c).some((r) => r.kind === kind && r.id === targetId));
    if (users.length) {
      return { action: "none", reason: `${users.length} change${users.length === 1 ? "" : "s"} in the list use${users.length === 1 ? "s" : ""} this ${kind}. Remove or change ${users.length === 1 ? "it" : "them"} first.` };
    }
    return { action: "removeThenInsert", ids: sameTarget.map((c) => c.id), change: { kind, op: "delete", targetId, scope, before: current, after: {} } };
  }

  // Update.
  if (sameTarget.some((c) => c.op === "delete")) return { action: "none", reason: `That ${kind} is already set to be deleted.` };
  const created = sameTarget.find((c) => c.op === "create");
  if (created) {
    const bad = checkRefs(existing, h, {}, fields);
    if (bad) return { action: "none", reason: bad };
    return { action: "replace", id: created.id, after: { ...created.after, ...fields }, before: {} };
  }

  const current = currentValues(h, kind, targetId, scope);
  if (!current) return { action: "none", reason: `That ${kind} isn't in Home Assistant any more.` };
  const bad = checkRefs(existing, h, current, fields);
  if (bad) return { action: "none", reason: bad };
  const pending = sameTarget.find((c) => c.op === "update");
  // A field that is already pending keeps the value from when it was first
  // edited, so a second edit can't hide a change Home Assistant made since.
  const baseOf = (key: string) => (pending && key in pending.before ? pending.before[key] : current[key]);
  const after: Record<string, unknown> = { ...(pending?.after ?? {}), ...fields };
  const before: Record<string, unknown> = {};

  // Categories: only the scopes that actually change are kept, so Apply never
  // re-sends a scope the user didn't touch.
  if ("categories" in after) {
    const now = { ...((current.categories ?? {}) as Record<string, string | null>), ...((pending?.before.categories as object) ?? {}) } as Record<string, string | null | undefined>;
    const merged = { ...((pending?.after.categories as object) ?? {}), ...((fields.categories as object) ?? {}) } as Record<string, string | null>;
    const changed: Record<string, string | null> = {};
    const was: Record<string, string | null> = {};
    for (const [s, v] of Object.entries(merged)) {
      if ((v ?? null) !== (now[s] ?? null)) {
        changed[s] = v ?? null;
        was[s] = now[s] ?? null;
      }
    }
    if (Object.keys(changed).length) {
      after.categories = changed;
      before.categories = was;
    } else delete after.categories;
  }
  for (const key of Object.keys(after)) {
    if (key === "categories") continue;
    if (sameValue(after[key], baseOf(key))) delete after[key];
    else before[key] = baseOf(key);
  }

  if (kind === "entity" && typeof after.new_entity_id === "string") {
    const bad = checkRename(existing, h, targetId, after.new_entity_id);
    if (bad) return { action: "none", reason: bad };
  }

  // Home Assistant 2026.10 refuses an area of its own for a device's main entity
  // (one with no name of its own) until it has a name.
  if (kind === "entity" && h.entities[targetId]?.needsOwnName && ("area_id" in after || "name" in after)) {
    const name = "name" in after ? after.name : current.name;
    const area = "area_id" in after ? after.area_id : current.area_id;
    if (area && !name) {
      return {
        action: "none",
        reason: "Home Assistant only lets this entity have an area of its own once it has a name. Give it a name in the same edit, or move its device instead.",
      };
    }
  }

  if (Object.keys(after).length === 0) {
    return pending ? { action: "remove", ids: [pending.id] } : { action: "none", reason: "That's how it already is." };
  }
  if (pending) return { action: "replace", id: pending.id, after, before };
  return { action: "insert", change: { kind, op: "update", targetId, scope, before, after } };
}

const none = (reason: string): MergePlan => ({ action: "none", reason });

// Helpers: a creation is its own change, keyed by the entity id it will have
// (there is no temporary id: nothing points at a helper that isn't applied). An
// update replaces the members; a second edit of the same helper folds into the
// first and keeps the members as they were before either.
function planHelper(existing: Change[], input: ChangeInput, h: Hierarchy): MergePlan {
  const fields = input.fields ?? {};
  const members = (fields.entities ?? []) as string[];
  const absent = members.find((m) => !h.entities[m]);
  if (absent) return none(`“${absent}” isn't in Home Assistant any more.`);

  if (input.op === "create") {
    const entityId = String(fields.entity_id);
    if (h.entities[entityId]) return none(`Home Assistant already has an entity “${entityId}”.`);
    if (existing.some((c) => c.kind === "helper" && c.op === "create" && c.after.entity_id === entityId)) return none(`The list already creates “${entityId}”.`);
    if (existing.some((c) => c.kind === "entity" && c.after.new_entity_id === entityId)) return none(`A change in the list already renames an entity to “${entityId}”.`);
    const bad = checkRefs(existing, h, {}, fields);
    if (bad) return none(bad);
    return { action: "insert", change: { kind: "helper", op: "create", targetId: entityId, scope: null, before: {}, after: { ...fields } } };
  }

  // The preview shows a pending rename under its new id; the helper is still
  // under the old one in Home Assistant.
  let targetId = input.targetId!;
  const renamed = existing.find((c) => c.kind === "entity" && c.after.new_entity_id === targetId);
  if (renamed) targetId = renamed.targetId;
  const e = h.entities[targetId];
  if (!e) return none("That helper isn't in Home Assistant any more.");
  if (e.platform !== "group") return none("Taxis only updates the members of a group.");
  if (!e.configEntryId) return none("This group isn't set up in the Home Assistant UI, so Taxis can't change its members.");
  const pending = existing.find((c) => c.kind === "helper" && c.op === "update" && c.targetId === targetId);
  const base = pending ? ((pending.before.entities as string[] | undefined) ?? e.members) : e.members;
  if (sameValue(members, base)) return pending ? { action: "remove", ids: [pending.id] } : none("That's how it already is.");
  if (pending) return { action: "replace", id: pending.id, after: { entities: members }, before: { entities: base } };
  return { action: "insert", change: { kind: "helper", op: "update", targetId, scope: null, before: { entities: e.members }, after: { entities: members } } };
}

// Null when `newId` is a free id in the same domain.
function checkRename(existing: Change[], h: Hierarchy, targetId: string, newId: string): string | null {
  const domain = targetId.slice(0, targetId.indexOf("."));
  if (!newId.startsWith(`${domain}.`)) return `An entity id keeps its domain: it has to start with “${domain}.”.`;
  if (!h.entities[targetId]?.inRegistry) return "This entity has no unique id, so Home Assistant doesn't let it be renamed.";
  if (h.entities[newId]) return `Home Assistant already has an entity “${newId}”.`;
  if (existing.some((c) => c.kind === "helper" && c.op === "create" && c.after.entity_id === newId)) return `The list already creates a helper “${newId}”.`;
  const taken = existing.find((c) => c.kind === "entity" && c.targetId !== targetId && c.after.new_entity_id === newId);
  if (taken) return `Another change in the list already renames an entity to “${newId}”.`;
  // An id another rename frees only becomes free once that one is applied:
  // keep it simple and refuse it.
  if (existing.some((c) => c.kind === "entity" && c.targetId === newId && typeof c.after.new_entity_id === "string")) {
    return `“${newId}” is being renamed in the list; it isn't free until that's applied.`;
  }
  return null;
}
