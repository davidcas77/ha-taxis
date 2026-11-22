import { createHmac, randomBytes } from "node:crypto";
import type { JevCheckPreview, JevCheckReview, JevCheckSubject } from "../../shared/jev-checks.ts";
import type { JevModel } from "../../shared/jev.ts";
import type { settingsStore } from "../settings.ts";
import { readJevCheckEvidence, type JevCheckReaders } from "./check-evidence.ts";
import { JevError, type JevProviderRequest } from "./service.ts";

const MAX_PREVIEW_BYTES = 24_000;
const MAX_ENTRIES = 48;
const PREVIEW_TTL_MS = 10 * 60_000;
const stale = () => new JevError("The evidence or Jev model changed. Review a fresh preview before sending.", 409, "stale");
const authorizationChanged = () =>
  new JevError("The Jev model or API key changed while preparing this check. Check again with the current settings.", 409, "stale");

type Authorization = { model: JevModel; digest: string };
type Reviewed = { review: JevCheckReview; reviewedAt: string };
export function jevCheckSessions(deps: {
  settings: ReturnType<typeof settingsStore>;
  reads: JevCheckReaders;
  check: (request: JevProviderRequest) => Promise<JevCheckReview>;
  redact: (s: string) => string;
  clock?: () => number;
  authorizationGeneration?: () => number;
}) {
  const clock = deps.clock ?? Date.now;
  const salt = randomBytes(32);
  // Issued previews expire independently of completed checks. The bounded
  // process-local maps store digests, times and closed-choice results only.
  const issued = new Map<string, number>();
  const completed = new Map<string, Reviewed>();
  const pending = new Map<string, Promise<Reviewed>>();
  const cacheKey = (preview: Pick<JevCheckPreview, "model" | "fingerprint">) => `${preview.model}:${preview.fingerprint}`;
  const isoNow = () => new Date(clock()).toISOString();
  const authorized = (): Authorization => {
    const config = deps.settings.jev();
    if (!config.enabled) throw new JevError("Enable Jev decisions in Settings first.", 409, "setup");
    const key = deps.settings.jevKey();
    if (!key) throw new JevError("Add a Jev API key in Settings first.", 409, "setup");
    return {
      model: config.model,
      digest: createHmac("sha256", salt)
        .update(JSON.stringify(["settings", config.model, key, deps.authorizationGeneration?.()]))
        .digest("hex"),
    };
  };
  const assertCurrent = (previous: Authorization) => {
    if (authorized().digest !== previous.digest) throw authorizationChanged();
  };
  function remember<T>(map: Map<string, T>, key: string, value: T) {
    map.delete(key);
    if (map.size >= MAX_ENTRIES) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
    map.set(key, value);
  }
  async function prepare(subject: JevCheckSubject, fresh: boolean, expectedModel?: JevModel) {
    const evidence = await readJevCheckEvidence(subject, deps.reads, deps.redact, fresh);
    const model = expectedModel ?? deps.settings.jev().model;
    const request: JevProviderRequest = { model, state: evidence.state, questions: evidence.provider };
    const size = () => Buffer.byteLength(JSON.stringify(request));
    while (subject.kind === "buttons" && evidence.questions.length > 1 && size() > MAX_PREVIEW_BYTES) {
      const removed = evidence.questions.pop()!;
      delete evidence.provider[removed.key];
      delete evidence.state.evidence[removed.key];
      delete evidence.identity[removed.key];
      evidence.state.evidence.pressesOmitted = Number(evidence.state.evidence.pressesOmitted) + 1;
    }
    const content = JSON.stringify(evidence.state, null, 2);
    if (size() > MAX_PREVIEW_BYTES) throw new JevError("This check’s evidence is too large to send safely. Select a narrower subject.", 409);
    const fingerprint = createHmac("sha256", salt)
      .update(JSON.stringify({ subject, request, identity: evidence.identity }))
      .digest("hex");
    return { request, preview: { model, content, fingerprint, questions: evidence.questions } };
  }
  async function reviewPrepared({ preview, request }: Awaited<ReturnType<typeof prepare>>, authorization: Authorization) {
    assertCurrent(authorization);
    const key = cacheKey(preview);
    const saved = completed.get(key);
    if (saved) {
      remember(completed, key, saved);
      return { ...saved, cached: true };
    }
    const pendingKey = `${key}:${authorization.digest}`;
    const underway = pending.get(pendingKey);
    if (underway) {
      const result = await underway;
      assertCurrent(authorization);
      return { ...result, cached: true };
    }
    // check() does its own synchronous setup, quota and single-flight checks
    // immediately before the provider request. No HA access is passed to it.
    const work = deps
      .check(request)
      .then((review) => {
        assertCurrent(authorization);
        const result = { review, reviewedAt: isoNow() };
        remember(completed, key, result);
        return result;
      })
      .finally(() => pending.delete(pendingKey));
    pending.set(pendingKey, work);
    return { ...(await work), cached: false };
  }
  return {
    async preview(subject: JevCheckSubject): Promise<JevCheckPreview> {
      const { preview } = await prepare(subject, false);
      const now = clock();
      for (const [key, expires] of issued) if (expires <= now) issued.delete(key);
      const key = cacheKey(preview);
      if (!issued.has(key)) remember(issued, key, now + PREVIEW_TTL_MS);
      return preview;
    },
    async run(subject: JevCheckSubject, fingerprint: string): Promise<{ review: JevCheckReview; cached: boolean }> {
      const authorization = authorized();
      const key = cacheKey({ model: authorization.model, fingerprint });
      const expires = issued.get(key);
      if (expires === undefined || clock() >= expires) throw stale();
      let result: Awaited<ReturnType<typeof prepare>>;
      try {
        result = await prepare(subject, true, authorization.model);
      } catch (error) {
        if (error instanceof JevError && error.status === 409) throw stale();
        throw error;
      }
      if (result.preview.fingerprint !== fingerprint || issued.get(key) !== expires || clock() >= expires) throw stale();
      const { review, cached } = await reviewPrepared(result, authorization);
      return { review, cached };
    },
    async auto(subject: JevCheckSubject) {
      const authorization = authorized();
      const result = await prepare(subject, true, authorization.model);
      const checkedAt = isoNow();
      return { preview: result.preview, ...(await reviewPrepared(result, authorization)), checkedAt };
    },
  };
}
