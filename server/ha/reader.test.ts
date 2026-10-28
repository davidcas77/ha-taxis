import { describe, expect, it, vi } from "vitest";

import { buildMockRegistry } from "../../scripts/mock-ha-core.ts";
import { readInstalled } from "../changes/recipes.ts";
import { fakeHa } from "../references/fake-ha.ts";
import { ConfigCache, HaReader, type ReaderDeps } from "./reader.ts";
import { READS } from "./registry.ts";
import type { HaConfig } from "./rest.ts";

// The caches every page shares: stored configs, the registry read, and the lock.

function clockAt(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

const quiet = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe("ConfigCache", () => {
  const config = (id: string): HaConfig => ({ id, alias: id });

  function cacheOver(ttlMs = 30_000) {
    const clock = clockAt();
    const get = vi.fn(async (_kind: string, id: string): Promise<HaConfig | null> => config(id));
    const post = vi.fn(async () => {});
    let generation = 0;
    const cache = new ConfigCache({ get } as never, clock.now, ttlMs, () => generation);
    return { cache, get, post, clock, bump: () => (generation += 1) };
  }

  it("reads each config from Home Assistant once, however many ask", async () => {
    const t = cacheOver();
    const answers = await Promise.all([t.cache.get("automation", "a", false), t.cache.get("automation", "a", false), t.cache.view().get("automation", "a")]);
    expect(answers.every((a) => a?.id === "a")).toBe(true);
    expect(t.get).toHaveBeenCalledTimes(1);
    // And again later, within the time it is kept.
    await t.cache.get("automation", "a", false);
    expect(t.get).toHaveBeenCalledTimes(1);
  });

  it("keeps kinds apart", async () => {
    const t = cacheOver();
    await t.cache.get("automation", "x", false);
    await t.cache.get("script", "x", false);
    expect(t.get).toHaveBeenCalledTimes(2);
  });

  it("reads again once the time is up", async () => {
    const t = cacheOver(30_000);
    await t.cache.get("automation", "a", false);
    t.clock.advance(30_001);
    await t.cache.get("automation", "a", false);
    expect(t.get).toHaveBeenCalledTimes(2);
  });

  it("reads again when asked for a fresh one, and keeps that one", async () => {
    const t = cacheOver();
    await t.cache.get("automation", "a", false);
    await t.cache.view(true).get("automation", "a");
    expect(t.get).toHaveBeenCalledTimes(2);
    await t.cache.get("automation", "a", false);
    expect(t.get).toHaveBeenCalledTimes(2);
  });

  it("remembers a missing config (YAML) but not a failed read", async () => {
    const t = cacheOver();
    t.get.mockResolvedValueOnce(null);
    expect(await t.cache.get("automation", "yaml", false)).toBeNull();
    expect(await t.cache.get("automation", "yaml", false)).toBeNull();
    expect(t.get).toHaveBeenCalledTimes(1);

    t.get.mockRejectedValueOnce(new Error("HA said no"));
    await expect(t.cache.get("automation", "bad", false)).rejects.toThrow("HA said no");
    expect((await t.cache.get("automation", "bad", false))?.id).toBe("bad");
    expect(t.get).toHaveBeenCalledTimes(3);
  });

  it("does not keep what Apply made out of date while it was being read", async () => {
    const t = cacheOver();
    let release!: (c: HaConfig) => void;
    t.get.mockImplementationOnce(() => new Promise<HaConfig>((resolve) => (release = resolve)));
    const slow = t.cache.get("automation", "a", false);
    t.bump(); // Apply dropped everything meanwhile
    t.cache.clear();
    release({ id: "old" });
    expect((await slow)?.id).toBe("old"); // the caller that asked still gets its answer...
    await Promise.resolve();
    expect((await t.cache.get("automation", "a", false))?.id).toBe("a"); // ...but the next one reads again
    expect(t.get).toHaveBeenCalledTimes(2);
  });

  describe("observing writes (the cache of one Apply)", () => {
    it("forgets a config as soon as it is posted, and never serves reads through it", async () => {
      const t = cacheOver(Number.POSITIVE_INFINITY);
      const rest = { request: vi.fn(), get: t.get, post: t.post };
      const watched = t.cache.observing(rest as never);

      await t.cache.get("automation", "a", false);
      await t.cache.get("automation", "a", false);
      expect(t.get).toHaveBeenCalledTimes(1);

      // A read through the observing client is Home Assistant's, not the cache's.
      await watched.get("automation", "a");
      await watched.get("automation", "a");
      expect(t.get).toHaveBeenCalledTimes(3);

      await watched.post("automation", "a", { id: "a" });
      expect(t.post).toHaveBeenCalledTimes(1);
      await t.cache.get("automation", "a", false);
      expect(t.get).toHaveBeenCalledTimes(4);
    });

    it("forgets it even when the post fails (it may have half-landed)", async () => {
      const t = cacheOver(Number.POSITIVE_INFINITY);
      t.post.mockRejectedValueOnce(new Error("refused"));
      const watched = t.cache.observing({ request: vi.fn(), get: t.get, post: t.post } as never);
      await t.cache.get("automation", "a", false);
      await expect(watched.post("automation", "a", {})).rejects.toThrow("refused");
      await t.cache.get("automation", "a", false);
      expect(t.get).toHaveBeenCalledTimes(2);
    });
  });
});

describe("HaReader", () => {
  function readerOver(fake = fakeHa(buildMockRegistry()), extra: Partial<ReaderDeps> = {}) {
    const clock = clockAt();
    const logger = quiet();
    const saved: unknown[] = [];
    const reader = new HaReader({
      ha: fake.ha,
      rest: fake.api,
      notConfigured: "not configured",
      clock: clock.now,
      logger,
      saveSnapshot: (input) => saved.push(input),
      ...extra,
    });
    const reads = (type: string) => fake.ws.filter((c) => c.type === type).length;
    return { reader, fake, clock, logger, saved, reads };
  }

  it("says why when Home Assistant is not configured", async () => {
    const reader = new HaReader({ ha: null, rest: null, notConfigured: "HA_URL is not set.", clock: Date.now, logger: quiet() });
    await expect(reader.read(false)).rejects.toThrow("HA_URL is not set.");
    await expect(reader.references({} as never, false)).rejects.toThrow("HA_URL is not set.");
    await expect(reader.buttons(false)).rejects.toThrow("HA_URL is not set.");
    await expect(reader.readParts(READS.states)).rejects.toThrow("HA_URL is not set.");
    await expect(reader.configs.get("automation", "a", false)).rejects.toThrow("HA_URL is not set.");
  });

  describe("the registry read", () => {
    it("is kept for a while, and Refresh reads again", async () => {
      const t = readerOver();
      expect((await t.reader.read(false)).cached).toBe(false);
      expect((await t.reader.read(false)).cached).toBe(true);
      expect(t.reads("get_states")).toBe(1);

      expect((await t.reader.read(true)).cached).toBe(false);
      expect(t.reads("get_states")).toBe(2);

      t.clock.advance(30_001);
      expect((await t.reader.read(false)).cached).toBe(false);
      expect(t.reads("get_states")).toBe(3);
    });

    it("shares one read between callers that ask together", async () => {
      const t = readerOver();
      const [a, b] = await Promise.all([t.reader.read(false), t.reader.read(false)]);
      expect(a.read).toBe(b.read);
      expect(t.reads("get_states")).toBe(1);
    });

    it("never reuses a read that started before a forced one", async () => {
      const t = readerOver();
      t.fake.delayMs = 5;
      const [first, forced] = await Promise.all([t.reader.read(false), t.reader.read(true)]);
      expect(forced.read).not.toBe(first.read);
      expect(t.reads("get_states")).toBe(2);
    });

    it("keeps a snapshot only when asked, and never the states", async () => {
      const t = readerOver();
      await t.reader.read(false);
      await t.reader.read(true);
      expect(t.saved).toHaveLength(0);

      await t.reader.read(true, { snapshot: true });
      expect(t.saved).toHaveLength(1);
      const raw = (t.saved[0] as { raw: Record<string, unknown> }).raw;
      expect(raw).toHaveProperty("areas");
      expect(raw).not.toHaveProperty("states");
    });

    it("does not fail a read when the snapshot can't be saved", async () => {
      const t = readerOver(undefined, {
        saveSnapshot: () => {
          throw new Error("disk full");
        },
      });
      await expect(t.reader.read(true, { snapshot: true })).resolves.toBeDefined();
      expect(t.logger.error).toHaveBeenCalledWith("Saving the snapshot failed", expect.any(Error));
    });

    it("drops the cache on invalidate, and a read already under way does not put itself back", async () => {
      const t = readerOver();
      t.fake.delayMs = 5;
      const underway = t.reader.read(false);
      t.reader.invalidate();
      await underway;
      t.fake.delayMs = 0;
      expect((await t.reader.read(false)).cached).toBe(false);
    });
  });

  describe("partial reads (what Apply uses to check its work)", () => {
    it("fetch only what is asked for and keep nothing", async () => {
      const t = readerOver();
      const states = await t.reader.readParts(READS.states);
      expect(states.states.length).toBeGreaterThan(0);
      expect(states.entities).toEqual([]);
      expect(states.areas).toEqual([]);
      expect(t.fake.ws.map((c) => c.type)).toEqual(["get_states"]);

      const registries = await t.reader.readParts(READS.registries);
      expect(registries.areas.length).toBeGreaterThan(0);
      expect(registries.states).toEqual([]);
      expect(t.reads("get_states")).toBe(1); // still only the first one
      expect(t.reads("get_config")).toBe(0);
      expect(t.reads("config_entries/get")).toBe(0);

      // Nothing was cached or saved: the next view is a real read.
      expect((await t.reader.read(false)).cached).toBe(false);
      expect(t.saved).toHaveLength(0);
    });

    it("always asks Home Assistant, even right after a full read", async () => {
      const t = readerOver();
      await t.reader.read(false);
      await t.reader.readParts(READS.states);
      expect(t.reads("get_states")).toBe(2);
    });
  });

  describe("the Apply lock", () => {
    it("lets one Apply hold it at a time", () => {
      const { reader } = readerOver();
      expect(reader.isApplying()).toBe(false);
      expect(reader.tryBeginApply()).toBe(true);
      expect(reader.isApplying()).toBe(true);
      expect(reader.tryBeginApply()).toBe(false);
      reader.endApply();
      expect(reader.isApplying()).toBe(false);
      expect(reader.tryBeginApply()).toBe(true);
    });
  });

  describe("one set of configs for every page", () => {
    const configGets = (fake: ReturnType<typeof fakeHa>) => {
      const counts = new Map<string, number>();
      for (const c of fake.rest.filter((r) => r.method === "GET" && /\/config\/automation\/config\//.test(r.path)))
        counts.set(c.path, (counts.get(c.path) ?? 0) + 1);
      return counts;
    };

    it("reads each automation once for References, Buttons and Recipes together", async () => {
      const t = readerOver();
      const { read } = await t.reader.read(false);
      await t.reader.references(read, false);
      await t.reader.buttons(false);
      await readInstalled({ ha: t.fake.ha, rest: t.reader.configs.view() }, read.raw, [], []);

      const counts = configGets(t.fake);
      expect(counts.size).toBeGreaterThan(0);
      expect([...counts.values()].every((n) => n === 1)).toBe(true);
    });

    it("reads them again after Apply invalidates, and on Refresh", async () => {
      const t = readerOver();
      const { read } = await t.reader.read(false);
      await t.reader.references(read, false);
      const once = [...configGets(t.fake).values()].reduce((a, b) => a + b, 0);

      t.reader.invalidate();
      const after = await t.reader.read(false);
      await t.reader.references(after.read, false);
      const twice = [...configGets(t.fake).values()].reduce((a, b) => a + b, 0);
      expect(twice).toBe(once * 2);

      await t.reader.references(after.read, true);
      expect([...configGets(t.fake).values()].reduce((a, b) => a + b, 0)).toBe(once * 3);
    });

    it("throws away a button read that Apply overtook", async () => {
      const t = readerOver();
      t.fake.delayMs = 3;
      const underway = t.reader.buttons(false);
      await Promise.resolve();
      t.reader.invalidate();
      await expect(underway).rejects.toThrow(/Configuration changed/);
    });
  });
});
