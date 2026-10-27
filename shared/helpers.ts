import { ENTITY_ID_RE } from "./changes.ts";
import { isSilentGroup } from "./entity-diagnosis.ts";
import { areaCodes, duplicateCodes, floorCodes, houseGroupId, type NamingSettings } from "./naming.ts";
import { areaInventory, type AreaInventory, type Capability, type InventorySettings } from "./inventory.ts";
import type { AreaNode, Change, ChangeInput, EntityItem, Hierarchy } from "./types.ts";

// Canonical helpers: for each area, one entity per capability that rolls the
// area's counted sensors (or lights, or players) up into a single one. The
// planner compares that with what Home Assistant has and says, per helper,
// whether it is in place, needs its members updated, can be adopted from an
// existing group, has to be created, or is blocked. Pure functions; nothing
// here changes anything. Applying lives in server/changes/helpers.ts.

export const HELPER_KEYS = ["lights", "motion", "presence", "door", "window", "temperature", "humidity", "illuminance", "media"] as const;
export type HelperKey = (typeof HELPER_KEYS)[number];

export type HelperDomain = "light" | "binary_sensor" | "sensor" | "media_player";

export type HelperSpec = {
  key: HelperKey;
  // The row title in Settings.
  label: string;
  // The last word of the helper's display name: "Kitchen motions".
  nameWord: string;
  domain: HelperDomain;
  helper: "group" | "min_max";
  // Only for groups: the group type Home Assistant's flow asks for.
  groupType?: "light" | "binary_sensor" | "media_player";
  // The default end of the entity id: <domain>.<code>_<suffix>.
  suffix: string;
  // How many counted sources the area needs before it gets the helper.
  min: number;
};

// The suffixes are chosen so they rarely collide with a single real sensor
// named after the room ("sensor.kitchen_motion" stays a sensor, the group is
// "binary_sensor.kitchen_motions"). They are settings: see helperNames.
export const HELPERS: readonly HelperSpec[] = [
  { key: "lights", label: "Lights", nameWord: "lights", domain: "light", helper: "group", groupType: "light", suffix: "all", min: 1 },
  { key: "motion", label: "Motion", nameWord: "motions", domain: "binary_sensor", helper: "group", groupType: "binary_sensor", suffix: "motions", min: 1 },
  { key: "presence", label: "Presence", nameWord: "presences", domain: "binary_sensor", helper: "group", groupType: "binary_sensor", suffix: "presences", min: 1 },
  { key: "door", label: "Doors", nameWord: "doors", domain: "binary_sensor", helper: "group", groupType: "binary_sensor", suffix: "doors", min: 1 },
  { key: "window", label: "Windows", nameWord: "windows", domain: "binary_sensor", helper: "group", groupType: "binary_sensor", suffix: "windows", min: 1 },
  { key: "temperature", label: "Temperature", nameWord: "temperature", domain: "sensor", helper: "min_max", suffix: "temperature", min: 1 },
  { key: "humidity", label: "Humidity", nameWord: "humidity", domain: "sensor", helper: "min_max", suffix: "humidity", min: 1 },
  { key: "illuminance", label: "Light level", nameWord: "illuminance", domain: "sensor", helper: "min_max", suffix: "illuminance", min: 1 },
  { key: "media", label: "Media", nameWord: "media", domain: "media_player", helper: "group", groupType: "media_player", suffix: "media", min: 2 },
];

export const HELPER_SPEC = Object.fromEntries(HELPERS.map((s) => [s.key, s])) as Record<HelperKey, HelperSpec>;

export const isHelperKey = (k: string): k is HelperKey => Object.hasOwn(HELPER_SPEC, k);

// The helper that rolls up a capability: the media group gathers speakers and
// TVs; thermostats, covers, fans and power have none.
export function helperKeyFor(capability: Capability): HelperKey | null {
  if (capability === "speaker" || capability === "tv") return "media";
  return isHelperKey(capability) ? capability : null;
}

