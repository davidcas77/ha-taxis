import { describe, expect, it } from "vitest";

import { addGroup, deleteGroup, groupOf, listKeyFor, moveItem, pruneGroups, renameGroup, sectionsFor, shiftGroup, type GroupSettings } from "./groups.ts";

const items = [
  { id: "b", name: "Bravo" },
  { id: "a", name: "alpha" },
  { id: "c", name: "Charlie" },
];

const base = (): GroupSettings => addGroup(addGroup({}, "labels", "g1", "First"), "labels", "g2", " Second ");

describe("listKeyFor", () => {
  it("maps Organize types to list names", () => {
    expect(listKeyFor("labels")).toBe("labels");
    expect(listKeyFor("category-script")).toBe("category:script");
    expect(listKeyFor("category-nope")).toBeNull();
    expect(listKeyFor("devices")).toBeNull();
    expect(listKeyFor("constructor")).toBeNull();
  });
});

describe("sectionsFor", () => {
  it("lists groups in order, items by name, then Ungrouped", () => {
    const s = moveItem(moveItem(base(), "labels", "c", "g2"), "labels", "b", "g1");
    const out = sectionsFor(s, "labels", items);
    expect(out.map((x) => x.group?.name ?? null)).toEqual(["First", "Second", null]);
    expect(out.map((x) => x.items.map((i) => i.id))).toEqual([["b"], ["c"], ["a"]]);
  });

  it("ignores ids that are gone and puts everything in Ungrouped with no groups", () => {
    const s = moveItem(base(), "labels", "gone", "g1");
    expect(sectionsFor(s, "labels", items)[0].items).toEqual([]);
    expect(sectionsFor({}, "labels", items)).toEqual([{ group: null, items: [items[1], items[0], items[2]] }]);
  });
});

describe("edits", () => {
  it("moves an item out of its old group, and back to Ungrouped", () => {
    let s = moveItem(base(), "labels", "a", "g1");
    s = moveItem(s, "labels", "a", "g2");
    expect(groupOf(s, "labels", "a")).toBe("g2");
    expect(s.labels!.groups[0].items).toEqual([]);
    expect(groupOf(moveItem(s, "labels", "a", null), "labels", "a")).toBeNull();
  });

  it("doesn't move into a group that doesn't exist", () => {
    const s = base();
    expect(moveItem(s, "labels", "a", "nope")).toBe(s);
  });

  it("renames (trimmed), reorders and deletes", () => {
    let s = renameGroup(base(), "labels", "g1", "  Rooms ");
    expect(s.labels!.groups.map((g) => g.name)).toEqual(["Rooms", "Second"]);
    s = shiftGroup(s, "labels", "g1", 1);
    expect(s.labels!.groups.map((g) => g.id)).toEqual(["g2", "g1"]);
    expect(shiftGroup(s, "labels", "g1", 1)).toBe(s);
    s = deleteGroup(moveItem(s, "labels", "a", "g1"), "labels", "g1");
    expect(groupOf(s, "labels", "a")).toBeNull();
  });

  it("keeps each list apart", () => {
    const s = addGroup(base(), "category:scene", "x", "Scenes");
    expect(s.labels!.groups).toHaveLength(2);
    expect(s["category:scene"]!.groups).toHaveLength(1);
  });
});

describe("pruneGroups", () => {
  it("drops ids Home Assistant lacks, and leaves unknown lists alone", () => {
    let s = moveItem(moveItem(base(), "labels", "a", "g1"), "labels", "gone", "g1");
    s = moveItem(addGroup(s, "category:scene", "x", "S"), "category:scene", "keep", "x");
    const out = pruneGroups(s, { labels: new Set(["a"]) });
    expect(out.labels!.groups[0].items).toEqual(["a"]);
    expect(out["category:scene"]!.groups[0].items).toEqual(["keep"]);
  });
});
