import {
  Activity,
  AlertTriangle,
  Battery,
  Blinds,
  Camera,
  ChevronDown,
  ChevronRight,
  Cpu,
  DoorOpen,
  Droplets,
  Gauge,
  Home,
  Layers,
  Lightbulb,
  Lock,
  MapPin,
  MousePointerClick,
  Pencil,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Thermometer,
  ToggleRight,
  Tv,
  UserRound,
  Workflow,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ROLE_ORDER } from "../../shared/roles.ts";
import { arrangeGroups, membershipIndex, summarizeRoom, type BinarySummary, type NumericSummary } from "../../shared/rooms.ts";
import type { AreaNode, ChangeInput, EntityItem, EntityRole, Hierarchy } from "../../shared/types.ts";
import { AreaEditor, DeviceEditor, EntityEditor, FloorEditor, NewItemForm } from "./editors.tsx";
import { useTaxis, type Selection } from "./state.tsx";
import { AreaSelect, Button, EditedDot, LabelChip, inputClass } from "./ui.tsx";

export const ROLE_ICONS: Record<EntityRole, LucideIcon> = {
  light: Lightbulb,
  switch: ToggleRight,
  motion: Activity,
  presence: UserRound,
  opening: DoorOpen,
  climate: Wind,
  temperature: Thermometer,
  humidity: Droplets,
  illuminance: Sun,
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
export const ROLE_LABEL = Object.fromEntries(ROLE_ORDER.map((r) => [r.role, r.label])) as Record<EntityRole, string>;

export type Filters = { maintenance: boolean; disabled: boolean };

export function visible(e: EntityItem, f: Filters): boolean {
  if (!f.maintenance && e.maintenance) return false;
  if (!f.disabled && (e.disabled || e.hidden)) return false;
  return true;
}

export const countVisible = (ids: string[], h: Hierarchy, f: Filters) =>
  ids.reduce((n, id) => (h.entities[id] && visible(h.entities[id], f) ? n + 1 : n), 0);

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

// ---------------------------------------------------------------------------
// Left: the tree of spaces.
// ---------------------------------------------------------------------------

function TreeRow({ depth, icon: Icon, label, count, active, muted, edited, onClick }: {
  depth: number;
  icon: LucideIcon;
  label: string;
  count?: number;
  active: boolean;
  muted?: boolean;
  edited?: boolean;
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
      {edited && <EditedDot />}
      {count !== undefined && <span className="shrink-0 text-xs tabular-nums text-muted">{count}</span>}
    </button>
  );
}

export function SpaceTree({ h, sel, select, filters, query }: { h: Hierarchy; sel: Selection; select: (s: Selection) => void; filters: Filters; query: string }) {
  const { edited } = useTaxis();
  const q = query.trim().toLowerCase();
  const matches = (a: AreaNode) => !q || a.name.toLowerCase().includes(q);
  const areaRow = (a: AreaNode) => (
    <TreeRow
      key={a.id}
      depth={2}
      icon={MapPin}
      label={a.name}
      count={countVisible(a.entityIds, h, filters)}
      active={sel.kind === "area" && sel.id === a.id}
      edited={edited.has(`area:${a.id}`)}
      onClick={() => select({ kind: "area", id: a.id })}
    />
  );
  return (
    <nav aria-label="Spaces" className="min-h-0 flex-1 overflow-y-auto p-1.5">
      <TreeRow depth={0} icon={Home} label={h.home.name} active={sel.kind === "home"} onClick={() => select({ kind: "home" })} />
      {h.floors.map((f) => {
        const areas = f.areaIds.map((id) => h.areas[id]).filter(matches);
        if (q && areas.length === 0) return null;
        return (
          <div key={f.id}>
            <TreeRow
              depth={1}
              icon={Layers}
              label={f.name}
              active={sel.kind === "floor" && sel.id === f.id}
              edited={edited.has(`floor:${f.id}`)}
              onClick={() => select({ kind: "floor", id: f.id })}
            />
            {areas.map(areaRow)}
          </div>
        );
      })}
      {h.looseAreaIds.length > 0 && (
        <div>
          <TreeRow depth={1} icon={Layers} label="No floor" muted active={sel.kind === "loose"} onClick={() => select({ kind: "loose" })} />
          {h.looseAreaIds.map((id) => h.areas[id]).filter(matches).map(areaRow)}
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
// Right: the selected space, with editing.
// ---------------------------------------------------------------------------

type Editing = { kind: "entity" | "device" | "area" | "floor"; id: string } | null;

export function SpaceView({ h, sel, select, filters }: { h: Hierarchy; sel: Selection; select: (s: Selection) => void; filters: Filters }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // A new place starts with nothing open and nothing picked.
  const key = JSON.stringify(sel);
  useEffect(() => {
    setEditing(null);
    setPicked(new Set());
  }, [key]);

  const close = () => setEditing(null);
  const editor = editing && (
    <div className="mb-5">
      {editing.kind === "entity" && h.entities[editing.id] && <EntityEditor key={editing.id} h={h} entity={h.entities[editing.id]} onClose={close} />}
      {editing.kind === "device" && h.devices[editing.id] && <DeviceEditor key={editing.id} h={h} device={h.devices[editing.id]} onClose={close} />}
      {editing.kind === "area" && h.areas[editing.id] && (
        <AreaEditor key={editing.id} h={h} area={h.areas[editing.id]} onClose={close} onDeleted={() => select({ kind: "home" })} />
      )}
      {editing.kind === "floor" && h.floors.find((f) => f.id === editing.id) && (
        <FloorEditor key={editing.id} floor={h.floors.find((f) => f.id === editing.id)!} onClose={close} onDeleted={() => select({ kind: "home" })} />
      )}
    </div>
  );

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const rows = { picked, toggle, edit: (id: string) => setEditing({ kind: "entity", id }) };

  let body: ReactNode;
  if (sel.kind === "area") {
    const area = h.areas[sel.id];
    body = area ? (
      <AreaView h={h} area={area} filters={filters} select={select} rows={rows} onEditArea={() => setEditing({ kind: "area", id: area.id })} onEditDevice={(id) => setEditing({ kind: "device", id })} />
    ) : (
      <Missing what="That area" select={select} />
    );
  } else if (sel.kind === "floor") {
    const floor = h.floors.find((f) => f.id === sel.id);
    body = floor ? (
      <AreaList h={h} title={floor.name} subtitle={floor.level !== null ? `Level ${floor.level}` : "Floor"} areaIds={floor.areaIds} filters={filters} select={select} floorId={floor.id} onEdit={() => setEditing({ kind: "floor", id: floor.id })} />
    ) : (
      <Missing what="That floor" select={select} />
    );
  } else if (sel.kind === "loose") {
    body = <AreaList h={h} title="No floor" subtitle="Areas that aren't on any floor" areaIds={h.looseAreaIds} filters={filters} select={select} floorId={null} />;
  } else if (sel.kind === "unassigned") {
    body = (
      <div className="flex flex-col gap-5">
        <Heading title="Not in any area" subtitle="Neither the entity nor its device has an area. Pick some and move them to an area below." />
        <RoleSections h={h} ids={h.unassignedEntityIds} filters={filters} rows={rows} showDevice />
      </div>
    );
  } else {
    body = <HomeView h={h} filters={filters} select={select} />;
  }

  return (
    <div className="flex flex-col">
      {editor}
      {picked.size > 0 && <BulkBar h={h} ids={[...picked]} onDone={() => setPicked(new Set())} />}
      {body}
    </div>
  );
}

function Missing({ what, select }: { what: string; select: (s: Selection) => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <Heading title="Not found" subtitle={`${what} isn't in Home Assistant any more. It may have been removed since your last visit.`} />
      <Button onClick={() => select({ kind: "home" })}>Go to the whole home</Button>
    </div>
  );
}

function Heading({ title, subtitle, children, action }: { title: string; subtitle?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
        {subtitle && <p className="max-w-[68ch] text-[13px] text-muted">{subtitle}</p>}
        {children}
      </div>
      {action}
    </div>
  );
}

function Stat({ label, value, note, onClick }: { label: string; value: number; note?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</span>
      <span className="text-xs text-muted">{label}</span>
      {note && <span className="mt-0.5 text-[11px] text-muted">{note}</span>}
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
  const roleTotals = groupByRole(Object.keys(h.entities), h, filters);
  return (
    <div className="flex flex-col gap-6">
      <Heading title={h.home.name} subtitle={h.home.haVersion ? `Home Assistant ${h.home.haVersion}` : undefined} />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <Stat label="Floors" value={h.counts.floors} />
        <Stat label="Areas" value={h.counts.areas} />
        <Stat label="Devices" value={h.counts.devices} />
        <Stat label="Entities" value={h.counts.entities} note={h.counts.disabledEntities > 0 ? `${h.counts.disabledEntities.toLocaleString()} more are disabled` : undefined} />
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
              {[
                ...h.floors.map((f) => ({ key: f.id, name: f.name, ids: f.areaIds, go: { kind: "floor", id: f.id } as Selection })),
                ...(h.looseAreaIds.length ? [{ key: "__loose", name: "No floor", ids: h.looseAreaIds, go: { kind: "loose" } as Selection }] : []),
              ].map((row) => (
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
        <NewItemForm kind="floor" onDone={() => {}} />
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

function AreaList({ h, title, subtitle, areaIds, filters, select, floorId, onEdit }: {
  h: Hierarchy;
  title: string;
  subtitle: string;
  areaIds: string[];
  filters: Filters;
  select: (s: Selection) => void;
  floorId: string | null;
  onEdit?: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Heading
        title={title}
        subtitle={`${subtitle} · ${areaIds.length} areas`}
        action={
          onEdit && (
            <Button onClick={onEdit}>
              <Pencil className="size-3.5" aria-hidden /> Edit floor
            </Button>
          )
        }
      />
      {areaIds.length === 0 ? (
        <p className="text-[13px] text-muted">No areas here yet.</p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {areaIds.map((id) => {
            const a = h.areas[id];
            const s = summarizeRoom(a, h);
            return (
              <button key={id} type="button" onClick={() => select({ kind: "area", id })} className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-left hover:bg-sunken">
                <span className="flex items-center gap-1.5 font-medium">
                  {a.name}
                  <ChevronRight className="ml-auto size-4 text-muted" aria-hidden />
                </span>
                <span className="text-xs text-muted tabular-nums">
                  {a.deviceIds.length} devices · {countVisible(a.entityIds, h, filters)} entities
                </span>
                <SummaryChips s={s} h={h} compact />
              </button>
            );
          })}
        </div>
      )}
      <NewItemForm kind="area" floorId={floorId} onDone={() => {}} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The room summary: temperature, humidity, light level, presence, motion,
// openings, lights.
// ---------------------------------------------------------------------------

function sourceNames(ids: string[], h: Hierarchy) {
  return ids.map((id) => h.entities[id]?.name ?? id).join(", ");
}

function numberChip(icon: LucideIcon, label: string, n: NumericSummary, h: Hierarchy) {
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const text = n.value !== null ? `${fmt(n.value)}${n.unit ? ` ${n.unit}` : ""}` : `${fmt(n.min)}–${fmt(n.max)}${n.unit ? ` ${n.unit}` : ""}`;
  const via = n.primaryId ? `from ${h.entities[n.primaryId]?.name ?? n.primaryId}` : `${n.sourceIds.length} sensors`;
  return { icon, label, text, title: `${label}: ${text}, ${via}. Sensors: ${sourceNames(n.sourceIds, h)}`, tone: "plain" as const, group: n.groupIds.length > 0 };
}

function binaryChip(icon: LucideIcon, label: string, b: BinarySummary, words: [string, string], h: Hierarchy) {
  const text = b.active === null ? "unknown" : b.active ? words[0] : words[1];
  return {
    icon,
    label,
    text,
    title: `${label}: ${text}. Sensors: ${sourceNames(b.sourceIds, h)}${b.activeIds.length ? `. Active: ${sourceNames(b.activeIds, h)}` : ""}`,
    tone: b.active ? ("on" as const) : b.active === null ? ("warn" as const) : ("plain" as const),
    group: b.groupIds.length > 0,
  };
}

function SummaryChips({ s, h, compact }: { s: ReturnType<typeof summarizeRoom>; h: Hierarchy; compact?: boolean }) {
  const chips = [
    s.temperature && numberChip(Thermometer, "Temperature", s.temperature, h),
    s.humidity && numberChip(Droplets, "Humidity", s.humidity, h),
    s.illuminance && numberChip(Sun, "Light level", s.illuminance, h),
    s.presence && binaryChip(UserRound, "Presence", s.presence, ["occupied", "clear"], h),
    s.motion && binaryChip(Activity, "Motion", s.motion, ["motion", "still"], h),
    s.opening && binaryChip(DoorOpen, "Doors and windows", s.opening, [`${s.opening.activeIds.length} open`, "closed"], h),
    s.lights && {
      icon: Lightbulb,
      label: "Lights",
      text: `${s.lights.on}/${s.lights.total} on`,
      title: `${s.lights.on} of ${s.lights.total} lights on${s.lights.groupIds.length ? `. Groups: ${sourceNames(s.lights.groupIds, h)}` : ""}`,
      tone: s.lights.on > 0 ? ("on" as const) : ("plain" as const),
      group: s.lights.groupIds.length > 0,
    },
  ].filter((c): c is NonNullable<typeof c> => Boolean(c));
  if (chips.length === 0) return compact ? null : <p className="text-[13px] text-muted">No temperature, presence, motion or light entities in this area.</p>;
  return (
    <ul aria-label="Room summary" className="flex flex-wrap gap-1.5">
      {chips.map((c) => {
        const Icon = c.icon;
        return (
          <li
            key={c.label}
            title={c.title}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
              c.tone === "on" ? "border-on/40 text-on" : c.tone === "warn" ? "border-warn/40 text-warn" : "border-line text-fg"
            } ${compact ? "" : "bg-surface"}`}
          >
            <Icon className="size-3.5" aria-hidden />
            {!compact && <span className="text-muted">{c.label}</span>}
            <span className="font-medium tabular-nums">{c.text}</span>
            {c.group && <span className="rounded bg-sunken px-1 text-[10px] text-muted">group</span>}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// An area: summary, entities by role (groups with their members), devices.
// ---------------------------------------------------------------------------

type Rows = { picked: Set<string>; toggle: (id: string) => void; edit: (id: string) => void };

function AreaView({ h, area, filters, select, rows, onEditArea, onEditDevice }: {
  h: Hierarchy;
  area: AreaNode;
  filters: Filters;
  select: (s: Selection) => void;
  rows: Rows;
  onEditArea: () => void;
  onEditDevice: (id: string) => void;
}) {
  const { edited } = useTaxis();
  const floor = h.floors.find((f) => f.id === area.floorId);
  const summary = summarizeRoom(area, h);
  return (
    <div className="flex flex-col gap-6">
      <Heading
        title={area.name}
        action={
          <Button onClick={onEditArea}>
            <Pencil className="size-3.5" aria-hidden /> Edit area
          </Button>
        }
      >
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
          {edited.has(`area:${area.id}`) && (
            <span className="inline-flex items-center gap-1 text-warn">
              <EditedDot /> changed, not applied
            </span>
          )}
          {area.labels.map((id) => h.labels[id] && <LabelChip key={id} label={h.labels[id]} />)}
        </div>
      </Heading>
      <SummaryChips s={summary} h={h} />
      <RoleSections h={h} ids={area.entityIds} filters={filters} rows={rows} />
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
                <li key={id}>
                  <button type="button" onClick={() => onEditDevice(id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-left text-[13px] hover:bg-sunken">
                    <Cpu className="size-4 text-muted" aria-hidden />
                    <span className="font-medium">{d.name}</span>
                    {edited.has(`device:${id}`) && <EditedDot />}
                    <span className="text-muted">{[d.manufacturer, d.model].filter(Boolean).join(" · ") || "Unknown model"}</span>
                    {via && <span className="text-xs text-muted">via {via.name}</span>}
                    <span className="ml-auto text-xs tabular-nums text-muted">{d.entityIds.length} entities</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function RoleSections({ h, ids, filters, rows, showDevice }: { h: Hierarchy; ids: string[]; filters: Filters; rows: Rows; showDevice?: boolean }) {
  const groups = groupByRole(ids, h, filters);
  const memberOf = useMemo(() => membershipIndex(h), [h]);
  if (groups.length === 0) return <p className="text-[13px] text-muted">No entities here with the current filters.</p>;
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map((g) => {
        const Icon = ROLE_ICONS[g.role];
        const { groups: grouped, loose } = arrangeGroups(g.entities, h);
        return (
          <section key={g.role} className="flex min-w-0 flex-col rounded-lg border border-line bg-surface" aria-label={g.label}>
            <h3 className="flex items-center gap-2 border-b border-line px-3 py-2 text-[13px] font-semibold">
              <Icon className="size-4 text-accent" aria-hidden />
              {g.label}
              <span className="ml-auto font-normal tabular-nums text-muted">{g.entities.length}</span>
            </h3>
            <ul className="flex flex-col py-1">
              {grouped.map((gv) => (
                <GroupBlock key={gv.group.entityId} h={h} group={gv.group} members={gv.members} rows={rows} memberOf={memberOf} />
              ))}
              {loose.map((e) => (
                <EntityRow key={e.entityId} e={e} rows={rows} device={showDevice && e.deviceId ? h.devices[e.deviceId]?.name : undefined} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function GroupBlock({ h, group, members, rows, memberOf }: {
  h: Hierarchy;
  group: EntityItem;
  members: { entityId: string; entity: EntityItem | null }[];
  rows: Rows;
  memberOf: Map<string, string[]>;
}) {
  const [open, setOpen] = useState(true);
  return (
    <li className="flex flex-col">
      <div className="flex items-center">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Hide members" : "Show members"} className="pl-2 text-muted hover:text-fg">
          {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
        </button>
        <ul className="min-w-0 flex-1">
          <EntityRow e={group} rows={rows} badge={`group of ${members.length}`} />
        </ul>
      </div>
      {open && (
        <ul className="ml-6 flex flex-col border-l border-line">
          {members.map((m) => {
            if (!m.entity) {
              return (
                <li key={m.entityId} className="px-3 py-1 text-xs text-warn" title="The group lists it, but Home Assistant has no such entity.">
                  {m.entityId} · missing
                </li>
              );
            }
            const others = (memberOf.get(m.entityId) ?? []).filter((g) => g !== group.entityId);
            const elsewhere = m.entity.areaId && m.entity.areaId !== group.areaId ? h.areas[m.entity.areaId]?.name : null;
            const note = [elsewhere && `in ${elsewhere}`, others.length > 0 && `also in ${others.map((g) => h.entities[g]?.name ?? g).join(", ")}`].filter(Boolean).join(" · ");
            return <EntityRow key={m.entityId} e={m.entity} rows={rows} note={note || undefined} />;
          })}
        </ul>
      )}
    </li>
  );
}

function EntityRow({ e, rows, device, badge, note }: { e: EntityItem; rows: Rows; device?: string; badge?: string; note?: string }) {
  const { edited } = useTaxis();
  const tone = stateTone(e);
  const id = `pick-${e.entityId}`;
  return (
    <li className="group flex items-center gap-2 px-3 py-1 text-[13px] hover:bg-sunken" title={e.entityId}>
      {e.inRegistry ? (
        <input id={id} type="checkbox" checked={rows.picked.has(e.entityId)} onChange={() => rows.toggle(e.entityId)} aria-label={`Select ${e.name}`} className="shrink-0" />
      ) : (
        <span className="w-[13px] shrink-0" aria-hidden />
      )}
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${tone === "on" ? "bg-on" : tone === "warn" ? "bg-warn" : "bg-off"}`} />
      <button type="button" onClick={() => rows.edit(e.entityId)} className="flex min-w-0 flex-1 flex-col text-left">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{e.name}</span>
          {edited.has(`entity:${e.entityId}`) && <EditedDot />}
          {badge && <span className="shrink-0 rounded bg-sunken px-1 text-[10px] text-muted">{badge}</span>}
          {device && <span className="truncate text-xs text-muted">{device}</span>}
        </span>
        {note && <span className="truncate text-[11px] text-muted">{note}</span>}
      </button>
      <span className={`max-w-[9rem] shrink-0 truncate tabular-nums ${tone === "warn" ? "text-warn" : "text-muted"}`}>{stateText(e)}</span>
    </li>
  );
}

// Changes to several entities at once.
function BulkBar({ h, ids, onDone }: { h: Hierarchy; ids: string[]; onDone: () => void }) {
  const { propose } = useTaxis();
  const [area, setArea] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const labels = Object.values(h.labels).sort((a, b) => a.name.localeCompare(b.name));
  const { notify } = useTaxis();
  const run = async (make: (e: EntityItem) => ChangeInput | null, skip?: (e: EntityItem) => boolean, skipWhy?: string) => {
    const chosen = ids.map((id) => h.entities[id]).filter(Boolean);
    const skipped = skip ? chosen.filter(skip) : [];
    const inputs = chosen.filter((e) => !skipped.includes(e)).map(make).filter((x): x is ChangeInput => Boolean(x));
    if (inputs.length === 0) {
      if (skipped.length) notify({ tone: "error", text: `Nothing added: ${skipWhy}` });
      return;
    }
    setBusy(true);
    const ok = await propose(inputs);
    setBusy(false);
    if (ok && skipped.length) notify({ tone: "error", text: `${skipped.length} left out: ${skipWhy}` });
    if (ok) onDone();
  };
  return (
    <div role="region" aria-label="Change the selected entities" className="sticky top-0 z-10 mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-accent/40 bg-surface p-3 shadow-sm">
      <span className="self-center text-[13px] font-medium">{ids.length} selected</span>
      <div className="flex items-end gap-1.5">
        <div className="w-48">
          <AreaSelect h={h} id="bulk-area" value={area} onChange={setArea} noneLabel="Same as their device" />
        </div>
        <Button
          disabled={busy}
          onClick={() =>
            void run(
              (e) => (e.ownAreaId === area ? null : { kind: "entity", op: "update", targetId: e.entityId, fields: { area_id: area } }),
              // A device's main entity can't take an area of its own without a name.
              (e) => Boolean(area) && e.needsOwnName && !e.customName,
              "a device's main entity needs a name before it can have an area of its own. Move its device instead, or name it first.",
            )
          }
        >
          Move
        </Button>
      </div>
      <div className="flex items-end gap-1.5">
        <select aria-label="Label" className={`${inputClass} w-40`} value={label} onChange={(ev) => setLabel(ev.target.value)}>
          <option value="">Choose a label…</option>
          {labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <Button disabled={busy || !label} onClick={() => void run((e) => (e.labels.includes(label) ? null : { kind: "entity", op: "update", targetId: e.entityId, fields: { labels: [...e.labels, label] } }))}>
          Add label
        </Button>
        <Button disabled={busy || !label} onClick={() => void run((e) => (!e.labels.includes(label) ? null : { kind: "entity", op: "update", targetId: e.entityId, fields: { labels: e.labels.filter((x) => x !== label) } }))}>
          Remove label
        </Button>
      </div>
      <Button disabled={busy} onClick={() => void run((e) => (e.hidden ? null : { kind: "entity", op: "update", targetId: e.entityId, fields: { hidden_by: "user" } }))}>
        Hide
      </Button>
      <Button tone="ghost" className="ml-auto" onClick={onDone}>
        Clear selection
      </Button>
    </div>
  );
}

export function SearchResults({ h, query, filters, select }: { h: Hierarchy; query: string; filters: Filters; select: (s: Selection) => void }) {
  const q = query.trim().toLowerCase();
  const results = useMemo(
    () => Object.values(h.entities).filter((e) => visible(e, filters) && (e.name.toLowerCase().includes(q) || e.entityId.includes(q))).slice(0, 200),
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
