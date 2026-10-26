import { describe, expect, it } from "vitest";

import { ANTHROPIC_EFFORT, ANTHROPIC_URL, ANTHROPIC_VERSION, anthropicProvider, anthropicSupportsEffort, toWireMessages } from "./anthropic.ts";
import { TEST_KEY, anthropicMessage, fakeFetch } from "./fake-fetch.ts";
import { AiError, type CompleteRequest } from "./types.ts";

const req = (over: Partial<CompleteRequest> = {}): CompleteRequest => ({
  model: "claude-haiku-5-5",
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 512,
  effort: "balanced",
  ...over,
});

describe("anthropicProvider.complete", () => {
  it("sends the Messages API request Anthropic documents, to Anthropic only", async () => {
    const t = fakeFetch({ body: anthropicMessage() });
    const out = await anthropicProvider({ key: TEST_KEY, fetch: t.fetch }).complete(req({ system: "Be brief." }));
    expect(t.calls).toHaveLength(1);
    const [call] = t.calls;
    expect(call.url).toBe(`${ANTHROPIC_URL}/v1/messages`);
    expect(call.method).toBe("POST");
    expect(call.headers).toMatchObject({ "x-api-key": TEST_KEY, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" });
    expect(call.body).toEqual({
      model: "claude-haiku-5-5",
      max_tokens: 512,
      system: "Be brief.",
      messages: [{ role: "user", content: "hi" }],
      output_config: { effort: "medium" },
    });
    expect(out).toMatchObject({ text: "ready", stop: "end", usage: { input: 20, output: 5 }, model: "claude-haiku-5-5", toolCalls: [] });
  });

  it("never sends sampling parameters, thinking budgets or a forced tool", async () => {
    const t = fakeFetch({ body: anthropicMessage() });
    await anthropicProvider({ key: TEST_KEY, fetch: t.fetch }).complete(
      req({ tools: [{ name: "get_state", description: "Read a state", inputSchema: { type: "object", properties: {} } }] }),
    );
    const body = t.calls[0].body as Record<string, unknown>;
    for (const field of ["temperature", "top_p", "top_k", "thinking", "tool_choice"]) expect(body).not.toHaveProperty(field);
    expect(body.tools).toEqual([{ name: "get_state", description: "Read a state", input_schema: { type: "object", properties: {} } }]);
  });

  it("maps Quick, Balanced and Thorough to low, medium and high", async () => {
    expect(ANTHROPIC_EFFORT).toEqual({ quick: "low", balanced: "medium", thorough: "high" });
    for (const [effort, level] of [["quick", "low"], ["balanced", "medium"], ["thorough", "high"]] as const) {
      const t = fakeFetch({ body: anthropicMessage() });
      await anthropicProvider({ key: TEST_KEY, fetch: t.fetch }).complete(req({ effort }));
      expect((t.calls[0].body as { output_config: unknown }).output_config).toEqual({ effort: level });
    }
  });

  it("leaves effort out for models that don't take it", async () => {
    const t = fakeFetch({ body: anthropicMessage() });
    await anthropicProvider({ key: TEST_KEY, fetch: t.fetch }).complete(req({ model: "claude-haiku-4-5-20251001" }));
    expect(t.calls[0].body).not.toHaveProperty("output_config");
  });

  it("retries once without effort when the service says it isn't accepted", async () => {
    const t = fakeFetch((_c, n) =>
      n === 0 ? { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "output_config.effort: not supported for this model" } } } : { body: anthropicMessage() },
    );
    const out = await anthropicProvider({ key: TEST_KEY, fetch: t.fetch }).complete(req({ model: "claude-sonnet-9-9" }));
    expect(t.calls).toHaveLength(2);
    expect(t.calls[0].body).toHaveProperty("output_config");
    expect(t.calls[1].body).not.toHaveProperty("output_config");
    expect(out.text).toBe("ready");
  });

  it("doesn't retry a 400 that isn't about effort", async () => {
    const t = fakeFetch({ status: 400, body: { error: { message: "max_tokens: must be at least 1" } } });
    await expect(anthropicProvider({ key: TEST_KEY, fetch: t.fetch }).complete(req())).rejects.toThrow(/max_tokens/);
    expect(t.calls).toHaveLength(1);
  });

  it("returns tool calls and ignores thinking blocks in the text", async () => {
    const content = [
      { type: "thinking", thinking: "", signature: "abc" },
      { type: "text", text: "Checking." },
      { type: "tool_use", id: "toolu_1", name: "get_state", input: { entity_id: "light.kitchen" } },
    ];
    const t = fakeFetch({ body: anthropicMessage({ content, stop_reason: "tool_use" }) });
    const out = await anthropicProvider({ key: TEST_KEY, fetch: t.fetch }).complete(req());
    expect(out.text).toBe("Checking.");
    expect(out.toolCalls).toEqual([{ id: "toolu_1", name: "get_state", input: { entity_id: "light.kitchen" } }]);
    expect(out.stop).toBe("tool_use");
    // The full content comes back so a follow-up can replay thinking unchanged.
    expect(out.raw).toEqual(content);
  });

  it("reports max_tokens and refusals as stop reasons, and missing usage as missing", async () => {
    const a = fakeFetch({ body: anthropicMessage({ stop_reason: "max_tokens" }) });
    expect((await anthropicProvider({ key: TEST_KEY, fetch: a.fetch }).complete(req())).stop).toBe("max_tokens");
    const b = fakeFetch({ body: anthropicMessage({ stop_reason: "refusal", usage: undefined }) });
    const out = await anthropicProvider({ key: TEST_KEY, fetch: b.fetch }).complete(req());
    expect(out.stop).toBe("refusal");
    expect(out.usage.missing).toBe(true);
  });

  it("refuses an answer that isn't a message", async () => {
    const t = fakeFetch({ body: { hello: "world" } });
    await expect(anthropicProvider({ key: TEST_KEY, fetch: t.fetch }).complete(req())).rejects.toBeInstanceOf(AiError);
  });

  it("keeps the key out of every error", async () => {
    const down = fakeFetch(new Error(`connect failed for ${TEST_KEY}`));
    await expect(anthropicProvider({ key: TEST_KEY, fetch: down.fetch }).complete(req())).rejects.toThrow(/Couldn't reach Anthropic/);
    await anthropicProvider({ key: TEST_KEY, fetch: down.fetch }).complete(req()).catch((e: Error) => expect(e.message).not.toContain(TEST_KEY));

    const echo = fakeFetch({ status: 401, body: { error: { message: `invalid x-api-key ${TEST_KEY}` } } });
    const e = await anthropicProvider({ key: TEST_KEY, fetch: echo.fetch }).complete(req()).catch((x: Error) => x);
    expect((e as Error).message).toContain("401");
    expect((e as Error).message).toContain("Check the API key");
    expect((e as Error).message).not.toContain(TEST_KEY);
  });
});

describe("anthropicProvider.listModels", () => {
  it("reads the Models API, following pages", async () => {
    const t = fakeFetch((c) =>
      c.url.includes("after_id=claude-sonnet-5-5")
        ? { body: { data: [{ id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5" }], has_more: false } }
        : { body: { data: [{ id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" }], has_more: true, last_id: "claude-sonnet-5-5" } },
    );
    const models = await anthropicProvider({ key: TEST_KEY, fetch: t.fetch }).listModels();
    expect(models).toEqual([
      { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
      { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
    ]);
    expect(t.calls.map((c) => c.url)).toEqual([`${ANTHROPIC_URL}/v1/models?limit=1000`, `${ANTHROPIC_URL}/v1/models?limit=1000&after_id=claude-sonnet-5-5`]);
    expect(t.calls[0].method).toBe("GET");
    expect(t.calls[0].headers["x-api-key"]).toBe(TEST_KEY);
  });

  it("stops after a few pages even if the service keeps saying there are more", async () => {
    const t = fakeFetch({ body: { data: [{ id: "claude-x-1", display_name: "X" }], has_more: true, last_id: "claude-x-1" } });
    await anthropicProvider({ key: TEST_KEY, fetch: t.fetch }).listModels();
    expect(t.calls).toHaveLength(5);
  });

  it("says what is wrong with the key", async () => {
    const t = fakeFetch({ status: 401, body: { error: { message: "invalid x-api-key" } } });
    await expect(anthropicProvider({ key: TEST_KEY, fetch: t.fetch }).listModels()).rejects.toThrow(/401.*invalid x-api-key.*Check the API key/);
  });
});

describe("toWireMessages", () => {
  it("answers parallel tool calls in one user message", () => {
    const wire = toWireMessages([
      { role: "user", content: "lights?" },
      {
        role: "assistant",
        content: "Looking.",
        toolCalls: [
          { id: "t1", name: "a", input: { x: 1 } },
          { id: "t2", name: "b", input: {} },
        ],
      },
      { role: "tool", toolCallId: "t1", content: "on" },
      { role: "tool", toolCallId: "t2", content: "boom", isError: true },
    ]);
    expect(wire).toEqual([
      { role: "user", content: "lights?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Looking." },
          { type: "tool_use", id: "t1", name: "a", input: { x: 1 } },
          { type: "tool_use", id: "t2", name: "b", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "on" },
          { type: "tool_result", tool_use_id: "t2", content: "boom", is_error: true },
        ],
      },
    ]);
  });

  it("replays an assistant turn exactly as it came when it has the raw blocks", () => {
    const raw = [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "ok" }];
    expect(toWireMessages([{ role: "assistant", content: "ok", raw }])).toEqual([{ role: "assistant", content: raw }]);
  });
});

describe("anthropicSupportsEffort", () => {
  it("is true for the 5.x models and Opus and Sonnet 4.5/4.6 and later", () => {
    for (const m of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-sonnet-5", "claude-opus-5-5", "claude-fable-5-1", "claude-opus-4-8", "claude-opus-4-5-20251101", "claude-sonnet-4-6"]) {
      expect(anthropicSupportsEffort(m), m).toBe(true);
    }
  });
  it("is false for Haiku 4.5 and older, and for names it doesn't know", () => {
    for (const m of ["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-sonnet-4-5", "claude-sonnet-4-0", "claude-opus-4-1-20250805", "claude-opus-4-20250514", "claude-3-haiku-20240307", "gpt-5", ""]) {
      expect(anthropicSupportsEffort(m), m).toBe(false);
    }
  });
});
