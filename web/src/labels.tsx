import { Tag, Folder, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { CATEGORY_SCOPES, type CategoryItem, type CategoryScope, type ChangeInput, type EntityItem, type Hierarchy, type LabelItem } from "../../shared/types.ts";
import { SCOPE_NAMES } from "./editors.tsx";
import { AssignTool, rolesSuggestedBy } from "./assign.tsx";
import { useTaxis, type Route } from "./state.tsx";
import { Button, EditedDot, Field, inputClass, LABEL_COLORS, labelColor } from "./ui.tsx";

// Labels and Categories pages. Labels go on areas, devices and entities;
// categories file automations, scripts, scenes and helpers, one list per kind
// as in Home Assistant. Both have an assign tool to put many entities in or
// take them out at once.

export function LabelsPage({ h, id, go }: { h: Hierarchy; id: string | null; go: (r: Route) => void }) {
  const usage = useMemo(() => labelUsage(h), [h]);
  const label = id ? h.labels[id] : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="flex max-h-[50vh] shrink-0 flex-col gap-3 overflow-y-auto border-b border-line bg-surface p-3 md:max-h-none md:w-80 md:border-r md:border-b-0">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Tag className="size-4 text-accent" aria-hidden /> Labels
        </h2>
        <p className="text-xs text-muted">On areas, devices and entities. Automations can target a label, so everything with it is acted on.</p>
        <ul className="flex flex-col">
          {Object.values(h.labels)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((l) => (
              <ListRow key={l.id} active={label?.id === l.id} onClick={() => go({ page: "labels", id: l.id })} count={usage.get(l.id)?.total ?? 0} edited={`label:${l.id}`}>
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: labelColor(l.color) ?? "var(--off)" }} />
                {l.name}
              </ListRow>
            ))}
        </ul>
        <NewForm kind="label" onCreated={() => {}} />
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
        {label ? (
          <LabelDetail key={label.id} h={h} label={label} usage={usage.get(label.id)} onDeleted={() => go({ page: "labels", id: null })} />
        ) : (
          <Intro title="Labels" text="Pick a label to rename it, change its color, and add it to entities or take it off, many at a time." />
        )}
      </main>
    </div>
  );
}

export function CategoriesPage({ h, scope: scopeParam, id, go }: { h: Hierarchy; scope: string | null; id: string | null; go: (r: Route) => void }) {
  const scope: CategoryScope = (CATEGORY_SCOPES as readonly string[]).includes(scopeParam ?? "") ? (scopeParam as CategoryScope) : "automation";
  const catUsage = useMemo(() => categoryUsage(h), [h]);
  const category = id ? h.categories[scope].find((c) => c.id === id) : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="flex max-h-[50vh] shrink-0 flex-col gap-3 overflow-y-auto border-b border-line bg-surface p-3 md:max-h-none md:w-80 md:border-r md:border-b-0">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Folder className="size-4 text-accent" aria-hidden /> Categories
        </h2>
        <p className="text-xs text-muted">Home Assistant keeps a separate list for each of these.</p>
        <div role="tablist" aria-label="Category lists" className="flex flex-wrap gap-1">
          {CATEGORY_SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              onClick={() => go({ page: "categories", scope: s, id: null })}
              className={`rounded-md px-2 py-1 text-xs ${scope === s ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-sunken"}`}
            >
              {SCOPE_NAMES[s]}
            </button>
          ))}
        </div>
        <ul className="flex flex-col">
          {h.categories[scope].length === 0 && <li className="px-2 py-1 text-xs text-muted">No categories for {SCOPE_NAMES[scope].toLowerCase()} yet.</li>}
          {h.categories[scope].map((c) => (
            <ListRow key={c.id} active={category?.id === c.id} onClick={() => go({ page: "categories", scope, id: c.id })} count={catUsage.get(`${scope}:${c.id}`)?.length ?? 0} edited={`category:${c.id}`}>
              {c.name}
            </ListRow>
          ))}
        </ul>
        <NewForm kind="category" scope={scope} onCreated={() => {}} />
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
        {category ? (
          <CategoryDetail key={category.id} h={h} category={category} members={catUsage.get(`${scope}:${category.id}`) ?? []} onDeleted={() => go({ page: "categories", scope, id: null })} />
        ) : (
          <Intro title="Categories" text="Pick a category to rename it and file automations, scripts, scenes or helpers under it, many at a time." />
        )}
      </main>
    </div>
  );
}

function Intro({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex max-w-[68ch] flex-col gap-2">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-[13px] text-muted">{text}</p>
    </div>
  );
}

