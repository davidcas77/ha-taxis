import { AlertTriangle, ChevronDown, ChevronRight, HeartPulse, Info, Loader2, OctagonAlert, RefreshCw } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  DEFAULT_HEALTH_OPTIONS,
  HEALTH_CHECKS,
  HEALTH_CHECK_LABEL,
  HEALTH_LIMITS,
  SEVERITIES,
  SEVERITY_LABEL,
  type HealthCheck,
  type HealthFinding,
  type HealthOptions,
  type HealthReport,
  type HealthTarget,
  type Severity,
} from "../../shared/health.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { api } from "./api.ts";
import { useTaxis, type Route } from "./state.tsx";
import { SortHeader, useSort } from "./table.tsx";
import { Button, inputClass } from "./ui.tsx";

// Health: the rule-based checks (shared/health.ts) over the home. One report,
// kept by the provider and shared by the Health page and the Health tab of each
// area. It reads again when the change list or the home changes. Nothing here
// writes: a finding's fix is a link, or changes the user adds to the list.

type HealthContext = {
  report: HealthReport | null;
  loading: boolean;
  error: string | null;
  options: HealthOptions;
  setOptions: (o: HealthOptions) => void;
  refresh: () => Promise<void>;
  want: () => void;
};

const Ctx = createContext<HealthContext | null>(null);

