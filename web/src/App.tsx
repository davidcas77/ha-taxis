import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Cpu,
  FolderTree,
  GitPullRequestArrow,
  HeartPulse,
  House,
  Layers,
  List,
  Loader2,
  MapPin,
  MousePointerClick,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Wrench,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AskTaxis } from "./assistant.tsx";
import { AutomationsPage } from "./automations.tsx";
import { ChangesPage } from "./changes.tsx";
import { GuidePage } from "./guide.tsx";
import { HealthPage, HealthProvider, useHealthCounts } from "./health.tsx";
import { rememberHomeRoom } from "./home-room-memory.ts";
import { OrganizePage } from "./organize.tsx";
import { ParametersPage } from "./parameters.tsx";
import { RoomChooser } from "./room-chooser.tsx";
import { AREAS_HOME, BUTTONS, GUIDE, RECIPES, ROOMS, SETTINGS } from "./route.ts";
import { SettingsPage } from "./settings-page.tsx";
import { SearchResults, SpaceTree, SpaceView, type Filters } from "./spaces.tsx";
import { useStoredFlag } from "./storage.ts";
import { TaxisProvider, useNotices, useRoute, useTaxis, type Route, type Selection } from "./state.tsx";
import { Page, PageHeader, pageMainClass } from "./ui.tsx";

export function App() {
  return (
    <TaxisProvider>
      <HealthProvider>
        <Shell />
      </HealthProvider>
    </TaxisProvider>
  );
}

const iconClass = "size-4 shrink-0";

