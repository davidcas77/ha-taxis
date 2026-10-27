import type { Change } from "./types.ts";

// Applying one change on its own. A change can need another one in the list to be
// applied first: an area it moves something into, a helper the recipe uses, the
// blueprint an automation is made from, a rename whose new id a group lists.
// This works out which, from what each change provides and what it names. The
// order of applying is not decided here: the pipeline of "Apply all"
// (server/changes/all.ts) orders whatever it is given, so applying a part of the
// list goes through the same steps in the same order. Pure functions.

// What a change makes that another can name: the temporary id of a new item, the
// entity id of a new helper, the id a renamed entity gets, the path of a
// blueprint it writes.
export function provides(c: Change): Set<string> {
  const out = new Set<string>();
  if (c.op === "create") {
    out.add(c.targetId);
    if (typeof c.after.entity_id === "string") out.add(c.after.entity_id);
  }
  if (c.kind === "entity" && typeof c.after.new_entity_id === "string") out.add(c.after.new_entity_id);
  if (c.kind === "blueprint" && typeof c.after.path === "string") out.add(c.after.path);
  return out;
}

// Every string a change holds, however deep: an area id, a list of members, the
// inputs of a recipe.
function strings(v: unknown, out: Set<string>, depth = 0): void {
  if (typeof v === "string") out.add(v);
  else if (depth < 6 && Array.isArray(v)) for (const x of v) strings(x, out, depth + 1);
  else if (depth < 6 && v && typeof v === "object") for (const x of Object.values(v)) strings(x, out, depth + 1);
}

// What a change names, to be matched whole against what the others provide. A
// temporary id it targets counts too (an update of an item the list creates).
export function names(c: Change): Set<string> {
  const out = new Set<string>();
  strings(c.after, out);
  if (c.targetId) out.add(c.targetId);
  for (const own of provides(c)) out.delete(own);
  return out;
}

// The changes `id` needs, directly or through others, in the order of the list,
// not counting itself. Empty for an id that isn't in the list.
export function dependenciesOf(changes: readonly Change[], id: number): Change[] {
  const byId = new Map(changes.map((c) => [c.id, c]));
  if (!byId.has(id)) return [];
  const makers = new Map<string, Change[]>();
  for (const c of changes) {
    for (const token of provides(c)) makers.set(token, [...(makers.get(token) ?? []), c]);
  }
  const needed = new Set<number>();
  const visit = (c: Change) => {
    for (const token of names(c)) {
      for (const maker of makers.get(token) ?? []) {
        if (maker.id === c.id || needed.has(maker.id) || maker.id === id) continue;
        needed.add(maker.id);
        visit(maker);
      }
    }
  };
  visit(byId.get(id)!);
  return changes.filter((c) => needed.has(c.id));
}

// What applying `ids` alone takes: they and everything they need, in the order of
// the list. An id that isn't in the list is left out.
export function closureFor(changes: readonly Change[], ids: readonly number[]): Change[] {
  const want = new Set<number>();
  for (const id of ids) {
    if (!changes.some((c) => c.id === id)) continue;
    want.add(id);
    for (const d of dependenciesOf(changes, id)) want.add(d.id);
  }
  return changes.filter((c) => want.has(c.id));
}

// ---------------------------------------------------------------------------
// Renames: what has to be known and agreed before they are applied.
// ---------------------------------------------------------------------------

export const isRenameChange = (c: Change): boolean => c.kind === "entity" && c.op === "update" && typeof c.after.new_entity_id === "string";

// What Taxis found about where each renamed id is used (/api/references): how
// many places it can't rewrite, per rename.
export type RenameKnowledge = { loading: boolean; error: string | null; renames: readonly { changeId: number; manual: number }[] };

// For the renames among `scope` (what is about to be applied): the ones whose
// uses are not known yet (wait), and the ones that need an "I understand" first
// because places remain to update by hand, or because Taxis could not look.
export function renameGate(scope: readonly Change[], refs: RenameKnowledge, understood: ReadonlySet<number>): { waiting: number[]; needsAck: number[]; unacknowledged: number[] } {
  const waiting: number[] = [];
  const needsAck: number[] = [];
  for (const c of scope.filter(isRenameChange)) {
    const mine = refs.renames.find((r) => r.changeId === c.id);
    if (refs.error) needsAck.push(c.id);
    else if (!mine) waiting.push(c.id);
    else if (mine.manual > 0) needsAck.push(c.id);
  }
  return { waiting, needsAck, unacknowledged: needsAck.filter((id) => !understood.has(id)) };
}
