import { describe, expect, it } from "vitest";

import { buildMockRegistry } from "../scripts/mock-ha-core.ts";
import { buildHierarchy } from "../server/model/hierarchy.ts";
import { cachedAreaCodes } from "./area-codes-cache.ts";
import { DEFAULT_NAMING, areaCodes } from "./naming.ts";

const h = buildHierarchy(buildMockRegistry(), "now");

describe("cachedAreaCodes", () => {
  it("answers exactly what areaCodes does, without and with typed codes", () => {
    expect(cachedAreaCodes(h, DEFAULT_NAMING)).toEqual(areaCodes(h, DEFAULT_NAMING));
    const typed = { ...DEFAULT_NAMING, areaCodes: { kitchen: "Cook Room", hallway: "hall" } };
    expect(cachedAreaCodes(h, typed)).toEqual(areaCodes(h, typed));
    expect(cachedAreaCodes(h, typed).kitchen.code).toBe("cook_room");
    expect(cachedAreaCodes(h, typed).kitchen.custom).toBe(true);
  });

  it("returns the same object while the typed codes are the same object", () => {
    expect(cachedAreaCodes(h, DEFAULT_NAMING)).toBe(cachedAreaCodes(h, DEFAULT_NAMING));
  });

  it("follows a change of the typed codes", () => {
    const one = { ...DEFAULT_NAMING, areaCodes: { kitchen: "a" } };
    const two = { ...DEFAULT_NAMING, areaCodes: { kitchen: "b" } };
    expect(cachedAreaCodes(h, one).kitchen.code).toBe("a");
    expect(cachedAreaCodes(h, two).kitchen.code).toBe("b");
  });
});
