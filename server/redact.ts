import { AI_PROVIDERS } from "../shared/ai.ts";
import { redact } from "./config.ts";
import type { settingsStore } from "./settings.ts";

// The one place text is cleaned before it leaves Taxis (an error shown in the
// browser, a message sent to an AI model, a line shown to the user). Before the
// server was split there were two near copies of this, and a third place that
// only removed the Home Assistant token.
//
// Besides the secrets we know (the Home Assistant token, every AI key, the Jev
// key), it also removes anything shaped like a key or an Authorization value,
// because an upstream error can echo a secret Taxis never saw.

const KEY_SHAPED = /\bsk-[A-Za-z0-9_*.-]{4,}/g;
const AUTHORIZATION_SHAPED = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=*-]{8,}/gi;

export function redactSecrets(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = text;
  for (const secret of secrets) out = redact(out, secret ?? undefined);
  return out.replace(KEY_SHAPED, "[redacted]").replace(AUTHORIZATION_SHAPED, "$1 [redacted]");
}

// The redactor the app uses. Keys are read each time, because a key saved in
// Settings must be covered from then on without a restart.
export function secretRedactor(haToken: string | undefined, settings: ReturnType<typeof settingsStore>): (text: string) => string {
  return (text) => redactSecrets(text, [haToken, ...AI_PROVIDERS.map((provider) => settings.aiKey(provider)), settings.jevKey()]);
}
