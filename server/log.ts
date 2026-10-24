import { redact } from "./config.ts";

// One line per event, to stdout/stderr, which Home Assistant shows on the app's
// Log tab. Every message passes through redact() so the token can never be
// written, whatever an error message happens to contain.

let secret: string | undefined;

export function setLogSecret(token: string | undefined): void {
  secret = token;
}

function line(level: string, message: string): string {
  return `${new Date().toISOString()} ${level} ${redact(message, secret)}`;
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
