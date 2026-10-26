// Where Taxis may send AI requests. Pure, so the server enforces it and the
// Settings page can show the same message while the user types.
//
// Anthropic has one fixed address and never goes through here. For an
// OpenAI-compatible service the user gives a base URL (OpenAI itself, OpenRouter,
// or something on their own network such as Ollama or LM Studio). Rules:
//
//   - https:// anywhere;
//   - http:// only for this machine and private networks (the key and the
//     prompts would otherwise cross the internet unencrypted);
//   - no user:password@, no query string, no fragment;
//   - never a link-local address (169.254.x.x, fe80::), where cloud metadata
//     services live.
//
// A name can't be proven private without resolving it, so names are judged by
// their form: "localhost", a single label (a Docker or mDNS name such as
// "ollama") or a .local / .lan / .internal / .home.arpa suffix.

export type BaseUrlCheck = { ok: true; url: string } | { ok: false; error: string };

const MAX_URL = 300;

function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

function isBlocked(host: string): boolean {
  const v4 = ipv4(host);
  if (v4) return (v4[0] === 169 && v4[1] === 254) || v4.every((p) => p === 0);
  if (host.includes(":")) return /^fe[89ab]/.test(host) || host === "::";
  return host === "metadata.google.internal";
}

function isPrivate(host: string): boolean {
  const v4 = ipv4(host);
  if (v4) {
    const [a, b] = v4;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (host.includes(":")) return host === "::1" || /^f[cd]/.test(host);
  if (!host.includes(".")) return true;
  return host.endsWith(".localhost") || [".local", ".lan", ".internal", ".home.arpa"].some((s) => host.endsWith(s));
}

export function checkBaseUrl(raw: string): BaseUrlCheck {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, error: "Enter the base URL, for example https://api.openai.com/v1." };
  if (text.length > MAX_URL) return { ok: false, error: `The base URL is longer than ${MAX_URL} characters.` };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, error: "The base URL isn't a valid address. Include the scheme, for example https://api.openai.com/v1." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "The base URL must start with https:// (or http:// on your own network)." };
  if (u.username || u.password) return { ok: false, error: "Leave the user name and password out of the base URL. The key has its own field." };
  if (u.search || u.hash) return { ok: false, error: "The base URL can't have a query string or a fragment." };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, error: "The base URL has no host." };
  if (isBlocked(host)) return { ok: false, error: "That address isn't allowed: link-local addresses are where cloud metadata services live." };
  if (u.protocol === "http:" && !isPrivate(host)) {
    return { ok: false, error: "Use https:// for addresses outside your home network. http:// is only allowed for this machine and private-network addresses (for example Ollama or LM Studio)." };
  }
  return { ok: true, url: `${u.origin}${u.pathname.replace(/\/+$/, "")}` };
}
