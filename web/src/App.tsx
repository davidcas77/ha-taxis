import {
  AlertTriangle,
  CheckCircle2,
  Compass,
  FolderTree,
  GitPullRequestArrow,
  HeartPulse,
  Layers,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AskTaxis } from "./assistant.tsx";
import { AutomationsPage } from "./automations.tsx";
import { ChangesPage } from "./changes.tsx";
import { GuidePage } from "./guide.tsx";
import { HealthPage, HealthProvider, useHealthCounts } from "./health.tsx";
import { OrganizePage } from "./organize.tsx";
import { ParametersPage } from "./parameters.tsx";
import { AREAS_HOME, GUIDE, RECIPES, SETTINGS } from "./route.ts";
import { SettingsPage } from "./settings-page.tsx";
import { SearchResults, SpaceTree, SpaceView, type Filters } from "./spaces.tsx";
import { useStoredFlag } from "./storage.ts";
import { TaxisProvider, useNotices, useRoute, useTaxis, type Route, type Selection } from "./state.tsx";
import { timeAgo } from "./time.ts";

export function App() {
  return (
    <TaxisProvider>
      <HealthProvider>
        <Shell />
      </HealthProvider>
    </TaxisProvider>
  );
}

// The page bar follows the guided path: Guide, then where the house is built
// (Areas, Organize, Automations, Parameters), then what watches it (Health,
// Changes); Settings sits at the right.
const iconClass = "size-4 shrink-0";

