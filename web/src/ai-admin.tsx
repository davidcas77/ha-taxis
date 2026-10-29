import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { ASSISTANT_ACTIONS, type AssistantAdminResponse } from "../../shared/assistant.ts";
import { TIER_LABEL } from "../../shared/ai.ts";
import { DataTable, type Column } from "./data-table.tsx";
import { Badge, Button, Card, EmptyState, Section } from "./ui.tsx";
import { api } from "./api.ts";

type Admin = Extract<AssistantAdminResponse, { ok: true }>;

type FunctionRow = { key: string; name: string; engine: ReactNode; engineText: string; trigger: string; data: string; authority: string };
type ActivityRow = Admin["activity"][number] & { key: string };

// The AI tab of Settings, overview part: where AI works, who triggers it and
// what it receives. The models and keys are set in the sections under it.
export function AiAdminPanel() {
  const [data, setData] = useState<Admin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let stale = false;
    void api.assistantAdmin().then((r) => {
      if (stale) return;
      if (r.ok) {
        setData(r);
        setError(null);
      } else setError(r.error);
    });
    return () => {
      stale = true;
    };
  }, [version]);

  const functions = useMemo<FunctionRow[]>(() => {
    if (!data) return [];
    const missing = (model: string | undefined) => model || "Model missing";
    return [
      ...Object.entries(ASSISTANT_ACTIONS).map(([key, a]) => {
        const status = data.ai.enabled ? "On demand" : "Off";
        return {
          key,
          name: a.label,
          engineText: `${TIER_LABEL[a.tier]} · ${missing(data.ai.models[a.tier])} · ${status}`,
          engine: (
            <>
              {TIER_LABEL[a.tier]} · {missing(data.ai.models[a.tier])}
              <p className="text-xs text-muted">{status}</p>
            </>
          ),
          trigger: "You send a question in Ask Taxis",
          data: "Reviewed page context, question, up to six recent messages",
          authority: "Text advice only",
        };
      }),
      {
        key: "jev-notes",
        name: "Room-note review",
        engine: `Jev · ${data.jev.enabled && data.jev.keySet ? "On demand" : "Needs setup"}`,
        engineText: `Jev · ${data.jev.enabled && data.jev.keySet ? "On demand" : "Needs setup"}`,
        trigger: "Guide → room test → Review notes with Jev",
        data: "Typed notes and public checklist criteria",
        authority: "Working / problem / not established; no saved observation or readiness change",
      },
      {
        key: "tests",
        name: "Connection tests",
        engine: "Selected tier or Jev",
        engineText: "Selected tier or Jev",
        trigger: "Test button in Settings",
        data: "Tiny public test prompt",
        authority: "Connection check only; counts toward usage",
      },
      {
        key: "buttons-review",
        name: "Button mapping review",
        engine: `Medium · ${missing(data.ai.models.medium)}`,
        engineText: `Medium · ${missing(data.ai.models.medium)}`,
        trigger: "Automations → Buttons → prepare preview → send review",
        data: "Selected control, supported gestures, matched automation names and service/target summaries, coverage gaps",
        authority: "Explanation only; cannot add or apply mappings",
      },
    ];
  }, [data]);

  const functionColumns: Column<FunctionRow>[] = [
    {
      id: "name",
      header: "Function",
      priority: 1,
      minWidth: 140,
      sort: (r) => r.name,
      cell: (r) => <span className="font-medium">{r.name}</span>,
      text: (r) => r.name,
    },
    { id: "engine", header: "Engine / status", priority: 1, minWidth: 180, cell: (r) => r.engine, text: (r) => r.engineText },
    { id: "trigger", header: "Trigger", priority: 2, minWidth: 160, cell: (r) => r.trigger },
    { id: "data", header: "Data sent", priority: 3, minWidth: 200, cell: (r) => r.data },
    { id: "authority", header: "Authority", priority: 2, minWidth: 180, cell: (r) => r.authority },
  ];

  const activity = useMemo<ActivityRow[]>(() => (data ? data.activity.map((r, i) => ({ ...r, key: `${r.at}:${i}` })) : []), [data]);
  const activityColumns: Column<ActivityRow>[] = [
    { id: "at", header: "Time", priority: 1, nowrap: true, minWidth: 150, sort: (r) => new Date(r.at).getTime(), cell: (r) => new Date(r.at).toLocaleString() },
    { id: "action", header: "Function", priority: 1, minWidth: 130, cell: (r) => ASSISTANT_ACTIONS[r.action]?.label ?? r.action },
    { id: "context", header: "Page / context", priority: 2, minWidth: 130, cell: (r) => `${r.page} · ${r.scope}`, text: (r) => `${r.page} · ${r.scope}` },
    {
      id: "model",
      header: "Requested model",
      priority: 3,
      minWidth: 160,
      maxWidth: 260,
      truncate: true,
      cell: (r) => `${TIER_LABEL[r.tier]} · ${r.model}`,
      text: (r) => `${TIER_LABEL[r.tier]} · ${r.model}`,
    },
    { id: "status", header: "Result", priority: 1, minWidth: 90, cell: (r) => r.status },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="AI administration"
        description="See where AI works, who triggers it and what it receives. Open the sparkle button on any page to ask Taxis. No AI function runs automatically in the background or writes to Home Assistant."
        actions={
          <Button onClick={() => setVersion((v) => v + 1)}>
            <RefreshCw className="size-4" aria-hidden />
            Refresh AI overview
          </Button>
        }
      >
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        {!data ? (
          !error && <p className="text-[13px] text-muted">Reading AI status…</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="flex flex-wrap items-center gap-2 font-semibold">
                Generative AI <Badge tone={data.ai.enabled ? "ok" : "muted"}>{data.ai.enabled ? "Enabled" : "Off"}</Badge>
              </h3>
              <p className="mt-2 text-[13px] text-muted">Provider: {data.ai.provider}. Configuration does not prove connectivity; use the model tests below.</p>
              <p className="mt-2 text-[13px]">
                {data.usage.calls} calls this UTC month · estimated ${data.usage.spentUsd.toFixed(4)} / ${data.usage.capUsd} cap
              </p>
              {!!data.usage.unpricedCalls && (
                <p className="mt-1 text-[13px] text-warn">{data.usage.unpricedCalls} calls have no known price and are not counted toward the dollar cap.</p>
              )}
            </Card>
            <Card>
              <h3 className="flex flex-wrap items-center gap-2 font-semibold">
                Jev decisions{" "}
                <Badge tone={data.jev.enabled ? (data.jev.keySet ? "ok" : "warn") : "muted"}>
                  {data.jev.enabled ? (data.jev.keySet ? "Configured" : "Key missing") : "Off"}
                </Badge>
              </h3>
              <p className="mt-2 text-[13px] text-muted">
                Separate from the three AI tiers: {data.jev.model}. Used only by its connection test and the Guide's room-note review button.
              </p>
              <p className="mt-2 text-[13px]">
                {data.jevUsage.attempts} / {data.jevUsage.limit} monthly requests · {data.jevUsage.completed} completed · estimated $
                {data.jevUsage.estimatedUsd.toFixed(6)}
              </p>
            </Card>
          </div>
        )}
      </Section>

      {data && (
        <>
          <Section title="Connected functions">
            <DataTable id="ai-functions" label="AI functions" rows={functions} rowKey={(r) => r.key} columns={functionColumns} />
          </Section>

          <Card>
            <h3 className="font-semibold">Access and limitations</h3>
            <p className="mt-2 text-[13px] text-muted">
              Taxis can read HA and apply your reviewed changes. AI receives no HA token or tools. Page data is off by default; you can include one selected
              area's entity names/IDs, roles, availability flags, capability counts, helper plans and guide equipment assessment. House context contains counts
              only. State values, attributes, YAML, credentials and saved test notes are omitted.
            </p>
            <p className="mt-2 text-[13px] text-muted">
              Readiness, capability counting, helper planning and Health scans remain rule based. Ask Taxis explains supplied evidence; it does not run the
              Health scan, verify automations or consult Jev. No automatic background analysis or automatic execution is connected.
            </p>
          </Card>

          <Section
            title="Recent assistant requests"
            description="Latest 30 requests; at most 200 metadata records retained. Questions, replies and room identities are not saved here. Jev totals are shown above; its decisions appear in the room-test panel."
          >
            <DataTable
              id="ai-requests"
              label="Assistant request history"
              rows={activity}
              rowKey={(r) => r.key}
              columns={activityColumns}
              empty={<EmptyState>No assistant requests yet. Opening the panel and previewing context do not call a provider.</EmptyState>}
            />
          </Section>
        </>
      )}
    </div>
  );
}