// ---------------------------------------------------------------------------
// The suffix of each canonical id (a naming setting).
// ---------------------------------------------------------------------------

// Lower-case slug. No leading, trailing or doubled underscore, which Home
// Assistant would refuse in an entity id.
export const HELPER_SUFFIX_RE = /^(?!_)(?!.*__)[a-z0-9_]{1,30}(?<!_)$/;

export type HelperNames = Partial<Record<HelperKey, string>>;

export function effectiveSuffixes(names: HelperNames | undefined): Record<HelperKey, string> {
  const out = {} as Record<HelperKey, string>;
  for (const s of HELPERS) out[s.key] = (names && Object.hasOwn(names, s.key) ? names[s.key] : undefined) || s.suffix;
  return out;
}

// Problems per key, in words: a suffix that isn't a slug, or that two keys
// share (checked on the suffixes as they would be used, defaults included).
export function helperNameErrors(names: HelperNames | undefined): Partial<Record<HelperKey, string>> {
  const out: Partial<Record<HelperKey, string>> = {};
  const eff = effectiveSuffixes(names);
  for (const s of HELPERS) {
    if (!HELPER_SUFFIX_RE.test(eff[s.key])) out[s.key] = "Use a–z, 0–9 and _, up to 30 characters, with no _ at either end or doubled.";
    // The occupied sensor of the recipes sits on this id.
    else if (s.domain === "binary_sensor" && eff[s.key] === RECIPE_HELPER_SUFFIX.occupied) out[s.key] = "Taxis uses this name for the occupied sensor of the recipes.";
    // The humidity rate sensor of the Bathroom fan recipe sits on this id.
    else if (s.domain === "sensor" && eff[s.key] === RECIPE_HELPER_SUFFIX.humidityRate) out[s.key] = "Taxis uses this name for the humidity rate sensor of the recipes.";
  }
  for (const s of HELPERS) {
    if (out[s.key]) continue;
    const other = HELPERS.find((o) => o.key !== s.key && eff[o.key] === eff[s.key]);
    if (other) out[s.key] = `${other.label} uses the same name.`;
  }
  return out;
}

export const canonicalId = (domain: HelperDomain, code: string, suffix: string) => `${domain}.${code}_${suffix}`;

// The helpers the recipes add to an area (shared/recipes.ts): the hold timer,
// the occupied sensor, the pause switch, the manual override timer, the climate
// schedule and the humidity rate sensor. Their ids end like this and, unlike the
// helpers above, the ends are not settings.
export const RECIPE_HELPER_SUFFIX = { hold: "hold", occupied: "occupied", switch: "paused", override: "override", climate: "climate", humidityRate: "humidity_rate" } as const;

export const helperName = (areaName: string, spec: HelperSpec) => `${areaName} ${spec.nameWord}`;

// ---------------------------------------------------------------------------
// What the inventory should leave out: an area's own canonical helpers.
// ---------------------------------------------------------------------------

// The canonical ids that Home Assistant already holds as a group or a min/max
// helper, per area, and the area's occupied sensor when it is a template. Those
// appear in the Helpers views and must not count as the area's own sensors (the
// occupied sensor would feed the occupancy that makes it). A real sensor that
// happens to sit on a canonical id stays in the inventory: it is a conflict to
// show, not a helper.
export function helperExclusions(h: Hierarchy, naming: NamingSettings): (areaId: string) => ReadonlySet<string> {
  const codes = areaCodes(h, naming);
  const suffix = effectiveSuffixes(naming.helperNames);
  const cache = new Map<string, ReadonlySet<string>>();
  return (areaId) => {
    let out = cache.get(areaId);
    if (!out) {
      const set = new Set<string>();
      const code = codes[areaId]?.code;
      if (code) {
        for (const s of HELPERS) {
          const id = canonicalId(s.domain, code, suffix[s.key]);
          const e = h.entities[id];
          if (e && e.domain === s.domain && e.platform === s.helper) set.add(id);
        }
        const occupied = h.entities[`binary_sensor.${code}_${RECIPE_HELPER_SUFFIX.occupied}`];
        if (occupied?.platform === "template") set.add(occupied.entityId);
      }
      out = set;
      cache.set(areaId, out);
    }
    return out;
  };
}

