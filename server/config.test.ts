import { describe, expect, it } from "vitest";

import { dataDir, redact, resolveHaTarget } from "./config.ts";
import { isAllowedPeer, normalizePeer } from "./ingress.ts";

describe("resolveHaTarget", () => {
  it("uses the Supervisor inside Home Assistant", () => {
    expect(resolveHaTarget({ SUPERVISOR_TOKEN: "sup", HA_URL: "http://x", HA_TOKEN: "t" })).toEqual({
      ok: true,
      target: { wsUrl: "ws://supervisor/core/websocket", restUrl: "http://supervisor/core/api", token: "sup", mode: "app" },
    });
  });

  it("builds the WebSocket URL from HA_URL in development", () => {
    const http = resolveHaTarget({ HA_URL: "http://homeassistant.local:8123/", HA_TOKEN: "t" });
    expect(http.ok && http.target.wsUrl).toBe("ws://homeassistant.local:8123/api/websocket");
    const https = resolveHaTarget({ HA_URL: "https://abc.ui.nabu.casa", HA_TOKEN: "t" });
    expect(https.ok && https.target.wsUrl).toBe("wss://abc.ui.nabu.casa/api/websocket");
  });

  it("builds the REST base URL the same way: the Supervisor proxy in the app, HA_URL + /api in development", () => {
    const http = resolveHaTarget({ HA_URL: "http://homeassistant.local:8123/", HA_TOKEN: "t" });
    expect(http.ok && http.target.restUrl).toBe("http://homeassistant.local:8123/api");
    const https = resolveHaTarget({ HA_URL: "https://abc.ui.nabu.casa", HA_TOKEN: "t" });
    expect(https.ok && https.target.restUrl).toBe("https://abc.ui.nabu.casa/api");
    const prefixed = resolveHaTarget({ HA_URL: "http://proxy.lan/ha/", HA_TOKEN: "t" });
    expect(prefixed.ok && prefixed.target).toMatchObject({ restUrl: "http://proxy.lan/ha/api", wsUrl: "ws://proxy.lan/ha/api/websocket" });
    const app = resolveHaTarget({ SUPERVISOR_TOKEN: "sup", HA_URL: "http://x", HA_TOKEN: "t" });
    expect(app.ok && app.target.restUrl).toBe("http://supervisor/core/api");
  });

  it("says exactly what is missing or wrong", () => {
    const none = resolveHaTarget({});
    expect(!none.ok && none.reason).toMatch(/HA_URL and HA_TOKEN are not set/);
    const noToken = resolveHaTarget({ HA_URL: "http://x" });
    expect(!noToken.ok && noToken.reason).toMatch(/HA_TOKEN is not set/);
    const bad = resolveHaTarget({ HA_URL: "homeassistant.local", HA_TOKEN: "t" });
    expect(bad.ok).toBe(false);
    const ftp = resolveHaTarget({ HA_URL: "ftp://x", HA_TOKEN: "t" });
    expect(!ftp.ok && ftp.reason).toMatch(/http/);
  });
});

describe("dataDir and redact", () => {
  it("stores data in /data inside Home Assistant", () => {
    expect(dataDir({ SUPERVISOR_TOKEN: "x" })).toBe("/data");
    expect(dataDir({})).toBe("./data");
    expect(dataDir({ TAXIS_DATA_DIR: "/tmp/t" })).toBe("/tmp/t");
  });

  it("never lets the token through", () => {
    expect(redact("failed with secret123 in it secret123", "secret123")).toBe("failed with *** in it ***");
    expect(redact("nothing", undefined)).toBe("nothing");
  });
});

describe("ingress guard", () => {
  it("accepts only the Ingress proxy inside Home Assistant", () => {
    expect(isAllowedPeer("172.30.32.2", "app")).toBe(true);
    expect(isAllowedPeer("::ffff:172.30.32.2", "app")).toBe(true);
    expect(isAllowedPeer("172.30.32.1", "app")).toBe(false);
    expect(isAllowedPeer("192.0.2.50", "app")).toBe(false);
    expect(isAllowedPeer(undefined, "app")).toBe(false);
  });

  it("refuses loopback inside Home Assistant", () => {
    expect(isAllowedPeer("127.0.0.1", "app")).toBe(false);
    expect(isAllowedPeer("::1", "app")).toBe(false);
    expect(isAllowedPeer("::ffff:127.0.0.1", "app")).toBe(false);
  });

  it("accepts anything in development", () => {
    expect(isAllowedPeer("192.0.2.50", "dev")).toBe(true);
  });

  it("accepts loopback in development", () => {
    expect(isAllowedPeer("127.0.0.1", "dev")).toBe(true);
    expect(isAllowedPeer("::1", "dev")).toBe(true);
  });

  it("normalizes IPv4-mapped addresses", () => {
    expect(normalizePeer("::ffff:10.1.2.3")).toBe("10.1.2.3");
  });
});
