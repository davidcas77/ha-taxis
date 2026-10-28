import { applyLabelDiff, currentValues, isRegistryKind, isTempId, labelDiff, sameValue } from "../../shared/changes.ts";
import type { ApplyStatus, Change, ChangeKind, Hierarchy } from "../../shared/types.ts";
import { READS, type FreshRead } from "../ha/registry.ts";
import type { RestApi } from "../ha/rest.ts";
import { buildHierarchy, type RawRegistry } from "../model/hierarchy.ts";
import { findReferences, searchRelated, type Related } from "../references/find.ts";
import { mapLimit, snapshot, type ReferenceIO, type Snapshot } from "../references/snapshot.ts";
import { updateReferences, type RenamePair } from "../references/update.ts";

// Applying the change list to Home Assistant.
//
//   0. a fresh read, and every change checked against it: the item must still
//      exist, nothing it points at may have disappeared, and a field Home
//      Assistant changed since the edit was made is a conflict (reported, not
//      overwritten);
//   1. creations (floors, labels, categories, then areas), noting the id Home
//      Assistant gives each. A name clash with an item this list deletes or
//      renames runs that change first;
//   2. updates, with temporary ids replaced by those real ids. Labels are sent
//      as "what Home Assistant has now, plus what was added, minus what was
//      removed", so labels added elsewhere in the meantime survive;
//   3. deletions;
//   4. another fresh read, and every change checked against it. An update only
//      counts as applied when the read shows it.
//
// A change that fails doesn't stop the others, except the ones that depend on
// it (an area that was never created can't receive a device).
//
// Renaming an entity id (new_entity_id) adds to this, because Home Assistant
// renames only the registry entry and the state:
//
//   0b. before anything is written, what uses each old id is read: one snapshot
//       of every automation, script, scene and dashboard, and search/related
//       for each id. If that can't be read, the renames are not sent;
//   2b. once the renames are verified (step 4), the editable configs that use
//       an old id are rewritten in one pass with all the renames at once, each
//       after a last check that Home Assistant still holds what the snapshot
//       read, and read back after. Areas that use the old id as their
//       temperature or humidity sensor are pointed at the new one;
//   what can't be updated (YAML, helpers, a config changed meanwhile) is listed
//   in the change's `details`. The rename itself counts as done once the
//   registry shows it, whatever happened to the configs: it can't be sent
//   again, because the old id no longer exists.
//
// Two ways a rename can be left half done, both handled so nothing is lost:
//
//   - the registry rename landed but Taxis couldn't read it back, so the change
//     is still in the list under an old id that is gone. The next Apply sees the
//     new id and no old one, doesn't send the rename again, and goes on to the
//     configs (and to any other field of the change, now against the new id);
//   - the rename verified but another field of the same change didn't. The
//     change is reported as failed and comes back in `retargets`: the caller
//     points it at the new id, without the rename, so it stays in the list as an
//     ordinary update of what is left.
//
// A list without renames reads and writes exactly what it did before.
//
// Helper changes (a group, min/max, timer, input boolean or template sensor
// created, a group's members or a timer's duration updated) are not handled
// here: the caller passes them to applyHelperChanges (helpers.ts) once this has
// run, so a rename or a new area they depend on is already done. Likewise
// blueprints and recipe automations (recipes.ts), which come before and after
// the helpers.

export type Writer = { write<T>(type: string, payload: Record<string, unknown>): Promise<T> };

// What the rename step needs besides the writer: reads over the WebSocket and
// the REST client for automations, scripts and scenes.
export type RenameIO = {
  ha: ReferenceIO["ha"];
  rest: RestApi;
  // Where the snapshot of what uses the old ids is read from when Apply shares
  // its configs between steps; defaults to `rest`. Rewrites always go through
  // `rest`, after a last read of it.
  reads?: Pick<RestApi, "get">;
};

