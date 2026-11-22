import { ScanSearch, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import type { JevCheckPreviewResponse, JevCheckRunResponse, JevCheckSubject, JevCheckQuestion } from "../../shared/jev-checks.ts";
import type { JevSettingsResponse } from "../../shared/jev.ts";
import { api } from "./api.ts";
import { useTaxis } from "./state.tsx";
import { Button } from "./ui.tsx";

type Session = {
  id: number;
  snapshot: object;
  preview?: JevCheckPreviewResponse;
  settings?: JevSettingsResponse;
  result?: JevCheckRunResponse;
  sending: boolean;
};

export function JevCheck({
  subject,
  label,
  title,
  openSettings,
  revision,
  disabled = false,
}: {
  subject: JevCheckSubject;
  label: string;
  title: string;
  openSettings: () => void;
  revision?: string;
  disabled?: boolean;
}) {
  const { hierarchy, version, inventory, naming, parameters } = useTaxis();
  const key = JSON.stringify(subject);
  const snapshot = useMemo(
    () => ({ key, hierarchy, version, inventory, naming, parameters, revision }),
    [key, hierarchy, version, inventory, naming, parameters, revision],
  );
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;
  const sequence = useRef(0);
  const sending = useRef<number | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  const prepare = async () => {
    const id = ++sequence.current;
    setSession({ id, snapshot, sending: false });
    const settings = await api.jev();
    if (sequence.current !== id || !dialog.current?.open || latestSnapshot.current !== snapshot) return;
    setSession((current) => (current?.id === id ? { ...current, settings } : current));
    if (!settings.ok || !settings.jev.enabled || !settings.jev.keySet) return;
    const preview = await api.jevCheckPreview(subject);
    setSession((current) => (current?.id === id ? { ...current, preview } : current));
  };

  const outdated = session !== null && session.snapshot !== snapshot;
  const same = outdated ? null : session;
  const preview = same?.preview?.ok ? same.preview.preview : null;
  const result = same?.result;
  const stale = outdated || (result?.ok === false && result.code === "stale") || (same?.preview?.ok === false && same.preview.code === "stale");
  const setupNeeded =
    (same?.settings?.ok === true && (!same.settings.jev.enabled || !same.settings.jev.keySet)) ||
    (same?.preview?.ok === false && same.preview.code === "setup") ||
    (result?.ok === false && result.code === "setup");
  const ready = same?.settings?.ok && same.settings.jev.enabled && same.settings.jev.keySet;
  const noKey = same?.settings?.ok && !same.settings.jev.keySet;
  const failure =
    same?.preview?.ok === false ? same.preview.error : result?.ok === false ? result.error : same?.settings?.ok === false ? same.settings.error : null;
  const canSend = Boolean(preview && ready && !setupNeeded && !stale && !same?.sending);

  const run = async () => {
    if (!canSend || !same || !preview || sending.current === same.id) return;
    const { id } = same;
    sending.current = id;
    setSession((current) => (current?.id === id ? { ...current, result: undefined, sending: true } : current));
    const reply = await api.jevCheckRun(subject, preview.fingerprint);
    if (sending.current === id) sending.current = null;
    setSession((current) => (current?.id === id ? { ...current, result: reply, sending: false } : current));
  };

  return (
    <>
      <Button
        tone="ghost"
        className="justify-self-start text-accent"
        disabled={disabled}
        aria-haspopup="dialog"
        onClick={() => {
          dialog.current?.showModal();
          void prepare();
        }}
      >
        <ScanSearch className="size-3.5 shrink-0" aria-hidden />
        {label}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => {
          if (!dialog.current?.open) {
            sequence.current += 1;
            setSession(null);
          }
        }}
        className="fixed top-1/2 left-1/2 m-0 max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-4 text-fg shadow-xl backdrop:bg-black/55 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="break-words text-base font-semibold">
            {title}
          </h2>
          {!setupNeeded && (
            <Button tone="ghost" aria-label="Close Jev check" onClick={() => dialog.current?.close()}>
              <X className="size-4" aria-hidden />
            </Button>
          )}
        </div>
        {session && (
          <div className="mt-2 grid min-w-0 gap-3 text-sm">
            {!same?.settings && !stale && (
              <p role="status" className="text-muted">
                Reading Jev settings…
              </p>
            )}
            {ready && !same?.preview && !stale && (
              <p role="status" className="text-muted">
                Preparing the evidence preview…
              </p>
            )}
            {stale && (
              <p role="alert" className="rounded border border-warn/40 bg-warn-soft p-2 text-warn">
                {failure ?? "This evidence has changed. Refresh the preview to review the current evidence."}
              </p>
            )}
            {failure && !stale && (
              <p role="alert" className="text-danger">
                {failure}
              </p>
            )}
            {preview && !stale && (
              <>
                <p className="text-muted">
                  TypeSafe’s <span className="font-medium text-fg">{preview.model}</span> will assess the questions below using the reviewed evidence.
                </p>
                {preview.questions.length > 0 && (
                  <ul
                    aria-label="What Jev will assess"
                    className="grid max-h-[28dvh] gap-2 overflow-y-auto rounded-md border border-line bg-bg p-3 text-xs text-muted"
                    tabIndex={0}
                  >
                    {preview.questions.map(({ key, label, choices }) => (
                      <li key={key}>
                        <span className="block font-medium text-fg">{label}</span> {Object.values(choices).join(" / ")}
                      </li>
                    ))}
                  </ul>
                )}
                <details className="rounded-md border border-line bg-bg p-3 text-xs">
                  <summary className="cursor-pointer font-medium text-accent">View exact evidence sent to Jev</summary>
                  <pre tabIndex={0} aria-label="Exact evidence for Jev" className="mt-2 max-h-[35dvh] overflow-auto break-words whitespace-pre-wrap">
                    {preview.content}
                  </pre>
                </details>
              </>
            )}
            {setupNeeded && (
              <div className="rounded border border-line bg-bg p-3">
                <p className="font-medium">{noKey ? "Do you have a Jev API key?" : "Enable Jev to use this optional check."}</p>
                <p className="mt-1 text-muted">Use the standard checks to continue here, or set up Jev for an additional assessment.</p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {preview && !stale && (
                <Button tone="primary" disabled={!canSend} onClick={() => void run()}>
                  {same?.sending ? "Checking with Jev…" : "Send this check to Jev"}
                </Button>
              )}
              {(stale || (failure && !setupNeeded)) && <Button onClick={() => void prepare()}>Refresh evidence</Button>}
              {setupNeeded && (
                <>
                  <Button autoFocus onClick={() => dialog.current?.close()}>
                    Use standard checks
                  </Button>
                  <Button
                    tone="primary"
                    onClick={() => {
                      dialog.current?.close();
                      openSettings();
                    }}
                  >
                    {noKey ? "I have a Jev key" : "Enable Jev"}
                  </Button>
                </>
              )}
            </div>
            {same?.sending && (
              <p role="status" className="text-muted">
                Waiting for Jev’s advisory check…
              </p>
            )}
            {preview && result?.ok && <JevResult questions={preview.questions} result={result} />}
          </div>
        )}
      </dialog>
    </>
  );
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

function JevResult({ questions, result }: { questions: JevCheckQuestion[]; result: Extract<JevCheckRunResponse, { ok: true }> }) {
  return (
    <section aria-label="Jev check result" className="grid gap-2 border-t border-line pt-3">
      <h3 className="font-semibold">Jev’s assessment</h3>
      <p className="text-xs text-muted">
        {result.review.model}
        {result.cached && " · Cached result"}. Confidence estimates come from the model. Use the evidence and existing review controls to make changes.
      </p>
      <ul className="grid gap-2">
        {questions.map((question) => {
          const answer = result.review.answers[question.key];
          if (!answer) return null;
          return (
            <li key={question.key} className="rounded-md border border-line p-2">
              <p className="font-medium">{question.label}</p>
              <p>
                {question.choices[answer.choice]} <span className="text-xs text-muted">· {percent(answer.confidence)} confidence</span>
              </p>
              <details className="mt-1 text-xs text-muted">
                <summary className="cursor-pointer">Decision probabilities</summary>
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(question.choices)
                    .filter(([key]) => answer.probabilities[key] !== undefined)
                    .map(([key, label]) => (
                      <li key={key}>
                        {label} {percent(answer.probabilities[key])}
                      </li>
                    ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
