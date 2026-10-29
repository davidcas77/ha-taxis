import { useCallback, useEffect, useState } from "react";
import type { Change } from "../../shared/types.ts";
import { api, type ApplyRun, type Repair } from "./api.ts";
import { Button, ConfirmAction } from "./ui.tsx";

export function ApplyHistory({ refreshKey, applying }: { refreshKey: number; applying: boolean }) {
  const [runs, setRuns] = useState<ApplyRun[]>([]);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [acknowledging, setAcknowledging] = useState<number | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    const [history, pending] = await Promise.all([api.history(), api.repairs()]);
    if (history.ok) setRuns(history.runs);
    if (pending.ok) setRepairs(pending.repairs);
    setError(!history.ok ? history.error : !pending.ok ? pending.error : null);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  const acknowledge = async (id: number) => {
    setAcknowledging(id);
    const result = await api.acknowledgeRepair(id);
    if (result.ok) {
      setRepairs(result.repairs);
      setError(null);
    } else setError(result.error);
    setAcknowledging(null);
  };
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-5" aria-labelledby="apply-history-heading">
      <div className="flex items-center gap-2">
        <h2 id="apply-history-heading" className="flex-1 text-base font-semibold">
          Apply history
        </h2>
        <Button disabled={loading || applying} onClick={() => void load()}>
          {loading ? "Loading…" : "Refresh history"}
        </Button>
      </div>
      <p className="text-xs text-muted">
        Saved in Taxis across reloads and app restarts. A stored configuration and a working automation are checked separately. Repairs stay here until you mark
        them repaired.
      </p>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          Couldn't update apply history: {error}
        </p>
      )}
      <section aria-labelledby="repair-queue-heading" className="flex flex-col gap-2">
        <h3 id="repair-queue-heading" className="text-sm font-semibold">
          Repairs needing attention ({repairs.length})
        </h3>
        {!loading && !error && repairs.length === 0 && <p className="text-xs text-muted">No unresolved repairs.</p>}
        {repairs.map((repair) => (
          <div key={repair.id} className="rounded-lg border border-warn/40 bg-warn-soft p-3 text-[13px]">
            <p className="break-words">{repair.message}</p>
            <p className="mt-1 text-xs text-muted">
              Apply #{repair.runId} · {new Date(repair.createdAt).toLocaleString()}
            </p>
            <ConfirmAction
              disabled={acknowledging !== null || applying}
              question="Have you repaired and verified this in Home Assistant? This only clears the reminder; it does not change Home Assistant."
              onConfirm={() => void acknowledge(repair.id)}
            >
              Mark repaired
            </ConfirmAction>
          </div>
        ))}
      </section>
      {!loading && !error && runs.length === 0 && <p className="text-xs text-muted">No recorded applies yet.</p>}
      {runs.map((run) => (
        <details key={run.id} className="rounded-lg border border-line bg-surface p-3">
          <summary className="cursor-pointer text-[13px]">
            <span className="font-medium">
              Apply #{run.id}: {run.status}
            </span>{" "}
            · {new Date(run.startedAt).toLocaleString()} ·{" "}
            {run.results.filter((r) => r.ok && r.status !== "partial" && r.status !== "unverified" && r.status !== "stored").length}/{run.results.length}{" "}
            verified
          </summary>
          <div className="mt-2 flex flex-col gap-2 text-xs">
            <p>
              {run.backup?.made
                ? `Home Assistant backup made before applying${run.backup.name ? `: ${run.backup.name}` : "."}`
                : (run.backup?.reason ?? "No backup recorded.")}
            </p>
            {run.backup?.slug && (
              <p>
                Backup ID: <code className="font-mono">{run.backup.slug}</code>
              </p>
            )}
            {run.error && <p className="text-danger">{run.error}</p>}
            {run.status === "interrupted" && (
              <p className="text-warn">
                The app stopped before this apply finished. Refresh Home Assistant and review the changes and repairs before retrying.
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {run.results.map((result) => (
                <li key={result.changeId}>
                  <HistoryChange change={run.changes?.find((change) => change.id === result.changeId)} />
                  <p className={result.ok ? "text-on" : "text-danger"}>
                    Change #{result.changeId}:{" "}
                    {result.status === "partial"
                      ? "Partially applied; repair needed"
                      : result.status === "unverified"
                        ? "Not verified"
                        : result.status === "stored"
                          ? "Configuration stored"
                          : result.status === "loaded"
                            ? "Loaded in Home Assistant"
                            : result.ok
                              ? "Applied to Home Assistant"
                              : "Needs attention"}{" "}
                    — {result.message}
                  </p>
                  {result.details?.map((detail, index) => (
                    <p key={index} className="break-words text-muted">
                      {detail}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        </details>
      ))}
    </section>
  );
}

function HistoryChange({ change }: { change?: Change }) {
  if (!change) return null;
  const name = change.after.name ?? change.after.alias ?? change.after.name_by_user ?? change.before.name ?? change.before.name_by_user;
  const display = (value: unknown) => (value === undefined || value === null ? "none" : typeof value === "string" ? value : JSON.stringify(value));
  return (
    <div className="mb-1 flex flex-col gap-1">
      <p className="font-medium">
        {change.op} {change.kind}
        {name ? ` “${String(name)}”` : ""} <code className="break-all font-mono font-normal">{change.targetId}</code>
      </p>
      <dl className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-3 gap-y-1 text-muted">
        {Object.entries(change.after).map(([field, after]) => (
          <div key={field} className="contents">
            <dt>{field.replaceAll("_", " ")}</dt>
            <dd className="max-h-32 overflow-auto break-words">
              <span className="line-through">{display(change.before[field])}</span> → <span className="text-fg">{display(after)}</span>
            </dd>
          </div>
        ))}
        {change.op === "delete" && (
          <div className="contents">
            <dt>Removed</dt>
            <dd className="break-words">{display(change.before)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
