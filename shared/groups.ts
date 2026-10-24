// Groups for labels and categories. Home Assistant has no such thing, so they
// live only in Taxis: a list of named groups per list, each holding item ids.
// Only membership is stored; order inside a group is by name, at display time.
// Pure functions, no side effects.

export const GROUP_LISTS = ["labels", "category:automation", "category:script", "category:scene", "category:helpers"] as const;
export type GroupListKey = (typeof GROUP_LISTS)[number];

export type ItemGroup = { id: string; name: string; items: string[] };
export type ItemGroups = { groups: ItemGroup[] };
export type GroupSettings = Partial<Record<GroupListKey, ItemGroups>>;

export const MAX_GROUPS = 100;
export const MAX_ITEMS = 2000;
export const MAX_NAME = 60;
export const GROUP_ID = /^[a-z0-9_-]{1,40}$/;

// The list an Organize type uses ("category-script" -> "category:script"), or
// null for types that can't be grouped.
export function listKeyFor(type: string): GroupListKey | null {
  const key = type.startsWith("category-") ? `category:${type.slice(9)}` : type;
  return (GROUP_LISTS as readonly string[]).includes(key) ? (key as GroupListKey) : null;
}

const groupsOf = (s: GroupSettings, list: GroupListKey): ItemGroup[] => (Object.hasOwn(s, list) ? s[list]!.groups : []);

const withGroups = (s: GroupSettings, list: GroupListKey, groups: ItemGroup[]): GroupSettings => ({ ...s, [list]: { groups } });

export type Section = { group: ItemGroup | null; items: { id: string; name: string }[] };

// Sections for display: each group in order, then Ungrouped (group: null).
// Ids that aren't in `items` (gone from Home Assistant) are skipped. If an id
// somehow sits in two groups, the first one wins.
export function sectionsFor(s: GroupSettings, list: GroupListKey, items: { id: string; name: string }[]): Section[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const placed = new Set<string>();
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const out: Section[] = groupsOf(s, list).map((group) => {
    const mine = [];
    for (const id of group.items) {
      const item = byId.get(id);
      if (item && !placed.has(id)) {
        placed.add(id);
        mine.push(item);
      }
    }
    return { group, items: mine.sort(byName) };
  });
  out.push({ group: null, items: items.filter((i) => !placed.has(i.id)).sort(byName) });
  return out;
}

// The group an item is in, or null.
export const groupOf = (s: GroupSettings, list: GroupListKey, itemId: string): string | null => groupsOf(s, list).find((g) => g.items.includes(itemId))?.id ?? null;

// Put an item in a group (null: Ungrouped). Out of every other group first.
export function moveItem(s: GroupSettings, list: GroupListKey, itemId: string, groupId: string | null): GroupSettings {
  const groups = groupsOf(s, list);
  if (groupId !== null && !groups.some((g) => g.id === groupId)) return s;
  return withGroups(
    s,
    list,
    groups.map((g) => {
      const rest = g.items.filter((i) => i !== itemId);
      return { ...g, items: g.id === groupId ? [...rest, itemId] : rest };
    }),
  );
}

// A group id not used in this list yet.
export function newGroupId(s: GroupSettings, list: GroupListKey): string {
  const used = new Set(groupsOf(s, list).map((g) => g.id));
  for (;;) {
    const id = `g${Math.random().toString(36).slice(2, 10)}`;
    if (!used.has(id)) return id;
  }
}

export const addGroup = (s: GroupSettings, list: GroupListKey, id: string, name: string): GroupSettings => withGroups(s, list, [...groupsOf(s, list), { id, name: name.trim(), items: [] }]);

export const renameGroup = (s: GroupSettings, list: GroupListKey, id: string, name: string): GroupSettings =>
  withGroups(s, list, groupsOf(s, list).map((g) => (g.id === id ? { ...g, name: name.trim() } : g)));

// Its items fall back to Ungrouped.
export const deleteGroup = (s: GroupSettings, list: GroupListKey, id: string): GroupSettings => withGroups(s, list, groupsOf(s, list).filter((g) => g.id !== id));

export function shiftGroup(s: GroupSettings, list: GroupListKey, id: string, by: -1 | 1): GroupSettings {
  const groups = [...groupsOf(s, list)];
  const from = groups.findIndex((g) => g.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= groups.length) return s;
  [groups[from], groups[to]] = [groups[to], groups[from]];
  return withGroups(s, list, groups);
}

// Drop item ids that Home Assistant no longer has. A list with no entry in
// `live` is left as it is (nothing known about it).
export function pruneGroups(s: GroupSettings, live: Partial<Record<GroupListKey, ReadonlySet<string>>>): GroupSettings {
  const out: GroupSettings = {};
  for (const list of GROUP_LISTS) {
    if (!Object.hasOwn(s, list)) continue;
    const known = Object.hasOwn(live, list) ? live[list] : undefined;
    out[list] = { groups: s[list]!.groups.map((g) => ({ ...g, items: known ? g.items.filter((i) => known.has(i)) : g.items })) };
  }
  return out;
}