function ListRow({ active, onClick, count, edited, children }: { active: boolean; onClick: () => void; count: number; edited: string; children: ReactNode }) {
  const { edited: changed } = useTaxis();
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${active ? "bg-accent-soft font-medium text-accent" : "hover:bg-sunken"}`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{children}</span>
        {changed.has(edited) && <EditedDot />}
        <span className="text-xs tabular-nums text-muted">{count}</span>
      </button>
    </li>
  );
}

function NewForm({ kind, scope, onCreated }: { kind: "label" | "category"; scope?: CategoryScope; onCreated: () => void }) {
  const { propose } = useTaxis();
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = `new-${kind}`;
  return (
    <form
      className="flex flex-wrap items-end gap-1.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return setError(`Give the new ${kind} a name.`);
        setError(null);
        const fields: Record<string, unknown> = { name: name.trim() };
        if (kind === "label" && color) fields.color = color;
        const ok = await propose({ kind, op: "create", scope, fields });
        if (ok) {
          setName("");
          onCreated();
        }
      }}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="sr-only">
          New {kind} name
        </label>
        <input id={id} className={inputClass} value={name} placeholder={kind === "label" ? "New label" : `New ${SCOPE_NAMES[scope!].toLowerCase().replace(/s$/, "")} category`} onChange={(e) => setName(e.target.value)} />
      </div>
      {kind === "label" && (
        <select aria-label="Color" className={`${inputClass} w-28`} value={color} onChange={(e) => setColor(e.target.value)}>
          <option value="">No color</option>
          {LABEL_COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}
      <Button type="submit">Add</Button>
      {error && (
        <p role="alert" className="w-full text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type LabelUse = { total: number; areas: string[]; devices: string[]; entities: string[] };

function labelUsage(h: Hierarchy): Map<string, LabelUse> {
  const m = new Map<string, LabelUse>();
  const get = (id: string) => {
    let u = m.get(id);
    if (!u) m.set(id, (u = { total: 0, areas: [], devices: [], entities: [] }));
    return u;
  };
  for (const a of Object.values(h.areas)) for (const l of a.labels) (get(l).areas.push(a.id), get(l).total++);
  for (const d of Object.values(h.devices)) for (const l of d.labels) (get(l).devices.push(d.id), get(l).total++);
  for (const e of Object.values(h.entities)) for (const l of e.labels) (get(l).entities.push(e.entityId), get(l).total++);
  return m;
}

function categoryUsage(h: Hierarchy): Map<string, EntityItem[]> {
  const m = new Map<string, EntityItem[]>();
  for (const e of Object.values(h.entities)) {
    for (const [scope, id] of Object.entries(e.categories)) {
      const key = `${scope}:${id}`;
      m.set(key, [...(m.get(key) ?? []), e]);
    }
  }
  return m;
}

function DetailHeader({ title, onDelete, deleteWhat, children }: { title: ReactNode; onDelete: () => void; deleteWhat: string; children?: ReactNode }) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold">{title}</h1>
        {children}
      </div>
      {asking ? (
        <span className="flex items-center gap-2 text-xs">
          Delete this {deleteWhat}? Home Assistant removes it from everything it's on.
          <Button tone="danger" onClick={onDelete}>
            Yes, delete
          </Button>
          <Button tone="ghost" onClick={() => setAsking(false)}>
            Keep it
          </Button>
        </span>
      ) : (
        <Button tone="danger" onClick={() => setAsking(true)}>
          <Trash2 className="size-3.5" aria-hidden /> Delete {deleteWhat}
        </Button>
      )}
    </div>
  );
}

function LabelDetail({ h, label, usage, onDeleted }: { h: Hierarchy; label: LabelItem; usage: LabelUse | undefined; onDeleted: () => void }) {
  const { propose } = useTaxis();
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color ?? "");
  const [icon, setIcon] = useState(label.icon ?? "");
  const [description, setDescription] = useState(label.description ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) return setError("A label needs a name.");
    if (icon.trim() && !/^[a-z0-9]+:[a-z0-9-]+$/.test(icon.trim())) return setError("An icon looks like mdi:tag.");
    const fields: Record<string, unknown> = {};
    if (name.trim() !== label.name) fields.name = name.trim();
    if ((color || null) !== label.color) fields.color = color || null;
    if ((icon.trim() || null) !== label.icon) fields.icon = icon.trim() || null;
    if ((description.trim() || null) !== label.description) fields.description = description.trim() || null;
    if (Object.keys(fields).length === 0) return setError("Nothing has changed yet.");
    setError(null);
    await propose({ kind: "label", op: "update", targetId: label.id, fields });
  };

  const removeFrom = (kind: "area" | "device" | "entity", id: string, current: string[]): ChangeInput => ({
    kind,
    op: "update",
    targetId: id,
    fields: { labels: current.filter((l) => l !== label.id) },
  });

  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        deleteWhat="label"
        onDelete={async () => {
          if (await propose({ kind: "label", op: "delete", targetId: label.id })) onDeleted();
        }}
        title={
          <>
            <span aria-hidden className="size-3 rounded-full" style={{ background: labelColor(label.color) ?? "var(--off)" }} />
            {label.name}
          </>
        }
      >
        <p className="text-[13px] text-muted">
          On {count(usage?.areas.length ?? 0, "area")}, {count(usage?.devices.length ?? 0, "device")} and {count(usage?.entities.length ?? 0, "entity", "entities")}.
        </p>
      </DetailHeader>

      <section className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="label-name">
          <input id="label-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Color" htmlFor="label-color">
          <select id="label-color" className={inputClass} value={color} onChange={(e) => setColor(e.target.value)}>
            <option value="">No color</option>
            {LABEL_COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Icon" htmlFor="label-icon">
          <input id="label-icon" className={inputClass} value={icon} placeholder="mdi:…" onChange={(e) => setIcon(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="label-desc">
          <input id="label-desc" className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="flex items-center gap-2 sm:col-span-2">
          <Button tone="primary" onClick={() => void save()}>
            Add to changes
          </Button>
          {error && (
            <span role="alert" className="text-xs text-danger">
              {error}
            </span>
          )}
        </div>
      </section>

      <Members
        title="Areas"
        items={(usage?.areas ?? []).map((id) => ({ id, name: h.areas[id]?.name ?? id }))}
        onRemove={(id) => void propose(removeFrom("area", id, h.areas[id].labels))}
      />
      <Members
        title="Devices"
        items={(usage?.devices ?? []).map((id) => ({ id, name: h.devices[id]?.name ?? id }))}
        onRemove={(id) => void propose(removeFrom("device", id, h.devices[id].labels))}
      />
      <AssignTool
        h={h}
        title={`Entities with “${label.name}”`}
        isMember={(e) => e.labels.includes(label.id)}
        suggestedRoles={rolesSuggestedBy(label.name)}
        onAdd={(ids) => void propose(ids.map((id) => ({ kind: "entity", op: "update", targetId: id, fields: { labels: [...h.entities[id].labels, label.id] } })))}
        onRemove={(ids) => void propose(ids.map((id) => removeFrom("entity", id, h.entities[id].labels)))}
      />
    </div>
  );
}

function CategoryDetail({ h, category, members, onDeleted }: { h: Hierarchy; category: CategoryItem; members: EntityItem[]; onDeleted: () => void }) {
  const { propose } = useTaxis();
  const [name, setName] = useState(category.name);
  const [icon, setIcon] = useState(category.icon ?? "");
  const [error, setError] = useState<string | null>(null);
  const scope = category.scope;

  const save = async () => {
    if (!name.trim()) return setError("A category needs a name.");
    const fields: Record<string, unknown> = {};
    if (name.trim() !== category.name) fields.name = name.trim();
    if ((icon.trim() || null) !== category.icon) fields.icon = icon.trim() || null;
    if (Object.keys(fields).length === 0) return setError("Nothing has changed yet.");
    setError(null);
    await propose({ kind: "category", op: "update", scope, targetId: category.id, fields });
  };

  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        deleteWhat="category"
        onDelete={async () => {
          if (await propose({ kind: "category", op: "delete", scope, targetId: category.id })) onDeleted();
        }}
        title={category.name}
      >
        <p className="text-[13px] text-muted">
          {SCOPE_NAMES[scope]} category · {members.length} in it
        </p>
      </DetailHeader>
      <section className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="cat-name">
          <input id="cat-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Icon" htmlFor="cat-icon">
          <input id="cat-icon" className={inputClass} value={icon} placeholder="mdi:…" onChange={(e) => setIcon(e.target.value)} />
        </Field>
        <div className="flex items-center gap-2 sm:col-span-2">
          <Button tone="primary" onClick={() => void save()}>
            Add to changes
          </Button>
          {error && (
            <span role="alert" className="text-xs text-danger">
              {error}
            </span>
          )}
        </div>
      </section>
      <AssignTool
        h={h}
        title={`${SCOPE_NAMES[scope]} in “${category.name}”`}
        candidate={(e) => e.inRegistry && e.categoryScope === scope}
        isMember={(e) => e.categories[scope] === category.id}
        onAdd={(ids) => void propose(ids.map((id) => ({ kind: "entity", op: "update", targetId: id, fields: { categories: { [scope]: category.id } } })))}
        onRemove={(ids) => void propose(ids.map((id) => ({ kind: "entity", op: "update", targetId: id, fields: { categories: { [scope]: null } } })))}
      />
    </div>
  );
}

function Members({ title, items, onRemove }: { title: string; items: { id: string; name: string; sub?: string }[]; onRemove: (id: string) => void }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">
        {title} · {items.length}
      </h2>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted">None.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-3 py-1.5 text-[13px]">
              <span className="min-w-0 flex-1 truncate">
                {i.name}
                {i.sub && <code className="ml-2 font-mono text-xs text-muted">{i.sub}</code>}
              </span>
              <Button tone="ghost" onClick={() => onRemove(i.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

