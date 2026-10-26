import { redact } from "../config.ts";
import { AiError } from "./types.ts";

// One HTTP call to an AI service, for every provider. What it guarantees:
//
//   - only the URL it is given: redirects are never followed (a redirect could
//     carry the API key to another host), a 3xx is an error;
//   - a time limit and a size limit on the answer;
//   - every error message has the key and anything that looks like one removed
//     before it can reach a log or the browser.

export type FetchLike = typeof fetch;

export type HttpResult = { ok: boolean; status: number; body: unknown; text: string };

const MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 180_000;

// Removes each secret (through redact()) and then key-shaped strings a service
// may echo back, such as "Incorrect API key provided: sk-proj-...abcd". Cut to a
// length that fits one line of a log.
export function scrub(message: string, secrets: readonly (string | null | undefined)[] = []): string {
  let out = message;
  for (const s of secrets) if (s) out = redact(out, s);
  out = out.replace(/\bsk-[A-Za-z0-9_*.-]{4,}/g, "sk-***").replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=*-]{8,}/gi, "$1 ***");
  return out.length > 400 ? `${out.slice(0, 400)}…` : out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error("the answer is too large");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("the answer is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function why(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return "it took too long to answer";
    const cause = (e as { cause?: unknown }).cause;
    if (isRecord(cause) && typeof cause.code === "string") return cause.code;
    return e.message;
  }
  return String(e);
}

export type RequestOptions = {
  // Names the service in messages: "Anthropic", "api.openai.com".
  label: string;
  secrets: readonly (string | null | undefined)[];
  timeoutMs?: number;
};

export async function httpJson(
  f: FetchLike,
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: unknown },
  o: RequestOptions,
): Promise<HttpResult> {
  let res: Response;
  try {
    res = await f(url, {
      method: init.method,
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "manual",
      signal: AbortSignal.timeout(o.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (e) {
    throw new AiError("network", scrub(`Couldn't reach ${o.label}: ${why(e)}.`, o.secrets));
  }
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => {});
    throw new AiError("upstream", `${o.label} redirected the request elsewhere. Taxis doesn't follow redirects, so check the base URL.`);
  }
  let text: string;
  try {
    text = await readCapped(res);
  } catch (e) {
    throw new AiError("upstream", scrub(`Couldn't read the answer from ${o.label}: ${why(e)}.`, o.secrets));
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { ok: res.ok, status: res.status, body, text };
}

// What the service said was wrong, in a line.
function detail(r: HttpResult): string {
  const b = r.body;
  if (isRecord(b)) {
    const e = b.error;
    if (typeof e === "string") return e;
    if (isRecord(e) && typeof e.message === "string") return e.message;
    if (typeof b.message === "string") return b.message;
  }
  return r.text.replace(/\s+/g, " ").trim();
}

const HINT: Record<number, string> = {
  401: " Check the API key.",
  403: " Check the API key and what it may use.",
  404: " Check the base URL (it usually ends in /v1) and the model name.",
  429: " The service is rate limiting this key, or the account is out of credit.",
};

export function failure(r: HttpResult, o: RequestOptions): AiError {
  const d = detail(r).replace(/[.\s]+$/, "");
  const message = `${o.label} answered ${r.status}${d ? `: ${d}` : ""}.${HINT[r.status] ?? ""}`;
  return new AiError(r.status === 400 ? "bad-request" : "upstream", scrub(message, o.secrets));
}

export const mentions = (r: HttpResult, pattern: RegExp): boolean => pattern.test(r.text);
