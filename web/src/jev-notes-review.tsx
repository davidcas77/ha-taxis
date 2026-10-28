import { useEffect, useRef, useState } from "react";
import { GUIDE_CHECKS, type GuideCheckKey } from "../../shared/guide-checks.ts";
import { JEV_CHOICE_LABELS, type JevReview } from "../../shared/jev.ts";
import { api } from "./api.ts";
import { Button } from "./ui.tsx";

export function JevNotesReview({
  notes,
  checks,
  openSettings,
}: {
  notes: string;
  checks: GuideCheckKey[];
  openSettings: () => void;
}) {
  const [configured, setConfigured] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ signature: string; review: JevReview } | null>(null);
  const signature = JSON.stringify({ notes, checks });
  const current = useRef(signature);
  current.current = signature;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let stale = false;
    void api.jev().then((r) => {
      if (stale) return;
      setConfigured(r.ok && r.jev.enabled && r.jev.keySet);
      setReadError(r.ok ? null : r.error);
    });
    return () => {
      stale = true;
    };
  }, [reload]);
  const visible = result?.signature === signature ? result.review : null;
  useEffect(() => setError(null), [signature]);
  return (
    <div aria-label="Jev room-note review" role="region" className="mt-4 rounded-lg border border-line p-3 text-xs">
      <h3 className="font-semibold">Review your notes with Jev</h3>
      <p className="mt-2 text-muted">
        Sends the notes above and this checklist's descriptions to TypeSafe. Taxis does not attach inventory or live
        device data. Anything you include in the notes is part of the request. Jev's suggestions never tick boxes, save
        observations or change readiness. Your observations remain the evidence.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          disabled={busy || !configured || !notes.trim() || !checks.length}
          onClick={async () => {
            const submitted = signature;
            setBusy(true);
            setError(null);
            setResult(null);
            try {
              const r = await api.jevRoomNotes({ notes, checks });
              if (!mounted.current || current.current !== submitted) return;
              if (r.ok) setResult({ signature: submitted, review: r.review });
              else setError(r.error);
            } finally {
              if (mounted.current) setBusy(false);
            }
          }}
        >
          {busy ? "Reviewing notes…" : "Review notes with Jev"}
        </Button>
        <Button onClick={openSettings}>Jev settings</Button>
        {(readError || !configured) && (
          <Button disabled={busy} onClick={() => setReload((v) => v + 1)}>
            Refresh Jev status
          </Button>
        )}
      </div>
      {!configured && (
        <p className="mt-2 text-muted">
          {readError ?? "Enable Jev and save its API key in Settings to use this review."}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-danger">
          {error}
        </p>
      )}
      {visible && (
        <div className="mt-3">
          <p className="text-muted">
            Suggested readings · {visible.model} · {visible.policyVersion}. Model confidence is not proof of the room's
            behavior.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {checks.map((key) => {
              const answer = visible.answers[key];
              if (!answer) return null;
              return (
                <li key={key} className="rounded border border-line p-2">
                  <p className="font-medium">{GUIDE_CHECKS.find((check) => check.key === key)?.label}</p>
                  <p className={answer.choice === "problem" ? "mt-1 text-warn" : "mt-1 text-muted"}>
                    {JEV_CHOICE_LABELS[answer.choice]} · model confidence {Math.round(answer.confidence * 100)}%
                  </p>
                  <details className="mt-1 text-muted">
                    <summary>Decision probabilities</summary>
                    <p>
                      Working: {Math.round(answer.probabilities.positive * 100)}% · Problem:{" "}
                      {Math.round(answer.probabilities.problem * 100)}% · Not established:{" "}
                      {Math.round(answer.probabilities.not_observed * 100)}%
                    </p>
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
