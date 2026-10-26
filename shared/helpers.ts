import { ENTITY_ID_RE } from "./changes.ts";
import { areaCodes, type NamingSettings } from "./naming.ts";
import { areaInventory, type AreaInventory, type InventorySettings } from "./inventory.ts";
import type { Change, ChangeInput, EntityItem, Hierarchy } from "./types.ts";

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
// the occupied sensor, the pause switch, the manual override timer and the
// climate schedule. Their ids end like this and, unlike the helpers above, the
// ends are not settings.
export const RECIPE_HELPER_SUFFIX = { hold: "hold", occupied: "occupied", switch: "paused", override: "override", climate: "climate" } as const;

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

export type HelperRow = {
  areaId: string;
  areaName: string;
  key: HelperKey;
  // The entity id this helper should have, and the name it is created with.
  canonicalId: string;
  name: string;
  helper: "group" | "min_max";
  groupType?: "light" | "binary_sensor" | "media_player";
  // The counted entities that feed it, by entity id.
  sources: string[];
  status: HelperStatus;
  // A min/max helper's members can't be read, so "in place" is not checked.
  membersUnknown?: boolean;
  // update-members, and adopt with membersDiffer: how the members change.
  added: string[];
  removed: string[];
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

export function planHelpers(h: Hierarchy, inventory: InventorySettings, naming: NamingSettings): HelperRow[] {
  const codes = areaCodes(h, naming);
  const suffix = effectiveSuffixes(naming.helperNames);
  const exclusions = helperExclusions(h, naming);
  // Every canonical id of every area: none of them is a group to adopt.
  const everyCanonical = new Set<string>();
  for (const area of Object.values(h.areas)) {
    for (const s of HELPERS) everyCanonical.add(canonicalId(s.domain, codes[area.id].code, suffix[s.key]));
  }
  const groups = Object.values(h.entities).filter((e) => e.platform === "group" && e.members.length > 0);
  // A group is adopted by one row only.
  const claimed = new Set<string>();
  const taken = (): ReadonlySet<string> => new Set([...everyCanonical, ...claimed]);
  const rows: HelperRow[] = [];

  for (const area of Object.values(h.areas)) {
    const inv = areaInventory(h, inventory, area.id, exclusions(area.id));
    const code = codes[area.id].code;
    for (const spec of HELPERS) {
      const sources = sourcesOf(inv, spec.key);
      if (sources.length < spec.min) continue;
      const id = canonicalId(spec.domain, code, suffix[spec.key]);
      if (!ENTITY_ID_RE.test(id)) continue;

      const row: HelperRow = {
        areaId: area.id,
        areaName: area.name,
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

      const held = h.entities[id];
      if (held) {
        const mine = held.domain === spec.domain && held.platform === spec.helper;
        if (!mine) {
          Object.assign(row, { status: "conflict", conflict: "taken", heldBy: id, heldByName: held.name, actionable: false });
        } else if (spec.helper === "min_max") {
          Object.assign(row, { status: "in-place", membersUnknown: true, actionable: false });
        } else if (held.members.length === 0) {
          // A group that reports no members: nothing to compare.
          Object.assign(row, { status: "in-place", membersUnknown: true, actionable: false });
        } else {
          const added = missingFrom(sources, held.members);
          const removed = missingFrom(held.members, sources);
          if (added.length === 0 && removed.length === 0) Object.assign(row, { status: "in-place", actionable: false });
          // Members can only be changed on a helper set up in the UI.
          else if (!held.configEntryId) Object.assign(row, { status: "conflict", conflict: "not-editable", heldBy: id, heldByName: held.name, actionable: false });
          else Object.assign(row, { status: "update-members", added, removed });
        }
      } else if (spec.helper === "group") {
        const free = taken();
        const candidates = groups.filter((e) => adoptable(e, spec, free));
        const rank = (e: EntityItem) => (e.areaId === area.id ? 0 : 1);
        const byName = (a: EntityItem, b: EntityItem) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.entityId.localeCompare(b.entityId);
        const exact = candidates.filter((e) => sameSet(e.members, sources)).sort(byName)[0];
        if (exact) {
          Object.assign(row, { status: "adopt", adoptFrom: exact.entityId, adoptFromName: exact.name });
        } else {
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
  return rows;
}

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
    if (c.kind === "area") return Boolean(row.areaSensor) && c.targetId === row.areaId && c.after[row.areaSensor!.field] === row.canonicalId;
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
            area_id: row.areaId,
            ...(row.areaSensor ? { set_area_sensor: row.key as "temperature" | "humidity" } : {}),
          },
        },
      ];
    case "in-place":
      return row.areaSensor ? [{ kind: "area", op: "update", targetId: row.areaId, fields: { [row.areaSensor.field]: row.canonicalId } }] : [];
    case "conflict":
      return [];
  }
}
