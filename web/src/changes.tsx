import { CheckCircle2, CircleAlert, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";

import type { ApplyResult, Change, Hierarchy } from "../../shared/types.ts";
import { api } from "./api.ts";
import { SCOPE_NAMES } from "./editors.tsx";
import { useTaxis } from "./state.tsx";
import { Button } from "./ui.tsx";

// The list of changes, in words, and Apply.

const KIND_NAMES: Record<Change["kind"], string> = { entity: "entity", device: "device", area: "area", floor: "floor", label: "label", category: "category" };

function nameOf(h: Hierarchy, c: Change): string {
  if (c.op === "create") return String(c.after.name ?? "new");
  const fromBefore = c.before.name ?? c.before.name_by_user;
  switch (c.kind) {
    case "entity":
      return h.entities[c.targetId]?.name ?? c.targetId;
    case "device":
      return h.devices[c.targetId]?.name ?? String(fromBefore ?? c.targetId);
    case "area":
      return String(c.before.name ?? h.areas[c.targetId]?.name ?? c.targetId);
    case "floor":
      return String(c.before.name ?? h.floors.find((f) => f.id === c.targetId)?.name ?? c.targetId);
    case "label":
      return String(c.before.name ?? h.labels[c.targetId]?.name ?? c.targetId);
    case "category":
      return String(c.before.name ?? c.targetId);
  }
}

function title(h: Hierarchy, c: Change): string {
  const what = c.kind === "category" && c.scope ? `${SCOPE_NAMES[c.scope].toLowerCase().replace(/s$/, "")} category` : KIND_NAMES[c.kind];
  const verb = c.op === "create" ? "New" : c.op === "delete" ? "Delete" : "Change";
  return `${verb} ${what} “${nameOf(h, c)}”`;
}

// One field, in words: "Area: Kitchen → Attic".
function describe(h: Hierarchy, c: Change, key: string): { label: string; from: string; to: string } {
  const areaName = (v: unknown) => (v ? h.areas[String(v)]?.name ?? String(v) : c.kind === "entity" ? "same as its device" : "no area");
  const floorName = (v: unknown) => (v ? h.floors.find((f) => f.id === v)?.name ?? String(v) : "no floor");
  const labelNames = (v: unknown) => ((v as string[] | undefined) ?? []).map((id) => h.labels[id]?.name ?? id);
  const plain = (v: unknown, empty = "default") => (v === null || v === undefined || v === "" ? empty : String(v));
  const b = c.before[key];
  const a = c.after[key];
  switch (key) {
    case "name":
    case "name_by_user":
      return { label: "Name", from: plain(b, c.op === "create" ? "" : "default"), to: plain(a) };
    case "area_id":
      return { label: "Area", from: c.op === "create" ? "" : areaName(b), to: areaName(a) };
    case "floor_id":
      return { label: "Floor", from: c.op === "create" ? "" : floorName(b), to: floorName(a) };
    case "labels": {
      const before = new Set(labelNames(b));
      const after = new Set(labelNames(a));
      const added = [...after].filter((x) => !before.has(x));
      const removed = [...before].filter((x) => !after.has(x));
      return { label: "Labels", from: removed.length ? `− ${removed.join(", ")}` : "", to: added.length ? `+ ${added.join(", ")}` : removed.length ? "" : "none" };
    }
    case "categories": {
      const parts = Object.entries((a as Record<string, string | null>) ?? {})
        .filter(([s, id]) => (((b as Record<string, string>) ?? {})[s] ?? null) !== id)
        .map(([s, id]) => `${SCOPE_NAMES[s] ?? s}: ${id ? h.categories[s as keyof Hierarchy["categories"]]?.find((x) => x.id === id)?.name ?? id : "none"}`);
      return { label: "Category", from: "", to: parts.join(", ") };
    }
    case "hidden_by":
      return { label: "Hidden", from: b ? "yes" : "no", to: a ? "yes" : "no" };
    case "disabled_by":
      return { label: "Disabled", from: b ? "yes" : "no", to: a ? "yes" : "no" };
    default:
      return { label: key.charAt(0).toUpperCase() + key.slice(1), from: c.op === "create" ? "" : plain(b, "none"), to: plain(a, "none") };
  }
}

export function ChangesPage({ h }: { h: Hierarchy }) {
  const { changes, version, removeChange, clearChanges, reload } = useTaxis();
  const [step, setStep] = useState<"list" | "confirm" | "confirmNoBackup" | "applying">("list");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ outcome: ApplyResult; titles: Map<number, string> } | null>(null);

  const apply = async (allowWithoutBackup: boolean) => {
    const titles = new Map(changes.map((c) => [c.id, title(h, c)]));
    setStep("applying");
    setError(null);
    const res = await api.apply(version, allowWithoutBackup);
    if (!res.ok) {
      if (/without one/.test(res.error)) {
        setStep("confirmNoBackup");
        return;
      }
      setError(res.error);
      setStep("list");
      await reload(false);
      return;
    }
    setResult({ outcome: res, titles });
    setStep("list");
    await reload(false);
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Changes</h1>
          <p className="text-[13px] text-muted">
            Edits made in Taxis wait here. Taxis shows the house as if they were done, but Home Assistant doesn't change until you apply them.
          </p>
        </div>

        {result && <Outcome result={result} onClose={() => setResult(null)} />}
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </div>
        )}

        {changes.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">No changes waiting. Edit an area, device, entity, label or category to start.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {changes.map((c) => {
                const keys = c.op === "delete" ? [] : Object.keys(c.after).filter((k) => c.op !== "create" || k !== "name");
                return (
                  <li key={c.id} className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-[13px] font-medium">{title(h, c)}</span>
                      <Button tone="ghost" aria-label={`Remove: ${title(h, c)}`} onClick={() => void removeChange(c.id)}>
                        <Trash2 className="size-3.5" aria-hidden /> Remove
                      </Button>
                    </div>
                    {keys.length > 0 && (
                      <dl className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-3 gap-y-0.5 text-xs">
                        {keys.map((k) => {
                          const d = describe(h, c, k);
                          return (
                            <div key={k} className="contents">
                              <dt className="text-muted">{d.label}</dt>
                              <dd className="min-w-0 break-words">
                                {d.from && <span className="text-muted line-through decoration-muted/50">{d.from}</span>}
                                {d.from && d.to && <span className="px-1 text-muted">→</span>}
                                {d.to && <span>{d.to}</span>}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    )}
                    {c.op === "delete" && <p className="text-xs text-muted">Home Assistant removes it from everything it's on.</p>}
                  </li>
                );
              })}
            </ul>

            {step === "list" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button tone="primary" onClick={() => setStep("confirm")}>
                  Apply {changes.length} change{changes.length === 1 ? "" : "s"} to Home Assistant
                </Button>
                <Button tone="ghost" onClick={() => void clearChanges()}>
                  Discard all
                </Button>
              </div>
            )}
            {step === "confirm" && (
              <Confirm onYes={() => void apply(false)} onNo={() => setStep("list")} yes="Back up and apply">
                Taxis first makes a backup of Home Assistant, then applies the {changes.length} change{changes.length === 1 ? "" : "s"}, then reads Home Assistant back to check each one.
                If the backup fails, nothing is changed.
              </Confirm>
            )}
            {step === "confirmNoBackup" && (
              <Confirm onYes={() => void apply(true)} onNo={() => setStep("list")} yes="Apply without a backup" danger>
                Taxis is running outside Home Assistant (development), so it can't make a backup. Apply anyway?
              </Confirm>
            )}
            {step === "applying" && <p className="text-[13px] text-muted">Backing up and applying… this can take a minute.</p>}
          </>
        )}
      </div>
    </main>
  );
}

