import { expect, it } from "vitest";
import { readBlueprintInventory } from "./blueprints.ts";

it("lists every installed domain and provider, preserving section inputs and null defaults", async () => {
  const calls: unknown[] = [];
  const ha = { command: async <T,>(type: string, payload: Record<string, unknown>): Promise<T> => {
    calls.push([type, payload]);
    return (payload.domain === "automation" ? {
      "community/motion.yaml": { metadata: { name: "Motion lighting", description: "Community recipe", author: "Community", source_url: "https://example.com/motion.yaml", input: { lamp: { name: "Lamp", selector: { entity: { domain: "light" } } }, timing: { name: "Timing", input: { delay: { name: "Delay", default: null, selector: { number: {} } } } } } } },
      "taxis/occupancy.yaml": { metadata: { name: "Taxis occupancy", input: {} } },
      "user/broken.yaml": { error: "Invalid selector" },
    } : { "user/announce.yaml": { metadata: { name: "Speak", domain: "script", source_url: "javascript:alert(1)", input: { message: { default: "", selector: { text: {} } } } } } }) as T;
  } };
  const result = await readBlueprintInventory(ha);
  expect(calls).toEqual([["blueprint/list", { domain: "automation" }], ["blueprint/list", { domain: "script" }]]);
  expect(result.complete).toBe(true); expect(result.blueprints).toHaveLength(4);
  expect(result.blueprints.find(b => b.path === "community/motion.yaml")).toMatchObject({ domain: "automation", name: "Motion lighting", author: "Community", sourceUrl: "https://example.com/motion.yaml", inputs: { lamp: { name: "Lamp" }, "timing.delay": { name: "Delay", section: "Timing", default: null } } });
  expect(result.blueprints.find(b => b.path === "community/motion.yaml")!.inputs.lamp).not.toHaveProperty("default");
  expect(result.blueprints.find(b => b.path === "user/announce.yaml")!.sourceUrl).toBeNull();
  expect(result.blueprints.find(b => b.path === "user/broken.yaml")!.error).toBe("Invalid selector");
});

it("reports partial inventory when one domain fails, retaining successful results and redacting errors", async () => {
  const ha = { command: async <T,>(_type: string, payload: Record<string, unknown>): Promise<T> => {
    if (payload.domain === "script") throw new Error("secret rejected");
    return { "user/working.yaml": { metadata: { name: "Working" } } } as T;
  } };
  const result = await readBlueprintInventory(ha, message => message.replace("secret", "***"));
  expect(result.complete).toBe(false); expect(result.blueprints).toHaveLength(1);
  expect(result.warnings).toEqual(["Could not read script blueprints: *** rejected"]);
});

it("distinguishes complete empty domains from unreadable lists and metadata", async () => {
  expect(await readBlueprintInventory({ command: async <T,>() => ({}) as T })).toEqual({ ok: true, blueprints: [], complete: true, warnings: [] });
  const result = await readBlueprintInventory({ command: async <T,>(_type: string, payload: Record<string, unknown>) => (payload.domain === "automation" ? [] : { "bad.yaml": null }) as T });
  expect(result.complete).toBe(false); expect(result.warnings).toHaveLength(2);
  expect(result.blueprints[0].error).toMatch(/metadata/);
});
