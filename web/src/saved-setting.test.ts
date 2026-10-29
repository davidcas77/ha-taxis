import { describe, expect, it } from "vitest";

import { runSave, SAVING_BUSY, type Saved, type SettingCell } from "./saved-setting.ts";

type S = { n: number };

function setup(persist: (v: S) => Promise<Saved<S>>, cell: Partial<SettingCell<S>> = {}) {
  const c: SettingCell<S> = { value: { n: 1 }, loaded: true, busy: false, ...cell };
  const shown: S[] = [];
  const saving: boolean[] = [];
  const hooks = { publish: (v: S) => shown.push(v), setSaving: (b: boolean) => saving.push(b), persist, notLoaded: "Not loaded yet." };
  return { c, shown, saving, save: (edit: (v: S) => S) => runSave(c, hooks, edit) };
}

describe("runSave", () => {
  it("refuses before the real value has arrived, and writes nothing", async () => {
    let called = 0;
    const t = setup(async (v) => (called++, { ok: true, value: v }), { loaded: false });
    expect(await t.save((v) => ({ n: v.n + 1 }))).toBe("Not loaded yet.");
    expect(called).toBe(0);
    expect(t.shown).toEqual([]);
  });

  it("does nothing, and saves nothing, when the edit changes nothing", async () => {
    let called = 0;
    const t = setup(async (v) => (called++, { ok: true, value: v }));
    expect(await t.save((v) => v)).toBeNull();
    expect(called).toBe(0);
    expect(t.saving).toEqual([]);
  });

  it("shows the edit at once, then adopts the server's copy", async () => {
    const t = setup(async (v) => ({ ok: true, value: { n: v.n * 10 } }));
    expect(await t.save((v) => ({ n: v.n + 1 }))).toBeNull();
    expect(t.shown).toEqual([{ n: 2 }, { n: 20 }]);
    expect(t.saving).toEqual([true, false]);
    expect(t.c).toEqual({ value: { n: 20 }, loaded: true, busy: false });
  });

  it("rolls the edit back when the save fails, and returns the reason", async () => {
    const original = { n: 1 };
    const t = setup(async () => ({ ok: false, error: "Disk full." }), { value: original });
    expect(await t.save((v) => ({ n: v.n + 1 }))).toBe("Disk full.");
    expect(t.shown).toEqual([{ n: 2 }, original]);
    expect(t.c.value).toBe(original);
    expect(t.c.busy).toBe(false);
  });

  it("refuses a second edit while one is being saved, then accepts again", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const t = setup(async (v) => {
      await gate;
      return { ok: true, value: v };
    });
    const first = t.save((v) => ({ n: v.n + 1 }));
    expect(await t.save((v) => ({ n: v.n + 5 }))).toBe(SAVING_BUSY);
    release();
    expect(await first).toBeNull();
    expect(t.c.value).toEqual({ n: 2 });
    expect(await t.save((v) => ({ n: v.n + 1 }))).toBeNull();
    expect(t.c.value).toEqual({ n: 3 });
  });
});
