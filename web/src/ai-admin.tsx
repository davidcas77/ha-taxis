import { useEffect, useState } from "react";
import { ASSISTANT_ACTIONS, type AssistantAdminResponse } from "../../shared/assistant.ts";
import { TIER_LABEL } from "../../shared/ai.ts";
import type { Route } from "./state.tsx";
import { Button } from "./ui.tsx";
import { api } from "./api.ts";

export function AiAdminPage({ go }: { go: (r: Route) => void }) {
  const [data, setData] = useState<Extract<AssistantAdminResponse, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let stale = false;
    void api.assistantAdmin().then(r => { if (stale) return; if (r.ok) { setData(r); setError(null); } else setError(r.error); });
    return () => { stale = true; };
  }, [version]);
  return <main className="min-h-0 flex-1 overflow-y-auto p-4 pb-24 md:p-6">
    <div className="flex flex-wrap items-center gap-3"><h1 className="text-xl font-semibold">AI administration</h1><Button onClick={() => go({ page: "settings" })}>Configure models and keys</Button><Button onClick={() => setVersion(v => v+1)}>Refresh AI overview</Button></div>
    <p className="mt-3 max-w-3xl text-sm text-muted">See where AI works, who triggers it and what it receives. Open the sparkle button on any page to ask Taxis. No AI function runs automatically in the background or writes to Home Assistant.</p>
    {error && <p role="alert" className="mt-3 text-danger">{error}</p>}
    {!data ? <p className="mt-4 text-muted">Reading AI status…</p> : <>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-surface p-4"><h2 className="font-semibold">Generative AI · {data.ai.enabled ? "Enabled" : "Off"}</h2><p className="mt-2 text-sm text-muted">Provider: {data.ai.provider}. Configuration does not prove connectivity; use the model tests in Settings.</p>
          <p className="mt-2 text-sm">{data.usage.calls} calls this UTC month · estimated ${data.usage.spentUsd.toFixed(4)} / ${data.usage.capUsd} cap</p>
          {!!data.usage.unpricedCalls && <p className="mt-1 text-sm text-warn">{data.usage.unpricedCalls} calls have no known price and are not counted toward the dollar cap.</p>}
        </section>
        <section className="rounded-lg border border-line bg-surface p-4"><h2 className="font-semibold">Jev decisions · {data.jev.enabled ? data.jev.keySet ? "Configured" : "Key missing" : "Off"}</h2><p className="mt-2 text-sm text-muted">Separate from the three AI tiers: {data.jev.model}. Used only by its connection test and the Guide's room-note review button.</p><p className="mt-2 text-sm">{data.jevUsage.attempts} / {data.jevUsage.limit} monthly requests · {data.jevUsage.completed} completed · estimated ${data.jevUsage.estimatedUsd.toFixed(6)}</p></section>
      </div>
      <h2 className="mt-6 font-semibold">Connected functions</h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-line"><table aria-label="AI functions" className="w-full text-left text-sm"><thead className="bg-surface text-muted"><tr>{["Function", "Engine / status", "Trigger", "Data sent", "Authority"].map(t => <th key={t} className="p-3">{t}</th>)}</tr></thead><tbody>
        {Object.entries(ASSISTANT_ACTIONS).map(([key, a]) => <tr key={key} className="border-t border-line"><td className="p-3 font-medium">{a.label}</td><td className="p-3">{TIER_LABEL[a.tier]} · {data.ai.models[a.tier] || "Model missing"}<p className="text-xs text-muted">{data.ai.enabled ? "On demand" : "Off"}</p></td><td className="p-3">You send a question in Ask Taxis</td><td className="p-3">Reviewed page context, question, up to six recent messages</td><td className="p-3">Text advice only</td></tr>)}
        <tr className="border-t border-line"><td className="p-3 font-medium">Room-note review</td><td className="p-3">Jev · {data.jev.enabled && data.jev.keySet ? "On demand" : "Needs setup"}</td><td className="p-3">Guide → room test → Review notes with Jev</td><td className="p-3">Typed notes and public checklist criteria</td><td className="p-3">Working / problem / not established; no saved observation or readiness change</td></tr>
        <tr className="border-t border-line"><td className="p-3 font-medium">Connection tests</td><td className="p-3">Selected tier or Jev</td><td className="p-3">Test button in Settings</td><td className="p-3">Tiny public test prompt</td><td className="p-3">Connection check only; counts toward usage</td></tr>
      </tbody></table></div>
      <section className="mt-5 rounded-lg border border-line p-4 text-sm"><h2 className="font-semibold">Access and limitations</h2><p className="mt-2 text-muted">Taxis can read HA and apply your reviewed changes. AI receives no HA token or tools. Page data is off by default; you can include one selected area's entity names/IDs, roles, availability flags, capability counts, helper plans and guide equipment assessment. House context contains counts only. State values, attributes, YAML, credentials and saved test notes are omitted.</p><p className="mt-2 text-muted">Readiness, capability counting, helper planning and Health scans remain rule based. Ask Taxis explains supplied evidence; it does not run the Health scan, verify automations or consult Jev. No automatic background analysis or automatic execution is connected.</p></section>
      <h2 className="mt-6 font-semibold">Recent assistant requests</h2><p className="mt-1 text-xs text-muted">Latest 30 requests; at most 200 metadata records retained. Questions, replies and room identities are not saved here. Jev totals are shown above; its decisions appear in the room-test panel.</p>
      {data.activity.length ? <div className="mt-3 overflow-x-auto"><table aria-label="Assistant request history" className="w-full text-left text-sm"><thead className="text-muted"><tr>{["Time", "Function", "Page / context", "Requested model", "Result"].map(t => <th key={t} className="p-2">{t}</th>)}</tr></thead><tbody>{data.activity.map((r,i) => <tr key={i} className="border-t border-line"><td className="p-2 whitespace-nowrap">{new Date(r.at).toLocaleString()}</td><td className="p-2">{ASSISTANT_ACTIONS[r.action]?.label ?? r.action}</td><td className="p-2">{r.page} · {r.scope}</td><td className="p-2 break-all">{TIER_LABEL[r.tier]} · {r.model}</td><td className="p-2">{r.status}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-sm text-muted">No assistant requests yet. Opening the panel and previewing context do not call a provider.</p>}
    </>}
  </main>;
}
