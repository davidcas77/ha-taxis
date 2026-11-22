import { createHmac, randomBytes } from "node:crypto";
import type { JevCheckPreview, JevCheckReview, JevCheckSubject } from "../../shared/jev-checks.ts";
import type { settingsStore } from "../settings.ts";
import { readJevCheckEvidence, type JevCheckReaders } from "./check-evidence.ts";
import { JevError, type JevProviderRequest } from "./service.ts";

const MAX_PREVIEW_BYTES = 24_000;
const MAX_ENTRIES = 48;
const TTL_MS = 10 * 60_000;
const stale = () => new JevError("The evidence or Jev model changed. Review a fresh preview before sending.", 409, "stale");

type Session = { expires: number; review?: JevCheckReview };
export function jevCheckSessions(deps: {
  settings: ReturnType<typeof settingsStore>;
  reads: JevCheckReaders;
  check: (request: JevProviderRequest) => Promise<JevCheckReview>;
  redact: (s: string) => string;
  clock?: () => number;
}) {
  const clock = deps.clock ?? Date.now;
  const salt = randomBytes(32);
  // Only opaque digests and closed-choice results are retained, without raw
  // names, configuration, provider body, keys, or subject identifiers.
  const sessions = new Map<string, Session>();
  const sessionKey = (preview: Pick<JevCheckPreview, "model" | "fingerprint">) => `${preview.model}:${preview.fingerprint}`;
  async function prepare(subject: JevCheckSubject, fresh: boolean) {
    const evidence = await readJevCheckEvidence(subject, deps.reads, deps.redact, fresh);
    const model = deps.settings.jev().model;
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
  return {
    async preview(subject: JevCheckSubject): Promise<JevCheckPreview> {
      const { preview } = await prepare(subject, false);
      const now = clock();
      for (const [key, item] of sessions) if (item.expires <= now) sessions.delete(key);
      const key = sessionKey(preview);
      if (!sessions.has(key)) {
        if (sessions.size >= MAX_ENTRIES) {
          const oldest = sessions.keys().next().value;
          if (oldest) sessions.delete(oldest);
        }
        sessions.set(key, { expires: now + TTL_MS });
      }
      return preview;
    },
    async run(subject: JevCheckSubject, fingerprint: string): Promise<{ review: JevCheckReview; cached: boolean }> {
      const config = deps.settings.jev();
      if (!config.enabled) throw new JevError("Enable Jev decisions in Settings first.", 409, "setup");
      if (!deps.settings.jevKey()) throw new JevError("Add a Jev API key in Settings first.", 409, "setup");
      const key = sessionKey({ model: config.model, fingerprint });
      const issued = sessions.get(key);
      if (!issued || clock() >= issued.expires) throw stale();
      let result: Awaited<ReturnType<typeof prepare>>;
      try {
        result = await prepare(subject, true);
      } catch (error) {
        if (error instanceof JevError && error.status === 409) throw stale();
        throw error;
      }
      if (result.preview.fingerprint !== fingerprint || sessions.get(key) !== issued || clock() >= issued.expires) throw stale();
      if (!deps.settings.jev().enabled || !deps.settings.jevKey()) throw new JevError("Enable Jev and save a key in Settings first.", 409, "setup");
      if (issued.review) return { review: issued.review, cached: true };
      const review = await deps.check(result.request);
      issued.review = review;
      return { review, cached: false };
    },
  };
}
