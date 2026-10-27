import { describe, expect, it } from "vitest";

import { ROLE_ORDER, roleCounts, sectionsByRole } from "./roles.ts";
import type { EntityRole } from "./types.ts";

const item = (id: string, role: EntityRole) => ({ id, role });

describe("sectionsByRole", () => {
  it("follows the order of ROLE_ORDER and leaves empty sections out", () => {
    const rows = [item("a", "helper"), item("b", "light"), item("c", "motion"), item("d", "light")];
    const out = sectionsByRole(rows, (r) => r.role);
    expect(out.map((s) => s.role)).toEqual(["light", "motion", "helper"]);
    expect(out.map((s) => s.label)).toEqual(["Lights", "Motion", "Helpers"]);
  });

  it("keeps the order of the rows inside a section", () => {
    const rows = [item("z", "light"), item("m", "switch"), item("a", "light")];
    const out = sectionsByRole(rows, (r) => r.role);
    expect(out[0].rows.map((r) => r.id)).toEqual(["z", "a"]);
  });

  it("puts a role it doesn't know under Other", () => {
    const out = sectionsByRole([item("a", "nonsense" as EntityRole), item("b", "other")], (r) => r.role);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ role: "other", label: "Other" });
    expect(out[0].rows).toHaveLength(2);
  });

  it("returns nothing for no rows, and has a section for every role", () => {
    expect(sectionsByRole([], (r: { role: EntityRole }) => r.role)).toEqual([]);
    const all = ROLE_ORDER.map((r) => item(r.role, r.role));
    expect(sectionsByRole(all, (r) => r.role)).toHaveLength(ROLE_ORDER.length);
  });
});

describe("roleCounts", () => {
  it("counts the kinds an area has, in display order, and leaves out the rest", () => {
    expect(roleCounts(["helper", "light", "other", "helper", "other"])).toEqual([
      { role: "light", label: "Lights", count: 1 },
      { role: "helper", label: "Helpers", count: 2 },
      { role: "other", label: "Other", count: 2 },
    ]);
    expect(roleCounts([])).toEqual([]);
  });
});
