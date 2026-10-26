import type { AiEffort, ModelInfo } from "../../shared/ai.ts";

// What every AI provider does, in one shape. Ask Taxis will use `tools` later:
// a tool is a name, a description and a JSON Schema for its input, and the model
// answers with calls to them. A provider never runs a tool; the caller does, and
// sends the result back as a "tool" message.

export type ToolDef = {
  name: string;
  description: string;
  // A JSON Schema with type "object".
  inputSchema: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  // Set when the model's arguments weren't valid JSON; `input` is empty then.
  invalid?: string;
};

export type ChatMessage =
  | { role: "user"; content: string }
  // `raw` is what the provider sent, kept so a follow-up can replay it exactly
  // (Anthropic's thinking blocks must come back unchanged).
  | { role: "assistant"; content: string; toolCalls?: ToolCall[]; raw?: unknown }
  | { role: "tool"; toolCallId: string; content: string; isError?: boolean };

export type CompleteRequest = {
  model: string;
  system?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxOutputTokens: number;
  effort: AiEffort;
};

export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal" | "other";

export type CompleteResult = {
  text: string;
  toolCalls: ToolCall[];
  stop: StopReason;
  // `missing`: the service didn't say, so the counts are zero and the call can't be priced.
  usage: { input: number; output: number; missing?: boolean };
  model: string;
  raw?: unknown;
};

export interface AiProvider {
  listModels(): Promise<ModelInfo[]>;
  complete(req: CompleteRequest): Promise<CompleteResult>;
}

export type AiErrorKind = "disabled" | "no-key" | "no-model" | "cap" | "config" | "network" | "upstream" | "bad-request";

// An error that is safe to show: its message has been through scrub().
export class AiError extends Error {
  kind: AiErrorKind;
  constructor(kind: AiErrorKind, message: string) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
  }
}
