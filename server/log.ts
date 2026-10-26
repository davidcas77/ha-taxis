import { redact } from "./config.ts";

// One line per event, to stdout/stderr, which Home Assistant shows on the app's
// Log tab. Every message passes through redact() so a secret can never be
// written, whatever an error message happens to contain: the Home Assistant
// token, and any AI API key.

let secret: string | undefined;
const extra = new Set<string>();

export function setLogSecret(token: string | undefined): void {
  secret = token;
}

// More secrets to keep out of the log (the AI keys). Keys that were replaced stay
// registered until the app restarts, which is harmless.
export function addLogSecret(value: string | null | undefined): void {
  if (value) extra.add(value);
}

export function clearLogSecrets(): void {
  extra.clear();
}

function line(level: string, message: string): string {
  let text = redact(message, secret);
  for (const s of extra) text = redact(text, s);
  return `${new Date().toISOString()} ${level} ${text}`;
}

export const log = {
  info(message: string): void {
    console.log(line("INFO", message));
  },
  warn(message: string): void {
    console.warn(line("WARN", message));
  },
  error(message: string, error?: unknown): void {
    const detail = error === undefined ? "" : `: ${error instanceof Error ? error.message : String(error)}`;
    console.error(line("ERROR", `${message}${detail}`));
  },
};
