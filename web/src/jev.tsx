import { useEffect, useState } from "react";
import { JEV_MODELS, validateJev, type JevModel, type JevUsage, type JevView } from "../../shared/jev.ts";
import { api } from "./api.ts";
import { useDraftGuard } from "./draft-guard.ts";
import { useTaxis } from "./state.tsx";
import { Button, inputClass } from "./ui.tsx";

export function JevSection() {
  const [saved, setSaved] = useState<JevView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let stale = false;
    void api.jev().then((r) => {
      if (stale) return;
      if (r.ok) {
        setSaved(r.jev);
        setError(null);
      } else setError(r.error);
    });
    return () => {
      stale = true;
    };
  }, [generation]);
  return (
    <section id="jev-settings" aria-label="Jev decisions" className="flex flex-col gap-4 border-t border-line pt-6">
      <div>
        <h2 className="text-sm font-semibold">Jev decisions</h2>
        <p className="mt-1 max-w-[72ch] text-[13px] text-muted">
          An optional TypeSafe decision service, separate from your Low, Medium and Strong models. It can review room-test notes in the Guide. Suggestions do
          not change checkmarks, readiness, helpers or devices.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error} <Button onClick={() => setGeneration((v) => v + 1)}>Retry reading Jev settings</Button>
        </p>
      )}
      {!saved && !error && <p className="text-xs text-muted">Reading Jev settings…</p>}
      {saved && (
        <JevForm
          key={generation}
          saved={saved}
          onSaved={(value) => {
            setSaved(value);
            setGeneration((n) => n + 1);
          }}
          reload={() => setGeneration((v) => v + 1)}
        />
      )}
    </section>
  );
}

