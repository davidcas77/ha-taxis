import { useDraftGuard } from "./draft-guard.ts";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  AI_EFFORTS,
  AI_TIERS,
  AI_PROVIDERS,
  CAP_MAX,
  CAP_MIN,
  DEFAULT_OPENAI_BASE,
  EFFORT_HINT,
  EFFORT_LABEL,
  TIER_LABEL,
  TIER_HINT,
  PROVIDER_LABEL,
  TOKENS_MAX,
  TOKENS_MIN,
  defaultModels,
  formatUsd,
  priceFor,
  type AiTier,
  type AiProviderId,
  type AiSettingsView,
  type AiTestResult,
  type AiUsage,
  type ModelInfo,
} from "../../shared/ai.ts";
import { formDiffers, formOf, savedSettings, settingsOf, type PriceRow } from "../../shared/ai-form.ts";
import { checkBaseUrl } from "../../shared/ai-url.ts";
import { api } from "./api.ts";
import { useTaxis } from "./state.tsx";
import { Button, Field, inputClass } from "./ui.tsx";

// Settings → AI (optional): off by default; a provider, a key that only ever goes
// to the server, a model for each of three task tiers, how hard to think, a monthly
// cap, and a Test connection. Nothing here touches Home Assistant.

type KeyEdit = "keep" | "replace" | "remove";

const tokens = (n: number) => n.toLocaleString("en-US");

