import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { ASSISTANT_ACTIONS, type AssistantAction, type AssistantPreview, type AssistantMessage, type AssistantAnswer, type AssistantScope } from "../../shared/assistant.ts";
import type { AiSettingsView } from "../../shared/ai.ts";
import { TIER_LABEL } from "../../shared/ai.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { api } from "./api.ts";
import type { Route } from "./state.tsx";
import { Button, inputClass } from "./ui.tsx";

export function routeScope(route: Route, h: Hierarchy | null): AssistantScope {
  let areaId: string | null = null;
  if (route.page === "areas" && route.sel.kind === "area") areaId = route.sel.id;
  if (route.page === "guide") areaId = route.areaId;
  if (route.page === "organize" && route.id) {
    if (route.type === "entities") areaId = h?.entities[route.id]?.areaId ?? null;
    if (route.type === "devices") areaId = h?.devices[route.id]?.areaId ?? null;
    if (route.type === "spaces" && route.id.startsWith("area:")) areaId = route.id.slice(5);
  }
  return { page: route.page, section: "tab" in route ? route.tab : route.page === "organize" ? route.type : "", areaId, includeData: false };
}

export function AskTaxis({ route, h, open, setOpen, go }: { route: Route; h: Hierarchy | null; open: boolean; setOpen: (v: boolean) => void; go: (r: Route) => void }) {
  const launcher = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) close.current?.focus();
    else if (wasOpen.current) launcher.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const scope = routeScope(route, h);
  return <>
    {!open && <button ref={launcher} type="button" aria-label="Ask Taxis" title="Ask Taxis" onClick={() => setOpen(true)} className="fixed right-5 bottom-5 z-40 flex size-12 items-center justify-center rounded-full border border-line bg-accent text-[var(--on-accent)] shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"><Sparkles className="size-6" aria-hidden /></button>}
    <aside hidden={!open} role="dialog" aria-label="Ask Taxis assistant" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }} className="fixed inset-y-0 right-0 z-40 w-full border-l border-line bg-bg shadow-xl md:w-[420px]">
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-2 border-b border-line bg-surface p-3">
          <Sparkles className="size-5 text-accent" aria-hidden /><h2 className="font-semibold">Ask Taxis</h2>
          <Button className="ml-auto" onClick={() => go({ page: "ai-admin" })}>AI administration</Button>
          <Button ref={close} aria-label="Close assistant" onClick={() => setOpen(false)}><X className="size-4" aria-hidden /></Button>
        </header>
        {open && <AssistantSession key={JSON.stringify(scope)} initialScope={scope} h={h} go={go} />}
      </div>
    </aside>
  </>;
}