// A change that has to stay in the list, now as an update of `targetId`.
export type Retarget = { changeId: number; targetId: string; after: Record<string, unknown>; before: Record<string, unknown> };

export const isRename = (c: Change) => c.kind === "entity" && c.op === "update" && typeof c.after.new_entity_id === "string";

// The change without its rename, aimed at the entity's new id.
function withoutRename(c: Change, newId: string): Change {
  const after = { ...c.after };
  const was = { ...c.before };
  delete after.new_entity_id;
  delete was.new_entity_id;
  return { ...c, targetId: newId, after, before: was };
}

const LEFT_ALONE = "Not updated: automations, scripts, scenes and dashboards were left alone, because the rename wasn't confirmed. Check what uses the old id.";

// Helpers, blueprints, automations and scripts are not registry items: they have
// steps of their own (helpers.ts, recipes.ts), after this one.
type RegistryKind = Exclude<ChangeKind, "helper" | "blueprint" | "automation" | "script">;

const ORDER: RegistryKind[] = ["floor", "label", "category", "area", "device", "entity"];
const DELETE_ORDER: RegistryKind[] = ["area", "floor", "label", "category"];

const REGISTRY: Record<RegistryKind, string> = {
  floor: "config/floor_registry",
  area: "config/area_registry",
  label: "config/label_registry",
  category: "config/category_registry",
  device: "config/device_registry",
  entity: "config/entity_registry",
};

const ID_KEY: Record<RegistryKind, string> = {
  floor: "floor_id",
  area: "area_id",
  label: "label_id",
  category: "category_id",
  device: "device_id",
  entity: "entity_id",
};

const FIELD_NAMES: Record<string, string> = {
  name: "name",
  name_by_user: "name",
  area_id: "area",
  floor_id: "floor",
  icon: "icon",
  level: "level",
  color: "color",
  description: "description",
  new_entity_id: "entity id",
  hidden_by: "hidden setting",
  disabled_by: "disabled setting",
  device_class: "device class",
  temperature_entity_id: "temperature sensor",
  humidity_entity_id: "humidity sensor",
};

// details: for a rename, what was updated and what still needs a hand.
export type Outcome = { changeId: number; ok: boolean; message: string; details?: string[]; status?: ApplyStatus };

// Names Home Assistant treats as the same: categories compare case-folded;
// floors, areas and labels also ignore spaces.
const nameKey = (kind: ChangeKind, v: unknown) => {
  const s = String(v ?? "").toLowerCase();
  return kind === "category" ? s : s.split(" ").join("");
};

function exists(h: Hierarchy, kind: ChangeKind, id: string, scope: Change["scope"]): boolean {
  return currentValues(h, kind, id, scope) !== null;
}

function namesOf(h: Hierarchy, kind: ChangeKind, scope: Change["scope"]): { id: string; name: string }[] {
  switch (kind) {
    case "floor":
      return h.floors.map((f) => ({ id: f.id, name: f.name }));
    case "area":
      return Object.values(h.areas).map((a) => ({ id: a.id, name: a.name }));
    case "label":
      return Object.values(h.labels).map((l) => ({ id: l.id, name: l.name }));
    case "category":
      return scope ? h.categories[scope].map((c) => ({ id: c.id, name: c.name })) : [];
    default:
      return [];
  }
}

