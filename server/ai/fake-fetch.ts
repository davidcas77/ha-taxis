import type { FetchLike } from "./http.ts";

// A stand-in for fetch in tests: answers from a script and records what was
// sent, so a test can assert the exact request, and that nothing else was sent.

export type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
export type Reply = { status?: number; body?: unknown; text?: string; headers?: Record<string, string> } | Error;

export function fakeFetch(script: Reply | ((call: Call, n: number) => Reply)) {
  const calls: Call[] = [];
  const f: FetchLike = async (input, init) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const r = typeof script === "function" ? script(call, calls.length - 1) : script;
    if (r instanceof Error) throw r;
    return new Response(r.text ?? (r.body === undefined ? "" : JSON.stringify(r.body)), { status: r.status ?? 200, headers: r.headers });
  };
  return { fetch: f, calls };
}

// Anthropic's message answer, with the fields Taxis reads.
export const anthropicMessage = (over: Record<string, unknown> = {}) => ({
  id: "msg_test",
  type: "message",
  model: "claude-haiku-5-5",
  role: "assistant",
  content: [{ type: "text", text: "ready" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 20, output_tokens: 5 },
  ...over,
});

export const chatCompletion = (over: Record<string, unknown> = {}) => ({
  id: "chatcmpl-test",
  model: "local-model",
  choices: [{ index: 0, message: { role: "assistant", content: "ready" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 20, completion_tokens: 5 },
  ...over,
});

// An invented key. Tests assert it never shows up where it shouldn't.
export const TEST_KEY = "sk-test-invented-0123456789abcdef";
