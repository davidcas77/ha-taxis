import { describe, expect, it } from "vitest";

import { TEST_KEY, fakeFetch } from "./fake-fetch.ts";
import { failure, httpJson, scrub } from "./http.ts";
import { AiError } from "./types.ts";

const opts = { label: "example.test", secrets: [TEST_KEY] };

describe("scrub", () => {
  it("removes each secret and key-shaped strings", () => {
    expect(scrub(`bad key ${TEST_KEY}!`, [TEST_KEY])).toBe("bad key ***!");
    const echoed = scrub("Incorrect API key provided: sk-proj-abcd****wxyz.", []);
    expect(echoed).toContain("sk-***");
    expect(echoed).not.toMatch(/abcd|wxyz/);
    expect(scrub("sent Authorization: Bearer abcdef0123456789", [])).toContain("Bearer ***");
    expect(scrub("no secrets here", [null, undefined, ""])).toBe("no secrets here");
  });

  it("cuts long messages", () => {
    expect(scrub("x".repeat(1000)).length).toBeLessThan(450);
  });
});

describe("httpJson", () => {
  it("never follows a redirect: the key would go to another host", async () => {
    const t = fakeFetch({ status: 302, headers: { location: "https://evil.example/steal" } });
    const e = await httpJson(t.fetch, "https://example.test/v1/models", { method: "GET", headers: { authorization: `Bearer ${TEST_KEY}` } }, opts).catch((x: Error) => x);
    expect(e).toBeInstanceOf(AiError);
    expect((e as Error).message).toMatch(/redirected/);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].url).toBe("https://example.test/v1/models");
  });

  it("explains a network failure without the key", async () => {
    const cause = Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
    const t = fakeFetch(Object.assign(new TypeError("fetch failed"), { cause }));
    await expect(httpJson(t.fetch, "http://localhost:1/v1/models", { method: "GET", headers: {} }, opts)).rejects.toThrow("Couldn't reach example.test: ECONNREFUSED.");
  });

  it("gives up on an answer that is too large", async () => {
    const t = fakeFetch({ text: "x".repeat(9 * 1024 * 1024) });
    await expect(httpJson(t.fetch, "https://example.test/v1/models", { method: "GET", headers: {} }, opts)).rejects.toThrow(/too large/);
  });

  it("parses JSON, and keeps text when it isn't JSON", async () => {
    const ok = await httpJson(fakeFetch({ body: { a: 1 } }).fetch, "https://example.test/", { method: "GET", headers: {} }, opts);
    expect(ok).toMatchObject({ ok: true, status: 200, body: { a: 1 } });
    const bad = await httpJson(fakeFetch({ status: 502, text: "<html>Bad gateway</html>" }).fetch, "https://example.test/", { method: "GET", headers: {} }, opts);
    expect(bad.body).toBeUndefined();
    expect(failure(bad, opts).message).toBe("example.test answered 502: <html>Bad gateway</html>.");
  });
});