export async function applyChanges(
  // Helper, blueprint, automation and script changes in the list are left to their
  // own steps and get no result here.
  all: Change[],
  ha: Writer,
  readFresh: FreshRead,
  // Needed to rename entity ids with what uses them; without it a rename only
  // changes the registry.
  rename?: RenameIO,
): Promise<{ results: Outcome[]; appliedIds: number[]; realIds: Map<string, string>; retargets: Retarget[]; renamed: Map<string, string> }> {
  const changes = all.filter((c) => isRegistryKind(c.kind));
  // A list of only helpers, blueprints, recipes and scripts has nothing to do
  // here. Reading the registries to find that out used to cost a full read per Apply.
  if (changes.length === 0) return { results: [], appliedIds: [], realIds: new Map(), retargets: [], renamed: new Map() };
  const realIds = new Map<string, string>();
  const outcome = new Map<number, Outcome>();
  const sent = new Map<number, Record<string, unknown>>();
  const fail = (c: Change, message: string) => outcome.set(c.id, { changeId: c.id, ok: false, message });

  // The hierarchy and, for a rename, the states. Not Home Assistant's name or
  // its integration list.
  const beforeRaw = await readFresh(READS.hierarchy);
  const before = buildHierarchy(beforeRaw, "");

  // A rename whose old id is gone and whose new id exists already happened (an
  // earlier Apply sent it but couldn't confirm it). It is not sent again; the
  // rest of the change works against the new id.
  const renameOf = new Map<number, RenamePair>(
    changes.filter(isRename).map((c) => [c.id, { changeId: c.id, oldId: c.targetId, newId: String(c.after.new_entity_id) }]),
  );
  const resumed = new Set<number>();
  for (const r of renameOf.values()) {
    if (!exists(before, "entity", r.oldId, null) && exists(before, "entity", r.newId, null)) resumed.add(r.changeId);
  }
  const work = changes.map((c) => (resumed.has(c.id) ? withoutRename(c, renameOf.get(c.id)!.newId) : c));
  // Renames the registry is known to show: resumed ones, and those verified below.
  const confirmed = new Set<number>(resumed);

  // Only id fields are resolved: a name that happens to start with "new:" is
  // just a name.
  const resolveId = (v: unknown): { ok: true; value: unknown } | { ok: false; missing: string } => {
    if (!isTempId(v)) return { ok: true, value: v };
    const real = realIds.get(v);
    return real ? { ok: true, value: real } : { ok: false, missing: v };
  };

  // 0. Check every change against the fresh read and build what will be sent.
  const payloadFor = (c: Change): Record<string, unknown> | string => {
    if (c.op !== "create" && !isTempId(c.targetId) && !exists(before, c.kind, c.targetId, c.scope)) {
      return `It's no longer in Home Assistant.`;
    }
    const now = c.op === "update" ? (currentValues(before, c.kind, c.targetId, c.scope) ?? {}) : {};
    const payload: Record<string, unknown> = {};
    for (const [key, wanted] of Object.entries(c.after)) {
      if (c.op === "create" && (wanted === null || wanted === undefined)) continue;
      if (key === "labels") {
        const d = labelDiff(c)!;
        // A label the change adds must still exist (Home Assistant would drop an
        // unknown one without a word). New labels from this list are checked
        // when they're resolved.
        const gone = d.added.find((l) => !isTempId(l) && !before.labels[l]);
        if (gone) return `The label “${gone}” it adds is no longer in Home Assistant.`;
        payload.labels = applyLabelDiff(c.op === "update" ? ((now.labels as string[]) ?? []) : [], d);
        continue;
      }
      if (key === "categories") {
        const nowCats = (now.categories ?? {}) as Record<string, string>;
        const wasCats = (c.before.categories ?? {}) as Record<string, string | null>;
        for (const [scope, cat] of Object.entries(wanted as Record<string, string | null>)) {
          const current = nowCats[scope] ?? null;
          if (current !== (wasCats[scope] ?? null) && current !== cat) {
            return `Its ${scope} category was changed in Home Assistant after you made this edit. Remove this change and edit it again.`;
          }
          // Home Assistant doesn't check that a category exists before storing it.
          if (cat && !isTempId(cat) && !before.categories[scope as keyof Hierarchy["categories"]]?.some((x) => x.id === cat)) {
            return `The ${scope} category it sets is no longer in Home Assistant.`;
          }
        }
        payload.categories = wanted;
        continue;
      }
      if (c.op === "update" && !sameValue(now[key], c.before[key]) && !sameValue(now[key], wanted)) {
        return `Its ${FIELD_NAMES[key] ?? key} was changed in Home Assistant after you made this edit (it's now ${JSON.stringify(now[key] ?? null)}). Remove this change and edit it again.`;
      }
      // An area's temperature or humidity sensor has to be an entity Home Assistant has.
      if ((key === "temperature_entity_id" || key === "humidity_entity_id") && typeof wanted === "string" && !before.entities[wanted]) {
        return `The sensor it sets (${wanted}) is no longer in Home Assistant.`;
      }
      payload[key] = wanted;
    }
    return payload;
  };

  const finish = (c: Change, base: Record<string, unknown>): Record<string, unknown> | string => {
    const payload = { ...base };
    for (const key of ["area_id", "floor_id"]) {
      if (!(key in payload)) continue;
      const r = resolveId(payload[key]);
      if (!r.ok) return `It depends on a new ${key === "area_id" ? "area" : "floor"}, which wasn't created.`;
      payload[key] = r.value;
      if (r.value && !exists(before, key === "area_id" ? "area" : "floor", String(r.value), null) && !isTempId(base[key])) {
        return `The ${key === "area_id" ? "area" : "floor"} it points at is no longer in Home Assistant.`;
      }
    }
    if (Array.isArray(payload.labels)) {
      const out: unknown[] = [];
      for (const l of payload.labels) {
        const r = resolveId(l);
        if (!r.ok) return "It depends on a new label, which wasn't created.";
        out.push(r.value);
      }
      payload.labels = out;
    }
    if (payload.categories && typeof payload.categories === "object") {
      const out: Record<string, unknown> = {};
      for (const [scope, cat] of Object.entries(payload.categories)) {
        const r = resolveId(cat);
        if (!r.ok) return "It depends on a new category, which wasn't created.";
        out[scope] = r.value;
      }
      payload.categories = out;
    }
    if (c.scope) payload.scope = c.scope;
    if (c.op !== "create") {
      const target = resolveId(c.targetId);
      if (!target.ok) return "It depends on an item that wasn't created.";
      payload[ID_KEY[c.kind as RegistryKind]] = target.value;
    }
    return payload;
  };

  const prepared = new Map<number, Record<string, unknown>>();
  for (const c of work) {
    if (resumed.has(c.id) && Object.keys(c.after).length === 0) {
      outcome.set(c.id, { changeId: c.id, ok: true, message: "Applied (the rename was already in Home Assistant)." });
      continue;
    }
    const p = payloadFor(c);
    if (typeof p === "string") fail(c, p);
    else prepared.set(c.id, p);
  }

  // 0b. Renames: read what uses each old id before anything is written. If it
  // can't be read, the renames are not sent (renaming would leave automations
  // pointing at an id that no longer exists, with no way to say so).
  const renames = rename ? changes.filter((c) => renameOf.has(c.id) && (resumed.has(c.id) || prepared.has(c.id))) : [];
  let snap: Snapshot | null = null;
  const related = new Map<number, Related>();
  if (rename && renames.length > 0) {
    try {
      snap = await snapshot({ ha: rename.ha, rest: rename.reads ?? rename.rest }, beforeRaw.states, beforeRaw.entities);
      await mapLimit(renames, 6, async (c) => {
        related.set(c.id, await searchRelated(rename.ha, c.targetId));
      });
    } catch (e) {
      snap = null;
      for (const c of renames) {
        prepared.delete(c.id);
        confirmed.delete(c.id);
        const why = `Taxis couldn't check what uses it (${(e as Error).message}), so`;
        fail(c, resumed.has(c.id) ? `${why} it didn't update them.` : `${why} it wasn't renamed.`);
      }
    }
  }

  const run = async (c: Change) => {
    if (outcome.has(c.id) || sent.has(c.id)) return;
    const base = prepared.get(c.id);
    if (!base) return;
    const payload = finish(c, base);
    if (typeof payload === "string") return fail(c, payload);
    try {
      const result = await ha.write<Record<string, unknown>>(`${REGISTRY[c.kind as RegistryKind]}/${c.op}`, payload);
      sent.set(c.id, payload);
      if (c.op === "create") {
        const newId = result?.[ID_KEY[c.kind as RegistryKind]];
        if (typeof newId !== "string") throw new Error("Home Assistant didn't return the new id.");
        realIds.set(c.targetId, newId);
      }
    } catch (e) {
      fail(c, `Home Assistant refused it: ${(e as Error).message}`);
    }
  };

  const of = (op: Change["op"], kinds: ChangeKind[]) => kinds.flatMap((k) => work.filter((x) => x.op === op && x.kind === k));

  // 1. Creations. A clash with a name this list deletes or renames away is
  // resolved by running that change first.
  for (const c of of("create", ORDER)) {
    if (outcome.has(c.id)) continue;
    const clash = namesOf(before, c.kind, c.scope).find((x) => nameKey(c.kind, x.name) === nameKey(c.kind, c.after.name));
    if (clash) {
      const freeing = work.find(
        (x) =>
          x.kind === c.kind &&
          x.targetId === clash.id &&
          x.scope === c.scope &&
          (x.op === "delete" || (x.op === "update" && "name" in x.after && nameKey(c.kind, x.after.name) !== nameKey(c.kind, c.after.name))),
      );
      if (!freeing) {
        fail(c, `Home Assistant already has ${c.kind === "area" ? "an" : "a"} ${c.kind} named “${String(c.after.name)}”.`);
        continue;
      }
      await run(freeing);
      if (!sent.has(freeing.id)) {
        fail(
          c,
          `Home Assistant already has ${c.kind === "area" ? "an" : "a"} ${c.kind} named “${String(c.after.name)}”, and the change that frees the name didn't go through.`,
        );
        continue;
      }
    }
    await run(c);
  }
  // 2. Updates. 3. Deletions.
  for (const c of of("update", ORDER)) await run(c);
  for (const c of of("delete", DELETE_ORDER)) await run(c);

  // 4. Check every written change against a fresh read.
  let after: RawRegistry | null = null;
  if (sent.size > 0) {
    try {
      // Did the registry edits take? Only the registries can say.
      after = await readFresh(READS.registries);
    } catch (e) {
      for (const c of work) {
        if (!sent.has(c.id)) continue;
        // A creation Home Assistant answered with an id exists, read or not.
        if (c.op === "create") outcome.set(c.id, { changeId: c.id, ok: true, message: "Created (not re-read)." });
        else {
          fail(c, `Sent, but Taxis couldn't read Home Assistant back to check it: ${(e as Error).message}`);
          if (isRename(c)) outcome.get(c.id)!.details = [LEFT_ALONE];
        }
      }
    }
    if (after) {
      const deletedLabels = new Set(work.filter((x) => x.kind === "label" && x.op === "delete" && sent.has(x.id)).map((x) => x.targetId));
      for (const c of work) {
        const payload = sent.get(c.id);
        if (!payload) continue;
        const problem = verify(c, payload, after, realIds, deletedLabels);
        if (!problem) {
          outcome.set(c.id, { changeId: c.id, ok: true, message: "Applied." });
          if (isRename(c)) confirmed.add(c.id);
        }
        // A creation that happened is done even if a detail differs: sending it
        // again would only fail on the name.
        else if (c.op === "create" && realIds.has(c.targetId) && !problem.startsWith("Home Assistant doesn't show")) {
          outcome.set(c.id, { changeId: c.id, ok: true, message: `Created, but ${problem.charAt(0).toLowerCase()}${problem.slice(1)}` });
        }
        // Likewise a rename the registry shows: the old id is gone, so sending it
        // again could only fail. The change is not done, though: what else it
        // sets stays in the list under the new id (see `retargets`).
        else if (isRename(c) && renamedInRegistry(c, payload, after)) {
          confirmed.add(c.id);
          fail(c, `Renamed, but ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`);
        } else {
          fail(c, problem);
          if (isRename(c)) outcome.get(c.id)!.details = [LEFT_ALONE];
        }
      }
    }
  }

  // 2b. What used the old ids. Only for renames the registry shows (a resumed
  // one is judged by the read taken at the start).
  if (rename && snap) {
    const pairs: RenamePair[] = renames.filter((c) => confirmed.has(c.id)).map((c) => renameOf.get(c.id)!);
    if (pairs.length > 0) {
      const lines = await updateReferences(
        { ha: { command: (t, p) => rename.ha.command(t, p), write: (t, p) => ha.write(t, p) }, rest: rename.rest },
        snap,
        pairs,
      );
      const areaLines = await repointAreas(ha, after ?? beforeRaw, pairs);
      pairs.forEach((r, i) => {
        const details = [...(lines.get(r.changeId) ?? []), ...(areaLines.get(r.changeId) ?? [])];
        const found = findReferences(snap!, related.get(r.changeId) ?? {}, r.oldId);
        for (const m of found.manual) details.push(`Needs a hand: ${m.name}: ${m.reason}`);
        // Things that couldn't be read could be using the id; say so once.
        if (i === 0) for (const note of snap!.notes) details.push(`Not updated: ${note}. Check it by hand.`);
        const o = outcome.get(r.changeId);
        if (o) o.details = details;
      });
    }
  }

  // A rename the registry shows, in a change that is not done: what is left of
  // it goes on as an update of the new id.
  const retargets: Retarget[] = [];
  for (const c of changes) {
    if (!confirmed.has(c.id) || outcome.get(c.id)?.ok) continue;
    const rest = withoutRename(c, renameOf.get(c.id)!.newId);
    if (Object.keys(rest.after).length > 0) retargets.push({ changeId: c.id, targetId: rest.targetId, after: rest.after, before: rest.before });
  }

  const results = changes.map((c) => outcome.get(c.id) ?? { changeId: c.id, ok: false, message: "Not sent." });
  return {
    results,
    appliedIds: results.filter((r) => r.ok).map((r) => r.changeId),
    realIds,
    retargets,
    renamed: new Map([...renameOf.values()].filter((r) => confirmed.has(r.changeId)).map((r) => [r.oldId, r.newId])),
  };
}

