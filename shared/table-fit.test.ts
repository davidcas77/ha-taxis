import { describe, expect, it } from "vitest";

import { fitColumns, headerRuns, NO_PREFS, parseColumnPrefs, stickyOffsets, togglePref, type FitColumn } from "./table-fit.ts";

const col = (id: string, priority: 1 | 2 | 3, minWidth = 100, rest: Partial<FitColumn> = {}): FitColumn => ({ id, priority, minWidth, ...rest });

describe("fitColumns", () => {
  const cols = [col("name", 1), col("id", 2), col("type", 2), col("state", 3), col("why", 3)];

  it("shows everything when it fits", () => {
    expect(fitColumns(cols, NO_PREFS, 500)).toEqual({ visible: ["name", "id", "type", "state", "why"], autoHidden: [], userHidden: [], canDropMore: true });
  });

  it("hides the least important first, the rightmost among equals", () => {
    expect(fitColumns(cols, NO_PREFS, 450).autoHidden).toEqual(["why"]);
    expect(fitColumns(cols, NO_PREFS, 350).autoHidden).toEqual(["state", "why"]);
    expect(fitColumns(cols, NO_PREFS, 250).autoHidden).toEqual(["type", "state", "why"]);
  });

  it("never hides priority 1 or locked columns, however narrow", () => {
    const fit = fitColumns([col("pick", 3, 40, { locked: true }), col("name", 1), col("id", 3)], NO_PREFS, 10);
    expect(fit.visible).toEqual(["pick", "name"]);
    expect(fit.autoHidden).toEqual(["id"]);
  });

  it("keeps the order of the columns", () => {
    expect(fitColumns(cols, NO_PREFS, 350).visible).toEqual(["name", "id", "type"]);
  });

  it("counts the reserved width", () => {
    expect(fitColumns(cols, NO_PREFS, 500, 100).autoHidden).toEqual(["why"]);
  });

  it("lets the person hide a column, which then frees room for the others", () => {
    const fit = fitColumns(cols, { show: [], hide: ["type"] }, 400);
    expect(fit.userHidden).toEqual(["type"]);
    expect(fit.visible).toEqual(["name", "id", "state", "why"]);
    expect(fit.autoHidden).toEqual([]);
  });

  it("keeps a column the person asked for, even if the table must scroll", () => {
    const fit = fitColumns(cols, { show: ["why"], hide: [] }, 250);
    expect(fit.visible).toEqual(["name", "why"]);
    expect(fit.autoHidden).toEqual(["id", "type", "state"]);
  });

  it("starts default-hidden columns hidden until shown", () => {
    const c = [col("a", 1), col("b", 2, 100, { defaultHidden: true })];
    expect(fitColumns(c, NO_PREFS, 1000)).toEqual({ visible: ["a"], autoHidden: [], userHidden: ["b"], canDropMore: false });
    expect(fitColumns(c, { show: ["b"], hide: [] }, 1000).visible).toEqual(["a", "b"]);
  });

  it("ignores a hide choice on a locked column", () => {
    expect(fitColumns([col("pick", 1, 40, { locked: true })], { show: [], hide: ["pick"] }, 100).visible).toEqual(["pick"]);
  });

  it("drops extra columns on request, in the same order, while any can go", () => {
    expect(fitColumns(cols, NO_PREFS, 500, 0, 1)).toMatchObject({ autoHidden: ["why"], canDropMore: true });
    expect(fitColumns(cols, NO_PREFS, 500, 0, 2).autoHidden).toEqual(["state", "why"]);
    const all = fitColumns(cols, NO_PREFS, 500, 0, 99);
    expect(all.visible).toEqual(["name"]);
    expect(all.canDropMore).toBe(false);
  });

  it("copes with no columns and no width", () => {
    expect(fitColumns([], NO_PREFS, 0)).toEqual({ visible: [], autoHidden: [], userHidden: [], canDropMore: false });
    expect(fitColumns(cols, NO_PREFS, 0).visible).toEqual(["name"]);
  });
});

describe("column preferences", () => {
  it("parses only the expected shape", () => {
    expect(parseColumnPrefs({ show: ["a", 3], hide: ["b"] })).toEqual({ show: ["a"], hide: ["b"] });
    expect(parseColumnPrefs(null)).toEqual(NO_PREFS);
    expect(parseColumnPrefs("x")).toEqual(NO_PREFS);
    expect(parseColumnPrefs({ show: "a" })).toEqual(NO_PREFS);
  });

  it("toggles a column off and on, forgetting the opposite choice", () => {
    const hidden = togglePref(NO_PREFS, "id", true);
    expect(hidden).toEqual({ show: [], hide: ["id"] });
    expect(togglePref(hidden, "id", false)).toEqual({ show: ["id"], hide: [] });
    expect(togglePref(togglePref(hidden, "id", true), "id", true)).toEqual({ show: [], hide: ["id"] });
  });
});

describe("stickyOffsets", () => {
  it("stacks the sticky columns from the left", () => {
    expect(
      stickyOffsets([
        { id: "pick", sticky: true, width: 32 },
        { id: "name", sticky: true, width: 180 },
        { id: "id", width: 200 },
      ]),
    ).toEqual({ pick: 0, name: 32 });
  });
});

describe("headerRuns", () => {
  it("merges neighbours of one group and leaves loose columns alone", () => {
    expect(
      headerRuns([{ id: "name" }, { id: "a", group: "Heating" }, { id: "b", group: "Heating" }, { id: "c", group: "Cooling" }, { id: "d", group: "Heating" }]),
    ).toEqual([
      { group: null, ids: ["name"] },
      { group: "Heating", ids: ["a", "b"] },
      { group: "Cooling", ids: ["c"] },
      { group: "Heating", ids: ["d"] },
    ]);
  });
});
