import { describe, expect, it } from "vitest";

import { buildMockRegistry } from "../../scripts/mock-ha-core.ts";
import { fakeHa } from "../references/fake-ha.ts";
import { HaRest, assertRestRequest } from "./rest.ts";

describe("REST allowlist", () => {
  it("allows GET and POST of an automation, script or scene config, and nothing else", () => {
    for (const kind of ["automation", "script", "scene"]) {
      for (const method of ["GET", "POST"]) expect(() => assertRestRequest(method, `/config/${kind}/config/abc_1-2`)).not.toThrow();
    }
    expect(() => assertRestRequest("GET", "/config/automation/config/1700000000001")).not.toThrow();
  });

  it("refuses DELETE and every other method", async () => {
    const t = fakeHa();
    for (const method of ["DELETE", "PUT", "PATCH", "HEAD", "get"]) {
      await expect(t.api.request(method, "/config/automation/config/1700000000001")).rejects.toThrow(/Refusing to send/);
    }
    expect(t.rest).toEqual([]);
    expect(Object.keys(t.home.automations)).toContain("1700000000001");
  });

  it("refuses any other path: states, services, other config types, odd ids", async () => {
    const t = fakeHa();
    const paths = [
      "/states",
      "/states/light.living_spots",
      "/services/light/turn_on",
      "/config",
      "/config/core/check_config",
      "/config/group/config/abc",
      "/config/automation/config",
      "/config/automation/config/",
      "/config/automation/config/a/b",
      "/config/automation/config/../script/config/x",
      "/config/automation/config/a?x=1",
      "/config/automation/config/a b",
      "/config/automation/config/%2e%2e",
      `/config/automation/config/${"a".repeat(256)}`,
      "/api/config/automation/config/abc",
      "config/automation/config/abc",
    ];
    for (const path of paths) await expect(t.api.request("GET", path)).rejects.toThrow(/Refusing to send/);
    await expect(t.api.request("POST", "/services/light/turn_on", {})).rejects.toThrow(/Refusing to send/);
    expect(t.rest).toEqual([]);
    // 255 characters is the longest id.
    expect(() => assertRestRequest("GET", `/config/automation/config/${"a".repeat(255)}`)).not.toThrow();
  });

  it("gives get() and post() no way to name another kind or id", async () => {
    const t = fakeHa();
    await expect(t.api.get("group" as never, "x")).rejects.toThrow(/Refusing to send/);
    await expect(t.api.get("automation", "../x")).rejects.toThrow(/Refusing to send/);
    await expect(t.api.post("script", "a/b", {})).rejects.toThrow(/Refusing to send/);
    expect(t.rest).toEqual([]);
  });
});

describe("HaRest", () => {
  it("reads a config, with the bearer token and no body", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const home = buildMockRegistry();
    const t = fakeHa(home);
    const api = new HaRest("http://supervisor/core/api/", "tok", (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return t.fetchImpl(url.replace("http://supervisor/core", "http://ha.test"), init);
    }) as typeof fetch);
    const config = await api.get("script", "movie_time");
    expect(config).toEqual(home.scripts.movie_time);
    expect(seen[0].url).toBe("http://supervisor/core/api/config/script/config/movie_time");
    expect(seen[0].init?.method).toBe("GET");
    expect((seen[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(seen[0].init?.body).toBeUndefined();
  });

  it("answers null for a 404: it exists but is YAML", async () => {
    const t = fakeHa();
    expect(await t.api.get("automation", "hall_night")).toBeNull();
    expect(await t.api.get("automation", "no_such_automation")).toBeNull();
  });

  it("replaces a config with POST", async () => {
    const t = fakeHa();
    await t.api.post("scene", "1700000000100", { id: "1700000000100", name: "Evening", entities: {} });
    expect(t.home.scenes["1700000000100"]).toEqual({ id: "1700000000100", name: "Evening", entities: {} });
    expect(t.rest.at(-1)).toMatchObject({ method: "POST", status: 200 });
    await expect(t.api.post("automation", "hall_night", { alias: "x" })).rejects.toThrow(/isn't editable in the UI/);
  });

  it("reports other statuses with Home Assistant's message", async () => {
    const t = fakeHa();
    t.restStatus = () => 500;
    await expect(t.api.get("script", "movie_time")).rejects.toThrow("Home Assistant refused to read the script (HTTP 500: forced 500).");
  });

  it("never lets the token through in an error", async () => {
    const leaky = new HaRest("http://x/api", "s3cret-token", (async () => {
      throw new Error("connect failed for Bearer s3cret-token at http://x");
    }) as typeof fetch);
    const error = await leaky.get("script", "a").catch((e: Error) => e);
    expect((error as Error).message).toMatch(/Couldn't reach/);
    expect((error as Error).message).not.toContain("s3cret-token");
    expect((error as Error).message).toContain("***");

    const echo = new HaRest("http://x/api", "s3cret-token", (async () => new Response(JSON.stringify({ message: "bad token s3cret-token" }), { status: 401 })) as typeof fetch);
    const refused = await echo.get("script", "a").catch((e: Error) => e);
    expect((refused as Error).message).toContain("HTTP 401");
    expect((refused as Error).message).not.toContain("s3cret-token");
  });

  it("gives up after the timeout", async () => {
    const hang = new HaRest(
      "http://x/api",
      "tok",
      ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        })) as typeof fetch,
      30,
    );
    await expect(hang.get("script", "a")).rejects.toThrow(/no answer within 0\.03s/);
  });
});
