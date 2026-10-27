import { describe, expect, it } from "vitest";

import { ROLE_ORDER, displayRole, isHelperEntity, roleCounts, sectionsByRole } from "./roles.ts";
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

describe("helpers and groups", () => {
  const e = (domain: string, platform: string, members: string[] = [], role: EntityRole = "other") => ({ domain, platform, members, role });

  it("tells a helper by its domain, its platform or the members it reports", () => {
    expect(isHelperEntity(e("input_boolean", "input_boolean"))).toBe(true);
    expect(isHelperEntity(e("counter", "counter"))).toBe(true);
    expect(isHelperEntity(e("sensor", "min_max"))).toBe(true);
    expect(isHelperEntity(e("sensor", "template"))).toBe(true);
    expect(isHelperEntity(e("light", "group"))).toBe(true);
    expect(isHelperEntity(e("light", "hue", ["light.a"]))).toBe(true);
  });

  it("tells a group that is unavailable, and reports no members, by its platform", () => {
    expect(isHelperEntity(e("light", "group", []))).toBe(true);
  });

  it("does not take a real light, a sensor or a light made from a switch for a helper", () => {
    expect(isHelperEntity(e("light", "hue"))).toBe(false);
    expect(isHelperEntity(e("sensor", "zigbee"))).toBe(false);
    expect(isHelperEntity(e("light", "switch_as_x"))).toBe(false);
    expect(isHelperEntity(e("automation", "automation"))).toBe(false);
  });

  it("lists a helper under Helpers, whatever it mirrors", () => {
    expect(displayRole(e("light", "group", ["light.a"], "light"))).toBe("helper");
    expect(displayRole(e("light", "hue", [], "light"))).toBe("light");
    expect(displayRole(e("input_boolean", "input_boolean", [], "helper"))).toBe("helper");
  });
});
