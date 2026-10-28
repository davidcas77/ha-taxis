import { afterEach, describe, expect, it, vi } from "vitest";

import { TEST_KEY, fakeFetch } from "./fake-fetch.ts";
import { failure, httpJson, scrub } from "./http.ts";
import { AiError } from "./types.ts";

const opts = { label: "example.test", secrets: [TEST_KEY] };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

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
    const e = await httpJson(t.fetch, "https://example.test/v1/models", { method: "GET", headers: { authorization: `Bearer ${TEST_KEY}` } }, { ...opts, retryTransient: true }).catch((x: Error) => x);
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
    expect(failure(bad, opts).message).toBe("example.test answered 502. The service returned a bad gateway response. Try again shortly.");
  });

  it("keeps an HTML gateway page out of errors and preserves useful JSON or plain-text details", async () => {
    const gateway = await httpJson(fakeFetch({ status: 504, text: `<!DOCTYPE html><!-- gateway --><html><script>${TEST_KEY}</script><title>Gateway time-out</title></html>` }).fetch, "https://example.test/", { method: "GET", headers: {} }, opts);
    expect(failure(gateway, opts).message).toBe("example.test answered 504. The service timed out. Try again shortly.");
    expect(failure({ ...gateway, body: { error: { message: "<html>gateway details</html>" } } }, opts).message).toBe(failure(gateway, opts).message);
    for (const result of [
      { ok: false, status: 401, body: { error: { message: `invalid key ${TEST_KEY}` } }, text: "" },
      { ok: false, status: 401, body: undefined, text: `invalid key ${TEST_KEY}` },
    ]) {
      expect(failure(result, opts).message).toContain("invalid key ***");
      expect(failure(result, opts).message).not.toContain(TEST_KEY);
      expect(failure(result, opts).message).toContain("Check the API key");
    }
  });

  it.each([500, 502, 503, 504])("retries one opted-in model GET after HTTP %i within the original deadline", async status => {
    vi.useFakeTimers();
    const timeouts = vi.spyOn(AbortSignal, "timeout");
    const t = fakeFetch((_call, index) => index === 0 ? { status, text: "<html>temporary</html>" } : { body: { data: [{ id: "example-model" }] } });
    const pending = httpJson(t.fetch, "https://example.test/models", { method: "GET", headers: { authorization: TEST_KEY } }, { ...opts, retryTransient: true, timeoutMs: 30_000 });
    await vi.advanceTimersByTimeAsync(999);
    expect(t.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(251);
    expect(await pending).toMatchObject({ ok: true, body: { data: [{ id: "example-model" }] } });
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]).toEqual(t.calls[0]);
    expect(timeouts.mock.calls[0][0]).toBe(30_000);
    expect(timeouts.mock.calls[1][0]).toBeGreaterThanOrEqual(28_750);
    expect(timeouts.mock.calls[1][0]).toBeLessThanOrEqual(29_000);
  });

  it("honors Retry-After seconds and HTTP dates, but doesn't exceed the request budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    for (const header of ["3", "Tue, 27 Oct 2026 12:00:06 GMT"]) {
      const t = fakeFetch((_call, index) => index ? { body: {} } : { status: 503, headers: { "retry-after": header } });
      const pending = httpJson(t.fetch, "https://example.test/models", { method: "GET", headers: {} }, { ...opts, retryTransient: true, timeoutMs: 30_000 });
      await vi.advanceTimersByTimeAsync(2999);
      expect(t.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect((await pending).ok).toBe(true);
      expect(t.calls).toHaveLength(2);
    }
    const limited = fakeFetch({ status: 503, headers: { "retry-after": "30" } });
    expect((await httpJson(limited.fetch, "https://example.test/models", { method: "GET", headers: {} }, { ...opts, retryTransient: true, timeoutMs: 30_000 })).status).toBe(503);
    expect(limited.calls).toHaveLength(1);
  });

  it("stops after the second transient failure and never retries a completion POST", async () => {
    vi.useFakeTimers();
    const get = fakeFetch({ status: 504 });
    const pending = httpJson(get.fetch, "https://example.test/models", { method: "GET", headers: {} }, { ...opts, retryTransient: true });
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(504);
    expect(get.calls).toHaveLength(2);
    const post = fakeFetch({ status: 504 });
    expect((await httpJson(post.fetch, "https://example.test/completions", { method: "POST", headers: {} }, { ...opts, retryTransient: true })).status).toBe(504);
    expect(post.calls).toHaveLength(1);
  });

  it.each([400, 401, 403, 404, 429])("doesn't retry configuration, credential or quota failure %i", async status => {
    const t = fakeFetch({ status });
    expect((await httpJson(t.fetch, "https://example.test/models", { method: "GET", headers: {} }, { ...opts, retryTransient: true })).status).toBe(status);
    expect(t.calls).toHaveLength(1);
  });
});
