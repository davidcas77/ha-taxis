import { describe, expect, it } from "vitest";
import { RECIPE_KEYS } from "../../shared/blueprints.ts";
import { RECIPE_GUIDE } from "./recipe-guide.ts";

describe("recipe explanations", () => {
  it("covers every supported recipe with useful device, helper, behavior, flow and example text", () => {
    expect(Object.keys(RECIPE_GUIDE).sort()).toEqual([...RECIPE_KEYS].sort());
    for (const key of RECIPE_KEYS) {
      const entry = RECIPE_GUIDE[key];
      expect(entry.summary.trim().length, key).toBeGreaterThan(15);
      expect(entry.example.trim().length, key).toBeGreaterThan(25);
      expect(entry.flow.length, key).toBeGreaterThanOrEqual(3);
      expect(entry.flow.length, key).toBeLessThanOrEqual(4);
      for (const field of [entry.devices, entry.helpers, entry.behavior, entry.flow]) {
        expect(field.length, key).toBeGreaterThan(0);
        expect(
          field.every((text) => text.trim().length > 15),
          key,
        ).toBe(true);
      }
    }
  });

  it("distinguishes optional equipment and important operating limits", () => {
    expect(RECIPE_GUIDE.leak_alert.devices.join(" ")).toMatch(/Optional.*valve/i);
    expect(RECIPE_GUIDE.bathroom_fan.helpers.join(" ")).toMatch(/humidity-rate/i);
    expect(RECIPE_GUIDE.covers_sun.behavior.join(" ")).toMatch(/window is open/i);
    expect(RECIPE_GUIDE.announce.behavior.join(" ")).toMatch(/not restored/i);
    expect(RECIPE_GUIDE.house_presence.behavior.join(" ")).toMatch(/guest mode/i);
  });

  it("explains helper purposes and separately planned prerequisites", () => {
    const helperText = (key: keyof typeof RECIPE_GUIDE) => RECIPE_GUIDE[key].helpers.join(" ");
    expect(helperText("occupancy")).toMatch(/hold timer.*bridge/i);
    expect(helperText("occupancy")).toMatch(/area occupancy virtual sensor.*other recipes.*calculated/i);
    expect(helperText("motion_lights")).toMatch(/light group.*stable target/i);
    expect(helperText("motion_lights")).toMatch(/does not install Occupancy/i);
    expect(helperText("media_off")).toMatch(/group.*optional/i);
    expect(helperText("bathroom_fan")).toMatch(/humidity-rate sensor.*quickly/i);
    expect(helperText("announce")).toMatch(/Plan Occupancy separately/i);
    expect(helperText("house_presence")).toMatch(/does not install/i);
    expect(helperText("unavailable_watch")).toMatch(/recovery still clears/i);
    for (const key of RECIPE_KEYS) expect(helperText(key)).toMatch(/(?:to |so |for |when |while |that |can |prevent|detect|select|signal|combine)/i);
  });
});