// ---------------------------------------------------------------------------
// The plan.
// ---------------------------------------------------------------------------

export type HelperStatus = "in-place" | "update-members" | "adopt" | "create" | "conflict";

// Where a helper sits: in an area (every helper above), on a floor (the light
// group of the floor's areas) or in the house (the light group of the floors).
export type HelperLevel = "area" | "floor" | "house";

export type HelperRow = {
  level: HelperLevel;
  // Area rows: the area. A floor's or the house's group has none: it goes in no area.
  areaId: string | null;
  // The name of the area, of the floor, or "House".
  areaName: string;
  // Floor rows: the floor.
  floorId: string | null;
  key: HelperKey;
  // The entity id this helper should have, and the name it is created with.
  canonicalId: string;
  name: string;
  helper: "group" | "min_max";
  groupType?: "light" | "binary_sensor" | "media_player";
  // The counted entities that feed it, by entity id. A floor's or the house's
  // group: the light groups it gathers.
  sources: string[];
  status: HelperStatus;
  // A min/max helper's members can't be read, so "in place" is not checked.
  membersUnknown?: boolean;
  // update-members, and adopt with membersDiffer: how the members change.
  added: string[];
  removed: string[];
  // update-members: members of the group that are not in Home Assistant any more
  // (they are among `removed`), and, for a group that is unavailable and reports
  // no members, that they could not be read, so `removed` is not known.
  missing?: string[];
  membersUnreadable?: boolean;
  // adopt: the group that is renamed to the canonical id.
  adoptFrom?: string;
  adoptFromName?: string;
  // adopt: the group shares most of its members but not all, so Taxis also
  // updates them.
  membersDiffer?: boolean;
  // conflict: who holds the canonical id, and why Taxis can't use it.
  heldBy?: string;
  heldByName?: string;
  conflict?: "taken" | "not-editable";
  // temperature and humidity: the area's own setting doesn't point at the
  // canonical sensor yet, and the plan sets it.
  areaSensor?: { field: "temperature_entity_id" | "humidity_entity_id"; current: string | null };
  // True when the row proposes something.
  actionable: boolean;
};

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
const missingFrom = (a: readonly string[], b: readonly string[]) => a.filter((x) => !b.includes(x));

function sourcesOf(inv: AreaInventory, key: HelperKey): string[] {
  const rows = key === "media" ? [...inv.speaker, ...inv.tv] : inv[key];
  return rows.filter((r) => r.counts).map((r) => r.entityId).sort();
}

const AREA_SENSOR = { temperature: "temperature_entity_id", humidity: "humidity_entity_id" } as const;

// A group Taxis may rename: it is a group helper of the right domain with
// members, in the registry, and not one of the canonical ids of any area.
function adoptable(e: EntityItem, spec: HelperSpec, taken: ReadonlySet<string>): boolean {
  return e.platform === "group" && e.domain === spec.domain && e.members.length > 0 && !e.disabled && e.inRegistry && !taken.has(e.entityId);
}

// The name of the light group of the whole house.
export const HOUSE_GROUP_NAME = "All lights";

// `changes`: the change list. A light group an area is about to get (created, or
// renamed from another group) counts as having one, so the floor and house groups
// can be planned in the same sitting.
// A code names every helper and recipe of an area, so sharing one would make
// two rooms write the same HA objects. Recheck inferred codes on every plan.
export function areaCodeConflicts(h: Hierarchy, naming: NamingSettings): Map<string, string> {
  const conflicts = new Map<string, string>();
  for (const [code, ids] of duplicateCodes(areaCodes(h, naming))) {
    const message = `Area code “${code}” is shared by ${ids.map(id => h.areas[id].name).join(" and ")}. Choose unique area codes in Settings.`;
    for (const id of ids) conflicts.set(id, message);
  }
  return conflicts;
}