function JevForm({ saved, onSaved, reload }: { saved: JevView; onSaved: (v: JevView) => void; reload: () => void }) {
  const { notify } = useTaxis();
  const [enabled, setEnabled] = useState(saved.enabled);
  const [model, setModel] = useState(saved.model);
  const [limit, setLimit] = useState(String(saved.monthlyRequestLimit));
  const [keyMode, setKeyMode] = useState<"keep" | "replace" | "remove">("keep");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<string | null>(null);
  const [usage, setUsage] = useState<JevUsage | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageVersion, setUsageVersion] = useState(0);
  const dirty = enabled !== saved.enabled || model !== saved.model || Number(limit) !== saved.monthlyRequestLimit || keyMode !== "keep";
  const guard = useDraftGuard(dirty);
  useEffect(() => {
    let stale = false;
    void api.jevUsage().then((r) => {
      if (stale) return;
      if (r.ok) {
        setUsage(r.usage);
        setUsageError(null);
      } else {
        setUsage(null);
        setUsageError(r.error);
      }
    });
    return () => {
      stale = true;
    };
  }, [usageVersion]);
  return (
    <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" className="accent-[var(--accent)]" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enable Jev decisions
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[13px]">
          Jev model
          <select aria-label="Jev model" className={inputClass} value={model} onChange={(e) => setModel(e.target.value as JevModel)}>
            {JEV_MODELS.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          Monthly Jev request limit
          <input
            aria-label="Monthly Jev request limit"
            type="number"
            min={1}
            max={10000}
            step={1}
            className={inputClass}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-col gap-2 text-[13px]">
        <p className="font-medium">Jev API key</p>
        <p className="text-xs text-muted">
          Get a TypeSafe key from{" "}
          <a className="text-accent underline" href="https://console.typesafe.ai" target="_blank" rel="noreferrer">
            console.typesafe.ai
          </a>
          . This key is independent of your other AI provider keys.
        </p>
        {keyMode === "remove" ? (
          <p className="text-warn">Key will be removed when you save.</p>
        ) : keyMode === "replace" || !saved.keySet ? (
          <input
            aria-label="Jev API key"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            className={`${inputClass} max-w-xl`}
            value={key}
            placeholder={saved.keySet ? "Enter replacement key" : "Paste your Jev API key"}
            onChange={(e) => {
              setKey(e.target.value);
              setKeyMode(e.target.value ? "replace" : "keep");
            }}
          />
        ) : (
          <p>Key set. It cannot be read back.</p>
        )}
        {saved.keySet && (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setKeyMode("replace");
                setKey("");
              }}
            >
              Replace Jev key
            </Button>
            <Button
              onClick={() => {
                setKeyMode("remove");
                setKey("");
              }}
            >
              Remove Jev key
            </Button>
          </div>
        )}
        <p className="max-w-[85ch] text-xs text-muted">
          The key is stored in Taxis's app data and included in Home Assistant app backups. Saved keys are never returned to the browser or written to logs. Jev
          receives room notes and checklist descriptions only when you click Review notes with Jev.
        </p>
      </div>
      <p className="text-xs text-muted">
        The limit counts every outgoing attempt, including connection tests and failed requests, per calendar month (UTC). It is separate from the other AI
        service's spending cap. Requests are manual; no background analysis runs.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          tone="primary"
          disabled={!dirty}
          onClick={async () => {
            const checked = validateJev({
              enabled,
              model,
              monthlyRequestLimit: Number(limit),
              ...(keyMode === "remove" ? { key: null } : keyMode === "replace" ? { key } : {}),
            });
            if (!checked.ok) {
              setError(checked.error);
              return;
            }
            setBusy(true);
            setError(null);
            try {
              const r = await api.saveJev({
                ...checked.value,
                ...(checked.key !== undefined ? { key: checked.key } : {}),
              });
              if (!r.ok) {
                setError(r.error);
                return;
              }
              setKey("");
              guard.release();
              onSaved(r.jev);
              notify({ tone: "ok", text: "Jev settings saved. Home Assistant is unchanged." });
            } finally {
              setBusy(false);
            }
          }}
        >
          Save Jev settings
        </Button>
        <Button
          onClick={() => {
            setEnabled(saved.enabled);
            setModel(saved.model);
            setLimit(String(saved.monthlyRequestLimit));
            setKeyMode("keep");
            setKey("");
            setError(null);
            setTest(null);
          }}
        >
          Undo Jev changes
        </Button>
        <Button onClick={() => guard.close(reload)}>Reload Jev settings</Button>
      </div>
      {error && (
        <p role="alert" className="break-words text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="rounded-lg border border-line p-3 text-[13px]">
        <Button
          disabled={dirty || !saved.enabled || !saved.keySet}
          onClick={async () => {
            setBusy(true);
            setError(null);
            setTest(null);
            try {
              const r = await api.jevTest();
              if (r.ok) setTest(`Connected · ${r.model} · ${r.inputTokens} input tokens · estimated $${r.estimatedUsd.toFixed(6)}`);
              else setError(r.error);
              setUsageVersion((v) => v + 1);
            } finally {
              setBusy(false);
            }
          }}
        >
          Test Jev connection
        </Button>
        <p className="mt-2 text-xs text-muted">
          {dirty
            ? "Save your Jev changes first; the test uses saved settings."
            : !saved.enabled
              ? "Enable Jev and save to test it."
              : !saved.keySet
                ? "Add a key and save to test it."
                : "Sends a small public test message to TypeSafe; no house data. Provider charges may apply."}
        </p>
        {test && !dirty && (
          <p role="status" className="mt-2 text-on">
            {test}
          </p>
        )}
      </div>
      <div className="text-xs text-muted" aria-label="Jev usage">
        {usage ? (
          <p>
            {usage.month}: {usage.attempts} of {usage.limit} requests · {usage.completed} completed · {usage.inputTokens} input tokens · estimated $
            {usage.estimatedUsd.toFixed(6)}
            {usage.unknownUsage ? ` · provider usage unavailable for ${usage.unknownUsage} attempts` : ""}. Estimates use TypeSafe's published input price for
            these pinned models; they are not an invoice.
          </p>
        ) : (
          <p>{usageError ?? "Reading Jev usage…"}</p>
        )}
        <Button className="mt-2" onClick={() => setUsageVersion((v) => v + 1)}>
          Refresh Jev usage
        </Button>
      </div>
    </fieldset>
  );
}
