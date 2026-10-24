// Where Home Assistant is and how to authenticate.
//
// Inside Home Assistant (as an app) the Supervisor injects SUPERVISOR_TOKEN and
// proxies the WebSocket API at ws://supervisor/core/websocket. For local
// development, HA_URL + HA_TOKEN (a long-lived token) point at a real instance.

export type HaTarget = { wsUrl: string; token: string; mode: "app" | "dev" };
export type HaTargetResult = { ok: true; target: HaTarget } | { ok: false; reason: string };

type Env = Record<string, string | undefined>;

export function resolveHaTarget(env: Env): HaTargetResult {
  const supervisorToken = env.SUPERVISOR_TOKEN?.trim();
  if (supervisorToken) {
    return {
      ok: true,
      target: { wsUrl: "ws://supervisor/core/websocket", token: supervisorToken, mode: "app" },
    };
  }

  const url = env.HA_URL?.trim();
  const token = env.HA_TOKEN?.trim();
  const missing = [!url && "HA_URL", !token && "HA_TOKEN"].filter(Boolean);
  if (missing.length) {
    return {
      ok: false,
      reason: `Not running inside Home Assistant, and ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set. See .env.example.`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url!);
  } catch {
    return { ok: false, reason: "HA_URL is not a valid URL. Include the scheme, e.g. http://homeassistant.local:8123." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "HA_URL must start with http:// or https://." };
  }
  const ws = parsed.protocol === "https:" ? "wss:" : "ws:";
  const base = `${ws}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`;
  return { ok: true, target: { wsUrl: `${base}/api/websocket`, token: token!, mode: "dev" } };
}

export function runMode(env: Env): "app" | "dev" {
  return env.SUPERVISOR_TOKEN ? "app" : "dev";
}

export function dataDir(env: Env): string {
  return env.TAXIS_DATA_DIR ?? (runMode(env) === "app" ? "/data" : "./data");
}

// Strip a token out of anything about to be logged or returned.
export function redact(message: string, token: string | undefined): string {
  return token ? message.split(token).join("***") : message;
}