export function planHelpers(h: Hierarchy, inventory: InventorySettings, naming: NamingSettings, changes: readonly Change[] = []): HelperRow[] {
  const codes = areaCodes(h, naming);
  const conflicts = areaCodeConflicts(h, naming);
  const floors = floorCodes(h, naming);
  const suffix = effectiveSuffixes(naming.helperNames);
  const exclusions = helperExclusions(h, naming);
  const lightSpec = HELPER_SPEC.lights;
  const houseId = houseGroupId(naming);
  const floorIds = new Map(h.floors.map((f) => [f.id, canonicalId("light", floors[f.id].code, suffix.lights)]));
  // Every canonical id of every area, and who it is for: none of them is a group
  // to adopt, and no other helper may sit on it. The ids of the floors and the
  // house are added as their rows are planned.
  const reserved = new Map<string, string>();
  for (const area of Object.values(h.areas)) {
    for (const s of HELPERS) reserved.set(canonicalId(s.domain, codes[area.id].code, suffix[s.key]), helperName(area.name, s));
  }
  const everyCanonical = new Set<string>([...reserved.keys(), ...floorIds.values(), houseId]);
  const groups = Object.values(h.entities).filter((e) => e.platform === "group" && e.members.length > 0);
  // A group is adopted by one row only.
  const claimed = new Set<string>();
  const taken = (): ReadonlySet<string> => new Set([...everyCanonical, ...claimed]);
  const rows: HelperRow[] = [];

  // What Home Assistant holds at the row's canonical id (or a group to adopt)
  // makes the row: in place, update members, adopt, create or conflict.
  const settle = (row: HelperRow, spec: HelperSpec, area: AreaNode | null) => {
    const id = row.canonicalId;
    const sources = row.sources;
    const conflict = area && conflicts.get(area.id);
    if (conflict) {
      Object.assign(row, { status: "conflict", conflict: "taken", heldBy: id, heldByName: conflict, actionable: false });
      return;
    }
    const held = h.entities[id];
    if (held) {
      const mine = held.domain === spec.domain && held.platform === spec.helper;
      if (!mine) {
        Object.assign(row, { status: "conflict", conflict: "taken", heldBy: id, heldByName: held.name, actionable: false });
      } else if (spec.helper === "min_max") {
        Object.assign(row, { status: "in-place", membersUnknown: true, actionable: false });
      } else if (isSilentGroup(held) && held.configEntryId) {
        // A group helper that is unavailable reports no members (Home Assistant leaves
        // them out while it is). It is unavailable because none of its members is
        // there, so it is given the area's counted entities.
        Object.assign(row, { status: "update-members", added: sources, removed: [], membersUnreadable: true });
      } else if (held.members.length === 0) {
        // A group that reports no members: nothing to compare.
        Object.assign(row, { status: "in-place", membersUnknown: true, actionable: false });
      } else {
        const added = missingFrom(sources, held.members);
        const removed = missingFrom(held.members, sources);
        if (added.length === 0 && removed.length === 0) Object.assign(row, { status: "in-place", actionable: false });
        // Members can only be changed on a helper set up in the UI.
        else if (!held.configEntryId) Object.assign(row, { status: "conflict", conflict: "not-editable", heldBy: id, heldByName: held.name, actionable: false });
        else Object.assign(row, { status: "update-members", added, removed, missing: held.members.filter((m) => !h.entities[m]) });
      }
    } else if (spec.helper === "group") {
      const free = taken();
      const candidates = groups.filter((e) => adoptable(e, spec, free));
      const rank = (e: EntityItem) => (area && e.areaId === area.id ? 0 : 1);
      const byName = (a: EntityItem, b: EntityItem) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.entityId.localeCompare(b.entityId);
      const exact = candidates.filter((e) => sameSet(e.members, sources)).sort(byName)[0];
      if (exact) {
        Object.assign(row, { status: "adopt", adoptFrom: exact.entityId, adoptFromName: exact.name });
      } else if (area) {
        // Not the same members, but the same group in all but a few: adopt it
        // and bring its members in line. Only a group in this area, set up in
        // the UI, so its members can be edited.
        const near = candidates
          .filter((e) => e.areaId === area.id && e.configEntryId)
          .map((e) => ({ e, shared: e.members.filter((m) => sources.includes(m)).length }))
          .filter(({ e, shared }) => shared >= 1 && shared * 2 >= e.members.length)
          .sort((a, b) => b.shared - a.shared || a.e.members.length - b.e.members.length || byName(a.e, b.e))[0];
        if (near) {
          Object.assign(row, {
            status: "adopt",
            adoptFrom: near.e.entityId,
            adoptFromName: near.e.name,
            membersDiffer: true,
            added: missingFrom(sources, near.e.members),
            removed: missingFrom(near.e.members, sources),
          });
        }
      }
      if (row.adoptFrom) claimed.add(row.adoptFrom);
    }
  };

  for (const area of Object.values(h.areas)) {
    const inv = areaInventory(h, inventory, area.id, exclusions(area.id));
    const code = codes[area.id].code;
    for (const spec of HELPERS) {
      const sources = sourcesOf(inv, spec.key);
      if (sources.length < spec.min) continue;
      const id = canonicalId(spec.domain, code, suffix[spec.key]);
      if (!ENTITY_ID_RE.test(id)) continue;

      const row: HelperRow = {
        level: "area",
        areaId: area.id,
        areaName: area.name,
        floorId: null,
        key: spec.key,
        canonicalId: id,
        name: helperName(area.name, spec),
        helper: spec.helper,
        groupType: spec.groupType,
        sources,
        status: "create",
        added: [],
        removed: [],
        actionable: true,
      };
      settle(row, spec, area);

      // The area's temperature and humidity setting should point at the
      // canonical sensor, whether it exists or is about to.
      if ((spec.key === "temperature" || spec.key === "humidity") && (row.status === "create" || row.status === "in-place")) {
        const field = AREA_SENSOR[spec.key];
        const current = spec.key === "temperature" ? area.temperatureEntityId : area.humidityEntityId;
        if (current !== id) {
          row.areaSensor = { field, current };
          row.actionable = true;
        }
      }
      rows.push(row);
    }
  }

  // ---- Floors and the house -----------------------------------------------
  // A floor's light group gathers the light groups of its areas, and the house's
  // gathers the floors' and those of the areas on no floor. Only the groups that
  // are there (or about to be, in the change list) are members: a group that
  // doesn't exist can't be nested, and adding it to the list makes the next plan
  // include it.
  const isGroup = (id: string) => h.entities[id]?.domain === "light" && h.entities[id]?.platform === "group";
  const incoming = (id: string) => changes.some((c) => (c.kind === "helper" && c.op === "create" && c.after.entity_id === id) || (c.kind === "entity" && c.after.new_entity_id === id));
  const willExist = (id: string) => isGroup(id) || incoming(id);
  const areaGroup = (areaId: string) => canonicalId("light", codes[areaId].code, suffix.lights);

  const groupRow = (level: "floor" | "house", id: string, name: string, scopeName: string, floorId: string | null, members: readonly string[], codeConflict?: string): HelperRow | null => {
    if (members.length === 0 || !ENTITY_ID_RE.test(id)) return null;
    const row: HelperRow = {
      level,
      areaId: null,
      areaName: scopeName,
      floorId,
      key: "lights",
      canonicalId: id,
      name,
      helper: "group",
      groupType: "light",
      sources: [...new Set(members)].sort(),
      status: "create",
      added: [],
      removed: [],
      actionable: true,
    };
    if (codeConflict) {
      Object.assign(row, { status: "conflict", conflict: "taken", heldBy: id, heldByName: codeConflict, actionable: false });
      return row;
    }
    const by = reserved.get(id);
    if (by) {
      Object.assign(row, { status: "conflict", conflict: "taken", heldBy: id, heldByName: by, actionable: false });
      return row;
    }
    reserved.set(id, name);
    settle(row, lightSpec, null);
    return row;
  };

  // The floors' groups that belong to Taxis: planned, or already there without a row.
  const floorMembers: string[] = [];
  for (const floor of h.floors) {
    const id = floorIds.get(floor.id)!;
    const free = !reserved.has(id);
    const members = floor.areaIds.filter((a) => h.areas[a]).map(areaGroup).filter(willExist);
    const row = groupRow("floor", id, `${floor.name} ${lightSpec.nameWord}`, floor.name, floor.id, members, floor.areaIds.map(a => conflicts.get(a)).find(Boolean));
    if (row) {
      rows.push(row);
      if (row.status !== "conflict") floorMembers.push(id);
    } else if (free && isGroup(id)) {
      floorMembers.push(id);
      reserved.set(id, `${floor.name} ${lightSpec.nameWord}`);
    }
  }
  const looseMembers = h.looseAreaIds.filter((a) => h.areas[a]).map(areaGroup).filter(willExist);
  const house = groupRow("house", houseId, HOUSE_GROUP_NAME, "House", null, [...floorMembers.filter(willExist), ...looseMembers], conflicts.values().next().value);
  if (house) rows.push(house);
  return rows;
}

