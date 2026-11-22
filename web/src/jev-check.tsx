import { ScanSearch, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { validateJevCheckSubject, type JevCheckAutoResponse, type JevCheckSubject, type JevCheckQuestion } from "../../shared/jev-checks.ts";
import { getSettingRevision } from "./api.ts";
import { jevCheckQueue, type JevCheckUpdate } from "./jev-check-queue.ts";
import { useTaxisData } from "./state.tsx";
import { Button } from "./ui.tsx";

type Result = Extract<JevCheckAutoResponse, { ok: true }>;
const timeLabel = (iso: string) => new Date(iso).toLocaleString();

export function JevCheck({
  subject,
  label,
  title,
  openSettings,
  revision,
  disabled = false,
  active = true,
}: {
  subject: JevCheckSubject;
  label: string;
  title: string;
  openSettings: () => void;
  revision?: string;
  disabled?: boolean;
  active?: boolean;
}) {
  const { hierarchy, version } = useTaxisData();
  const key = JSON.stringify(subject);
  const roomCheck = subject.kind === "equipment" || subject.kind === "groups";
  const roomRevision = roomCheck ? [getSettingRevision("inventory"), getSettingRevision("parameters")] : null;
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([key, hierarchy?.fetchedAt, version, roomRevision, revision, attempt]);
  const [updated, setUpdated] = useState<{ key: string; update: JevCheckUpdate } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const enabled = active && !disabled && Boolean(hierarchy);

  useEffect(() => {
    if (!enabled) return;
    const validated = validateJevCheckSubject(JSON.parse(key));
    if (!validated) return;
    setUpdated(null);
    return jevCheckQueue.watch(requestKey, validated, (update) => setUpdated({ key: requestKey, update }));
  }, [enabled, requestKey, key]);

  const state = enabled && updated?.key === requestKey ? updated.update : null;
  const result = state?.kind === "result" ? state.result : null;
  const setup = state?.kind === "setup" ? state : null;
  const showStatus = state && !setup;
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Button tone="ghost" className="text-accent" disabled={disabled} aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
          <ScanSearch className="size-3.5 shrink-0" aria-hidden />
          {showStatus ? "Jev details" : label}
        </Button>
        {showStatus && (
          <span role="status" className="text-xs text-muted">
            {result ? (
              <>
                Last checked <time dateTime={result.checkedAt}>{timeLabel(result.checkedAt)}</time> · {result.cached ? "Cached result" : "Fresh result"}
              </>
            ) : state.kind === "checking" ? (
              "Checking with Jev…"
            ) : (
              "Jev check unavailable"
            )}
          </span>
        )}
      </div>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="fixed top-1/2 left-1/2 m-0 max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-4 text-fg shadow-xl backdrop:bg-black/55 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="break-words text-base font-semibold">
            {title}
          </h2>
          {!setup && (
            <Button tone="ghost" aria-label="Close Jev check" onClick={() => dialog.current?.close()}>
              <X className="size-4" aria-hidden />
            </Button>
          )}
        </div>
        <div className="mt-2 grid min-w-0 gap-3 text-sm">
          {setup ? (
            <>
              <div className="rounded border border-line bg-bg p-3">
                <p className="font-medium">{setup.noKey ? "Do you have a Jev API key?" : "Enable Jev to use this optional check."}</p>
                <p className="mt-1 text-muted">Use the standard checks to continue here, or set up Jev for an additional assessment.</p>
              </div>
              <div className="flex flex-wrap gap-2">
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
                  {setup.noKey ? "I have a Jev key" : "Enable Jev"}
                </Button>
              </div>
            </>
          ) : result ? (
            <>
              <p className="text-xs text-muted">
                Last checked <time dateTime={result.checkedAt}>{timeLabel(result.checkedAt)}</time> · {result.cached ? "Cached result" : "Fresh result"}
                {result.cached && (
                  <>
                    {" "}
                    · Assessment from <time dateTime={result.reviewedAt}>{timeLabel(result.reviewedAt)}</time>
                  </>
                )}
              </p>
              <JevResult questions={result.preview.questions} result={result} />
              <details className="rounded-md border border-line bg-bg p-3 text-xs">
                <summary className="cursor-pointer font-medium text-accent">View exact evidence sent to Jev</summary>
                <pre tabIndex={0} aria-label="Exact evidence for Jev" className="mt-2 max-h-[35dvh] overflow-auto break-words whitespace-pre-wrap">
                  {result.preview.content}
                </pre>
              </details>
              <Button className="justify-self-start" onClick={() => setAttempt((n) => n + 1)}>
                Check again
              </Button>
            </>
          ) : state?.kind === "error" ? (
            <>
              <p role="alert" className="text-danger">
                {state.message}
              </p>
              <Button className="justify-self-start" onClick={() => setAttempt((n) => n + 1)}>
                Retry Jev check
              </Button>
            </>
          ) : (
            <p role="status" className="text-muted">
              {state?.kind === "checking" ? "Waiting for Jev’s assessment…" : "Preparing the Jev check…"}
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

function JevResult({ questions, result }: { questions: JevCheckQuestion[]; result: Result }) {
  return (
    <section aria-label="Jev check result" className="grid gap-2 border-t border-line pt-3">
      <h3 className="font-semibold">Jev’s assessment</h3>
      <p className="text-xs text-muted">
        {result.review.model}. Confidence estimates come from the model. Use the evidence and existing review controls to make changes.
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
