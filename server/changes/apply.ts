import { applyLabelDiff, currentValues, isTempId, labelDiff, sameValue } from "../../shared/changes.ts";
import type { Change, ChangeKind, Hierarchy } from "../../shared/types.ts";
import { buildHierarchy, type RawRegistry } from "../model/hierarchy.ts";

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

export type Writer = { write<T>(type: string, payload: Record<string, unknown>): Promise<T> };

const ORDER: ChangeKind[] = ["floor", "label", "category", "area", "device", "entity"];
const DELETE_ORDER: ChangeKind[] = ["area", "floor", "label", "category"];

const REGISTRY: Record<ChangeKind, string> = {
  floor: "config/floor_registry",
  area: "config/area_registry",
  label: "config/label_registry",
  category: "config/category_registry",
  device: "config/device_registry",
  entity: "config/entity_registry",
};

const ID_KEY: Record<ChangeKind, string> = {
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
  hidden_by: "hidden setting",
  disabled_by: "disabled setting",
};

export type Outcome = { changeId: number; ok: boolean; message: string };

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
  changes: Change[],
  ha: Writer,
  readFresh: () => Promise<RawRegistry>,
): Promise<{ results: Outcome[]; appliedIds: number[]; realIds: Map<string, string> }> {
  const realIds = new Map<string, string>();
  const outcome = new Map<number, Outcome>();
  const sent = new Map<number, Record<string, unknown>>();
  const fail = (c: Change, message: string) => outcome.set(c.id, { changeId: c.id, ok: false, message });

  const before = buildHierarchy(await readFresh(), "");

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
    const now = c.op === "update" ? currentValues(before, c.kind, c.targetId, c.scope) ?? {} : {};
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
      payload[ID_KEY[c.kind]] = target.value;
    }
    return payload;
  };

  const prepared = new Map<number, Record<string, unknown>>();
  for (const c of changes) {
    const p = payloadFor(c);
    if (typeof p === "string") fail(c, p);
    else prepared.set(c.id, p);
  }

  const run = async (c: Change) => {
    if (outcome.has(c.id) || sent.has(c.id)) return;
    const base = prepared.get(c.id);
    if (!base) return;
    const payload = finish(c, base);
    if (typeof payload === "string") return fail(c, payload);
    try {
      const result = await ha.write<Record<string, unknown>>(`${REGISTRY[c.kind]}/${c.op}`, payload);
      sent.set(c.id, payload);
      if (c.op === "create") {
        const newId = result?.[ID_KEY[c.kind]];
        if (typeof newId !== "string") throw new Error("Home Assistant didn't return the new id.");
        realIds.set(c.targetId, newId);
      }
    } catch (e) {
      fail(c, `Home Assistant refused it: ${(e as Error).message}`);
    }
  };

  const of = (op: Change["op"], kinds: ChangeKind[]) => kinds.flatMap((k) => changes.filter((x) => x.op === op && x.kind === k));

  // 1. Creations. A clash with a name this list deletes or renames away is
  // resolved by running that change first.
  for (const c of of("create", ORDER)) {
    if (outcome.has(c.id)) continue;
    const clash = namesOf(before, c.kind, c.scope).find((x) => nameKey(c.kind, x.name) === nameKey(c.kind, c.after.name));
    if (clash) {
      const freeing = changes.find(
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
        fail(c, `Home Assistant already has ${c.kind === "area" ? "an" : "a"} ${c.kind} named “${String(c.after.name)}”, and the change that frees the name didn't go through.`);
        continue;
      }
    }
    await run(c);
  }
  // 2. Updates. 3. Deletions.
  for (const c of of("update", ORDER)) await run(c);
  for (const c of of("delete", DELETE_ORDER)) await run(c);

  // 4. Check every written change against a fresh read.
  if (sent.size > 0) {
    let after: RawRegistry | null = null;
    try {
      after = await readFresh();
    } catch (e) {
      for (const c of changes) {
        if (!sent.has(c.id)) continue;
        // A creation Home Assistant answered with an id exists, read or not.
        if (c.op === "create") outcome.set(c.id, { changeId: c.id, ok: true, message: "Created (not re-read)." });
        else fail(c, `Sent, but Taxis couldn't read Home Assistant back to check it: ${(e as Error).message}`);
      }
    }
    if (after) {
      const deletedLabels = new Set(changes.filter((x) => x.kind === "label" && x.op === "delete" && sent.has(x.id)).map((x) => x.targetId));
      for (const c of changes) {
        const payload = sent.get(c.id);
        if (!payload) continue;
        const problem = verify(c, payload, after, realIds, deletedLabels);
        if (!problem) outcome.set(c.id, { changeId: c.id, ok: true, message: "Applied." });
        // A creation that happened is done even if a detail differs: sending it
        // again would only fail on the name.
        else if (c.op === "create" && realIds.has(c.targetId) && !problem.startsWith("Home Assistant doesn't show")) {
          outcome.set(c.id, { changeId: c.id, ok: true, message: `Created, but ${problem.charAt(0).toLowerCase()}${problem.slice(1)}` });
        } else fail(c, problem);
      }
    }
  }

  const results = changes.map((c) => outcome.get(c.id) ?? { changeId: c.id, ok: false, message: "Not sent." });
  return { results, appliedIds: results.filter((r) => r.ok).map((r) => r.changeId), realIds };
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
  const item = findRaw(fresh, c, id);
  // A new item with the same name can get the same id (Home Assistant derives
  // ids from names), so an id this Apply just created doesn't count as left over.
  if (c.op === "delete") return item && ![...realIds.values()].includes(id) ? "Home Assistant still has it." : null;
  if (!item) return c.op === "create" ? "Home Assistant doesn't show it after creating it." : "It's no longer in Home Assistant.";

  for (const [key, expected] of Object.entries(payload)) {
    if (key === "scope" || key === ID_KEY[c.kind]) continue;
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

function findRaw(fresh: RawRegistry, c: Change, id: string): Record<string, unknown> | undefined {
  const find = <T,>(list: T[] | undefined, key: string) =>
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
  }
}