function AssistantSession({ initialScope, h, go }: { initialScope: AssistantScope; h: Hierarchy | null; go: (r: Route) => void }) {
  const [scope, setScope] = useState(initialScope);
  const [preview, setPreview] = useState<AssistantPreview | null>(null);
  const [ai, setAi] = useState<AiSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<AssistantAction>("explain");
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<AssistantMessage[]>([]);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const mounted = useRef(true);
  const signature = JSON.stringify(scope);
  const current = useRef(signature);
  current.current = signature;
  const last = useRef<HTMLDivElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let stale = false;
    setLoading(true); setPreview(null); setReviewed(false); setError(null);
    void Promise.all([api.assistantContext(scope), api.ai()]).then(([context, config]) => {
      if (stale) return;
      if (context.ok) setPreview(context.preview); else setError(context.error);
      if (config.ok) setAi(config.ai); else setError(config.error);
      setLoading(false);
    });
    return () => { stale = true; };
  }, [signature, refresh]);
  useEffect(() => { last.current?.scrollIntoView({ block: "nearest" }); }, [history, busy]);
  const changeScope = (s: AssistantScope) => { setScope(s); setPreview(null); setReviewed(false); setHistory([]); setAnswer(null); };
  const canSend = !!preview && reviewed && ai?.enabled && !!ai.models[ASSISTANT_ACTIONS[action].tier] && !busy && !loading && !!question.trim();
  return <div className="min-h-0 flex-1 overflow-y-auto p-4 text-[13px]">
    <p className="text-muted">Ask for explanations or advice. Replies cannot queue changes, apply them or control devices. Opening this panel sends nothing to an AI provider.</p>
    <div className="mt-4 flex flex-col gap-3 rounded-lg border border-line p-3">
      <p className="font-medium">Context · {scope.page}{scope.section && ` / ${scope.section}`}</p>
      <label className="flex items-center gap-2"><input type="checkbox" checked={scope.includeData} disabled={busy} onChange={e => changeScope({ ...scope, includeData: e.target.checked })} />Include page data</label>
      <label>Area for this question<select aria-label="Assistant area" className={`${inputClass} mt-1`} value={scope.areaId ?? ""} disabled={busy} onChange={e => changeScope({ ...scope, areaId: e.target.value || null })}>
        <option value="">House counts only</option>{Object.values(h?.areas ?? {}).sort((a,b) => a.name.localeCompare(b.name)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select></label>
      <p className="text-xs text-muted">Page data is off by default. For room advice, select an area and enable it. Changing page or context clears this conversation.</p>
      {loading && <p role="status">Preparing context…</p>}
      {preview && <>
        <details><summary className="cursor-pointer text-accent">Review exactly what will be sent · {preview.title}</summary>
          <pre aria-label="Assistant context preview" className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-surface p-2 text-[11px]">{preview.content}</pre>
          <ul className="mt-2 list-disc pl-4 text-xs text-muted">{preview.omissions.map(o => <li key={o}>{o}</li>)}</ul>
        </details>
        <label className="flex items-start gap-2 text-xs"><input className="mt-0.5" type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />Send this context, my question and up to six recent messages to the configured AI provider.</label>
      </>}
      <Button disabled={busy || loading} onClick={() => setRefresh(v => v+1)}>Refresh context and AI status</Button>
    </div>
    {ai && !ai.enabled && <p className="mt-3 text-warn">AI is off. Enable it and configure your models in Settings.</p>}
    <div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => go({ page: "settings" })}>AI settings</Button><Button disabled={busy} onClick={() => { setHistory([]); setAnswer(null); setQuestion(""); setError(null); }}>Clear chat</Button></div>
    <div className="mt-4 flex flex-wrap gap-2" aria-label="Assistant actions">{(Object.keys(ASSISTANT_ACTIONS) as AssistantAction[]).map(key => <Button key={key} disabled={busy} aria-pressed={action === key} tone={action === key ? "primary" : "plain"} onClick={() => { setAction(key); setQuestion(ASSISTANT_ACTIONS[key].prompt); }}>{ASSISTANT_ACTIONS[key].label}</Button>)}</div>
    <p className="mt-2 text-xs text-muted">{ai?.provider ?? "Provider not loaded"} · {TIER_LABEL[ASSISTANT_ACTIONS[action].tier]} tier · {ai?.models[ASSISTANT_ACTIONS[action].tier] || "No model configured"}</p>
    <div role="log" aria-label="Assistant conversation" aria-live="polite" className="mt-4 flex flex-col gap-3">
      {history.map((m,i) => <div key={i} className={`rounded-lg border border-line p-3 ${m.role === "user" ? "bg-surface" : "bg-accent-soft"}`}><p className="mb-1 text-xs font-semibold">{m.role === "user" ? "You" : "Taxis · AI advice"}</p><p className="whitespace-pre-wrap break-words">{m.content}</p></div>)}
      {busy && <p role="status">Thinking…</p>}<div ref={last} />
    </div>
    {answer && <p className="mt-2 text-xs text-muted">{TIER_LABEL[answer.tier]} · {answer.model} · {answer.inputTokens} in / {answer.outputTokens} out tokens · {answer.costUsd === null ? "Cost unknown; not counted toward the dollar cap" : `estimated $${answer.costUsd.toFixed(5)}`}{answer.truncated && " · Reply is incomplete because the output limit was reached."}</p>}
    <form className="mt-4 flex flex-col gap-2" onSubmit={async e => {
      e.preventDefault(); if (!canSend || !preview || busy) return;
      const submitted = signature; const text = question.trim(); setBusy(true); setError(null);
      try {
        const r = await api.assistantAsk({ ...scope, action, question: text, fingerprint: preview.fingerprint, history: history.slice(-6).map(m => ({ ...m, content: m.content.slice(0,2000) })) });
        if (!mounted.current || current.current !== submitted) return;
        if (r.ok) { setHistory(v => [...v, { role: "user", content: text }, { role: "assistant", content: r.answer.text }]); setAnswer(r.answer); setQuestion(""); }
        else { setError(r.error); setReviewed(false); }
      } finally { if (mounted.current) setBusy(false); }
    }}>
      <label htmlFor="assistant-question" className="font-medium">Your question</label>
      <textarea id="assistant-question" value={question} maxLength={2000} rows={3} disabled={busy} onChange={e => setQuestion(e.target.value)} className={inputClass} placeholder="What would you like help with?" />
      {error && <p role="alert" className="text-danger">{error}</p>}
      <Button type="submit" tone="primary" disabled={!canSend}>Ask Taxis</Button>
      <p className="text-xs text-muted">Questions and replies stay only in this open panel; closing it or reloading clears them. Follow-ups include at most six messages, shortened to 2,000 characters each. Closing does not cancel a submitted provider request. Request metadata and usage are retained.</p>
    </form>
  </div>;
}
