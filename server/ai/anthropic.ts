import type { AiEffort, ModelInfo } from "../../shared/ai.ts";
import { failure, httpJson, mentions, type FetchLike, type HttpResult } from "./http.ts";
import { AiError, type AiProvider, type ChatMessage, type CompleteRequest, type CompleteResult, type StopReason, type ToolCall } from "./types.ts";

// Anthropic's Messages API and Models API over plain fetch.
// https://platform.claude.com/docs/en/api/messages
//
// The address is fixed: this is the only host this provider talks to. The API
// version and the request fields below are the ones in Anthropic's current
// guidance (claude-api skill, 2026-10): `output_config.effort` sets how hard the
// model thinks, adaptive thinking is the default on the 5.x models so no
// `thinking` field is sent, and no sampling parameters (temperature, top_p,
// top_k) are sent, which the 2026-10-21 version rejects.

export const ANTHROPIC_URL = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2026-10-21";

// Quick / Balanced / Thorough as Anthropic's effort levels. "high" is as far as
// Thorough goes: "xhigh" and "max" cost a good deal more and are for work that
// needs them.
export const ANTHROPIC_EFFORT: Record<AiEffort, "low" | "medium" | "high"> = { quick: "low", balanced: "medium", thorough: "high" };

// Whether a model takes `output_config.effort`: the 5.x models and Opus/Sonnet
// 4.5-4.6 and later do; Haiku 4.5 and the older models answer 400. When this is
// wrong for a model, the 400 is caught and the call retried without it.
export function anthropicSupportsEffort(model: string): boolean {
  const m = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(model);
  if (!m) return false;
  const major = Number(m[2]);
  const minor = m[3] === undefined ? 0 : Number(m[3]);
  if (m[1] === "fable" || m[1] === "mythos") return true;
  if (major >= 5) return true;
  if (major === 4 && m[1] === "opus") return minor >= 5;
  if (major === 4 && m[1] === "sonnet") return minor >= 6;
  return false;
}

type Block = Record<string, unknown>;
type WireMessage = { role: "user" | "assistant"; content: string | Block[] };

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

// Tool results go back in one user message together, which is how Anthropic
// wants parallel tool calls answered.
export function toWireMessages(messages: ChatMessage[]): WireMessage[] {
  const out: WireMessage[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const content: Block[] = Array.isArray(m.raw)
        ? (m.raw as Block[])
        : [
            ...(m.content ? [{ type: "text", text: m.content }] : []),
            ...(m.toolCalls ?? []).map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
          ];
      if (content.length > 0) out.push({ role: "assistant", content });
    } else {
      const block: Block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content, ...(m.isError ? { is_error: true } : {}) };
      const last = out[out.length - 1];
      if (last?.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) last.content.push(block);
      else out.push({ role: "user", content: [block] });
    }
  }
  return out;
}

function stopReason(v: unknown): StopReason {
  switch (v) {
    case "end_turn":
    case "stop_sequence":
      return "end";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

export function parseAnthropicMessage(body: unknown): CompleteResult {
  if (!isRecord(body) || !Array.isArray(body.content)) throw new AiError("upstream", "Anthropic's answer wasn't in the shape Taxis expects.");
  const texts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const b of body.content) {
    if (!isRecord(b)) continue;
    // Thinking blocks stay in `raw` only; they are not part of the answer.
    if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
    else if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
      toolCalls.push({ id: b.id, name: b.name, input: isRecord(b.input) ? b.input : {} });
    }
  }
  const usage = isRecord(body.usage) ? body.usage : null;
  return {
    text: texts.join(""),
    toolCalls,
    stop: stopReason(body.stop_reason),
    usage: usage ? { input: count(usage.input_tokens), output: count(usage.output_tokens) } : { input: 0, output: 0, missing: true },
    model: typeof body.model === "string" ? body.model : "",
    raw: body.content,
  };
}

export function anthropicProvider(cfg: { key: string; fetch?: FetchLike }): AiProvider {
  const f = cfg.fetch ?? fetch;
  const headers = { "x-api-key": cfg.key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" };
  const opts = { label: "Anthropic", secrets: [cfg.key] };

  return {
    async listModels(): Promise<ModelInfo[]> {
      const models: ModelInfo[] = [];
      let after: string | undefined;
      // Newest first. A few pages are plenty: Anthropic lists tens of models.
      for (let page = 0; page < 5; page++) {
        const res = await httpJson(f, `${ANTHROPIC_URL}/v1/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ""}`, { method: "GET", headers }, { ...opts, timeoutMs: 30_000 });
        if (!res.ok) throw failure(res, opts);
        const body = res.body;
        if (!isRecord(body) || !Array.isArray(body.data)) throw new AiError("upstream", "Anthropic's model list wasn't in the shape Taxis expects.");
        for (const m of body.data) {
          if (isRecord(m) && typeof m.id === "string") models.push({ id: m.id, name: typeof m.display_name === "string" ? m.display_name : m.id });
        }
        if (body.has_more === true && typeof body.last_id === "string") after = body.last_id;
        else break;
      }
      return models;
    },

    async complete(req: CompleteRequest): Promise<CompleteResult> {
      const body: Record<string, unknown> = {
        model: req.model,
        max_tokens: req.maxOutputTokens,
        messages: toWireMessages(req.messages),
      };
      if (req.system) body.system = req.system;
      if (req.tools?.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
      // No tool_choice: "auto" is the default, and forcing a tool is refused by the newest models.
      if (anthropicSupportsEffort(req.model)) body.output_config = { effort: ANTHROPIC_EFFORT[req.effort] };

      const send = (): Promise<HttpResult> => httpJson(f, `${ANTHROPIC_URL}/v1/messages`, { method: "POST", headers, body }, opts);
      let res = await send();
      if (!res.ok && res.status === 400 && body.output_config && mentions(res, /effort|output_config/i)) {
        delete body.output_config;
        res = await send();
      }
      if (!res.ok) throw failure(res, opts);
      return parseAnthropicMessage(res.body);
    },
  };
}