function Shell() {
  const { hierarchy, changes, loading, error, reload } = useTaxis();
  const health = useHealthCounts();
  const [route, go] = useRoute();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Kept in this browser, like the folded floors.
  const [maintenance, setMaintenance] = useStoredFlag("taxis:tree:show-maintenance");
  const [disabled, setDisabled] = useStoredFlag("taxis:tree:show-disabled");
  const [showEmpty, setShowEmpty] = useStoredFlag("taxis:tree:show-empty", true);
  const filters = useMemo<Filters>(() => ({ maintenance, disabled }), [maintenance, disabled]);

  // Picking a space ends a search, so the right pane shows what was picked.
  const select = useCallback(
    (s: Selection) => {
      setQuery("");
      go({ page: "areas", sel: s, tab: "overview" });
    },
    [go],
  );

  const page: Route["page"] = route.page;
  const open = (r: Route) => () => go(r);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="flex min-w-0 items-center gap-3 px-3 py-1.5 md:px-4">
          <div className="flex shrink-0 items-center gap-1.5">
            <Layers className="size-5 text-accent" aria-hidden />
            <span className="text-base font-semibold tracking-tight">Taxis</span>
          </div>
          <nav aria-label="Pages" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            <Tab active={page === "guide"} onClick={open(GUIDE)} icon={<Compass className={iconClass} aria-hidden />}>
              Guide
            </Tab>
            <Tab active={page === "areas"} onClick={open(route.page === "areas" ? route : AREAS_HOME)} icon={<MapPin className={iconClass} aria-hidden />}>
              Areas
            </Tab>
            <Tab
              active={page === "organize"}
              onClick={open(route.page === "organize" ? route : { page: "organize", type: "labels", id: null })}
              icon={<FolderTree className={iconClass} aria-hidden />}
            >
              Organize
            </Tab>
            <Tab
              active={page === "automations"}
              onClick={open(route.page === "automations" ? route : RECIPES)}
              icon={<Workflow className={iconClass} aria-hidden />}
            >
              Automations
            </Tab>
            <Tab
              active={page === "parameters"}
              onClick={open(route.page === "parameters" ? route : { page: "parameters", tab: "capabilities" })}
              icon={<SlidersHorizontal className={iconClass} aria-hidden />}
            >
              Parameters
            </Tab>
            <Tab active={page === "health"} onClick={open({ page: "health" })} icon={<HeartPulse className={iconClass} aria-hidden />}>
              Health
              {health && health.error > 0 && <Count tone="danger">{health.error}</Count>}
              {health && health.error === 0 && health.warning > 0 && <Count tone="warn">{health.warning}</Count>}
            </Tab>
            <Tab active={page === "changes"} onClick={open({ page: "changes" })} icon={<GitPullRequestArrow className={iconClass} aria-hidden />}>
              Changes
              {changes.length > 0 && <Count tone="warn">{changes.length}</Count>}
            </Tab>
            <span className="ml-auto" aria-hidden />
            <Tab
              active={page === "settings"}
              onClick={open(route.page === "settings" ? route : SETTINGS)}
              icon={<Settings className={iconClass} aria-hidden />}
            >
              Settings
            </Tab>
          </nav>
          <button
            type="button"
            onClick={() => void reload(true)}
            disabled={loading}
            aria-label="Refresh"
            title="Read Home Assistant again"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[13px] hover:bg-sunken disabled:opacity-60"
          >
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
        {hierarchy && (
          <p className="truncate px-3 pb-1.5 text-[12px] tabular-nums text-muted md:px-4">
            <span className="font-medium text-fg">{hierarchy.home.name}</span> · {hierarchy.counts.floors} floors · {hierarchy.counts.areas} areas ·{" "}
            {hierarchy.counts.devices} devices · {hierarchy.counts.entities.toLocaleString()} entities
            {hierarchy.counts.disabledEntities > 0 && ` (${hierarchy.counts.disabledEntities.toLocaleString()} disabled)`} · Read {timeAgo(hierarchy.fetchedAt)}
          </p>
        )}
      </header>

      {changes.length > 0 && route.page !== "changes" && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-warn-soft px-4 py-1.5 text-[13px] text-warn">
          You're seeing the house with {changes.length} change{changes.length === 1 ? "" : "s"} that aren't in Home Assistant yet.
          <button type="button" className="font-medium underline" onClick={() => go({ page: "changes" })}>
            Review and apply
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 border-b border-line bg-warn-soft px-4 py-2.5 text-[13px] text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Couldn't read Home Assistant. {error}
            {hierarchy && " Showing the last successful read."}
          </span>
        </div>
      )}

      <NoticeBanner />

      {route.page === "settings" ? (
        <SettingsPage h={hierarchy} tab={route.tab} go={go} />
      ) : !hierarchy ? (
        <div className="flex flex-1 items-center justify-center gap-2 px-4 text-center text-muted">
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden /> Reading your floors, areas, devices and entities…
            </>
          ) : (
            "Nothing to show yet. Fix the problem above, then refresh."
          )}
        </div>
      ) : route.page === "guide" ? (
        <GuidePage h={hierarchy} areaId={route.areaId} go={go} />
      ) : route.page === "organize" ? (
        <OrganizePage h={hierarchy} type={route.type} id={route.id} go={go} />
      ) : route.page === "automations" ? (
        <AutomationsPage h={hierarchy} tab={route.tab} controlId={route.controlId} go={go} />
      ) : route.page === "parameters" ? (
        <ParametersPage h={hierarchy} tab={route.tab} go={go} />
      ) : route.page === "health" ? (
        <HealthPage h={hierarchy} go={go} />
      ) : route.page === "changes" ? (
        <ChangesPage h={hierarchy} />
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <aside className="flex max-h-[45vh] shrink-0 flex-col border-b border-line bg-surface md:max-h-none md:w-72 md:border-r md:border-b-0">
            <div className="border-b border-line p-2.5">
              <label className="flex items-center gap-2 rounded-md border border-line bg-bg px-2 py-1.5">
                <Search className="size-4 text-muted" aria-hidden />
                <input
                  id="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find an area or entity"
                  aria-label="Find an area or entity"
                  className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted"
                />
              </label>
            </div>
            <SpaceTree h={hierarchy} sel={route.sel} select={select} filters={filters} query={query} showEmpty={showEmpty} />
            <div className="flex flex-col gap-1 border-t border-line p-2.5 text-[12px] text-muted">
              <Toggle id="show-maintenance" checked={maintenance} onChange={setMaintenance}>
                Show config and diagnostic entities
              </Toggle>
              <Toggle id="show-disabled" checked={disabled} onChange={setDisabled}>
                Show disabled and hidden entities
              </Toggle>
              <Toggle id="show-empty" checked={showEmpty} onChange={setShowEmpty}>
                Show empty areas
              </Toggle>
            </div>
          </aside>
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
            {query.trim() ? (
              <SearchResults h={hierarchy} query={query} filters={filters} select={select} />
            ) : (
              <SpaceView h={hierarchy} sel={route.sel} tab={route.tab} go={go} select={select} filters={filters} />
            )}
          </main>
        </div>
      )}
      <AskTaxis route={route} h={hierarchy} open={assistantOpen} setOpen={setAssistantOpen} go={go} />
    </div>
  );
}

// A short-lived message under the header. It reads the notice by itself, so a
// toast does not make the rest of the shell draw again.
function NoticeBanner() {
  const { notice } = useNotices();
  if (!notice) return null;
  return (
    <div
      role="status"
      className={`flex items-center gap-2 border-b border-line px-4 py-1.5 text-[13px] ${notice.tone === "error" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"}`}
    >
      {notice.tone === "ok" ? <CheckCircle2 className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
      {notice.text}
    </div>
  );
}

function Count({ tone, children }: { tone: "warn" | "danger"; children: ReactNode }) {
  return (
    <span className={`rounded-full px-1.5 text-[11px] font-semibold text-[var(--bg)] tabular-nums ${tone === "danger" ? "bg-danger" : "bg-warn"}`}>
      {children}
    </span>
  );
}

function Tab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  // On a narrow screen the bar scrolls; keep the current page in view.
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-[13px] ${active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-sunken hover:text-fg"}`}
    >
      {icon}
      {children}
    </button>
  );
}

function Toggle({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--accent)]" />
      {children}
    </label>
  );
}
