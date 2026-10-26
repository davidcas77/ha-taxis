import { describe, expect, it } from "vitest";

import { DEFAULT_AI, type AiSettings, type AiSettingsView } from "./ai.ts";
import { canonical, formDiffers, formOf, savedSettings, settingsOf } from "./ai-form.ts";

const saved: AiSettings = {
  ...structuredClone(DEFAULT_AI),
  enabled: true,
  provider: "openai-compatible",
  baseUrl: "http://192.168.1.20:11434/v1",
  models: { quick: "qwen2.5:7b", ask: "llama3.2:3b" },
  prices: { "qwen2.5:7b": { inputPerMTok: 0, outputPerMTok: 0 }, "gpt-5": { inputPerMTok: 1.25, outputPerMTok: 10 } },
};

describe("settingsOf", () => {
  it("reads back exactly what formOf was given", () => {
    expect(settingsOf(formOf(saved))).toEqual(saved);
    expect(formDiffers(formOf(saved), saved)).toBe(false);
  });

  it("produces only the fields of the settings: nothing the view adds, no key", () => {
    const view: AiSettingsView = { ...saved, keySet: true, keyEnd: "abcd", keys: { anthropic: { set: false, end: null }, "openai-compatible": { set: true, end: "abcd" } } };
    expect(savedSettings(view)).toEqual(saved);
    expect(Object.keys(settingsOf(formOf(savedSettings(view))) as object).sort()).toEqual(
      ["baseUrl", "effort", "enabled", "maxOutputTokens", "models", "monthlyCapUsd", "prices", "provider"],
    );
  });

  it("notices a change, however small, and ignores the order of prices", () => {
    expect(formDiffers({ ...formOf(saved), cap: "5.5" }, saved)).toBe(true);
    expect(formDiffers({ ...formOf(saved), models: { quick: "other", ask: "llama3.2:3b" } }, saved)).toBe(true);
    const f = formOf(saved);
    expect(formDiffers({ ...f, prices: [...f.prices].reverse() }, saved)).toBe(false);
    expect(canonical({ b: 1, a: { d: 1, c: 2 } })).toBe(canonical({ a: { c: 2, d: 1 }, b: 1 }));
  });

  it("trims model names and skips empty price rows", () => {
    const f = formOf(saved);
    const read = settingsOf({ ...f, models: { quick: " m1 ", ask: "" }, prices: [...f.prices, { model: " ", input: "", output: " " }] }) as AiSettings;
    expect(read.models).toEqual({ quick: "m1", ask: "" });
    expect(Object.keys(read.prices)).toEqual(["qwen2.5:7b", "gpt-5"]);
  });

  it("says what is wrong with the numbers, in words", () => {
    const f = formOf(saved);
    expect(settingsOf({ ...f, cap: "" })).toMatch(/monthly cap/);
    expect(settingsOf({ ...f, cap: "five" })).toMatch(/monthly cap/);
    expect(settingsOf({ ...f, maxTokens: "lots" })).toMatch(/output tokens/);
    expect(settingsOf({ ...f, prices: [{ model: "", input: "1", output: "2" }] })).toMatch(/Name the model/);
    expect(settingsOf({ ...f, prices: [{ model: "gpt-5", input: "1", output: "" }] })).toMatch(/both prices for gpt-5/);
    expect(settingsOf({ ...f, prices: [{ model: "gpt-5", input: "x", output: "2" }] })).toMatch(/both prices for gpt-5/);
    expect(formDiffers({ ...f, cap: "" }, saved)).toBe(true);
  });
});
