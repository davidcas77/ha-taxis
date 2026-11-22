import type { JevCheckAutoResponse, JevCheckSubject } from "../../shared/jev-checks.ts";
import type { JevSettingsResponse } from "../../shared/jev.ts";
import { api } from "./api.ts";

export type JevCheckUpdate =
  | { kind: "checking" }
  | { kind: "setup"; noKey: boolean }
  | { kind: "error"; message: string }
  | { kind: "result"; result: Extract<JevCheckAutoResponse, { ok: true }> };

type Listener = (update: JevCheckUpdate) => void;
type Job = { key: string; subject: JevCheckSubject; listeners: Set<Listener>; latest?: JevCheckUpdate };

export function createJevCheckQueue(readSettings: () => Promise<JevSettingsResponse>, check: (subject: JevCheckSubject) => Promise<JevCheckAutoResponse>) {
  const pending = new Map<string, Job>();
  let active: Job | null = null;
  let draining = false;
  let settingsVersion = 0;

  const publish = (job: Job, update: JevCheckUpdate) => {
    job.latest = update;
    for (const listener of job.listeners) listener(update);
  };

  const drain = async () => {
    let settings: { version: number; value: JevSettingsResponse } | null = null;
    while (pending.size > 0) {
      const job = pending.values().next().value!;
      pending.delete(job.key);
      active = job;
      try {
        while (job.listeners.size > 0 && settings?.version !== settingsVersion) {
          const version: number = settingsVersion;
          settings = { version, value: await readSettings() };
        }
        if (job.listeners.size === 0 || settings === null) continue;
        const saved = settings.value;
        if (!saved.ok) publish(job, { kind: "error", message: saved.error });
        else if (!saved.jev.enabled || !saved.jev.keySet) publish(job, { kind: "setup", noKey: !saved.jev.keySet });
        else {
          publish(job, { kind: "checking" });
          const result = await check(job.subject);
          if (result.ok) publish(job, { kind: "result", result });
          else {
            if (result.code === "setup" || result.code === "stale") settings = null;
            publish(job, { kind: "error", message: result.error });
          }
        }
      } catch {
        publish(job, { kind: "error", message: "Couldn’t complete the Jev check." });
      } finally {
        active = null;
      }
    }
    draining = false;
  };

  return {
    watch(key: string, subject: JevCheckSubject, listener: Listener): () => void {
      const job = (active?.key === key ? active : pending.get(key)) ?? { key, subject, listeners: new Set<Listener>() };
      if (job !== active) pending.set(key, job);
      job.listeners.add(listener);
      if (job.latest) listener(job.latest);
      if (!draining) {
        draining = true;
        // A view can unmount before we read settings, including during React's development remount.
        queueMicrotask(() => void drain());
      }
      return () => {
        job.listeners.delete(listener);
        if (job !== active && job.listeners.size === 0 && pending.get(key) === job) pending.delete(key);
      };
    },
    settingsChanged() {
      settingsVersion += 1;
    },
  };
}

export const jevCheckQueue = createJevCheckQueue(api.jev, api.jevCheckAuto);
