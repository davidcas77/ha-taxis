import { describe, expect, it } from "vitest";

import { analyzeArea, DEFAULT_NAMING, type NamingRow } from "./naming.ts";
import { EMPTY_NAMING_IGNORES, allIgnored, anyIgnored, fieldIgnored, hasSuggestion, ignoreSuggestions, isIgnored, namingFit, readNamingIgnores, restoreSuggestions, splitIgnored } from "./naming-ignores.ts";
import type { Hierarchy } from "./types.ts";

const row = (over: Partial<NamingRow>): NamingRow => ({
  entityId: "light.hall_lamp",
  name: "Hall lamp",
  customName: null,
  status: "ok",
  foundPrefix: null,
  otherAreaId: null,
  suggestedId: null,
  suggestedName: null,
  editable: true,
  ...over,
});

describe("ignoring suggestions", () => {
  it("ignores both fields by default, sorted and once, and returns the same object when nothing changes", () => {
    const one = ignoreSuggestions(EMPTY_NAMING_IGNORES, ["light.b", "light.a", "light.b"]);
    expect(one).toEqual({ entities: { "light.a": { name: true, id: true }, "light.b": { name: true, id: true } } });
    expect(Object.keys(one.entities)).toEqual(["light.a", "light.b"]);
    expect(ignoreSuggestions(one, ["light.a"])).toBe(one);
    expect(isIgnored(one, "light.a")).toBe(true);
    expect(isIgnored(one, "light.c")).toBe(false);
  });

  it("ignores one field on its own, and adds the other later", () => {
    const name = ignoreSuggestions(EMPTY_NAMING_IGNORES, ["light.a"], ["name"]);
    expect(name).toEqual({ entities: { "light.a": { name: true } } });
    expect(isIgnored(name, "light.a", "name")).toBe(true);
    expect(isIgnored(name, "light.a", "id")).toBe(false);
    expect(isIgnored(name, "light.a")).toBe(true);
    expect(ignoreSuggestions(name, ["light.a"], ["name"])).toBe(name);
    expect(ignoreSuggestions(name, ["light.a"], ["id"])).toEqual({ entities: { "light.a": { name: true, id: true } } });
  });

  it("restores a field, and drops the entity once nothing is ignored", () => {
    const s = { entities: { "light.a": { name: true, id: true } as const, "light.b": { id: true } as const } };
    expect(restoreSuggestions(s, ["light.a"], ["name"])).toEqual({ entities: { "light.a": { id: true }, "light.b": { id: true } } });
    expect(restoreSuggestions(s, ["light.a"])).toEqual({ entities: { "light.b": { id: true } } });
    expect(restoreSuggestions(s, ["light.b"], ["name"])).toBe(s);
    expect(restoreSuggestions(s, ["light.z"])).toBe(s);
  });

  it("never mutates what it was given, and keeps a plain object", () => {
    const s = { entities: { "light.a": { name: true } as const } };
    ignoreSuggestions(s, ["light.b"]);
    restoreSuggestions(s, ["light.a"]);
    expect(s).toEqual({ entities: { "light.a": { name: true } } });
    expect(Object.getPrototypeOf(ignoreSuggestions(s, ["light.b"]).entities)).toBe(Object.prototype);
  });
});

