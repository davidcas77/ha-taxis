import { describe, expect, it, vi } from "vitest";
import type { JevCheckAutoResponse, JevCheckSubject } from "../../shared/jev-checks.ts";
import type { JevSettingsResponse } from "../../shared/jev.ts";
import { createJevCheckQueue, type JevCheckUpdate } from "./jev-check-queue.ts";

const subject = (controlId: string): JevCheckSubject => ({ kind: "buttons", controlId });
const unavailable: JevCheckAutoResponse = { ok: false, error: "The detail is unavailable." };
const configured: JevSettingsResponse = {
  ok: true,
  revision: "configured",
  jev: { enabled: true, keySet: true, model: "jev-1.14.0", monthlyRequestLimit: 100 },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("view-driven Jev checks", () => {
  it("shares duplicate work, runs serially and drops queued subjects that are no longer open", async () => {
    const read = vi.fn(async () => configured);
    const first = deferred<JevCheckAutoResponse>();
    const check = vi.fn((target: JevCheckSubject) =>
      target.kind === "buttons" && target.controlId === "device:first" ? first.promise : Promise.resolve(unavailable),
    );
    const queue = createJevCheckQueue(read, check);
    const left = vi.fn();
    const right = vi.fn();
    const abandoned = vi.fn();
    const last = vi.fn();
    queue.watch("first-view", subject("device:first"), left);
    queue.watch("first-view", subject("device:first"), right);
    const leave = queue.watch("abandoned-view", subject("device:abandoned"), abandoned);
    queue.watch("last-view", subject("device:last"), last);
    await vi.waitFor(() => expect(left).toHaveBeenCalledWith({ kind: "checking" }));
    expect(right).toHaveBeenCalledWith({ kind: "checking" });
    expect(check.mock.calls).toEqual([[subject("device:first")]]);
    leave();
    first.resolve(unavailable);
    await vi.waitFor(() => expect(last).toHaveBeenCalledWith({ kind: "error", message: unavailable.error }));
    expect(abandoned).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    expect(check.mock.calls).toEqual([[subject("device:first")], [subject("device:last")]]);
  });

  it.each([false, true])("never runs with Jev off or a missing key (enabled: %s)", async (enabled) => {
    const check = vi.fn(async () => unavailable);
    const read = vi.fn(async () => ({ ...configured, jev: { ...configured.jev, enabled, keySet: false } }));
    const queue = createJevCheckQueue(read, check);
    const seen: JevCheckUpdate[] = [];
    queue.watch("view", subject("device:first"), (update) => seen.push(update));
    await vi.waitFor(() => expect(seen).toEqual([{ kind: "setup", noKey: true }]));
    expect(check).not.toHaveBeenCalled();
  });

  it("drops abandoned viewers while waiting for the local settings read", async () => {
    const settings = deferred<JevSettingsResponse>();
    const read = vi.fn(() => settings.promise);
    const check = vi.fn(async () => unavailable);
    const queue = createJevCheckQueue(read, check);
    const abandoned = vi.fn();
    const leave = queue.watch("first", subject("device:first"), abandoned);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    leave();
    const current = vi.fn();
    queue.watch("second", subject("device:second"), current);
    settings.resolve(configured);
    await vi.waitFor(() => expect(current).toHaveBeenCalledWith({ kind: "error", message: unavailable.error }));
    expect(abandoned).not.toHaveBeenCalled();
    expect(check.mock.calls).toEqual([[subject("device:second")]]);
  });
});
