import { ROOM_AUTOMATIONS, type RoomAutomationKey } from "./guide-automations.ts";
import { jevRecord, type JevModel } from "./jev.ts";

export type JevCheckSubject =
  | { kind: "buttons"; controlId: string }
  | { kind: "area"; target: "device" | "entity"; id: string }
  | { kind: "equipment"; areaId: string; automationKey: RoomAutomationKey; checkKey: string }
  | { kind: "groups"; areaId: string; automationKey: RoomAutomationKey };

export type JevCheckQuestion = { key: string; label: string; choices: Record<string, string> };
export type JevCheckPreview = { fingerprint: string; model: JevModel; content: string; questions: JevCheckQuestion[] };
export type JevCheckChoice = { choice: string; confidence: number; probabilities: Record<string, number> };
export type JevCheckReview = {
  model: string;
  answers: Record<string, JevCheckChoice>;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
};
export type JevCheckFailure = { ok: false; error: string; code?: "stale" | "setup" | "busy" };
export type JevCheckPreviewResponse = { ok: true; preview: JevCheckPreview } | JevCheckFailure;
export type JevCheckRunResponse = { ok: true; review: JevCheckReview; cached: boolean } | JevCheckFailure;
export type JevCheckAutoResponse =
  { ok: true; preview: JevCheckPreview; review: JevCheckReview; cached: boolean; checkedAt: string; reviewedAt: string } | JevCheckFailure;

const id = (v: unknown): v is string => typeof v === "string" && /^[\p{L}\p{N}_.:-]{1,255}$/u.test(v) && !v.startsWith("new:");
const key = (v: unknown): v is RoomAutomationKey => ROOM_AUTOMATIONS.some((x) => x.key === v);

export function validateJevCheckSubject(input: unknown): JevCheckSubject | null {
  if (!jevRecord(input)) return null;
  const exact = (fields: string[]) => Object.keys(input).length === fields.length && fields.every((field) => Object.hasOwn(input, field));
  if (input.kind === "buttons" && exact(["kind", "controlId"]) && id(input.controlId) && /^(device|entity):.+$/.test(input.controlId)) {
    return { kind: "buttons", controlId: input.controlId };
  }
  if (input.kind === "area" && exact(["kind", "target", "id"]) && id(input.id) && (input.target === "device" || input.target === "entity")) {
    return { kind: "area", target: input.target, id: input.id };
  }
  if (!id(input.areaId) || !key(input.automationKey)) return null;
  if (input.kind === "equipment" && exact(["kind", "areaId", "automationKey", "checkKey"]) && id(input.checkKey)) {
    return { kind: "equipment", areaId: input.areaId, automationKey: input.automationKey, checkKey: input.checkKey };
  }
  if (input.kind === "groups" && exact(["kind", "areaId", "automationKey"])) {
    return { kind: "groups", areaId: input.areaId, automationKey: input.automationKey };
  }
  return null;
}