// The row an area has for a helper, or undefined when the area doesn't get one
// (nothing counted for it, or too few players for a media group).
export const areaHelperRow = (rows: readonly HelperRow[], areaId: string, key: HelperKey): HelperRow | undefined => rows.find((r) => r.level === "area" && r.areaId === areaId && r.key === key);

// ---------------------------------------------------------------------------
// Rows and the change list.
// ---------------------------------------------------------------------------

// True when the change list already holds a change for this row: a helper being
// created or updated, the group being renamed to the canonical id, or the
// area's sensor being pointed at it.
export function hasPendingChange(row: HelperRow, changes: readonly Change[]): boolean {
  return changes.some((c) => {
    if (c.kind === "helper") return c.targetId === row.canonicalId || c.after.entity_id === row.canonicalId || (row.adoptFrom !== undefined && c.targetId === row.adoptFrom);
    if (c.kind === "entity") return c.after.new_entity_id === row.canonicalId || (row.adoptFrom !== undefined && c.targetId === row.adoptFrom && c.after.new_entity_id !== undefined);
    if (c.kind === "area") return Boolean(row.areaSensor) && row.areaId !== null && c.targetId === row.areaId && c.after[row.areaSensor!.field] === row.canonicalId;
    return false;
  });
}

// What adding a row to the change list means, as the edits to send in order.
// Adopting renames the group (Apply rewrites what uses the old id); when its
// members differ, a members update follows, aimed at the id the group has now.
// An area setting alone is a small area update.
export function helperChangeInputs(row: HelperRow): ChangeInput[] {
  switch (row.status) {
    case "adopt": {
      const out: ChangeInput[] = [{ kind: "entity", op: "update", targetId: row.adoptFrom!, fields: { new_entity_id: row.canonicalId } }];
      if (row.membersDiffer) out.push({ kind: "helper", op: "update", targetId: row.adoptFrom!, fields: { entities: row.sources } });
      return out;
    }
    case "update-members":
      return [{ kind: "helper", op: "update", targetId: row.canonicalId, fields: { entities: row.sources } }];
    case "create":
      return [
        {
          kind: "helper",
          op: "create",
          fields: {
            helper: row.helper,
            ...(row.groupType ? { group_type: row.groupType } : {}),
            name: row.name,
            entity_id: row.canonicalId,
            entities: row.sources,
            // A floor's or the house's group goes in no area.
            ...(row.areaId !== null ? { area_id: row.areaId } : {}),
            ...(row.areaSensor ? { set_area_sensor: row.key as "temperature" | "humidity" } : {}),
          },
        },
      ];
    case "in-place":
      return row.areaSensor && row.areaId !== null ? [{ kind: "area", op: "update", targetId: row.areaId, fields: { [row.areaSensor.field]: row.canonicalId } }] : [];
    case "conflict":
      return [];
  }
}
