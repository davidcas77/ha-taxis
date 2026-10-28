import { useEffect, useState } from "react";
import type { AreaReadiness } from "../../shared/guide.ts";
import type { GuideTestRecord } from "../../shared/guide-checks.ts";
import { useDraftGuard } from "./draft-guard.ts";
import { Button, inputClass } from "./ui.tsx";

export function GuideRoomTest({
  area,
  onSave,
}: {
  area: AreaReadiness;
  onSave: (record: GuideTestRecord) => Promise<string | null>;
}) {
  const initial = () => ({
    configuration: area.configuration,
    checked: area.testRecord?.configuration === area.configuration ? area.testRecord.checked : [],
    notes: area.testRecord?.configuration === area.configuration ? area.testRecord.notes : "",
  });
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const guard = useDraftGuard(dirty);
  const canTest = area.stage === "test" || area.stage === "tested";
  const changed = draft.configuration !== area.configuration;
  useEffect(() => {
    if (changed && !dirty) {
      const next = initial();
      setDraft(next);
      setBaseline(next);
    }
  }, [area.configuration, changed, dirty]);
  return (
    <section aria-label="Room test checklist" className="rounded-lg border border-line p-4 text-[13px]">
      <h2 className="font-semibold">5. Test comfort in the room</h2>
      <p className="mt-2 text-muted">
        After you review and Apply the setup, test in the actual room. Tick only behavior you have observed. These are
        your observations, not an automatic verification. Check an HA automation trace when the result is unexpected.
      </p>
      {!canTest && (
        <p className="mt-3 text-warn">
          Complete the equipment, helpers and recipe checks above before recording a room test. Stored configuration
          alone does not prove that an automation is enabled.
        </p>
      )}
      {area.testRecord && (
        <div className="mt-3 rounded border border-line p-3">
          <p className={area.testCurrent ? "text-on" : "text-warn"}>
            {area.testCurrent
              ? "Tested by you for the current configuration."
              : area.testRecord.configuration !== area.configuration
                ? "Previous test needs a retest because the room configuration changed."
                : "Previous observations are saved; this room still needs checks."}
          </p>
          <p className="mt-1 text-xs text-muted">Recorded {new Date(area.testRecord.testedAt).toLocaleString()}</p>
          {area.testRecord.notes && <p className="mt-2 whitespace-pre-wrap break-words">{area.testRecord.notes}</p>}
        </div>
      )}
      {changed && (
        <p role="alert" className="mt-3 text-warn">
          The room setup changed while this form was open. Your draft is kept. Start a new test for the current setup
          before saving.
        </p>
      )}
      <div role="group" aria-label="Observed room behavior" className="mt-4 grid gap-3 md:grid-cols-2">
        {area.checks.map((check) => (
          <label key={check.key} className="flex items-start gap-2 rounded border border-line p-3">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--accent)]"
              checked={draft.checked.includes(check.key)}
              disabled={saving || !canTest}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  checked: event.target.checked
                    ? [...draft.checked, check.key]
                    : draft.checked.filter((key) => key !== check.key),
                })
              }
            />
            <span>
              <span className="font-medium">{check.label}</span>
              <span className="mt-1 block text-xs text-muted">{check.detail}</span>
            </span>
          </label>
        ))}
      </div>
      <label className="mt-4 flex flex-col gap-1">
        Room test notes
        <textarea
          aria-label="Room test notes"
          className={`${inputClass} min-h-24 w-full`}
          maxLength={2000}
          disabled={saving || !canTest}
          value={draft.notes}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          placeholder="What worked, and what still needs adjustment?"
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          tone="primary"
          disabled={saving || !canTest || changed || (!draft.checked.length && !draft.notes.trim())}
          onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              const problem = await onSave({ ...draft, testedAt: new Date().toISOString() });
              setError(problem);
              if (!problem) {
                guard.release();
                setBaseline(draft);
              }
            } finally {
              setSaving(false);
            }
          }}
        >
          Save room test record
        </Button>
        <Button
          disabled={saving}
          onClick={() => {
            const next = initial();
            setDraft(next);
            setBaseline(next);
            setError(null);
            guard.release();
          }}
        >
          {changed ? "Start new room test" : "Undo test edits"}
        </Button>
        <span className="text-xs text-muted">
          {area.checks.filter((check) => draft.checked.includes(check.key)).length} of {area.checks.length} observed
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
