import { describe, expect, it } from "vitest";

import { analyzeArea, DEFAULT_NAMING, type NamingRow } from "./naming.ts";
import { EMPTY_NAMING_IGNORES, hasSuggestion, ignoreSuggestions, isIgnored, namingFit, restoreSuggestions, splitIgnored } from "./naming-ignores.ts";
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
  it("adds ids sorted and once, and returns the same object when nothing changes", () => {
    const one = ignoreSuggestions(EMPTY_NAMING_IGNORES, ["light.b", "light.a", "light.b"]);
    expect(one).toEqual({ entities: ["light.a", "light.b"] });
    expect(ignoreSuggestions(one, ["light.a"])).toBe(one);
    expect(isIgnored(one, "light.a")).toBe(true);
    expect(isIgnored(one, "light.c")).toBe(false);
  });

  it("restores ids, and returns the same object when none was ignored", () => {
    const s = { entities: ["light.a", "light.b"] };
    expect(restoreSuggestions(s, ["light.a"])).toEqual({ entities: ["light.b"] });
    expect(restoreSuggestions(s, ["light.z"])).toBe(s);
  });

  it("never mutates what it was given", () => {
    const s = { entities: ["light.a"] };
    ignoreSuggestions(s, ["light.b"]);
    restoreSuggestions(s, ["light.a"]);
    expect(s).toEqual({ entities: ["light.a"] });
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

describe("splitIgnored", () => {
  const rows = [row({ entityId: "light.a", suggestedName: "A" }), row({ entityId: "light.b", suggestedId: "light.hall_b" }), row({ entityId: "light.c" })];

  it("moves ignored rows with a suggestion out of the active ones", () => {
    const { active, ignored } = splitIgnored(rows, { entities: ["light.a", "light.c"] });
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
    expect(namingFit({ rows }, { entities: ["light.old_b", "light.hall_d"] })).toEqual({ fits: 3, total: 4, ignored: 2 });
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
