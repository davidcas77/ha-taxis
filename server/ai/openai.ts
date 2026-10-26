import type { AiEffort, ModelInfo } from "../../shared/ai.ts";
import { checkBaseUrl } from "../../shared/ai-url.ts";
import { failure, httpJson, mentions, type FetchLike, type HttpResult } from "./http.ts";
import { AiError, type AiProvider, type ChatMessage, type CompleteRequest, type CompleteResult, type StopReason, type ToolCall } from "./types.ts";

// Any service that speaks the OpenAI chat API: OpenAI itself, OpenRouter, Ollama
// (http://<host>:11434/v1), LM Studio and the like. Plain fetch, against the
// base URL the user set and no other host (redirects are never followed).
// https://platform.openai.com/docs/api-reference/chat

// Quick / Balanced / Thorough as `reasoning_effort`.
export const OPENAI_EFFORT: Record<AiEffort, "low" | "medium" | "high"> = { quick: "low", balanced: "medium", thorough: "high" };

// Models that turned `reasoning_effort` down, so the next call to them doesn't
// send it. Per base URL and model; forgotten when the process restarts.
const noEffort = new Set<string>();
const NO_EFFORT_MAX = 200;
export const forgetRejectedEffort = (): void => noEffort.clear();

// Names that are not chat models, hidden from the list.
const NOT_CHAT = /(embed|whisper|tts|dall-e|moderation|transcribe|realtime|audio|image|rerank)/i;

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

export function toWireMessages(system: string | undefined, messages: ChatMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } })) }
          : {}),
      });
    } else out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
  }
  return out;
}

function stopReason(v: unknown, hasCalls: boolean): StopReason {
  if (hasCalls || v === "tool_calls" || v === "function_call") return "tool_use";
  if (v === "stop") return "end";
  if (v === "length") return "max_tokens";
  if (v === "content_filter") return "refusal";
  return "other";
}

export function parseChatCompletion(body: unknown): CompleteResult {
  const choice = isRecord(body) && Array.isArray(body.choices) && isRecord(body.choices[0]) ? body.choices[0] : null;
  const message = choice && isRecord(choice.message) ? choice.message : null;
  if (!choice || !message) throw new AiError("upstream", "The answer wasn't in the shape Taxis expects (no choices).");
  const toolCalls: ToolCall[] = [];
  for (const c of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    if (!isRecord(c) || !isRecord(c.function) || typeof c.function.name !== "string") continue;
    const id = typeof c.id === "string" && c.id ? c.id : `call_${toolCalls.length + 1}`;
    const raw = c.function.arguments;
    try {
      const input: unknown = typeof raw === "string" && raw.trim() ? JSON.parse(raw) : {};
      if (!isRecord(input)) throw new Error("not an object");
      toolCalls.push({ id, name: c.function.name, input });
    } catch {
      toolCalls.push({ id, name: c.function.name, input: {}, invalid: "The model's arguments for this tool weren't a JSON object." });
    }
  }
  const usage = isRecord(body) && isRecord(body.usage) ? body.usage : null;
  return {
    text: typeof message.content === "string" ? message.content : "",
    toolCalls,
    stop: stopReason(choice.finish_reason, toolCalls.length > 0),
    // Some local servers leave usage out; the call can't be priced then.
    usage: usage ? { input: count(usage.prompt_tokens), output: count(usage.completion_tokens) } : { input: 0, output: 0, missing: true },
    model: isRecord(body) && typeof body.model === "string" ? body.model : "",
  };
}

export function openAiProvider(cfg: { baseUrl: string; key?: string | null; fetch?: FetchLike }): AiProvider {
  const checked = checkBaseUrl(cfg.baseUrl);
  if (!checked.ok) throw new AiError("config", checked.error);
  const base = checked.url;
  const host = new URL(base).host;
  const f = cfg.fetch ?? fetch;
  const headers: Record<string, string> = { "content-type": "application/json", ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}) };
  const opts = { label: host, secrets: [cfg.key] };
  // OpenAI's own newer models refuse max_tokens; the other services still use it.
  const tokensField = new URL(base).hostname === "api.openai.com" ? "max_completion_tokens" : "max_tokens";

  return {
    async listModels(): Promise<ModelInfo[]> {
      const res = await httpJson(f, `${base}/models`, { method: "GET", headers }, { ...opts, timeoutMs: 30_000 });
      if (!res.ok) throw failure(res, opts);
      const data = isRecord(res.body) ? res.body.data : undefined;
      if (!Array.isArray(data)) throw new AiError("upstream", `${host} answered, but its model list wasn't in the shape Taxis expects.`);
      const seen = new Set<string>();
      const models: ModelInfo[] = [];
      for (const m of data) {
        if (!isRecord(m) || typeof m.id !== "string" || !m.id || seen.has(m.id) || NOT_CHAT.test(m.id)) continue;
        seen.add(m.id);
        models.push({ id: m.id, name: m.id });
        if (models.length >= 500) break;
      }
      return models;
    },

    async complete(req: CompleteRequest): Promise<CompleteResult> {
      const memo = `${base}|${req.model}`;
      const body: Record<string, unknown> = {
        model: req.model,
        messages: toWireMessages(req.system, req.messages),
        [tokensField]: req.maxOutputTokens,
      };
      if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
      if (!noEffort.has(memo)) body.reasoning_effort = OPENAI_EFFORT[req.effort];

      const send = (): Promise<HttpResult> => httpJson(f, `${base}/chat/completions`, { method: "POST", headers, body }, opts);
      let res = await send();
      // Models that don't reason answer 400 and name the parameter: remember
      // that, and ask again without it, once.
      if (!res.ok && (res.status === 400 || res.status === 422) && body.reasoning_effort !== undefined && mentions(res, /reasoning_effort|reasoning/i)) {
        if (noEffort.size >= NO_EFFORT_MAX) noEffort.clear();
        noEffort.add(memo);
        delete body.reasoning_effort;
        res = await send();
      }
      if (!res.ok) throw failure(res, opts);
      return parseChatCompletion(res.body);
    },
  };
}