function AvailableModels({ available, models, onChoose }: { available: ModelInfo[]; models: Record<AiTier, string>; onChoose: (job: AiTier, id: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(true);
  const search = query.trim().toLowerCase();
  const matches = available.filter(model => `${model.id} ${model.name}`.toLowerCase().includes(search));
  return <section aria-labelledby="available-models-heading" className="min-w-0 rounded-lg border border-line bg-surface">
    <div className="flex flex-wrap items-center justify-between gap-2 p-3">
      <h3 id="available-models-heading" className="text-[13px] font-semibold">Available models ({available.length})</h3>
      <Button tone="ghost" aria-expanded={open} aria-controls="available-models-list" onClick={() => setOpen(!open)}>{open ? "Hide models" : "Show models"}</Button>
    </div>
    <div id="available-models-list" hidden={!open}>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <label htmlFor="ai-model-search" className="text-xs font-medium text-muted">Search available models</label>
        <input id="ai-model-search" type="search" className={inputClass} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by model ID or name" />
        <p role="status" className="text-xs text-muted">{matches.length} of {available.length} models. Choose a tier, then save AI settings.</p>
      </div>
      {matches.length ? <ul aria-label="Available AI models" className="max-h-80 overflow-y-auto border-t border-line">
        {matches.map(model => <li key={model.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-line p-3 last:border-b-0">
          <div className="min-w-0 flex-1 basis-48">
            <code className="block break-all text-[13px]">{model.id}</code>
            {model.name !== model.id && <span className="block break-words text-xs text-muted">{model.name}</span>}
          </div>
          <div className="flex flex-wrap gap-2">{AI_TIERS.map(job => <Button key={job} tone={models[job] === model.id ? "primary" : "ghost"} aria-label={`Use ${model.id} for ${TIER_LABEL[job]}`} aria-pressed={models[job] === model.id} onClick={() => onChoose(job, model.id)}>{models[job] === model.id ? `${TIER_LABEL[job]} selected` : `Use for ${TIER_LABEL[job]}`}</Button>)}</div>
        </li>)}
      </ul> : <p className="border-t border-line p-3 text-[13px] text-muted">No models match this search.</p>}
    </div>
  </section>;
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded-md border border-line">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 text-[13px] ${i > 0 ? "border-l border-line" : ""} ${on ? "bg-accent-soft font-medium text-accent" : "bg-surface text-muted hover:text-fg"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function AiSection() {
  const [saved, setSaved] = useState<AiSettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    void api.ai().then((r) => (r.ok ? setSaved(r.ai) : setLoadError(r.error)));
  }, []);

  return (
    <section aria-labelledby="ai-heading" className="flex flex-col gap-3 border-t border-line pt-6">
      <div className="flex flex-col gap-1">
        <h2 id="ai-heading" className="text-sm font-semibold">
          AI (optional)
        </h2>
        <p className="max-w-[68ch] text-[13px] text-muted">
          Off unless you turn it on. Your API key stays in this add-on: it is stored here, never sent back to your browser and never written to the log. Nothing is written to Home Assistant by AI, and every change it proposes will go through the change list for you to review.
        </p>
      </div>
      {loadError && (
        <p role="alert" className="text-xs text-danger">
          {loadError}
        </p>
      )}
      {!saved && !loadError && <p className="text-[13px] text-muted">Loading the AI settings…</p>}
      {saved && <AiForm saved={saved} onSaved={setSaved} />}
    </section>
  );
}

function AiForm({ saved, onSaved }: { saved: AiSettingsView; onSaved: (v: AiSettingsView) => void }) {
  const { notify } = useTaxis();
  const [enabled, setEnabled] = useState(saved.enabled);
  const [provider, setProvider] = useState(saved.provider);
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl);
  const [models, setModels] = useState(saved.models);
  const [effort, setEffort] = useState(saved.effort);
  const [cap, setCap] = useState(String(saved.monthlyCapUsd));
  const [maxTokens, setMaxTokens] = useState(String(saved.maxOutputTokens));
  const [prices, setPrices] = useState<PriceRow[]>(() => formOf(saved).prices);
  const [keyEdit, setKeyEdit] = useState<KeyEdit>("keep");
  const [keyText, setKeyText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [available, setAvailable] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsMsg, setModelsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const modelsRequest = useRef(0);
  useEffect(() => () => { modelsRequest.current += 1; }, []);
  const clearModels = () => {
    modelsRequest.current += 1;
    setAvailable([]);
    setModelsMsg(null);
    setLoadingModels(false);
  };

  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [testing, setTesting] = useState<AiTier | null>(null);
  const [test, setTest] = useState<{ ok: true; result: AiTestResult } | { ok: false; error: string } | null>(null);

  const refreshUsage = useCallback(() => {
    void api.aiUsage().then((r) => r.ok && setUsage(r.usage));
  }, []);
  useEffect(refreshUsage, [refreshUsage]);

  const keyOf = saved.keys[provider];
  // An empty box in place of a replacement means no change.
  const edit: KeyEdit = keyEdit === "replace" && !keyText.trim() ? "keep" : keyEdit;
  // Whether there will be a key after Save.
  const willHaveKey = edit === "replace" ? true : edit === "remove" ? false : keyOf.set;

  const form = { enabled, provider, baseUrl, models, effort, cap, maxTokens, prices };
  const built = settingsOf(form);
  const dirty = edit !== "keep" || formDiffers(form, savedSettings(saved));
  const draftGuard = useDraftGuard(dirty);
  const urlProblem = provider === "openai-compatible" ? (() => { const c = checkBaseUrl(baseUrl); return c.ok ? null : c.error; })() : null;

  const changeProvider = (p: AiProviderId) => {
    if (p === provider) return;
    setProvider(p);
    setModels(defaultModels(p));
    clearModels();
    setKeyEdit("keep");
    setKeyText("");
    if (p === "openai-compatible" && !baseUrl.trim()) setBaseUrl(DEFAULT_OPENAI_BASE);
  };

  const loadModels = async () => {
    const request = ++modelsRequest.current;
    setLoadingModels(true);
    setAvailable([]);
    setModelsMsg(null);
    const r = await api.aiModels({
      provider,
      ...(provider === "openai-compatible" ? { baseUrl } : {}),
      ...(edit === "replace" ? { key: keyText.trim() } : {}),
    });
    if (request !== modelsRequest.current) return;
    setLoadingModels(false);
    if (!r.ok) return setModelsMsg({ ok: false, text: r.error });
    setAvailable(r.models);
    setModelsMsg({ ok: true, text: r.models.length === 0 ? "The service lists no models." : `${r.models.length} model${r.models.length === 1 ? "" : "s"} available. Browse the list below or type a model ID.` });

  };

  const save = async () => {
    if (typeof built === "string") return setError(built);
    setSaving(true);
    setError(null);
    const r = await api.saveAi({
      ...built,
      ...(edit === "replace" ? { key: keyText.trim() } : edit === "remove" ? { key: null } : {}),
    });
    setSaving(false);
    if (!r.ok) return setError(r.error);
    draftGuard.release();
    onSaved(r.ai);
    setKeyEdit("keep");
    setKeyText("");
    setTest(null);
    notify({ tone: "ok", text: "AI settings saved" });
    refreshUsage();
  };

  const undo = () => {
    setEnabled(saved.enabled);
    setProvider(saved.provider);
    setBaseUrl(saved.baseUrl);
    setModels(saved.models);
    setEffort(saved.effort);
    setCap(String(saved.monthlyCapUsd));
    setMaxTokens(String(saved.maxOutputTokens));
    setPrices(formOf(saved).prices);
    setKeyEdit("keep");
    setKeyText("");
    setError(null);
    clearModels();
  };

  const runTest = async (job: AiTier) => {
    setTesting(job);
    setTest(null);
    const r = await api.aiTest(job);
    setTesting(null);
    setTest(r.ok ? { ok: true, result: r.test } : { ok: false, error: r.error });
    refreshUsage();
  };

  const canTest = !dirty && saved.enabled && !testing;

  // What a model costs, said next to its field.
  const priceNote = (id: string) => {
    if (!id.trim()) return null;
    const found = priceFor({ prices: typeof built === "string" ? saved.prices : built.prices }, provider, id.trim());
    if (found) {
      const { inputPerMTok: i, outputPerMTok: o } = found.price;
      return `${found.source === "settings" ? "Your price" : "Built-in price"}: $${i} in, $${o} out per million tokens.`;
    }
    return "No price known. Its tokens are counted, but not its cost, so the cap can't see it. Add a price below.";
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="AI" value={enabled ? "on" : "off"} options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]} onChange={(v) => setEnabled(v === "on")} />
        <span className="text-xs text-muted">{enabled ? "Used only for the things you ask it to do." : "No request is ever sent to an AI service."}</span>
      </div>

      {enabled && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Provider" htmlFor="ai-provider">
              <select id="ai-provider" className={inputClass} value={provider} onChange={(e) => changeProvider(e.target.value as AiProviderId)}>
                {AI_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABEL[p]}
                  </option>
                ))}
              </select>
            </Field>
            {provider === "openai-compatible" && (
              <Field
                label="Base URL"
                htmlFor="ai-base-url"
                hint="OpenAI, OpenRouter, or a service on your network such as Ollama (http://<host>:11434/v1) or LM Studio. https:// is required except for this machine and private-network addresses."
              >
                <input
                  id="ai-base-url"
                  className={`${inputClass} font-mono ${urlProblem ? "border-danger" : ""}`}
                  value={baseUrl}
                  spellCheck={false}
                  aria-invalid={urlProblem ? true : undefined}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    clearModels();
                  }}
                />
                {urlProblem && (
                  <p role="alert" className="text-[11px] text-danger">
                    {urlProblem}
                  </p>
                )}
              </Field>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">API key{provider === "openai-compatible" ? " (leave empty for a service that needs none)" : ""}</span>
            {keyOf.set && keyEdit === "keep" ? (
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span>Key set{keyOf.end ? <>, ends with …<code className="font-mono">{keyOf.end}</code></> : ""}.</span>
                <Button onClick={() => setKeyEdit("replace")}>Replace</Button>
                <Button tone="danger" onClick={() => setKeyEdit("remove")}>
                  Remove
                </Button>
              </div>
            ) : keyEdit === "remove" ? (
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-warn">The key will be removed when you save.</span>
                <Button tone="ghost" onClick={() => setKeyEdit("keep")}>
                  Keep it
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="ai-key"
                  type="password"
                  aria-label="API key"
                  autoComplete="off"
                  spellCheck={false}
                  className={`${inputClass} max-w-md font-mono`}
                  placeholder={keyOf.set ? "New key" : provider === "anthropic" ? "sk-ant-…" : "Key"}
                  value={keyText}
                  onChange={(e) => {
                    setKeyText(e.target.value);
                    setKeyEdit("replace");
                  }}
                />
                {keyOf.set && (
                  <Button
                    tone="ghost"
                    onClick={() => {
                      setKeyEdit("keep");
                      setKeyText("");
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            )}
            <p className="text-[11px] text-muted">Write-only: once saved, the key can't be read back here. It is kept in this add-on's data, which Home Assistant backups of the add-on include.</p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={loadingModels || (provider === "anthropic" && !willHaveKey) || Boolean(urlProblem)} onClick={() => void loadModels()}>
                {loadingModels ? "Loading…" : "Load models"}
              </Button>
              {modelsMsg && (
                <span role={modelsMsg.ok ? "status" : "alert"} className={`min-w-0 max-w-full text-xs [overflow-wrap:anywhere] ${modelsMsg.ok ? "text-muted" : "text-danger"}`}>
                  {modelsMsg.text}
                </span>
              )}
            </div>
            <datalist id="ai-models">
              {available.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </datalist>
            <p className="text-xs text-muted">Task routing: Low for naming/classification, Medium for explanations/analysis, Strong for planning/review. You can also enter a model ID directly.</p>
            <p className="text-xs text-muted">Configure and test each tier here. Task-based AI features are not connected yet.</p>
            <div className="grid gap-3 lg:grid-cols-3">
              {AI_TIERS.map((job) => (
                <Field
                  key={job}
                  label={`${TIER_LABEL[job]} model`}
                  htmlFor={`ai-model-${job}`}
                  hint={
                    <>
                      {TIER_HINT[job]}
                      {priceNote(models[job]) && <span className="mt-0.5 block">{priceNote(models[job])}</span>}
                    </>
                  }
                >
                  <input
                    id={`ai-model-${job}`}
                    list="ai-models"
                    className={`${inputClass} font-mono`}
                    value={models[job]}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={provider === "openai-compatible" ? "Load models, then pick" : undefined}
                    onChange={(e) => setModels({ ...models, [job]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
            {available.length > 0 && <AvailableModels available={available} models={models} onChoose={(job, id) => setModels(current => ({ ...current, [job]: id }))} />}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Effort</span>
            <Segmented label="Effort" value={effort} options={AI_EFFORTS.map((e) => ({ value: e, label: EFFORT_LABEL[e] }))} onChange={setEffort} />
            <p className="text-[11px] text-muted">
              {EFFORT_HINT[effort]} {provider === "anthropic" ? "Sent as Anthropic's effort setting." : "Sent as reasoning effort, to models that accept it."}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Monthly spending cap (US dollars)"
              htmlFor="ai-cap"
              hint={`Between $${CAP_MIN} and $${CAP_MAX.toLocaleString("en-US")}. AI stops for the rest of the month once it is reached. Only calls with a known price count toward it.`}
            >
              <input id="ai-cap" inputMode="decimal" className={`${inputClass} max-w-40`} value={cap} onChange={(e) => setCap(e.target.value)} />
            </Field>
            <Field label="Most output tokens per request" htmlFor="ai-max-tokens" hint={`Between ${tokens(TOKENS_MIN)} and ${tokens(TOKENS_MAX)}. Includes the model's thinking.`}>
              <input id="ai-max-tokens" inputMode="numeric" className={`${inputClass} max-w-40`} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-xs font-medium text-muted">Prices (optional)</h3>
              <p className="text-[11px] text-muted">US dollars per million tokens. Anthropic's are built in. Enter your own for any other model to count its cost; use 0 for a model that runs on your own machine.</p>
            </div>
            {prices.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {prices.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input
                      aria-label="Model"
                      list="ai-models"
                      className={`${inputClass} max-w-64 font-mono`}
                      placeholder="Model"
                      spellCheck={false}
                      value={r.model}
                      onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, model: e.target.value } : x)))}
                    />
                    <input
                      aria-label={`Input price for ${r.model || "the model"}`}
                      inputMode="decimal"
                      className={`${inputClass} w-24!`}
                      placeholder="In"
                      value={r.input}
                      onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)))}
                    />
                    <input
                      aria-label={`Output price for ${r.model || "the model"}`}
                      inputMode="decimal"
                      className={`${inputClass} w-24!`}
                      placeholder="Out"
                      value={r.output}
                      onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, output: e.target.value } : x)))}
                    />
                    <Button tone="ghost" aria-label={`Remove the price for ${r.model || "this model"}`} onClick={() => setPrices(prices.filter((_, j) => j !== i))}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div>
              <Button onClick={() => setPrices([...prices, { model: "", input: "", output: "" }])}>Add a price</Button>
            </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button tone="primary" disabled={saving || !dirty || (enabled && Boolean(urlProblem))} onClick={() => void save()}>
          {saving ? "Saving…" : "Save AI settings"}
        </Button>
        <Button tone="ghost" disabled={!dirty} onClick={undo}>
          Undo changes
        </Button>
        {error && (
          <span role="alert" className="text-xs text-danger">
            {error}
          </span>
        )}
      </div>

      {enabled && (
        <section aria-label="Test connection" className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Test connection</h3>
            {AI_TIERS.map((job) => (
              <Button key={job} disabled={!canTest || !saved.models[job]} onClick={() => void runTest(job)}>
                {testing === job ? "Testing…" : `Test the ${TIER_LABEL[job]} model`}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted">
            {dirty || !saved.enabled
              ? "Save your changes first; the test uses what is saved."
              : "Sends one short, fixed sentence (no information about your home) and shows the answer. It is a real call, so it counts toward the cap."}
          </p>
          <div aria-live="polite">
            {test?.ok === false && (
              <p role="alert" className="text-[13px] text-danger">
                {test.error}
              </p>
            )}
            {test?.ok === true && <TestResult r={test.result} />}
          </div>
        </section>
      )}

      <UsagePanel usage={usage} />
    </div>
  );
}

function TestResult({ r }: { r: AiTestResult }) {
  return (
    <div className="flex flex-col gap-1 text-[13px]">
      <p>
        <span className="text-muted">Answer: </span>
        {r.reply ? <q className="text-fg">{r.reply}</q> : <span className="text-warn">{r.stop === "max_tokens" ? "No text: the model used its whole budget before answering." : "The model sent no text."}</span>}
      </p>
      <p className="text-xs text-muted">
        {TIER_LABEL[r.tier]} tier · <code className="font-mono">{r.model}</code> · {tokens(r.inputTokens)} in, {tokens(r.outputTokens)} out tokens ·{" "}
        {r.costUsd === null ? "cost unknown (no price for this model)" : formatUsd(r.costUsd)} · {(r.ms / 1000).toFixed(1)} s
      </p>
    </div>
  );
}

function UsagePanel({ usage }: { usage: AiUsage | null }) {
  if (!usage) return null;
  const share = usage.capUsd > 0 ? Math.min(1, usage.spentUsd / usage.capUsd) : 0;
  const over = usage.spentUsd >= usage.capUsd;
  return (
    <section aria-label="Usage this month" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-xs font-medium text-muted">Usage this month</h3>
        <p className="text-[11px] text-muted">{usage.month}, counted in UTC.</p>
      </div>
      <div
        role="progressbar"
        aria-label="Spent against the monthly cap"
        aria-valuemin={0}
        aria-valuemax={usage.capUsd}
        aria-valuenow={Math.min(usage.spentUsd, usage.capUsd)}
        className="h-2 w-full max-w-md overflow-hidden rounded-full bg-sunken"
      >
        <div className={`h-full ${over ? "bg-danger" : "bg-accent"}`} style={{ width: `${share * 100}%` }} />
      </div>
      <p className="text-[13px]">
        <span className={over ? "font-medium text-danger" : ""}>{formatUsd(usage.spentUsd)}</span> of {formatUsd(usage.capUsd)}
        {over ? ": the cap is reached, so AI is paused until next month or until you raise it" : ""}. {tokens(usage.calls)} call{usage.calls === 1 ? "" : "s"}, {tokens(usage.inputTokens)} tokens in, {tokens(usage.outputTokens)} out.
      </p>
      {usage.unpricedCalls > 0 && (
        <p className="text-xs text-warn">
          {tokens(usage.unpricedCalls)} call{usage.unpricedCalls === 1 ? " has" : "s have"} no known price. Their tokens are counted but not their cost, so the cap can't see them. Add a price for the model above.
        </p>
      )}
      {usage.byModel.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-muted">
          {usage.byModel.map((m) => (
            <li key={`${m.provider}:${m.model}`}>
              <code className="font-mono text-fg">{m.model}</code>: {tokens(m.calls)} call{m.calls === 1 ? "" : "s"}, {tokens(m.inputTokens)} in, {tokens(m.outputTokens)} out
              {m.unpricedCalls === m.calls ? ", cost unknown" : `, ${formatUsd(m.costUsd)}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
