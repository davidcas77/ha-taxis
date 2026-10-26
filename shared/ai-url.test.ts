import { describe, expect, it } from "vitest";

import { checkBaseUrl } from "./ai-url.ts";

const ok = (raw: string) => {
  const r = checkBaseUrl(raw);
  if (!r.ok) throw new Error(r.error);
  return r.url;
};

describe("checkBaseUrl", () => {
  it("accepts https anywhere and trims the trailing slash", () => {
    expect(ok("https://api.openai.com/v1")).toBe("https://api.openai.com/v1");
    expect(ok("  https://openrouter.ai/api/v1/  ")).toBe("https://openrouter.ai/api/v1");
    expect(ok("https://llm.example.org:8443/v1///")).toBe("https://llm.example.org:8443/v1");
  });

  it("accepts http for this machine and private networks", () => {
    for (const u of [
      "http://localhost:11434/v1",
      "http://127.0.0.1:1234/v1",
      "http://[::1]:1234/v1",
      "http://10.0.0.5:11434/v1",
      "http://172.16.0.9/v1",
      "http://172.31.255.1/v1",
      "http://192.168.1.20:11434/v1",
      "http://100.64.1.2:11434/v1",
      "http://ollama:11434/v1",
      "http://gpu-box.local:11434/v1",
      "http://box.lan/v1",
      "http://[fd12:3456::1]:1234/v1",
    ]) {
      expect(checkBaseUrl(u), u).toMatchObject({ ok: true });
    }
  });

  it("refuses http for anything outside the home network", () => {
    for (const u of ["http://api.openai.com/v1", "http://8.8.8.8/v1", "http://172.32.0.1/v1", "http://192.169.0.1/v1", "http://example.com/v1", "http://[2001:db8::1]/v1"]) {
      expect(checkBaseUrl(u), u).toMatchObject({ ok: false, error: expect.stringContaining("https://") });
    }
  });

  it("never allows link-local addresses, where metadata services live", () => {
    for (const u of ["http://169.254.169.254/latest", "https://169.254.169.254/v1", "http://[fe80::1]/v1", "https://0.0.0.0/v1", "https://metadata.google.internal/v1"]) {
      expect(checkBaseUrl(u), u).toMatchObject({ ok: false });
    }
  });

  it("refuses credentials, queries and fragments in the address", () => {
    expect(checkBaseUrl("https://user:pw@api.openai.com/v1")).toMatchObject({ ok: false });
    expect(checkBaseUrl("https://user@api.openai.com/v1")).toMatchObject({ ok: false });
    expect(checkBaseUrl("https://api.openai.com/v1?key=abc")).toMatchObject({ ok: false });
    expect(checkBaseUrl("https://api.openai.com/v1#x")).toMatchObject({ ok: false });
  });

  it("refuses other schemes, empty and unreadable input", () => {
    for (const u of ["", "   ", "api.openai.com/v1", "ftp://host/v1", "file:///etc/passwd", "javascript:alert(1)", `https://${"a".repeat(300)}.com`]) {
      expect(checkBaseUrl(u), u).toMatchObject({ ok: false });
    }
    expect(checkBaseUrl(undefined as never)).toMatchObject({ ok: false });
  });
});
