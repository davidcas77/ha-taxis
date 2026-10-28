import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import {
  AI_TIERS,
  AI_PROVIDERS,
  type AiTier,
  type AiModelsRequest,
  type AiModelsResponse,
  type AiProviderId,
  type AiSettingsResponse,
  type AiTestResponse,
  type AiUsageResponse,
} from "../../shared/ai.ts";
import { log } from "../log.ts";
import { keyReentryProblem } from "../../shared/ai-form.ts";
import { isAiKey, validateAi, type settingsStore } from "../settings.ts";
import { scrub, type FetchLike } from "./http.ts";
import type { AiLedger } from "./ledger.ts";
import type { ProviderFactory } from "./provider.ts";
import { aiService } from "./service.ts";
import { AiError } from "./types.ts";

// /api/settings/ai, /api/ai/models, /api/ai/test and /api/ai/usage. Mounted
// under /api, so the cross-site header guard in index.ts covers them. None of
// them returns the API key, and no error text leaves here without it, the Home
// Assistant token or anything key-shaped removed. AI has no write path to Home
// Assistant: these routes touch Taxis's own settings and ledger only.

export type AiRouteDeps = {
  settings: ReturnType<typeof settingsStore>;
  ledger: AiLedger;
  // Registers a secret with the logger so it can never be written to the log.
  protect: (secret: string) => void;
  // Takes the Home Assistant token out of a message.
  redact: (message: string) => string;
  fetch?: FetchLike;
  makeProvider?: ProviderFactory;
  clock?: () => number;
};

const STATUS: Record<AiError["kind"], 400 | 409 | 429 | 502> = {
  disabled: 409,
  "no-key": 409,
  "no-model": 409,
  cap: 429,
  config: 400,
  "bad-request": 502,
  network: 502,
  upstream: 502,
};

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

export function aiRoutes(deps: AiRouteDeps): Hono {
  const app = new Hono();
  const service = aiService({ settings: deps.settings, ledger: deps.ledger, fetch: deps.fetch, makeProvider: deps.makeProvider, clock: deps.clock });

  // An error as the browser sees it. Anything that isn't an AiError is logged
  // and answered generally, since its text can't be trusted to be free of secrets.
  const fail = (what: string, e: unknown): { error: string; status: 400 | 409 | 429 | 500 | 502 } => {
    const keys = AI_PROVIDERS.map((p) => deps.settings.aiKey(p));
    if (e instanceof AiError) {
      const error = deps.redact(scrub(e.message, keys));
      log.warn(`${what} failed: ${error}`);
      return { error, status: STATUS[e.kind] };
    }
    log.error(`${what} failed`, e);
    return { error: "Something went wrong in Taxis. See the app's log.", status: 500 };
  };

  app.get("/settings/ai", (c) => c.json<AiSettingsResponse>({ ok: true, ai: deps.settings.aiView() }));

  app.put("/settings/ai", bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json<AiSettingsResponse>({ ok: false, error: "The AI settings are too large." }, 413) }), async (c) => {
    const checked = validateAi(await c.req.json().catch(() => null));
    if (!checked.ok) return c.json<AiSettingsResponse>({ ok: false, error: checked.error }, 400);
    // The stored OpenAI-compatible key was entered for the saved address. If the
    // address changes and the key isn't supplied again, refuse rather than send it
    // to a host the user never gave it to. Nothing is saved.
    const problem = keyReentryProblem({
      provider: checked.value.provider,
      savedBaseUrl: deps.settings.ai().baseUrl,
      newBaseUrl: checked.value.baseUrl,
      compatibleKeyStored: deps.settings.aiKey("openai-compatible") !== null,
      change: checked.key === undefined ? "keep" : checked.key === null ? "remove" : "replace",
    });
    if (problem) return c.json<AiSettingsResponse>({ ok: false, error: problem }, 409);
    // Everything was checked above, so both writes are expected to succeed.
    deps.settings.saveAi(checked.value);
    if (checked.key !== undefined) {
      deps.settings.saveAiKey(checked.value.provider, checked.key);
      if (checked.key) deps.protect(checked.key);
    }
    log.info(`Saved AI settings (${checked.value.enabled ? "on" : "off"}, ${checked.value.provider}${checked.key === undefined ? "" : checked.key === null ? ", key removed" : ", key replaced"})`);
    return c.json<AiSettingsResponse>({ ok: true, ai: deps.settings.aiView() });
  });

  app.post("/ai/models", bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json<AiModelsResponse>({ ok: false, error: "The request is too large." }, 413) }), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body !== null && !isRecord(body)) return c.json<AiModelsResponse>({ ok: false, error: "The request wasn't readable." }, 400);
    const typed: AiModelsRequest = {};
    if (body?.provider !== undefined) {
      if (!(AI_PROVIDERS as readonly unknown[]).includes(body.provider)) return c.json<AiModelsResponse>({ ok: false, error: "Choose a provider." }, 400);
      typed.provider = body.provider as AiProviderId;
    }
    if (body?.baseUrl !== undefined) {
      if (typeof body.baseUrl !== "string") return c.json<AiModelsResponse>({ ok: false, error: "The base URL wasn't readable." }, 400);
      typed.baseUrl = body.baseUrl;
    }
    if (body?.key !== undefined && body.key !== "") {
      if (!isAiKey(body.key)) return c.json<AiModelsResponse>({ ok: false, error: "The API key can't contain spaces and can't be longer than 400 characters." }, 400);
      typed.key = body.key;
      // A key typed here is used for this one request, not stored; keep it out of the log all the same.
      deps.protect(body.key);
    }
    try {
      return c.json<AiModelsResponse>({ ok: true, models: await service.models(typed) });
    } catch (e) {
      const { error, status } = fail("Loading the AI models", e);
      return c.json<AiModelsResponse>({ ok: false, error }, status);
    }
  });

  app.post("/ai/test", bodyLimit({ maxSize: 1024, onError: (c) => c.json<AiTestResponse>({ ok: false, error: "The request is too large." }, 413) }), async (c) => {
    const body = await c.req.json().catch(() => null);
    // Accept requests from a pre-tier browser tab during an app update.
    const legacyJob = isRecord(body) ? body.job : undefined;
    const tier = isRecord(body) && body.tier !== undefined ? body.tier : legacyJob === "quick" ? "low" : legacyJob === "ask" ? "medium" : legacyJob;
    if (tier !== undefined && !(AI_TIERS as readonly unknown[]).includes(tier)) return c.json<AiTestResponse>({ ok: false, error: "Choose Low, Medium or Strong." }, 400);
    try {
      const test = await service.test((tier as AiTier | undefined) ?? "low");
      log.info(`AI test with ${test.model}: ${test.inputTokens} in, ${test.outputTokens} out`);
      return c.json<AiTestResponse>({ ok: true, test });
    } catch (e) {
      const { error, status } = fail("The AI test", e);
      return c.json<AiTestResponse>({ ok: false, error }, status);
    }
  });

  app.get("/ai/usage", (c) => c.json<AiUsageResponse>({ ok: true, usage: deps.ledger.monthToDate(deps.settings.ai().monthlyCapUsd) }));

  return app;
}
