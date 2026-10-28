import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, ChevronLeft, MoreHorizontal, RefreshCw, Sparkles, X } from "lucide-react";
import {
  ASSISTANT_ACTIONS,
  type AssistantAction,
  type AssistantPreview,
  type AssistantMessage,
  type AssistantAnswer,
  type AssistantScope,
} from "../../shared/assistant.ts";
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

export function AskTaxis({
  route,
  h,
  open,
  setOpen,
  go,
}: {
  route: Route;
  h: Hierarchy | null;
  open: boolean;
  setOpen: (v: boolean) => void;
  go: (r: Route) => void;
}) {
  const launcher = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) close.current?.focus();
    else if (wasOpen.current) launcher.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const scope = routeScope(route, h);
  return (
    <>
      <button
        ref={launcher}
        type="button"
        aria-label={open ? "Hide assistant" : "Ask Taxis"}
        aria-expanded={open}
        aria-controls="assistant-window"
        title="Ask Taxis"
        onClick={() => setOpen(!open)}
        className="fixed right-5 bottom-5 z-40 flex size-12 items-center justify-center rounded-full border border-line bg-accent text-[var(--on-accent)] shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Sparkles className="size-6" aria-hidden />
      </button>
      {open && (
        <aside
          id="assistant-window"
          role="dialog"
          aria-label="Ask Taxis assistant"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className="assistant-window overflow-hidden rounded-2xl border border-line bg-bg shadow-2xl"
        >
          <AssistantSession key={JSON.stringify(scope)} initialScope={scope} h={h} go={go} closeRef={close} onClose={() => setOpen(false)} />
        </aside>
      )}
    </>
  );
}

