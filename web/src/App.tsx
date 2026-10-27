import { RecipesPage } from "./recipes.tsx";
import { Workflow, AlertTriangle, CheckCircle2, FolderTree, HeartPulse, Layers, ListChecks, Loader2, MapPin, RefreshCw, Search, Settings, SlidersHorizontal } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { ChangesPage } from "./changes.tsx";
import { HealthPage, HealthProvider, useHealthCounts } from "./health.tsx";
import { SettingsPage } from "./naming.tsx";
import { OrganizePage } from "./organize.tsx";
import { ParametersPage } from "./parameters.tsx";
import { SearchResults, SpaceTree, SpaceView, type Filters } from "./spaces.tsx";
import { useStoredFlag } from "./storage.ts";
import { TaxisProvider, useRoute, useTaxis, type Selection } from "./state.tsx";

export function App() {
  return (
    <TaxisProvider>
      <HealthProvider>
        <Shell />
      </HealthProvider>
    </TaxisProvider>
  );
}

function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

function Shell() {
  const { hierarchy, changes, loading, error, notice, reload } = useTaxis();
  const health = useHealthCounts();
  const [route, go] = useRoute();
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

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2">
        <div className="flex items-center gap-2">
          <Layers className="size-5 text-accent" aria-hidden />
          <span className="text-base font-semibold tracking-tight">Taxis</span>
        </div>
        <nav aria-label="Pages" className="flex flex-wrap gap-1">
          <Tab active={route.page === "areas"} onClick={() => go(route.page === "areas" ? route : { page: "areas", sel: { kind: "home" }, tab: "overview" })} icon={<MapPin className="size-4" aria-hidden />}>
            Areas
          </Tab>
          <Tab active={route.page === "organize"} onClick={() => go(route.page === "organize" ? route : { page: "organize", type: "labels", id: null })} icon={<FolderTree className="size-4" aria-hidden />}>
            Organize
          </Tab>
          <Tab active={route.page === "recipes"} onClick={() => go({ page: "recipes" })} icon={<Workflow className="size-4" aria-hidden />}>Recipes</Tab>
          <Tab active={route.page === "parameters"} onClick={() => go(route.page === "parameters" ? route : { page: "parameters", tab: "capabilities" })} icon={<SlidersHorizontal className="size-4" aria-hidden />}>
            Parameters
          </Tab>
          <Tab active={route.page === "health"} onClick={() => go({ page: "health" })} icon={<HeartPulse className="size-4" aria-hidden />}>
            Health
            {health && health.error > 0 && <span className="rounded-full bg-danger px-1.5 text-[11px] font-semibold text-[var(--bg)] tabular-nums">{health.error}</span>}
            {health && health.error === 0 && health.warning > 0 && <span className="rounded-full bg-warn px-1.5 text-[11px] font-semibold text-[var(--bg)] tabular-nums">{health.warning}</span>}
          </Tab>
          <Tab active={route.page === "changes"} onClick={() => go({ page: "changes" })} icon={<ListChecks className="size-4" aria-hidden />}>
            Changes
            {changes.length > 0 && <span className="rounded-full bg-warn px-1.5 text-[11px] font-semibold text-[var(--bg)] tabular-nums">{changes.length}</span>}
          </Tab>
          <Tab active={route.page === "settings"} onClick={() => go({ page: "settings" })} icon={<Settings className="size-4" aria-hidden />}>
            Settings
          </Tab>
        </nav>
        {hierarchy && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted">
            <span>{hierarchy.home.name}</span>
            <span className="tabular-nums">
              {hierarchy.counts.floors} floors · {hierarchy.counts.areas} areas · {hierarchy.counts.devices} devices · {hierarchy.counts.entities.toLocaleString()} entities
              {hierarchy.counts.disabledEntities > 0 && ` (${hierarchy.counts.disabledEntities.toLocaleString()} disabled)`}
            </span>
            <span>Read {timeAgo(hierarchy.fetchedAt)}</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void reload(true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[13px] hover:bg-sunken disabled:opacity-60"
          >
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
            Refresh
          </button>
        </div>
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

      {notice && (
        <div role="status" className={`flex items-center gap-2 border-b border-line px-4 py-1.5 text-[13px] ${notice.tone === "error" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"}`}>
          {notice.tone === "ok" ? <CheckCircle2 className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
          {notice.text}
        </div>
      )}

      {!hierarchy ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-muted">
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden /> Reading your floors, areas, devices and entities…
            </>
          ) : (
            "Nothing to show yet. Fix the problem above, then refresh."
          )}
        </div>
      ) : route.page === "organize" ? (
        <OrganizePage h={hierarchy} type={route.type} id={route.id} go={go} />
      ) : route.page === "recipes" ? (
        <RecipesPage h={hierarchy} />
      ) : route.page === "parameters" ? (
        <ParametersPage h={hierarchy} tab={route.tab} go={go} />
      ) : route.page === "health" ? (
        <HealthPage h={hierarchy} go={go} />
      ) : route.page === "settings" ? (
        <SettingsPage h={hierarchy} go={go} />
      ) : route.page === "changes" ? (
        <ChangesPage h={hierarchy} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
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
    </div>
  );
}

function Tab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] ${active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-sunken hover:text-fg"}`}
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
