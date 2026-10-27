import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { DEFAULT_AI } from "../shared/ai.ts";
import { settingsStore, validateAi } from "./settings.ts";

const base = () => ({ ...structuredClone(DEFAULT_AI), enabled: true });
const store = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return { db, s: settingsStore(db) };
};

describe("validateAi", () => {
  it("accepts the defaults and normalises what it keeps", () => {
    const r = validateAi({ ...base(), baseUrl: " https://openrouter.ai/api/v1/ ", monthlyCapUsd: 5.004, models: { low: " gpt-5-mini ", medium: "", strong: "" } });
    expect(r).toEqual({
      ok: true,
      value: { ...base(), baseUrl: "https://openrouter.ai/api/v1", monthlyCapUsd: 5, models: { low: "gpt-5-mini", medium: "", strong: "" } },
    });
  });

  it("starts with Anthropic's current Haiku and Sonnet", () => {
    expect(DEFAULT_AI).toMatchObject({ provider: "anthropic", models: { low: "claude-haiku-5-5", medium: "claude-sonnet-5-5", strong: "" }, effort: "balanced", monthlyCapUsd: 5 });
  });

  it("separates the key from the settings: left out, a string, or null", () => {
    expect(validateAi(base())).not.toHaveProperty("key");
    expect(validateAi({ ...base(), key: "sk-test-abc" })).toMatchObject({ ok: true, key: "sk-test-abc" });
    expect(validateAi({ ...base(), key: null })).toMatchObject({ ok: true, key: null });
    // The settings it returns never carry the key.
    const r = validateAi({ ...base(), key: "sk-test-abc" });
    expect(r.ok && r.value).not.toHaveProperty("key");
  });

  it("checks the key", () => {
    for (const key of ["", "has space", "line\nbreak", "é", "x".repeat(401), 5, true]) {
      expect(validateAi({ ...base(), key }), String(key)).toMatchObject({ ok: false });
    }
    expect(validateAi({ ...base(), key: "x".repeat(400) })).toMatchObject({ ok: true });
  });

  it("refuses things that aren't settings", () => {
    for (const bad of [null, [], "x", 3, { ...base(), extra: 1 }, { ...base(), enabled: "yes" }, { ...base(), provider: "other" }, { ...base(), effort: "max" }, { ...base(), models: "x" }]) {
      expect(validateAi(bad)).toMatchObject({ ok: false });
    }
  });

  it("checks the base URL with the same rules as the server enforces on every call", () => {
    expect(validateAi({ ...base(), provider: "openai-compatible", baseUrl: "http://192.168.1.20:11434/v1" })).toMatchObject({ ok: true });
    expect(validateAi({ ...base(), baseUrl: "http://api.example.com/v1" })).toMatchObject({ ok: false, error: expect.stringContaining("https://") });
    expect(validateAi({ ...base(), baseUrl: "https://user:pw@api.example.com/v1" })).toMatchObject({ ok: false });
  });

  it("limits the cap and the output tokens", () => {
    expect(validateAi({ ...base(), monthlyCapUsd: 0 })).toMatchObject({ ok: false });
    expect(validateAi({ ...base(), monthlyCapUsd: 0.01 })).toMatchObject({ ok: true });
    expect(validateAi({ ...base(), monthlyCapUsd: 10_001 })).toMatchObject({ ok: false });
    expect(validateAi({ ...base(), monthlyCapUsd: "5" })).toMatchObject({ ok: false });
    expect(validateAi({ ...base(), monthlyCapUsd: Infinity })).toMatchObject({ ok: false });
    expect(validateAi({ ...base(), maxOutputTokens: 255 })).toMatchObject({ ok: false });
    expect(validateAi({ ...base(), maxOutputTokens: 256 })).toMatchObject({ ok: true });
    expect(validateAi({ ...base(), maxOutputTokens: 16_000 })).toMatchObject({ ok: true });
    expect(validateAi({ ...base(), maxOutputTokens: 16_001 })).toMatchObject({ ok: false });
    expect(validateAi({ ...base(), maxOutputTokens: 1000.5 })).toMatchObject({ ok: false });
  });

  it("checks model names", () => {
    for (const m of ["claude-haiku-5-5", "qwen2.5:7b", "anthropic/claude-sonnet-5.5", "gpt-5"]) {
      expect(validateAi({ ...base(), models: { low: m, medium: m, strong: "" } }), m).toMatchObject({ ok: true });
    }
    for (const m of ["has space", "semi;colon", "x".repeat(201), 3]) {
      expect(validateAi({ ...base(), models: { low: m, medium: "", strong: "" } }), String(m)).toMatchObject({ ok: false });
    }
  });

  it("checks per-model prices", () => {
    const prices = { "gpt-5": { inputPerMTok: 1.25, outputPerMTok: 10 }, "qwen2.5:7b": { inputPerMTok: 0, outputPerMTok: 0 } };
    expect(validateAi({ ...base(), prices })).toMatchObject({ ok: true, value: { prices } });
    for (const bad of [
      { "gpt-5": { inputPerMTok: -1, outputPerMTok: 1 } },
      { "gpt-5": { inputPerMTok: 1 } },
      { "gpt-5": { inputPerMTok: "1", outputPerMTok: 1 } },
      { "gpt-5": { inputPerMTok: 10_001, outputPerMTok: 1 } },
      { "gpt-5": 5 },
      { "bad name": { inputPerMTok: 1, outputPerMTok: 1 } },
      [],
    ]) {
      expect(validateAi({ ...base(), prices: bad }), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`m${i}`, { inputPerMTok: 1, outputPerMTok: 1 }]));
    expect(validateAi({ ...base(), prices: many })).toMatchObject({ ok: false });
  });

  it("keeps __proto__ as a model name, not as a prototype", () => {
    const r = validateAi({ ...base(), prices: JSON.parse('{"__proto__": {"inputPerMTok": 1, "outputPerMTok": 2}}') });
    expect(r.ok && Object.keys(r.value.prices)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(r.ok && r.value.prices)).toBe(Object.prototype);
  });
});

