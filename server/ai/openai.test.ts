import { beforeEach, describe, expect, it } from "vitest";

import { TEST_KEY, chatCompletion, fakeFetch } from "./fake-fetch.ts";
import { OPENAI_EFFORT, forgetRejectedEffort, openAiProvider, toWireMessages } from "./openai.ts";
import { AiError, type CompleteRequest } from "./types.ts";

const req = (over: Partial<CompleteRequest> = {}): CompleteRequest => ({
  model: "qwen2.5:7b",
  messages: [{ role: "user", content: "hi" }],
  maxOutputTokens: 512,
  effort: "balanced",
  ...over,
});

beforeEach(() => forgetRejectedEffort());

describe("openAiProvider.complete", () => {
  it("posts a chat completion to the base URL and nowhere else", async () => {
    const t = fakeFetch({ body: chatCompletion() });
    const out = await openAiProvider({ baseUrl: "http://192.168.1.20:11434/v1/", key: TEST_KEY, fetch: t.fetch }).complete(req({ system: "Be brief." }));
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].url).toBe("http://192.168.1.20:11434/v1/chat/completions");
    expect(t.calls[0].method).toBe("POST");
    expect(t.calls[0].headers.authorization).toBe(`Bearer ${TEST_KEY}`);
    expect(t.calls[0].body).toEqual({
      model: "qwen2.5:7b",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "hi" },
      ],
      max_tokens: 512,
      reasoning_effort: "medium",
    });
    expect(out).toMatchObject({ text: "ready", stop: "end", usage: { input: 20, output: 5 }, model: "local-model", toolCalls: [] });
  });

  it("uses max_completion_tokens on OpenAI itself, and sends no key header when there is none", async () => {
    const t = fakeFetch({ body: chatCompletion() });
    await openAiProvider({ baseUrl: "https://api.openai.com/v1", key: TEST_KEY, fetch: t.fetch }).complete(req({ model: "gpt-5" }));
    expect(t.calls[0].body).toMatchObject({ max_completion_tokens: 512 });
    expect(t.calls[0].body).not.toHaveProperty("max_tokens");

    const local = fakeFetch({ body: chatCompletion() });
    await openAiProvider({ baseUrl: "http://localhost:1234/v1", fetch: local.fetch }).complete(req());
    expect(local.calls[0].headers).not.toHaveProperty("authorization");
  });

  it("maps Quick, Balanced and Thorough to reasoning_effort", async () => {
    expect(OPENAI_EFFORT).toEqual({ quick: "low", balanced: "medium", thorough: "high" });
    const t = fakeFetch({ body: chatCompletion() });
    await openAiProvider({ baseUrl: "http://localhost:1234/v1", fetch: t.fetch }).complete(req({ effort: "thorough" }));
    expect(t.calls[0].body).toMatchObject({ reasoning_effort: "high" });
  });

  it("retries once without reasoning_effort when the model rejects it, then remembers", async () => {
    const reject = { status: 400, body: { error: { message: "Unsupported parameter: 'reasoning_effort' is not supported with this model." } } };
    const t = fakeFetch((c) => ((c.body as Record<string, unknown>).reasoning_effort ? reject : { body: chatCompletion() }));
    const p = openAiProvider({ baseUrl: "https://api.openai.com/v1", key: TEST_KEY, fetch: t.fetch });

    expect((await p.complete(req({ model: "gpt-4o" }))).text).toBe("ready");
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1].body).not.toHaveProperty("reasoning_effort");

    // The next call to that model doesn't send it at all; another model still does.
    await p.complete(req({ model: "gpt-4o" }));
    expect(t.calls).toHaveLength(3);
    expect(t.calls[2].body).not.toHaveProperty("reasoning_effort");
    await p.complete(req({ model: "o4-mini" })).catch(() => {});
    expect(t.calls[3].body).toHaveProperty("reasoning_effort");
  });

  it("doesn't retry a 400 that doesn't name it, or retry twice", async () => {
    const t = fakeFetch({ status: 400, body: { error: { message: "context length exceeded" } } });
    await expect(openAiProvider({ baseUrl: "http://localhost:1234/v1", fetch: t.fetch }).complete(req())).rejects.toThrow(/context length exceeded/);
    expect(t.calls).toHaveLength(1);

    const always = fakeFetch({ status: 400, body: { error: { message: "reasoning_effort is invalid" } } });
    await expect(openAiProvider({ baseUrl: "http://localhost:1234/v1", fetch: always.fetch }).complete(req({ model: "m2" }))).rejects.toBeInstanceOf(AiError);
    expect(always.calls).toHaveLength(2);
  });

  it("sends tools as functions and returns the calls, parsed", async () => {
    const t = fakeFetch({
      body: chatCompletion({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                { id: "call_1", type: "function", function: { name: "get_state", arguments: '{"entity_id":"light.kitchen"}' } },
                { id: "call_2", type: "function", function: { name: "broken", arguments: "{nope" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    });
    const out = await openAiProvider({ baseUrl: "http://localhost:1234/v1", fetch: t.fetch }).complete(
      req({ tools: [{ name: "get_state", description: "Read a state", inputSchema: { type: "object", properties: {} } }] }),
    );
    expect((t.calls[0].body as { tools: unknown }).tools).toEqual([
      { type: "function", function: { name: "get_state", description: "Read a state", parameters: { type: "object", properties: {} } } },
    ]);
    expect(out.stop).toBe("tool_use");
    expect(out.toolCalls[0]).toEqual({ id: "call_1", name: "get_state", input: { entity_id: "light.kitchen" } });
    expect(out.toolCalls[1]).toMatchObject({ id: "call_2", name: "broken", input: {}, invalid: expect.any(String) });
  });

  it("reports length and missing usage", async () => {
    const t = fakeFetch({ body: { model: "m", choices: [{ message: { content: "cut" }, finish_reason: "length" }] } });
    const out = await openAiProvider({ baseUrl: "http://localhost:1234/v1", fetch: t.fetch }).complete(req());
    expect(out.stop).toBe("max_tokens");
    expect(out.usage).toEqual({ input: 0, output: 0, missing: true });
  });

  it("refuses a base URL that isn't allowed, before anything is sent", () => {
    const t = fakeFetch({ body: chatCompletion() });
    expect(() => openAiProvider({ baseUrl: "http://api.example.com/v1", fetch: t.fetch })).toThrow(/https/);
    expect(() => openAiProvider({ baseUrl: "http://169.254.169.254/v1", fetch: t.fetch })).toThrow(AiError);
    expect(t.calls).toEqual([]);
  });

  it("keeps the key out of errors, even when the service echoes it", async () => {
    const t = fakeFetch({ status: 401, body: { error: { message: `Incorrect API key provided: ${TEST_KEY}. Find your key at ...` } } });
    const e = await openAiProvider({ baseUrl: "https://api.openai.com/v1", key: TEST_KEY, fetch: t.fetch }).complete(req()).catch((x: Error) => x);
    expect((e as Error).message).toMatch(/api\.openai\.com answered 401/);
    expect((e as Error).message).not.toContain(TEST_KEY);
  });

  it("hints at the base URL on a 404", async () => {
    const t = fakeFetch({ status: 404, text: "404 page not found" });
    await expect(openAiProvider({ baseUrl: "http://localhost:11434", fetch: t.fetch }).complete(req())).rejects.toThrow(/ends in \/v1/);
  });
});

describe("openAiProvider.listModels", () => {
  it("recovers from a temporary HTML gateway timeout on the model list", async () => {
    const t = fakeFetch((_call, index) => index === 0 ? { status: 504, text: "<!DOCTYPE html><title>Gateway time-out</title>" } : { body: { data: [{ id: "example-model" }] } });
    const models = await openAiProvider({ baseUrl: "https://api.openai.com/v1", key: TEST_KEY, fetch: t.fetch }).listModels();
    expect(models).toEqual([{ id: "example-model", name: "example-model" }]);
    expect(t.calls).toHaveLength(2);
    expect(t.calls.every(call => call.method === "GET" && call.url === "https://api.openai.com/v1/models")).toBe(true);
  });

  it("reads GET /models, drops what isn't a chat model and keeps the service's order", async () => {
    const t = fakeFetch({
      body: { object: "list", data: [{ id: "qwen2.5:7b" }, { id: "text-embedding-3-small" }, { id: "llama3.2:3b" }, { id: "whisper-1" }, { id: "qwen2.5:7b" }, { id: "gpt-image-1" }] },
    });
    const models = await openAiProvider({ baseUrl: "http://192.168.1.20:11434/v1", fetch: t.fetch }).listModels();
    expect(models).toEqual([
      { id: "qwen2.5:7b", name: "qwen2.5:7b" },
      { id: "llama3.2:3b", name: "llama3.2:3b" },
    ]);
    expect(t.calls[0].url).toBe("http://192.168.1.20:11434/v1/models");
    expect(t.calls[0].method).toBe("GET");
  });

  it("says when the answer isn't a model list", async () => {
    const t = fakeFetch({ body: { models: [] } });
    await expect(openAiProvider({ baseUrl: "http://localhost:1234/v1", fetch: t.fetch }).listModels()).rejects.toThrow(/model list/);
  });
});

describe("toWireMessages", () => {
  it("carries a tool round trip", () => {
    expect(
      toWireMessages("sys", [
        { role: "user", content: "q" },
        { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "a", input: { x: 1 } }] },
        { role: "tool", toolCallId: "c1", content: "result" },
      ]),
    ).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "q" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "a", arguments: '{"x":1}' } }] },
      { role: "tool", tool_call_id: "c1", content: "result" },
    ]);
  });
});