// Null when Home Assistant now shows what was sent; otherwise what's different.
export function verify(
  c: Change,
  payload: Record<string, unknown>,
  fresh: RawRegistry,
  realIds: Map<string, string>,
  deletedLabels: Set<string> = new Set(),
): string | null {
  const id = realIds.get(c.targetId) ?? c.targetId;
  // A renamed entity is found under its new id, and must be gone from the old.
  const renamedTo = typeof payload.new_entity_id === "string" ? payload.new_entity_id : null;
  const item = findRaw(fresh, c, renamedTo ?? id);
  if (renamedTo && renamedTo !== id && findRaw(fresh, c, id)) return `Home Assistant still has an entity with the old id “${id}”.`;
  // A new item with the same name can get the same id (Home Assistant derives
  // ids from names), so an id this Apply just created doesn't count as left over.
  if (c.op === "delete") return item && ![...realIds.values()].includes(id) ? "Home Assistant still has it." : null;
  if (!item) return c.op === "create" ? "Home Assistant doesn't show it after creating it." : "It's no longer in Home Assistant.";

  for (const [key, expected] of Object.entries(payload)) {
    if (key === "scope" || key === ID_KEY[c.kind as RegistryKind]) continue;
    if (key === "new_entity_id") {
      if (item.entity_id !== expected)
        return `Its entity id reads ${JSON.stringify(item.entity_id ?? null)} in Home Assistant, not ${JSON.stringify(expected)}.`;
      continue;
    }
    if (key === "categories") {
      const now = (item.categories ?? {}) as Record<string, string>;
      for (const [scope, cat] of Object.entries(expected as Record<string, string | null>)) {
        if ((now[scope] ?? null) !== (cat ?? null)) return `Its ${scope} category didn't change.`;
      }
      continue;
    }
    if (key === "labels") {
      const want = (expected as string[]).filter((l) => !deletedLabels.has(l));
      if (!sameValue(item.labels ?? [], want)) return `Its labels read ${JSON.stringify(item.labels ?? [])} in Home Assistant, not ${JSON.stringify(want)}.`;
      continue;
    }
    if (!sameValue(item[key], expected)) {
      return `Its ${FIELD_NAMES[key] ?? key} reads ${JSON.stringify(item[key] ?? null)} in Home Assistant, not ${JSON.stringify(expected)}.`;
    }
  }
  return null;
}

