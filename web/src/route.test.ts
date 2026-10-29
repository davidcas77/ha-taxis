import { describe, expect, it } from "vitest";

import { normalizeLegacyHash } from "../../shared/route-hash.ts";
import { AI_SETTINGS, AREAS_HOME, BUTTONS, GUIDE, RECIPES, SETTINGS, parseHash, toHash, type Route } from "./route.ts";

// The address bar is the app's router: every page must come back from its own hash.
const ROUTES: Route[] = [
  GUIDE,
  { page: "guide", areaId: "kitchen" },
  AREAS_HOME,
  { page: "areas", sel: { kind: "floor", id: "ground" }, tab: "overview" },
  { page: "areas", sel: { kind: "area", id: "kitchen" }, tab: "overview" },
  { page: "areas", sel: { kind: "area", id: "kitchen" }, tab: "naming" },
  { page: "areas", sel: { kind: "area", id: "a b/c" }, tab: "devices-entities" },
  { page: "areas", sel: { kind: "unassigned" }, tab: "overview" },
  { page: "areas", sel: { kind: "loose" }, tab: "overview" },
  { page: "organize", type: "labels", id: null },
  { page: "organize", type: "entities", id: "light.desk" },
  { page: "organize", type: "spaces", id: "area:kitchen" },
  RECIPES,
  BUTTONS,
  { page: "automations", tab: "buttons", controlId: "device:abc" },
  { page: "parameters", tab: "capabilities" },
  { page: "parameters", tab: "safety" },
  { page: "health" },
  { page: "changes" },
  SETTINGS,
  AI_SETTINGS,
];

describe("route hashes", () => {
  it.each(ROUTES.map((r) => [toHash(r), r] as const))("%s opens the page it names", (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  it("gives every page its own hash", () => {
    const hashes = ROUTES.map(toHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("names the new pages", () => {
    expect(toHash(RECIPES)).toBe("#automations/recipes");
    expect(toHash(BUTTONS)).toBe("#automations/buttons");
    expect(toHash(SETTINGS)).toBe("#settings");
    expect(toHash(AI_SETTINGS)).toBe("#settings/ai");
  });
});

describe("old links", () => {
  const open = (hash: string) => parseHash(hash);

  it("open Recipes and Buttons as tabs of Automations", () => {
    expect(open("#recipes")).toEqual(RECIPES);
    expect(open("#parameters/recipes")).toEqual(RECIPES);
    expect(open("#buttons")).toEqual(BUTTONS);
    expect(open("#buttons/device%3Aabc")).toEqual({ page: "automations", tab: "buttons", controlId: "device:abc" });
  });

  it("open the AI administration as a tab of Settings", () => {
    expect(open("#ai-admin")).toEqual(AI_SETTINGS);
    expect(open("#ai")).toEqual(AI_SETTINGS);
  });

  it("are rewritten in the address bar", () => {
    expect(normalizeLegacyHash("#recipes")).toBe(toHash(RECIPES));
    expect(normalizeLegacyHash("#ai-admin")).toBe(toHash(AI_SETTINGS));
  });

  it("keep the older Organize bookmarks working", () => {
    expect(open("#labels/abc")).toEqual({ page: "organize", type: "labels", id: "abc" });
    expect(open("#categories/script/x")).toEqual({ page: "organize", type: "category-script", id: "x" });
    expect(open("#devices")).toEqual({ page: "organize", type: "devices", id: null });
    expect(open("#area/kitchen/entities")).toEqual({ page: "areas", sel: { kind: "area", id: "kitchen" }, tab: "devices-entities" });
  });
});

describe("the home page", () => {
  it("is the Guide for an empty, bare or unknown hash", () => {
    for (const hash of ["", "#", "#nothing-here", "#settingsx"]) expect(parseHash(hash), hash).toEqual(GUIDE);
  });

  it("is the Guide for a mangled link", () => {
    expect(parseHash("#area/%E0%A4%A")).toEqual(GUIDE);
  });

  it("leaves #home for the whole house in Areas", () => {
    expect(parseHash("#home")).toEqual(AREAS_HOME);
    expect(toHash(AREAS_HOME)).toBe("#home");
  });

  it("falls back to the first tab of a page for an unknown tab", () => {
    expect(parseHash("#parameters/bogus")).toEqual({ page: "parameters", tab: "capabilities" });
    expect(parseHash("#automations/bogus")).toEqual(RECIPES);
    expect(parseHash("#settings/bogus")).toEqual(SETTINGS);
    expect(parseHash("#area/kitchen/bogus")).toEqual({ page: "areas", sel: { kind: "area", id: "kitchen" }, tab: "overview" });
  });
});
