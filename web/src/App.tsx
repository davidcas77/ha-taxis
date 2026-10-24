import {
  Activity,
  AlertTriangle,
  Battery,
  Blinds,
  Camera,
  ChevronRight,
  Cpu,
  DoorOpen,
  Droplets,
  Gauge,
  Home,
  Layers,
  Lightbulb,
  Loader2,
  Lock,
  MapPin,
  MousePointerClick,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Thermometer,
  ToggleRight,
  Tv,
  UserRound,
  Workflow,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { ROLE_ORDER } from "../../shared/roles.ts";
import type { AreaNode, EntityItem, EntityRole, Hierarchy } from "../../shared/types.ts";
import { fetchHierarchy } from "./api.ts";

// ---------------------------------------------------------------------------
// Selection lives in the URL hash (#home, #floor/<id>, #area/<id>, #unassigned)
// so a reload or a bookmark opens the same space.
// ---------------------------------------------------------------------------

type Selection = { kind: "home" } | { kind: "floor"; id: string } | { kind: "area"; id: string } | { kind: "unassigned" } | { kind: "loose" };

function parseHash(hash: string): Selection {
  const [kind, ...rest] = hash.replace(/^#/, "").split("/");
  let id: string;
  try {
    id = decodeURIComponent(rest.join("/"));
  } catch {
    return { kind: "home" }; // a mangled link opens the whole home
  }
  if (kind === "floor" && id) return { kind: "floor", id };
  if (kind === "area" && id) return { kind: "area", id };
  if (kind === "unassigned") return { kind: "unassigned" };
  if (kind === "loose") return { kind: "loose" };
  return { kind: "home" };
}

function toHash(s: Selection): string {
  if (s.kind === "floor" || s.kind === "area") return `#${s.kind}/${encodeURIComponent(s.id)}`;
  return `#${s.kind}`;
}

function useSelection(): [Selection, (s: Selection) => void] {
  const [sel, setSel] = useState<Selection>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setSel(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const select = useCallback((s: Selection) => {
    window.location.hash = toHash(s);
  }, []);
  return [sel, select];
}

// ---------------------------------------------------------------------------
// Presentation helpers.
// ---------------------------------------------------------------------------

const ROLE_ICONS: Record<EntityRole, LucideIcon> = {
  light: Lightbulb,
  switch: ToggleRight,
  motion: Activity,
  presence: UserRound,
  opening: DoorOpen,
  climate: Wind,
  temperature: Thermometer,
  humidity: Droplets,
  media: Tv,
  cover: Blinds,
  lock: Lock,
  power: Zap,
  battery: Battery,
  button: MousePointerClick,
  sensor: Gauge,
  automation: Workflow,
  helper: SlidersHorizontal,
  camera: Camera,
  other: Sparkles,
};

const ROLE_LABEL = Object.fromEntries(ROLE_ORDER.map((r) => [r.role, r.label])) as Record<EntityRole, string>;

type Filters = { maintenance: boolean; disabled: boolean };

function visible(e: EntityItem, f: Filters): boolean {
  if (!f.maintenance && e.maintenance) return false;
  if (!f.disabled && (e.disabled || e.hidden)) return false;
  return true;
}

function stateText(e: EntityItem): string {
  if (e.disabled) return "disabled";
  if (e.state === null) return "no state";
  return e.unit ? `${e.state} ${e.unit}` : e.state;
}

function stateTone(e: EntityItem): "on" | "off" | "warn" {
  if (e.state === "unavailable" || e.state === "unknown") return "warn";
  if (["on", "open", "home", "playing", "unlocked", "detected", "heat", "cool", "auto"].includes(e.state ?? "")) return "on";
  return "off";
}

function groupByRole(ids: string[], h: Hierarchy, f: Filters) {
  const groups = new Map<EntityRole, EntityItem[]>();
  for (const id of ids) {
    const e = h.entities[id];
    if (!e || !visible(e, f)) continue;
    const list = groups.get(e.role) ?? [];
    list.push(e);
    groups.set(e.role, list);
  }
  return ROLE_ORDER.filter((r) => groups.has(r.role)).map((r) => ({ ...r, entities: groups.get(r.role)! }));
}

const countVisible = (ids: string[], h: Hierarchy, f: Filters) =>
  ids.reduce((n, id) => (h.entities[id] && visible(h.entities[id], f) ? n + 1 : n), 0);

function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

// ---------------------------------------------------------------------------
// The app.
// ---------------------------------------------------------------------------

export function App() {
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>({ maintenance: false, disabled: false });
  const [sel, setSelection] = useSelection();
  // Picking a space ends a search, so the right pane shows what was picked.
  const select = useCallback(
    (s: Selection) => {
      setQuery("");
      setSelection(s);
    },
    [setSelection],
  );

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    const res = await fetchHierarchy(refresh).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : "Could not reach the Taxis server.",
    }));
    if (res.ok) {
      setHierarchy(res.hierarchy);
      setError(null);
    } else {
      setError(res.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Layers className="size-5 text-accent" aria-hidden />
          <span className="text-base font-semibold tracking-tight">Taxis</span>
        </div>
        {hierarchy && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted">
            <span>{hierarchy.home.name}</span>
            <span className="tabular-nums">
              {hierarchy.counts.floors} floors · {hierarchy.counts.areas} areas · {hierarchy.counts.devices} devices ·{" "}
              {hierarchy.counts.entities} entities
            </span>
            <span>Read {timeAgo(hierarchy.fetchedAt)}</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-muted">Read-only</span>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[13px] hover:bg-sunken disabled:opacity-60"
          >
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-2 border-b border-line bg-warn-soft px-4 py-2.5 text-[13px] text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Couldn't read Home Assistant. {error}
            {hierarchy && " Showing the last successful read."}
          </span>
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
            <SpaceTree h={hierarchy} sel={sel} select={select} filters={filters} query={query} />
            <div className="flex flex-col gap-1 border-t border-line p-2.5 text-[12px] text-muted">
              <Toggle id="show-maintenance" checked={filters.maintenance} onChange={(v) => setFilters((f) => ({ ...f, maintenance: v }))}>
                Show config and diagnostic entities
              </Toggle>
              <Toggle id="show-disabled" checked={filters.disabled} onChange={(v) => setFilters((f) => ({ ...f, disabled: v }))}>
                Show disabled and hidden entities
              </Toggle>
            </div>
          </aside>
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
            {query.trim() ? (
              <SearchResults h={hierarchy} query={query} filters={filters} select={select} />
            ) : (
              <SpaceView h={hierarchy} sel={sel} select={select} filters={filters} />
            )}
          </main>
        </div>
      )}
    </div>
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

// ---------------------------------------------------------------------------
// Left: the spaces tree.
// ---------------------------------------------------------------------------

function TreeRow({
  depth,
  icon: Icon,
  label,
  count,
  active,
  muted,
  onClick,
}: {
  depth: number;
  icon: LucideIcon;
  label: string;
  count?: number;
  active: boolean;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-[13px] ${
        active ? "bg-accent-soft font-medium text-accent" : muted ? "text-muted hover:bg-sunken" : "hover:bg-sunken"
      }`}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="shrink-0 text-xs tabular-nums text-muted">{count}</span>}
    </button>
  );
}

function SpaceTree({ h, sel, select, filters, query }: { h: Hierarchy; sel: Selection; select: (s: Selection) => void; filters: Filters; query: string }) {
  const q = query.trim().toLowerCase();
  const areaMatches = (a: AreaNode) => !q || a.name.toLowerCase().includes(q);
  const isArea = (id: string) => sel.kind === "area" && sel.id === id;

  return (
    <nav aria-label="Spaces" className="min-h-0 flex-1 overflow-y-auto p-1.5">
      <TreeRow depth={0} icon={Home} label={h.home.name} active={sel.kind === "home"} onClick={() => select({ kind: "home" })} />
      {h.floors.map((f) => {
        const areas = f.areaIds.map((id) => h.areas[id]).filter(areaMatches);
        if (q && areas.length === 0) return null;
        return (
          <div key={f.id}>
            <TreeRow
              depth={1}
              icon={Layers}
              label={f.name}
              active={sel.kind === "floor" && sel.id === f.id}
              onClick={() => select({ kind: "floor", id: f.id })}
            />
            {areas.map((a) => (
              <TreeRow
                key={a.id}
                depth={2}
                icon={MapPin}
                label={a.name}
                count={countVisible(a.entityIds, h, filters)}
                active={isArea(a.id)}
                onClick={() => select({ kind: "area", id: a.id })}
              />
            ))}
          </div>
        );
      })}
      {h.looseAreaIds.length > 0 && (
        <div>
          <TreeRow depth={1} icon={Layers} label="No floor" muted active={sel.kind === "loose"} onClick={() => select({ kind: "loose" })} />
          {h.looseAreaIds
            .map((id) => h.areas[id])
            .filter(areaMatches)
            .map((a) => (
              <TreeRow
                key={a.id}
                depth={2}
                icon={MapPin}
                label={a.name}
                count={countVisible(a.entityIds, h, filters)}
                active={isArea(a.id)}
                onClick={() => select({ kind: "area", id: a.id })}
              />
            ))}
        </div>
      )}
      <TreeRow
        depth={0}
        icon={AlertTriangle}
        label="Not in any area"
        muted
        count={countVisible(h.unassignedEntityIds, h, filters)}
        active={sel.kind === "unassigned"}
        onClick={() => select({ kind: "unassigned" })}
      />
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Right: the selected space.
// ---------------------------------------------------------------------------

function SpaceView({ h, sel, select, filters }: { h: Hierarchy; sel: Selection; select: (s: Selection) => void; filters: Filters }) {
  if (sel.kind === "area") {
    const area = h.areas[sel.id];
    if (!area) return <Missing what="That area" select={select} />;
    return <AreaView h={h} area={area} filters={filters} select={select} />;
  }
  if (sel.kind === "floor") {
    const floor = h.floors.find((f) => f.id === sel.id);
    if (!floor) return <Missing what="That floor" select={select} />;
    return <AreaList h={h} title={floor.name} subtitle={floor.level !== null ? `Level ${floor.level}` : "Floor"} areaIds={floor.areaIds} filters={filters} select={select} />;
  }
  if (sel.kind === "loose") {
    return <AreaList h={h} title="No floor" subtitle="Areas that aren't on any floor" areaIds={h.looseAreaIds} filters={filters} select={select} />;
  }
  if (sel.kind === "unassigned") {
    return (
      <div className="flex flex-col gap-5">
        <Heading title="Not in any area" subtitle="Neither the entity nor its device has an area. Assigning areas comes in a later version." />
        <RoleGroups h={h} ids={h.unassignedEntityIds} filters={filters} showDevice />
      </div>
    );
  }
  return <HomeView h={h} filters={filters} select={select} />;
}

function Missing({ what, select }: { what: string; select: (s: Selection) => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <Heading title="Not found" subtitle={`${what} isn't in Home Assistant any more. It may have been removed since your last visit.`} />
      <button type="button" className="text-accent underline" onClick={() => select({ kind: "home" })}>
        Go to the whole home
      </button>
    </div>
  );
}

function Heading({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
      {subtitle && <p className="max-w-[68ch] text-[13px] text-muted">{subtitle}</p>}
      {children}
    </div>
  );
}

function Stat({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  const body = (
    <>
      <span className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</span>
      <span className="text-xs text-muted">{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex flex-col items-start rounded-lg border border-line bg-surface px-3.5 py-3 text-left hover:bg-sunken">
      {body}
    </button>
  ) : (
    <div className="flex flex-col rounded-lg border border-line bg-surface px-3.5 py-3">{body}</div>
  );
}

function HomeView({ h, filters, select }: { h: Hierarchy; filters: Filters; select: (s: Selection) => void }) {
  const allIds = Object.keys(h.entities);
  const roleTotals = groupByRole(allIds, h, filters);
  return (
    <div className="flex flex-col gap-6">
      <Heading title={h.home.name} subtitle={h.home.haVersion ? `Home Assistant ${h.home.haVersion}` : undefined} />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <Stat label="Floors" value={h.counts.floors} />
        <Stat label="Areas" value={h.counts.areas} />
        <Stat label="Devices" value={h.counts.devices} />
        <Stat label="Entities" value={h.counts.entities} />
        <Stat label="Not in any area" value={countVisible(h.unassignedEntityIds, h, filters)} onClick={() => select({ kind: "unassigned" })} />
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Floors</h2>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead className="bg-sunken text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Floor</th>
                <th className="px-3 py-2 font-medium">Areas</th>
                <th className="px-3 py-2 font-medium">Devices</th>
                <th className="px-3 py-2 font-medium">Entities</th>
              </tr>
            </thead>
            <tbody>
              {[...h.floors.map((f) => ({ key: f.id, name: f.name, ids: f.areaIds, go: { kind: "floor", id: f.id } as Selection })),
                ...(h.looseAreaIds.length ? [{ key: "__loose", name: "No floor", ids: h.looseAreaIds, go: { kind: "loose" } as Selection }] : [])].map((row) => (
                <tr key={row.key} className="border-t border-line">
                  <td className="px-3 py-2">
                    <button type="button" className="text-accent hover:underline" onClick={() => select(row.go)}>
                      {row.name}
                    </button>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{row.ids.length}</td>
                  <td className="px-3 py-2 tabular-nums">{row.ids.reduce((n, id) => n + h.areas[id].deviceIds.length, 0)}</td>
                  <td className="px-3 py-2 tabular-nums">{row.ids.reduce((n, id) => n + countVisible(h.areas[id].entityIds, h, filters), 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">What's in the home</h2>
        <div className="flex flex-wrap gap-2">
          {roleTotals.map((g) => {
            const Icon = ROLE_ICONS[g.role];
            return (
              <span key={g.role} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[13px]">
                <Icon className="size-3.5 text-muted" aria-hidden />
                {g.label}
                <span className="tabular-nums text-muted">{g.entities.length}</span>
              </span>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function AreaList({ h, title, subtitle, areaIds, filters, select }: { h: Hierarchy; title: string; subtitle: string; areaIds: string[]; filters: Filters; select: (s: Selection) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <Heading title={title} subtitle={`${subtitle} · ${areaIds.length} areas`} />
      {areaIds.length === 0 ? (
        <p className="text-[13px] text-muted">No areas on this floor yet.</p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {areaIds.map((id) => {
            const a = h.areas[id];
            const groups = groupByRole(a.entityIds, h, filters);
            return (
              <button key={id} type="button" onClick={() => select({ kind: "area", id })} className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-left hover:bg-sunken">
                <span className="flex items-center gap-1.5 font-medium">
                  {a.name}
                  <ChevronRight className="ml-auto size-4 text-muted" aria-hidden />
                </span>
                <span className="text-xs text-muted tabular-nums">
                  {a.deviceIds.length} devices · {countVisible(a.entityIds, h, filters)} entities
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {groups.slice(0, 8).map((g) => {
                    const Icon = ROLE_ICONS[g.role];
                    return (
                      <span key={g.role} title={g.label} className="inline-flex items-center gap-1 rounded bg-sunken px-1.5 py-0.5 text-xs text-muted">
                        <Icon className="size-3" aria-hidden />
                        {g.entities.length}
                      </span>
                    );
                  })}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AreaView({ h, area, filters, select }: { h: Hierarchy; area: AreaNode; filters: Filters; select: (s: Selection) => void }) {
  const floor = h.floors.find((f) => f.id === area.floorId);
  const labelNames = area.labels.map((id) => h.labels[id]?.name ?? id);
  return (
    <div className="flex flex-col gap-6">
      <Heading title={area.name}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          {floor ? (
            <button type="button" className="text-accent hover:underline" onClick={() => select({ kind: "floor", id: floor.id })}>
              {floor.name}
            </button>
          ) : (
            <span>No floor</span>
          )}
          <span>
            Area id <code className="rounded bg-sunken px-1 font-mono text-xs">{area.id}</code>
          </span>
          {labelNames.length > 0 && <span>Labels: {labelNames.join(", ")}</span>}
        </div>
      </Heading>
      <RoleGroups h={h} ids={area.entityIds} filters={filters} />
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Devices in this area · {area.deviceIds.length}</h2>
        {area.deviceIds.length === 0 ? (
          <p className="text-[13px] text-muted">No devices are assigned to this area.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {area.deviceIds.map((id) => {
              const d = h.devices[id];
              const via = d.viaDeviceId ? h.devices[d.viaDeviceId] : undefined;
              return (
                <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-[13px]">
                  <Cpu className="size-4 text-muted" aria-hidden />
                  <span className="font-medium">{d.name}</span>
                  <span className="text-muted">{[d.manufacturer, d.model].filter(Boolean).join(" · ") || "Unknown model"}</span>
                  {via && <span className="text-xs text-muted">via {via.name}</span>}
                  <span className="ml-auto text-xs tabular-nums text-muted">{d.entityIds.length} entities</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function RoleGroups({ h, ids, filters, showDevice }: { h: Hierarchy; ids: string[]; filters: Filters; showDevice?: boolean }) {
  const groups = groupByRole(ids, h, filters);
  if (groups.length === 0) return <p className="text-[13px] text-muted">No entities here with the current filters.</p>;
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map((g) => {
        const Icon = ROLE_ICONS[g.role];
        return (
          <section key={g.role} className="flex min-w-0 flex-col rounded-lg border border-line bg-surface" aria-label={g.label}>
            <h3 className="flex items-center gap-2 border-b border-line px-3 py-2 text-[13px] font-semibold">
              <Icon className="size-4 text-accent" aria-hidden />
              {g.label}
              <span className="ml-auto font-normal tabular-nums text-muted">{g.entities.length}</span>
            </h3>
            <ul className="flex flex-col py-1">
              {g.entities.map((e) => (
                <EntityRow key={e.entityId} e={e} device={showDevice && e.deviceId ? h.devices[e.deviceId]?.name : undefined} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function EntityRow({ e, device }: { e: EntityItem; device?: string }) {
  const tone = stateTone(e);
  return (
    <li className="flex items-center gap-2 px-3 py-1 text-[13px]" title={e.entityId}>
      <span
        aria-hidden
        className={`size-2 shrink-0 rounded-full ${tone === "on" ? "bg-on" : tone === "warn" ? "bg-warn" : "bg-off"}`}
      />
      <span className="min-w-0 flex-1 truncate">
        {e.name}
        {device && <span className="ml-1.5 text-xs text-muted">{device}</span>}
      </span>
      <span className={`shrink-0 max-w-[9rem] truncate tabular-nums ${tone === "warn" ? "text-warn" : "text-muted"}`}>{stateText(e)}</span>
    </li>
  );
}

function SearchResults({ h, query, filters, select }: { h: Hierarchy; query: string; filters: Filters; select: (s: Selection) => void }) {
  const q = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      Object.values(h.entities)
        .filter((e) => visible(e, filters) && (e.name.toLowerCase().includes(q) || e.entityId.includes(q)))
        .slice(0, 200),
    [h, q, filters],
  );
  return (
    <div className="flex flex-col gap-4">
      <Heading title={`Entities matching “${query.trim()}”`} subtitle={results.length === 200 ? "Showing the first 200." : `${results.length} found.`} />
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {results.map((e) => {
          const area = e.areaId ? h.areas[e.areaId] : undefined;
          const Icon = ROLE_ICONS[e.role];
          return (
            <li key={e.entityId} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-[13px]">
              <Icon className="size-4 text-muted" aria-hidden />
              <span className="font-medium">{e.name}</span>
              <code className="font-mono text-xs text-muted">{e.entityId}</code>
              <span className="text-xs text-muted">{ROLE_LABEL[e.role]}</span>
              {area ? (
                <button type="button" className="ml-auto text-accent hover:underline" onClick={() => select({ kind: "area", id: area.id })}>
                  {area.name}
                </button>
              ) : (
                <span className="ml-auto text-muted">Not in any area</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
