import { describe, expect, it } from "vitest";

import { compareValues, sortRows } from "./sort.ts";

describe("sorting rows", () => {
  const rows = [{ n: "light 10" }, { n: "Light 2" }, { n: "" }, { n: "alpha" }, { n: null }];
  const get = (r: { n: string | null }) => r.n;

  it("sorts text without regard to case and numbers by value", () => {
    expect(sortRows(rows, get, "asc").map((r) => r.n)).toEqual(["alpha", "Light 2", "light 10", "", null]);
    expect(compareValues(2, 10)).toBeLessThan(0);
    expect(compareValues("b", "A")).toBeGreaterThan(0);
  });

  it("puts blanks last whichever way it sorts", () => {
    expect(sortRows(rows, get, "desc").map((r) => r.n)).toEqual(["light 10", "Light 2", "alpha", "", null]);
  });

  it("leaves the rows it was given alone, and keeps equal rows in their order", () => {
    const given = [{ n: "b", i: 1 }, { n: "a", i: 2 }, { n: "b", i: 3 }];
    const copy = structuredClone(given);
    expect(sortRows(given, (r) => r.n, "asc").map((r) => r.i)).toEqual([2, 1, 3]);
    expect(given).toEqual(copy);
  });
});