describe("settingsStore ai", () => {
  it("reads legacy Quick/Ask settings as Low/Medium without rewriting the row or keys", () => {
    const { db, s } = store();
    const legacy = { ...base(), provider: "openai-compatible", baseUrl: "http://localhost:1234/v1", models: { quick: "my-small", ask: "my-large" }, effort: "thorough", monthlyCapUsd: 42, prices: { "my-large": { inputPerMTok: 2, outputPerMTok: 4 } } };
    db.prepare("INSERT INTO settings(key,value) VALUES (?,?)").run("ai", JSON.stringify(legacy));
    s.saveAiKey("openai-compatible", "saved-key-invented-0123456789");
    expect(s.ai()).toEqual({ ...legacy, models: { low: "my-small", medium: "my-large", strong: "" } });
    expect(s.aiKey("openai-compatible")).toBe("saved-key-invented-0123456789");
    expect(JSON.parse((db.prepare("SELECT value FROM settings WHERE key='ai'").get() as { value: string }).value)).toEqual(legacy);
    s.saveAi({ ...s.ai(), models: { ...s.ai().models, strong: "my-planner" } });
    expect(s.ai().models).toEqual({ low: "my-small", medium: "my-large", strong: "my-planner" });
    db.close();
  });

  it("keeps explicit tiers instead of filling them from leftover legacy model fields", () => {
    const r = validateAi({ ...base(), models: { low: "chosen", medium: "", strong: "planner", quick: "old-small", ask: "old-large" } });
    expect(r).toMatchObject({ ok: true, value: { models: { low: "chosen", medium: "", strong: "planner" } } });
  });

  it("starts with AI off and the defaults", () => {
    const { s } = store();
    expect(s.ai()).toEqual(DEFAULT_AI);
    expect(s.aiView()).toEqual({ ...DEFAULT_AI, keySet: false, keyEnd: null, keys: { anthropic: { set: false, end: null }, "openai-compatible": { set: false, end: null } } });
  });

  it("saves and reads back, and the key lives in a row of its own", () => {
    const { db, s } = store();
    const value = { ...base(), effort: "thorough" as const, prices: { m: { inputPerMTok: 1, outputPerMTok: 2 } } };
    s.saveAi(value);
    s.saveAiKey("anthropic", "sk-test-invented-0123456789abcdef");
    expect(s.ai()).toEqual(value);
    expect(s.aiKey("anthropic")).toBe("sk-test-invented-0123456789abcdef");
    expect(s.aiKey("openai-compatible")).toBeNull();
    const rows = db.prepare("SELECT key, value FROM settings ORDER BY key").all() as { key: string; value: string }[];
    expect(rows.map((r) => r.key)).toEqual(["ai", "ai_key:anthropic"]);
    expect(rows.find((r) => r.key === "ai")!.value).not.toContain("sk-test");
  });

  it("describes the key without giving it away", () => {
    const { s } = store();
    s.saveAiKey("anthropic", "sk-test-invented-0123456789abcdef");
    expect(s.aiView()).toMatchObject({ keySet: true, keyEnd: "cdef", keys: { anthropic: { set: true, end: "cdef" }, "openai-compatible": { set: false } } });
    expect(JSON.stringify(s.aiView())).not.toContain("sk-test");
    s.saveAiKey("anthropic", "short-key");
    expect(s.aiView()).toMatchObject({ keySet: true, keyEnd: null });
    s.saveAiKey("anthropic", null);
    expect(s.aiView()).toMatchObject({ keySet: false, keyEnd: null });
  });

  it("falls back to the defaults when the stored value was edited into nonsense", () => {
    const { db, s } = store();
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("ai", '{"enabled": true, "monthlyCapUsd": -1}');
    expect(s.ai()).toEqual(DEFAULT_AI);
    db.prepare("UPDATE settings SET value = ? WHERE key = ?").run("{not json", "ai");
    expect(s.ai()).toEqual(DEFAULT_AI);
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("ai_key:anthropic", '"has a space"');
    expect(s.aiKey("anthropic")).toBeNull();
  });
});
