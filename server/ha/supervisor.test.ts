import { describe, expect, it } from "vitest";

import { backupHomeAssistant } from "./supervisor.ts";

const TOKEN = "supervisor-secret-token-123";

type Call = { url: string; init: RequestInit };

// A fetch that answers once with `respond`, and records what it was asked.
function fetchReturning(respond: () => Promise<Response> | Response) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("backupHomeAssistant", () => {
  it("asks the Supervisor for a partial backup, with the token, and returns the slug", async () => {
    const { impl, calls } = fetchReturning(() => json({ result: "ok", data: { slug: "abc123" } }));
    const made = await backupHomeAssistant(TOKEN, "Taxis before applying 2 changes", impl);
    expect(made).toEqual({ ok: true, name: "Taxis before applying 2 changes", slug: "abc123" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://supervisor/backups/new/partial");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    const sent = JSON.parse(String(calls[0].init.body));
    // Configuration only: no add-ons, folders or history database.
    expect(sent).toMatchObject({ name: "Taxis before applying 2 changes", homeassistant: true, homeassistant_exclude_database: true, addons: [], folders: [] });
  });

  it("succeeds without a slug when the Supervisor does not give one", async () => {
    const { impl } = fetchReturning(() => json({ result: "ok" }));
    expect(await backupHomeAssistant(TOKEN, "x", impl)).toEqual({ ok: true, name: "x", slug: null });
  });

  it("fails on a non-2xx answer and says why", async () => {
    const { impl } = fetchReturning(() => json({ result: "error", message: "Backup already running" }, 400));
    const made = await backupHomeAssistant(TOKEN, "x", impl);
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.reason).toContain("HTTP 400: Backup already running");
  });

  it("fails on a 200 that is not result ok", async () => {
    const { impl } = fetchReturning(() => json({ result: "error", message: "nope" }));
    const made = await backupHomeAssistant(TOKEN, "x", impl);
    expect(made.ok).toBe(false);
  });

  it("fails when the answer is not JSON", async () => {
    const { impl } = fetchReturning(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const made = await backupHomeAssistant(TOKEN, "x", impl);
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.reason).toContain("HTTP 502");
  });

  it("fails when the Supervisor can't be reached", async () => {
    const { impl } = fetchReturning(() => Promise.reject(new Error("connect ECONNREFUSED 172.30.32.1:80")));
    const made = await backupHomeAssistant(TOKEN, "x", impl);
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.reason).toContain("Couldn't reach the Supervisor: connect ECONNREFUSED");
  });

  it("gives up when the backup takes too long", async () => {
    // Never answers by itself; only the abort ends it, as a real fetch would.
    const hang = (async (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })));
      })) as typeof fetch;
    const made = await backupHomeAssistant(TOKEN, "x", hang, 20);
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.reason).toMatch(/took longer/);
  });

  describe("never puts the token in the error text", () => {
    it("when the network error repeats it", async () => {
      const { impl } = fetchReturning(() => Promise.reject(new Error(`request failed (Authorization: Bearer ${TOKEN})`)));
      const made = await backupHomeAssistant(TOKEN, "x", impl);
      expect(made.ok).toBe(false);
      if (!made.ok) expect(made.reason).not.toContain(TOKEN);
    });

    it("when the Supervisor's message repeats it", async () => {
      const { impl } = fetchReturning(() => json({ result: "error", message: `Invalid token ${TOKEN}` }, 401));
      const made = await backupHomeAssistant(TOKEN, "x", impl);
      expect(made.ok).toBe(false);
      if (!made.ok) {
        expect(made.reason).not.toContain(TOKEN);
        expect(made.reason).toContain("HTTP 401");
      }
    });
  });
});