describe("reading what was stored", () => {
  it("reads the older list of ids as both fields ignored", () => {
    expect(readNamingIgnores({ entities: ["light.b", "light.a"] })).toEqual({ ok: true, value: { entities: { "light.a": { name: true, id: true }, "light.b": { name: true, id: true } } } });
  });

  it("reads the current shape, drops false fields and entities with nothing ignored", () => {
    expect(readNamingIgnores({ entities: { "light.a": { name: true, id: false }, "light.b": { name: false } } })).toEqual({ ok: true, value: { entities: { "light.a": { name: true } } } });
  });

  it("refuses what it can't read", () => {
    for (const bad of [null, [], { entities: "x" }, { entities: [3] }, { entities: { "light.a": 1 } }, { entities: { "light.a": { icon: true } } }, { other: 1 }]) {
      expect(readNamingIgnores(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });
});

describe("hasSuggestion", () => {
  it("needs a name or an id suggestion on an entity that can be renamed", () => {
    expect(hasSuggestion(row({ suggestedName: "Hall Lamp" }))).toBe(true);
    expect(hasSuggestion(row({ suggestedId: "light.hall_lamp_2" }))).toBe(true);
    expect(hasSuggestion(row({}))).toBe(false);
    expect(hasSuggestion(row({ suggestedName: "x", editable: false }))).toBe(false);
  });
});

describe("per field", () => {
  const both = row({ entityId: "light.a", suggestedName: "A", suggestedId: "light.hall_a" });
  const onlyId = row({ entityId: "light.b", suggestedId: "light.hall_b" });
  const nameIgnored = ignoreSuggestions(EMPTY_NAMING_IGNORES, ["light.a", "light.b"], ["name"]);

  it("knows which field of a row is ignored; a field with no suggestion has nothing to ignore", () => {
    expect(fieldIgnored(both, nameIgnored, "name")).toBe(true);
    expect(fieldIgnored(both, nameIgnored, "id")).toBe(false);
    expect(fieldIgnored(onlyId, nameIgnored, "name")).toBe(false);
    expect(anyIgnored(both, nameIgnored)).toBe(true);
    expect(anyIgnored(onlyId, nameIgnored)).toBe(false);
    expect(anyIgnored(both, EMPTY_NAMING_IGNORES)).toBe(false);
  });

  it("is ignored altogether only when every suggestion of the row is", () => {
    expect(allIgnored(both, nameIgnored)).toBe(false);
    expect(allIgnored(both, ignoreSuggestions(nameIgnored, ["light.a"], ["id"]))).toBe(true);
    // The id is the only suggestion of onlyId, and the name was never one.
    expect(allIgnored(onlyId, ignoreSuggestions(EMPTY_NAMING_IGNORES, ["light.b"], ["id"]))).toBe(true);
    expect(allIgnored(row({ entityId: "light.c" }), ignoreSuggestions(EMPTY_NAMING_IGNORES, ["light.c"]))).toBe(false);
  });

  it("keeps a row with one suggestion left among the active ones, and does not count it as fine", () => {
    const rows = [row({ ...both, status: "old-prefix" })];
    expect(splitIgnored(rows, nameIgnored)).toEqual({ active: rows, ignored: [] });
    expect(namingFit({ rows }, nameIgnored)).toEqual({ fits: 0, total: 1, ignored: 0 });
    expect(namingFit({ rows }, ignoreSuggestions(nameIgnored, ["light.a"], ["id"]))).toEqual({ fits: 1, total: 1, ignored: 1 });
  });
});

describe("splitIgnored", () => {
  const rows = [row({ entityId: "light.a", suggestedName: "A" }), row({ entityId: "light.b", suggestedId: "light.hall_b" }), row({ entityId: "light.c" })];

  it("moves ignored rows with a suggestion out of the active ones", () => {
    const { active, ignored } = splitIgnored(rows, { entities: { "light.a": { name: true, id: true }, "light.c": { name: true, id: true } } });
    expect(ignored.map((r) => r.entityId)).toEqual(["light.a"]);
    // light.c has nothing to ignore, so it stays among the rows that fit.
    expect(active.map((r) => r.entityId)).toEqual(["light.b", "light.c"]);
  });

  it("keeps every row active when nothing is ignored", () => {
    expect(splitIgnored(rows, EMPTY_NAMING_IGNORES)).toEqual({ active: rows, ignored: [] });
  });
});

describe("namingFit", () => {
  it("counts an ignored row as fine whatever its prefix says", () => {
    const rows = [
      row({ entityId: "light.hall_a", status: "ok" }),
      row({ entityId: "light.old_b", status: "old-prefix", suggestedId: "light.hall_b" }),
      row({ entityId: "light.c", status: "no-area", suggestedName: "Hall C" }),
      row({ entityId: "light.hall_d", status: "ok", suggestedName: "Hall D" }),
    ];
    expect(namingFit({ rows }, EMPTY_NAMING_IGNORES)).toEqual({ fits: 2, total: 4, ignored: 0 });
    // The ok row that is ignored is counted once, not twice.
    expect(namingFit({ rows }, ignoreSuggestions(EMPTY_NAMING_IGNORES, ["light.old_b", "light.hall_d"]))).toEqual({ fits: 3, total: 4, ignored: 2 });
  });

  it("works on a real analysis, with invented data", () => {
    const h = {
      floors: [],
      looseAreaIds: ["hall"],
      areas: { hall: { id: "hall", name: "Hall", floorId: null, entityIds: ["light.hall_lamp", "light.tv_strip"], deviceIds: [] } },
      devices: {},
      labels: {},
      entities: {
        "light.hall_lamp": { entityId: "light.hall_lamp", name: "Hall lamp", customName: null, domain: "light", role: "light", areaId: "hall", disabled: false, maintenance: false, inRegistry: true, deviceClass: null, members: [] },
        "light.tv_strip": { entityId: "light.tv_strip", name: "TV strip", customName: null, domain: "light", role: "light", areaId: "hall", disabled: false, maintenance: false, inRegistry: true, deviceClass: null, members: [] },
      },
    } as unknown as Hierarchy;
    const analysis = analyzeArea(h.areas.hall, h, DEFAULT_NAMING);
    const before = namingFit(analysis, EMPTY_NAMING_IGNORES);
    const strip = analysis.rows.find((r) => r.entityId === "light.tv_strip")!;
    expect(hasSuggestion(strip)).toBe(true);
    const after = namingFit(analysis, ignoreSuggestions(EMPTY_NAMING_IGNORES, [strip.entityId]));
    expect(after.fits).toBe(before.fits + 1);
    expect(after.ignored).toBe(1);
  });
});