function Shell() {
  const { hierarchy, changes, loading, error, reload } = useTaxis();
  const [route, go] = useRoute();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Kept in this browser, like the folded floors.
  const [maintenance, setMaintenance] = useStoredFlag("taxis:tree:show-maintenance");
  const [disabled, setDisabled] = useStoredFlag("taxis:tree:show-disabled");
  const [showEmpty, setShowEmpty] = useStoredFlag("taxis:tree:show-empty", true);
  const filters = useMemo<Filters>(() => ({ maintenance, disabled }), [maintenance, disabled]);
  const { page } = route;
  const buttonsOpen = page === "automations" && route.tab === "buttons";
  const roomId = page === "guide" ? route.areaId : null;
  const [roomContext, setRoomContext] = useState(roomId);
  const roomExists = roomId !== null && Boolean(hierarchy?.areas[roomId]);
  useEffect(() => {
    if (page === "guide" || page === "rooms") setRoomContext(roomId);
  }, [page, roomId]);
  useEffect(() => {
    if (roomId && roomExists) rememberHomeRoom(roomId);
  }, [roomExists, roomId]);
  const returnRoom = page !== "guide" && page !== "rooms" && roomContext ? hierarchy?.areas[roomContext] : undefined;

  // Picking a space ends a search, so the right pane shows what was picked.
  const select = useCallback(
    (s: Selection) => {
      setQuery("");
      go({ page: "areas", sel: s, tab: "overview" });
    },
    [go],
  );

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-3 px-3 pt-1.5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:px-4 md:py-1.5">
          <div className="flex items-center gap-1.5">
            <Layers className="size-5 text-accent" aria-hidden />
            <span className="text-base font-semibold tracking-tight">Taxis</span>
          </div>
          <nav
            aria-label="Pages"
            className="col-span-2 col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-0.5 md:col-span-1 md:col-start-2 md:row-start-1 md:gap-x-1"
          >
            <NavButton active={page === "guide" && !roomId} onClick={() => go(GUIDE)}>
              <House className={`${iconClass} hidden sm:block`} aria-hidden />
              Home
            </NavButton>
            <NavButton active={page === "rooms" || Boolean(roomId)} onClick={() => go(ROOMS)}>
              <MapPin className={`${iconClass} hidden sm:block`} aria-hidden />
              Rooms
            </NavButton>
            <NavButton active={page === "organize" && route.type === "devices"} onClick={() => go({ page: "organize", type: "devices", id: null })}>
              <Cpu className={`${iconClass} hidden sm:block`} aria-hidden />
              Devices
            </NavButton>
            <NavButton active={page === "organize" && route.type === "entities"} onClick={() => go({ page: "organize", type: "entities", id: null })}>
              <List className={`${iconClass} hidden sm:block`} aria-hidden />
              Entities
            </NavButton>
            <NavButton active={buttonsOpen} onClick={() => go(buttonsOpen ? route : BUTTONS)}>
              <MousePointerClick className={`${iconClass} hidden sm:block`} aria-hidden />
              Buttons
            </NavButton>
            <NavButton active={page === "changes"} onClick={() => go({ page: "changes" })}>
              <GitPullRequestArrow className={`${iconClass} hidden sm:block`} aria-hidden />
              Changes
              {changes.length > 0 && <Count tone="warn">{changes.length}</Count>}
            </NavButton>
            <div className="ml-auto flex shrink-0 items-center gap-x-0.5 md:gap-x-1">
              <ToolsNavigation route={route} go={go} />
              <NavButton active={page === "settings"} onClick={() => go(page === "settings" ? route : SETTINGS)} label="Settings">
                <Settings className={iconClass} aria-hidden />
              </NavButton>
            </div>
          </nav>
          <button
            type="button"
            onClick={() => void reload(true)}
            disabled={loading}
            aria-label="Refresh"
            title="Read Home Assistant again"
            className="col-start-2 row-start-1 inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[13px] hover:bg-sunken disabled:opacity-60 md:col-start-3"
          >
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </header>

      {returnRoom && (
        <div className="shrink-0 border-b border-line bg-surface px-3 md:px-4">
          <button
            type="button"
            className="inline-flex max-w-full items-center gap-1.5 rounded-md py-2 text-[13px] font-medium text-accent hover:underline"
            onClick={() => go({ page: "guide", areaId: returnRoom.id })}
          >
            <ArrowLeft className={iconClass} aria-hidden />
            <span className="truncate">Back to {returnRoom.name}</span>
          </button>
        </div>
      )}

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
      ) : route.page === "rooms" ? (
        <Page width="4xl">
          <PageHeader title="Rooms" icon={<MapPin className="size-5 text-accent" aria-hidden />} />
          <RoomChooser h={hierarchy} go={go} />
        </Page>
      ) : route.page === "organize" ? (
        <OrganizePage h={hierarchy} type={route.type} id={route.id} go={go} />
      ) : route.page === "automations" ? (
        <AutomationsPage h={hierarchy} tab={route.tab} controlId={route.controlId} go={go} />
      ) : route.page === "parameters" ? (
        <ParametersPage h={hierarchy} tab={route.tab} go={go} />
      ) : route.page === "health" ? (
        <HealthPage key={route.check} h={hierarchy} go={go} initialCheck={route.check} />
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
          <main className={pageMainClass}>
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

const TOOLS = [
  { label: "Areas", icon: MapPin, route: AREAS_HOME },
  { label: "Organize", icon: FolderTree, route: { page: "organize", type: "labels", id: null } },
  { label: "Recipes", icon: Workflow, route: RECIPES },
  { label: "Parameters", icon: SlidersHorizontal, route: { page: "parameters", tab: "capabilities" } },
  { label: "Health", icon: HeartPulse, route: { page: "health" } },
] satisfies { label: string; icon: typeof MapPin; route: Route }[];

const navButtonClass = "inline-flex min-h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[13px] sm:min-h-8 sm:gap-1.5 sm:px-2.5";

function navButtonTone(active: boolean) {
  return active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-sunken hover:text-fg";
}

function ToolsNavigation({ route, go }: { route: Route; go: (route: Route) => void }) {
  const [open, setOpen] = useState(false);
  const disclosure = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const health = useHealthCounts();
  const healthCount = health?.error || health?.warning || 0;
  const healthTone = health?.error ? "danger" : "warn";
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (!disclosure.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [open]);

  const isActive = (target: Route) => {
    if (route.page !== target.page) return false;
    if (route.page === "automations") return target.page === "automations" && route.tab === target.tab;
    return route.page !== "organize" || (route.type !== "devices" && route.type !== "entities");
  };
  const closeAndFocus = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div
      ref={disclosure}
      className="relative"
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.stopPropagation();
          closeAndFocus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls="tools-navigation"
        onClick={() => setOpen(!open)}
        className={`${navButtonClass} ${navButtonTone(open || TOOLS.some((tool) => isActive(tool.route)))}`}
      >
        <Wrench className={`${iconClass} hidden sm:block`} aria-hidden />
        Tools
        {healthCount > 0 && <span className={`size-1.5 rounded-full ${healthTone === "danger" ? "bg-danger" : "bg-warn"}`} aria-hidden />}
        <ChevronDown className="size-3" aria-hidden />
      </button>
      <div
        id="tools-navigation"
        role="group"
        aria-label="Tools pages"
        hidden={!open}
        className="absolute right-0 top-full z-30 mt-1 w-48 rounded-lg border border-line bg-surface p-1 shadow-lg"
      >
        {TOOLS.map(({ label, icon: Icon, route: target }) => {
          const active = isActive(target);
          return (
            <button
              key={label}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => {
                closeAndFocus();
                go(active && target.page !== "health" ? route : target);
              }}
              className={`flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] ${navButtonTone(active)}`}
            >
              <Icon className={iconClass} aria-hidden />
              {label}
              {target.page === "health" && healthCount > 0 && <Count tone={healthTone}>{healthCount}</Count>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
      className={`${navButtonClass} ${navButtonTone(active)}`}
    >
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