function AssistantSession({
  initialScope,
  h,
  go,
  closeRef,
  onClose,
}: {
  initialScope: AssistantScope;
  h: Hierarchy | null;
  go: (r: Route) => void;
  closeRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
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
  const [contextOpen, setContextOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const contextButton = useRef<HTMLButtonElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const signature = JSON.stringify(scope);
  const current = useRef(signature);
  current.current = signature;
  const last = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let stale = false;
    setLoading(true);
    setPreview(null);
    setError(null);
    void Promise.all([api.assistantContext(scope), api.ai()]).then(([context, config]) => {
      if (stale) return;
      if (context.ok) setPreview(context.preview);
      else setError(context.error);
      if (config.ok) setAi(config.ai);
      else setError(config.error);
      setLoading(false);
    });
    return () => {
      stale = true;
    };
  }, [signature, refresh]);
  useEffect(() => {
    last.current?.scrollIntoView({ block: "nearest" });
  }, [history, busy]);
  const changeScope = (s: AssistantScope) => {
    setScope(s);
    setPreview(null);
    setHistory([]);
    setAnswer(null);
  };
  const canSend = !!preview && ai?.enabled && !!ai.models[ASSISTANT_ACTIONS[action].tier] && !busy && !loading && !!question.trim();
  const contextLabel = scope.includeData ? (scope.areaId ? (h?.areas[scope.areaId]?.name ?? "Selected area") : "House counts") : "Page help only";
  return (
    <div
      className="relative flex h-full min-h-0 flex-col text-[13px]"
      onKeyDown={(e) => {
        if (e.key === "Escape" && (contextOpen || optionsOpen)) {
          e.stopPropagation();
          (contextOpen ? contextButton : optionsButton).current?.focus();
          setContextOpen(false);
          setOptionsOpen(false);
        }
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2.5">
        <Sparkles className="size-4 text-accent" aria-hidden />
        <h2 className="font-semibold">Ask Taxis</h2>
        <Button
          ref={optionsButton}
          className="ml-auto"
          tone="ghost"
          aria-label="Assistant options"
          aria-expanded={optionsOpen}
          onClick={() => {
            setOptionsOpen(!optionsOpen);
            setContextOpen(false);
          }}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
        <Button ref={closeRef} tone="ghost" aria-label="Close assistant" onClick={onClose}>
          <X className="size-4" aria-hidden />
        </Button>
      </header>
      {optionsOpen && (
        <div
          role="region"
          aria-label="Assistant options"
          className="absolute top-12 right-2 z-10 flex max-h-[calc(100%-60px)] w-64 max-w-[calc(100%-16px)] flex-col gap-1 overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-xl"
        >
          <Button
            tone="ghost"
            onClick={() => {
              setOptionsOpen(false);
              go({ page: "ai-admin" });
            }}
          >
            AI administration
          </Button>
          <Button
            tone="ghost"
            onClick={() => {
              setOptionsOpen(false);
              go({ page: "settings" });
            }}
          >
            AI settings
          </Button>
          <Button
            tone="ghost"
            disabled={busy}
            onClick={() => {
              setHistory([]);
              setAnswer(null);
              setQuestion("");
              setError(null);
              setOptionsOpen(false);
            }}
          >
            Clear chat
          </Button>
          <p className="border-t border-line p-2 text-xs text-muted">
            {ai?.provider ?? "Loading provider"} · {TIER_LABEL[ASSISTANT_ACTIONS[action].tier]} ·{" "}
            {ai?.models[ASSISTANT_ACTIONS[action].tier] || "No model configured"}
          </p>
          {answer && (
            <p className="px-2 text-xs text-muted">
              Last reply: {answer.model} · {answer.inputTokens} in / {answer.outputTokens} out tokens ·{" "}
              {answer.costUsd === null ? "Cost unknown; excluded from the dollar cap" : `estimated $${answer.costUsd.toFixed(5)}`}
            </p>
          )}
          <p className="p-2 text-xs text-muted">
            Advice only. Chat clears on close, page or context change. Follow-ups send up to six messages, shortened to 2,000 characters each. Request metadata
            is retained; closing does not cancel a submitted request.
          </p>
        </div>
      )}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <button
          ref={contextButton}
          type="button"
          aria-label="Assistant context"
          aria-expanded={contextOpen}
          onClick={() => {
            setContextOpen(!contextOpen);
            setOptionsOpen(false);
          }}
          className="flex min-w-0 items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs text-muted hover:text-fg"
        >
          <span className="truncate">{contextLabel}</span>
          <ChevronDown className="size-3 shrink-0" aria-hidden />
        </button>
        <select
          aria-label="Assistant task"
          disabled={busy}
          value={action}
          onChange={(e) => setAction(e.target.value as AssistantAction)}
          className="ml-auto min-w-0 max-w-40 rounded-md bg-transparent py-1 text-xs text-muted"
        >
          {(Object.keys(ASSISTANT_ACTIONS) as AssistantAction[]).map((k) => (
            <option key={k} value={k}>
              {ASSISTANT_ACTIONS[k].label}
            </option>
          ))}
        </select>
      </div>
      {contextOpen ? (
        <section aria-label="Assistant context options" className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mb-3 flex items-center gap-2">
            <Button tone="ghost" onClick={() => setContextOpen(false)}>
              <ChevronLeft className="size-3" aria-hidden />
              Back to chat
            </Button>
            <span className="text-xs text-muted">
              {scope.page}
              {scope.section && ` / ${scope.section}`}
            </span>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={scope.includeData} disabled={busy} onChange={(e) => changeScope({ ...scope, includeData: e.target.checked })} />
            Include page data
          </label>
          <label className="mt-3 block">
            Area for this question
            <select
              aria-label="Assistant area"
              className={`${inputClass} mt-1`}
              value={scope.areaId ?? ""}
              disabled={busy}
              onChange={(e) => changeScope({ ...scope, areaId: e.target.value || null })}
            >
              <option value="">House counts only</option>
              {Object.values(h?.areas ?? {})
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <p className="mt-2 text-xs text-muted">Page data starts off. Enable it for room-specific help. Changing context clears the conversation.</p>
          {preview && (
            <details className="mt-3">
              <summary className="cursor-pointer text-accent">Review exactly what will be sent</summary>
              <pre
                aria-label="Assistant context preview"
                className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-surface p-2 text-[11px]"
              >
                {preview.content}
              </pre>
              <ul className="mt-2 list-disc pl-4 text-xs text-muted">
                {preview.omissions.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </details>
          )}
          <Button className="mt-3" disabled={busy || loading} onClick={() => setRefresh((v) => v + 1)}>
            <RefreshCw className="size-3" aria-hidden />
            Refresh context and AI status
          </Button>
        </section>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!history.length && !busy && (
            <div className="py-4">
              <p className="font-medium">How can I help?</p>
              <p className="mt-1 text-xs text-muted">Ask about your setup or choose a starting point.</p>
              <div className="mt-3 flex flex-wrap gap-2" aria-label="Assistant actions">
                {(Object.keys(ASSISTANT_ACTIONS) as AssistantAction[]).map((k) => (
                  <Button
                    key={k}
                    onClick={() => {
                      setAction(k);
                      setQuestion(ASSISTANT_ACTIONS[k].prompt);
                    }}
                  >
                    {ASSISTANT_ACTIONS[k].label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div role="log" aria-label="Assistant conversation" aria-live="polite" className="flex flex-col gap-3">
            {history.map((m, i) => (
              <div key={i} className={`max-w-[95%] rounded-xl px-3 py-2 ${m.role === "user" ? "ml-auto bg-accent-soft" : "mr-auto bg-surface"}`}>
                <p className="mb-1 text-[11px] font-medium text-muted">{m.role === "user" ? "You" : "Taxis"}</p>
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
              </div>
            ))}
            {busy && (
              <p role="status" className="text-muted">
                Thinking…
              </p>
            )}
            <div ref={last} />
          </div>
          {answer?.truncated && <p className="mt-2 text-xs text-warn">Reply incomplete: the output limit was reached.</p>}
        </div>
      )}
      <form
        className="shrink-0 border-t border-line bg-surface p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canSend || !preview || busy) return;
          const submitted = signature;
          const text = question.trim();
          setBusy(true);
          setError(null);
          setContextOpen(false);
          setOptionsOpen(false);
          try {
            const r = await api.assistantAsk({
              ...scope,
              action,
              question: text,
              fingerprint: preview.fingerprint,
              history: history.slice(-6).map((m) => ({ ...m, content: m.content.slice(0, 2000) })),
            });
            if (!mounted.current || current.current !== submitted) return;
            if (r.ok) {
              setHistory((v) => [...v, { role: "user", content: text }, { role: "assistant", content: r.answer.text }]);
              setAnswer(r.answer);
              setQuestion("");
            } else setError(r.error);
          } finally {
            if (mounted.current) setBusy(false);
          }
        }}
      >
        {ai && !ai.enabled && (
          <p className="mb-2 text-xs text-warn">
            AI is off.{" "}
            <button type="button" className="underline" onClick={() => go({ page: "settings" })}>
              Set up AI
            </button>
          </p>
        )}
        {ai?.enabled && !ai.models[ASSISTANT_ACTIONS[action].tier] && (
          <p className="mb-2 text-xs text-warn">
            Choose a {TIER_LABEL[ASSISTANT_ACTIONS[action].tier]} model in{" "}
            <button type="button" className="underline" onClick={() => go({ page: "settings" })}>
              AI settings
            </button>
            .
          </p>
        )}
        {loading && (
          <p role="status" className="mb-2 text-xs text-muted">
            Preparing context…
          </p>
        )}
        {error && (
          <div className="mb-2 text-xs text-danger">
            <p role="alert">{error}</p>
            <button type="button" disabled={busy || loading} onClick={() => setRefresh((v) => v + 1)} className="mt-1 underline">
              Refresh context
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-xl border border-line bg-bg p-2 focus-within:border-accent">
          <label htmlFor="assistant-question" className="sr-only">
            Your question
          </label>
          <textarea
            id="assistant-question"
            value={question}
            maxLength={2000}
            rows={2}
            disabled={busy}
            onChange={(e) => setQuestion(e.target.value)}
            className="max-h-24 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 outline-none"
            placeholder="Ask something…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button type="submit" aria-label="Send message" title="Send message" tone="primary" disabled={!canSend} className="mb-0.5 size-8 shrink-0 !p-0">
            <ArrowUp className="size-4" aria-hidden />
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted">Send shares your message and selected context with your AI provider.</p>
      </form>
    </div>
  );
}
