import type { AiTier, AiProviderId } from "./ai.ts";
import type { AiSettingsView, AiUsage } from "./ai.ts";
import type { JevView, JevUsage } from "./jev.ts";

export const ASSISTANT_ACTIONS = {
  explain: { label: "Explain", tier: "medium", task: "explanation", prompt: "Explain this page and the supplied facts in plain language." },
  next: { label: "Suggest next steps", tier: "strong", task: "planning", prompt: "What should I do next for comfort and convenient lighting with the equipment I already have?" },
  naming: { label: "Naming help", tier: "low", task: "naming", prompt: "Explain the configured naming and suggest consistent names for the supplied entities." },
} as const;
export type AssistantAction = keyof typeof ASSISTANT_ACTIONS;
export const ASSISTANT_PAGES = ["areas", "guide", "parameters", "organize", "recipes", "health", "changes", "settings", "ai-admin", "buttons"] as const;
export type AssistantScope = { page: (typeof ASSISTANT_PAGES)[number]; section: string; areaId: string | null; includeData: boolean };
export type AssistantPreview = { fingerprint: string; title: string; content: string; omissions: string[] };
export type AssistantMessage = { role: "user" | "assistant"; content: string };
export type AssistantRequest = AssistantScope & { action: AssistantAction; question: string; fingerprint: string; history: AssistantMessage[] };
export type AssistantAnswer = { text: string; tier: AiTier; model: string; provider: AiProviderId; costUsd: number | null; inputTokens: number; outputTokens: number; truncated: boolean };
export type AssistantActivity = { at: string; action: AssistantAction; page: string; scope: string; tier: AiTier; model: string; status: string };
export type AssistantPreviewResponse = { ok: true; preview: AssistantPreview } | { ok: false; error: string };
export type AssistantResponse = { ok: true; answer: AssistantAnswer } | { ok: false; error: string };
export type AssistantAdminResponse = { ok: true; ai: AiSettingsView; jev: JevView; usage: AiUsage; jevUsage: JevUsage; activity: AssistantActivity[] } | { ok: false; error: string };

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function assistantScope(v: unknown): AssistantScope | null {
  if (!record(v) || !(ASSISTANT_PAGES as readonly unknown[]).includes(v.page) || typeof v.section !== "string" || v.section.length > 60 ||
      !/^[a-z0-9-]*$/.test(v.section) || typeof v.includeData !== "boolean" ||
      !(v.areaId === null || typeof v.areaId === "string" && v.areaId.length > 0 && v.areaId.length <= 200)) return null;
  return { page: v.page as AssistantScope["page"], section: v.section, areaId: v.areaId as string | null, includeData: v.includeData };
}
export function assistantRequest(v: unknown): AssistantRequest | null {
  const scope = assistantScope(v);
  if (!scope || !record(v) || !Object.hasOwn(ASSISTANT_ACTIONS, String(v.action)) || typeof v.question !== "string" ||
      !v.question.trim() || v.question.length > 2000 || typeof v.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(v.fingerprint) ||
      !Array.isArray(v.history) || v.history.length > 6 || v.history.some(m => !record(m) || !["user", "assistant"].includes(String(m.role)) || typeof m.content !== "string" || m.content.length > 2000)) return null;
  const allowed = new Set(["page", "section", "areaId", "includeData", "action", "question", "fingerprint", "history"]);
  if (Object.keys(v).some(k => !allowed.has(k))) return null;
  return { ...scope, action: v.action as AssistantAction, question: v.question.trim(), fingerprint: v.fingerprint, history: v.history as AssistantMessage[] };
}