export function HealthProvider({ children }: { children: ReactNode }) {
  const { version, hierarchy } = useTaxis();
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<HealthOptions>(DEFAULT_HEALTH_OPTIONS);
  // Nothing is read until a page that shows the report is open.
  const [wanted, setWanted] = useState(false);
  const latest = useRef(0);

  const load = useCallback(
    async (refresh: boolean) => {
      const n = ++latest.current;
      setLoading(true);
      const r = await api.healthReport(refresh, options);
      // A newer request has gone out: its answer is the one to show.
      if (n !== latest.current) return;
      if (r.ok) {
        setReport(r.report);
        setError(null);
      } else setError(r.error);
      setLoading(false);
    },
    [options],
  );

  const fetchedAt = hierarchy?.fetchedAt ?? "";
  useEffect(() => {
    if (wanted && fetchedAt) void load(false);
  }, [wanted, fetchedAt, version, load]);

  const want = useCallback(() => setWanted(true), []);
  const refresh = useCallback(() => load(true), [load]);
  const value = useMemo(() => ({ report, loading, error, options, setOptions, refresh, want }), [report, loading, error, options, refresh, want]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHealth(): HealthContext {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHealth outside HealthProvider");
  const { want } = v;
  useEffect(() => want(), [want]);
  return v;
}

// The count for the navigation bar, once a report has been read.
export function useHealthCounts(): { error: number; warning: number } | null {
  const v = useContext(Ctx);
  return v?.report ? { error: v.report.counts.error, warning: v.report.counts.warning } : null;
}

// ---------------------------------------------------------------------------
// Where a finding leads.
// ---------------------------------------------------------------------------

export function targetRoute(t: HealthTarget): Route {
  switch (t.page) {
    case "area":
      return { page: "areas", sel: { kind: "area", id: t.areaId }, tab: t.tab };
    case "parameters":
      return { page: "parameters", tab: t.tab };
    case "settings":
      return { page: "settings" };
  }
}

// An entity's place in Taxis: its area's Entities tab, or the Entities page for
// one that sits in no area.
function entityRoute(h: Hierarchy, id: string): Route | null {
  const e = h.entities[id];
  if (!e) return null;
  return e.areaId ? { page: "areas", sel: { kind: "area", id: e.areaId }, tab: "entities" } : { page: "entities" };
}

const TONE: Record<Severity, string> = { error: "text-danger", warning: "text-warn", info: "text-muted" };
const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const ICON = { error: OctagonAlert, warning: AlertTriangle, info: Info } as const;

export function SeverityBadge({ severity }: { severity: Severity }) {
  const Icon = ICON[severity];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${TONE[severity]}`}>
      <Icon className="size-3.5" aria-hidden />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The table of findings, used by the page and by an area's Health tab.
// ---------------------------------------------------------------------------

function subjectOf(f: HealthFinding): string {
  if (f.item) return f.item.name;
  return f.entity ?? "";
}

export function FindingsTable({ h, findings, go, showArea = true }: { h: Hierarchy; findings: HealthFinding[]; go: (r: Route) => void; showArea?: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const columns = useMemo(
    () => ({
      severity: (f: HealthFinding) => RANK[f.severity],
      check: (f: HealthFinding) => HEALTH_CHECK_LABEL[f.check],
      area: (f: HealthFinding) => (f.area ? h.areas[f.area]?.name ?? f.area : null),
      title: (f: HealthFinding) => f.title,
      subject: (f: HealthFinding) => subjectOf(f),
    }),
    [h],
  );
  const { rows, sort, toggle } = useSort(findings, columns, { key: "severity", dir: "asc" });
  const flip = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  if (rows.length === 0) return <p className="text-[13px] text-muted">Nothing here.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-[13px]">
        <thead className="bg-sunken text-left text-xs text-muted">
          <tr>
            <SortHeader label="Severity" k="severity" sort={sort} onToggle={toggle} />
            <SortHeader label="Check" k="check" sort={sort} onToggle={toggle} />
            {showArea && <SortHeader label="Area" k="area" sort={sort} onToggle={toggle} />}
            <SortHeader label="What" k="title" sort={sort} onToggle={toggle} />
            <SortHeader label="Subject" k="subject" sort={sort} onToggle={toggle} />
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const expanded = open.has(f.id);
            return (
              <FindingRows key={f.id} h={h} f={f} expanded={expanded} onToggle={() => flip(f.id)} go={go} showArea={showArea} />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FindingRows({ h, f, expanded, onToggle, go, showArea }: { h: Hierarchy; f: HealthFinding; expanded: boolean; onToggle: () => void; go: (r: Route) => void; showArea: boolean }) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const area = f.area ? h.areas[f.area] : undefined;
  const columns = showArea ? 5 : 4;
  return (
    <>
      <tr className="border-t border-line align-top">
        <td className="whitespace-nowrap px-3 py-1.5">
          <SeverityBadge severity={f.severity} />
        </td>
        <td className="px-3 py-1.5 text-muted">{HEALTH_CHECK_LABEL[f.check]}</td>
        {showArea && (
          <td className="px-3 py-1.5">
            {area ? (
              <button type="button" className="text-accent hover:underline" onClick={() => go({ page: "areas", sel: { kind: "area", id: area.id }, tab: "overview" })}>
                {area.name}
              </button>
            ) : (
              <span className="text-muted">–</span>
            )}
          </td>
        )}
        <td className="px-3 py-1.5">
          <button type="button" aria-expanded={expanded} onClick={onToggle} className="flex items-start gap-1 text-left hover:text-accent">
            <Chevron className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{f.title}</span>
          </button>
        </td>
        <td className="px-3 py-1.5 text-xs text-muted">{f.item ? f.item.name : f.entity ? <code className="font-mono">{f.entity}</code> : null}</td>
      </tr>
      {expanded && (
        <tr className="bg-sunken/50">
          <td />
          <td colSpan={columns - 1} className="px-3 pb-3 pt-1">
            <FindingDetail h={h} f={f} go={go} />
          </td>
        </tr>
      )}
    </>
  );
}

function FindingDetail({ h, f, go }: { h: Hierarchy; f: HealthFinding; go: (r: Route) => void }) {
  const { propose, busy } = useTaxis();
  const entities = f.entities ?? (f.entity ? [f.entity] : []);
  const fix = f.fix;
  return (
    <div className="flex max-w-[80ch] flex-col gap-2">
      <p>{f.detail}</p>
      {f.item && (
        <p className="text-xs text-muted">
          {f.item.kind[0].toUpperCase() + f.item.kind.slice(1)} “{f.item.name}”{f.item.entityId && <code className="ml-1 font-mono">{f.item.entityId}</code>}. Edit it in Home Assistant.
        </p>
      )}
      {entities.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs">
          {entities.slice(0, 12).map((id) => {
            const route = entityRoute(h, id);
            return (
              <li key={id} className="flex flex-wrap items-center gap-x-2">
                <code className="font-mono">{id}</code>
                {h.entities[id] ? <span className="text-muted">{h.entities[id].name}</span> : <span className="text-danger">not in Home Assistant</span>}
                {route && (
                  <button type="button" className="text-accent hover:underline" onClick={() => go(route)}>
                    Open
                  </button>
                )}
              </li>
            );
          })}
          {entities.length > 12 && <li className="text-muted">and {entities.length - 12} more</li>}
        </ul>
      )}
      {fix && (
        <div className="flex flex-wrap items-center gap-2">
          {fix.kind === "changes" ? (
            <>
              <Button tone="primary" disabled={busy} onClick={() => void propose(fix.inputs)}>
                {fix.label}
              </Button>
              <span className="text-xs text-muted">Adds to the list of changes; nothing is written until you apply it.</span>
            </>
          ) : (
            <Button onClick={() => go(targetRoute(fix.to))}>{fix.label}</Button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page.
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

const NOTE =
  "Rule-based checks over what Taxis reads from Home Assistant: no AI, and nothing here changes anything. Some findings offer a fix, which only adds changes to the list for you to review and apply.";

export function HealthPage({ h, go }: { h: Hierarchy; go: (r: Route) => void }) {
  const { report, loading, error, options, setOptions, refresh } = useHealth();
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [check, setCheck] = useState<HealthCheck | "all">("all");
  const [area, setArea] = useState<string>("all");
  const [query, setQuery] = useState("");

  const findings = report?.findings ?? [];
  const areaIds = useMemo(() => [...new Set(findings.map((f) => f.area).filter((a): a is string => Boolean(a)))].sort((a, b) => (h.areas[a]?.name ?? a).localeCompare(h.areas[b]?.name ?? b)), [findings, h]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return findings.filter(
      (f) =>
        (severity === "all" || f.severity === severity) &&
        (check === "all" || f.check === check) &&
        (area === "all" || (area === "none" ? !f.area : f.area === area)) &&
        (!q || `${f.title} ${f.detail} ${f.entity ?? ""} ${f.item?.name ?? ""}`.toLowerCase().includes(q)),
    );
  }, [findings, severity, check, area, query]);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <HeartPulse className="size-5 text-accent" aria-hidden /> Health
          </h1>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted">
            {report && <span>Checked {timeAgo(report.generatedAt)}</span>}
            <Button onClick={() => void refresh()} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
              Check again
            </Button>
          </div>
        </div>
        <p className="max-w-[72ch] text-[13px] text-muted">{NOTE}</p>

        {error && (
          <p role="alert" className="text-[13px] text-danger">
            Taxis couldn't run the checks. {error}
          </p>
        )}

        {!report ? (
          !error && <p className="text-[13px] text-muted">Running the checks…</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2.5">
              {SEVERITIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={severity === s}
                  onClick={() => setSeverity(severity === s ? "all" : s)}
                  className={`flex flex-col items-start gap-0.5 rounded-lg border bg-surface px-3 py-2 text-left ${severity === s ? "border-accent" : "border-line hover:border-accent/50"}`}
                >
                  <span className={`text-2xl font-semibold tabular-nums ${report.counts[s] > 0 ? TONE[s] : "text-muted"}`}>{report.counts[s]}</span>
                  <SeverityBadge severity={s} />
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="health-check" className="text-xs font-medium text-muted">
                  Check
                </label>
                <select id="health-check" className={`${inputClass} w-56`} value={check} onChange={(e) => setCheck(e.target.value as HealthCheck | "all")}>
                  <option value="all">All checks · {report.findings.length}</option>
                  {HEALTH_CHECKS.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label} · {report.byCheck[c.key]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="health-area" className="text-xs font-medium text-muted">
                  Area
                </label>
                <select id="health-area" className={`${inputClass} w-48`} value={area} onChange={(e) => setArea(e.target.value)}>
                  <option value="all">All areas</option>
                  <option value="none">Not in an area</option>
                  {areaIds.map((id) => (
                    <option key={id} value={id}>
                      {h.areas[id]?.name ?? id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="health-search" className="text-xs font-medium text-muted">
                  Search
                </label>
                <input id="health-search" className={`${inputClass} w-48`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or entity id" />
              </div>
              <Thresholds options={options} onChange={setOptions} />
            </div>

            <p className="text-xs text-muted">
              {shown.length} of {findings.length} finding{findings.length === 1 ? "" : "s"}. Looked at {report.checked.entities.toLocaleString()} entities, {report.checked.automations} automations, {report.checked.scripts} scripts, {report.checked.scenes} scenes and {report.checked.dashboards} dashboards.
            </p>

            {findings.length === 0 ? <p className="text-[13px] text-muted">Nothing to look at: no check found anything.</p> : <FindingsTable h={h} findings={shown} go={go} />}

            {report.notes.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs text-muted">
                {report.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </main>
  );
}

// The two thresholds, applied when the box is left or Enter is pressed.
function Thresholds({ options, onChange }: { options: HealthOptions; onChange: (o: HealthOptions) => void }) {
  return (
    <div className="flex items-end gap-3">
      <Threshold id="health-hours" label="Not reporting after (hours)" k="unavailableHours" options={options} onChange={onChange} />
      <Threshold id="health-days" label="No run for (days)" k="staleDays" options={options} onChange={onChange} />
    </div>
  );
}

function Threshold({ id, label, k, options, onChange }: { id: string; label: string; k: keyof HealthOptions; options: HealthOptions; onChange: (o: HealthOptions) => void }) {
  const [draft, setDraft] = useState(String(options[k]));
  useEffect(() => setDraft(String(options[k])), [options, k]);
  const { min, max } = HEALTH_LIMITS[k];
  const commit = () => {
    const n = Math.round(Number(draft));
    const next = Number.isFinite(n) && draft.trim() !== "" ? Math.min(max, Math.max(min, n)) : options[k];
    setDraft(String(next));
    if (next !== options[k]) onChange({ ...options, [k]: next });
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        className={`${inputClass} w-28`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// An area's Health tab: the findings about this area.
// ---------------------------------------------------------------------------

export function useAreaFindings(areaId: string): { findings: HealthFinding[]; ready: boolean; error: string | null } {
  const { report, error } = useHealth();
  const findings = useMemo(() => (report ? report.findings.filter((f) => f.area === areaId) : []), [report, areaId]);
  return { findings, ready: report !== null, error };
}

export function AreaFindings({ h, areaId, go }: { h: Hierarchy; areaId: string; go: (r: Route) => void }) {
  const { findings, ready, error } = useAreaFindings(areaId);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">
        Checks{ready ? ` · ${findings.length}` : ""}
      </h2>
      {error && !ready ? (
        <p role="alert" className="text-[13px] text-danger">
          Taxis couldn't run the checks. {error}
        </p>
      ) : !ready ? (
        <p className="text-[13px] text-muted">Running the checks…</p>
      ) : findings.length === 0 ? (
        <p className="text-[13px] text-muted">No check found anything about this area.</p>
      ) : (
        <FindingsTable h={h} findings={findings} go={go} showArea={false} />
      )}
    </section>
  );
}