function Confirm({ children, onYes, onNo, yes, danger }: { children: React.ReactNode; onYes: () => void; onNo: () => void; yes: string; danger?: boolean }) {
  return (
    <div role="alertdialog" aria-label="Confirm" className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-surface p-3.5">
      <p className="flex items-start gap-2 text-[13px]">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <span>{children}</span>
      </p>
      <div className="flex gap-2">
        <Button tone={danger ? "danger" : "primary"} onClick={onYes}>
          {yes}
        </Button>
        <Button tone="ghost" onClick={onNo}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Outcome({ result, onClose }: { result: { outcome: ApplyResult; titles: Map<number, string> }; onClose: () => void }) {
  const { outcome, titles } = result;
  const ok = outcome.results.filter((r) => r.ok).length;
  const failed = outcome.results.length - ok;
  return (
    <section aria-label="Result" className={`flex flex-col gap-2 rounded-lg border px-3.5 py-3 ${failed ? "border-warn/50 bg-warn-soft" : "border-on/40 bg-surface"}`}>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">
          {failed ? `${ok} applied, ${failed} not applied` : `${ok} change${ok === 1 ? "" : "s"} applied`}
        </h2>
        <Button tone="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="text-xs text-muted">{outcome.backup.made ? `Backup made first: “${outcome.backup.name}”.` : outcome.backup.reason}</p>
      <ul className="flex flex-col gap-1 text-[13px]">
        {outcome.results.map((r) => (
          <li key={r.changeId} className="flex items-start gap-2">
            {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-on" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />}
            <span>
              {titles.get(r.changeId) ?? `Change ${r.changeId}`}
              {!r.ok && <span className="block text-xs text-muted">{r.message} It stays in the list.</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