// True when the fresh read shows the entity under its new id and not the old.
function renamedInRegistry(c: Change, payload: Record<string, unknown>, fresh: RawRegistry): boolean {
  return typeof payload.new_entity_id === "string" && !!findRaw(fresh, c, payload.new_entity_id) && !findRaw(fresh, c, c.targetId);
}

// Home Assistant leaves an area's temperature and humidity sensor on the old id
// when the entity is renamed: point them at the new one.
async function repointAreas(ha: Writer, fresh: RawRegistry, pairs: RenamePair[]): Promise<Map<number, string[]>> {
  const lines = new Map<number, string[]>(pairs.map((r) => [r.changeId, []]));
  const byOld = new Map(pairs.map((r) => [r.oldId, r]));
  const fields = [
    ["temperature_entity_id", "temperature sensor"],
    ["humidity_entity_id", "humidity sensor"],
  ] as const;
  for (const area of fresh.areas) {
    const hits = fields.flatMap(([field, label]) => {
      const r = byOld.get(area[field] ?? "");
      return r ? [{ field, label, r }] : [];
    });
    if (hits.length === 0) continue;
    const payload: Record<string, unknown> = { area_id: area.area_id };
    for (const h of hits) payload[h.field] = h.r.newId;
    let result: Record<string, unknown> | null = null;
    let problem: string | null = null;
    try {
      result = (await ha.write<Record<string, unknown> | null>("config/area_registry/update", payload)) ?? null;
    } catch (e) {
      problem = `Home Assistant refused it (${(e as Error).message})`;
    }
    for (const h of hits) {
      // The answer is the area as stored: when it shows another sensor, it didn't take.
      const stale = result && typeof result === "object" && h.field in result && result[h.field] !== h.r.newId;
      const what = `area “${area.name}” (${h.label})`;
      const line = problem
        ? `Not updated: ${what}: ${problem}. Change it by hand.`
        : stale
          ? `Not updated: ${what} still reads ${JSON.stringify(result![h.field])}. Check it in Home Assistant.`
          : `Updated ${what}`;
      lines.get(h.r.changeId)!.push(line);
    }
  }
  return lines;
}

function findRaw(fresh: RawRegistry, c: Change, id: string): Record<string, unknown> | undefined {
  const find = <T>(list: T[] | undefined, key: string) =>
    (list ?? []).find((x) => (x as Record<string, unknown>)[key] === id) as Record<string, unknown> | undefined;
  switch (c.kind) {
    case "floor":
      return find(fresh.floors, "floor_id");
    case "area":
      return find(fresh.areas, "area_id");
    case "label":
      return find(fresh.labels, "label_id");
    case "category":
      return find(c.scope ? fresh.categories?.[c.scope] : [], "category_id");
    case "device":
      return find(fresh.devices, "id");
    case "entity":
      return find(fresh.entities, "entity_id");
    case "helper":
    case "blueprint":
    case "automation":
    case "script":
      return undefined;
  }
}
