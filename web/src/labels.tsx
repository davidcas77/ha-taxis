import { useState, type ReactNode } from "react";

import { type CategoryItem, type ChangeInput, type EntityItem, type Hierarchy, type LabelItem } from "../../shared/types.ts";
import { SCOPE_NAMES } from "./editors.tsx";
import { AssignTool } from "./assign.tsx";
import { EntityLabels } from "./entity-labels.tsx";
import { useTaxis } from "./state.tsx";
import { Actions, ConfirmAction, Field, HeaderBar, PageHeader, inputClass, LABEL_COLORS, labelColor } from "./ui.tsx";

// Label and category details, shown in the Organize page's right pane. Labels
// go on areas, devices and entities; categories file automations, scripts,
// scenes and helpers, one list per kind as in Home Assistant. Both have an
// assign tool to put many entities in or take them out at once.

export { NewForm } from "./new-form.tsx";

// ---------------------------------------------------------------------------

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export type LabelUse = { total: number; areas: string[]; devices: string[]; entities: string[] };

export function labelUsage(h: Hierarchy): Map<string, LabelUse> {
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

export function categoryUsage(h: Hierarchy): Map<string, EntityItem[]> {
  const m = new Map<string, EntityItem[]>();
  for (const e of Object.values(h.entities)) {
    for (const [scope, id] of Object.entries(e.categories)) {
      const key = `${scope}:${id}`;
      m.set(key, [...(m.get(key) ?? []), e]);
    }
  }
  return m;
}

// Title on the left, the same actions as every editor on the right.
function DetailHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions: ReactNode }) {
  return (
    <HeaderBar>
      <div className="min-w-[8rem] flex-1">
        <PageHeader title={title} description={description} />
      </div>
      {actions}
    </HeaderBar>
  );
}

export function LabelDetail({ h, label, usage, onDeleted }: { h: Hierarchy; label: LabelItem; usage: LabelUse | undefined; onDeleted: () => void }) {
  const { propose } = useTaxis();
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color ?? "");
  const [icon, setIcon] = useState(label.icon ?? "");
  const [description, setDescription] = useState(label.description ?? "");
  const [error, setError] = useState<string | null>(null);

  const fields: Record<string, unknown> = {};
  if (name.trim() !== label.name) fields.name = name.trim();
  if ((color || null) !== label.color) fields.color = color || null;
  if ((icon.trim() || null) !== label.icon) fields.icon = icon.trim() || null;
  if ((description.trim() || null) !== label.description) fields.description = description.trim() || null;
  const dirty = Object.keys(fields).length > 0;

  const save = async () => {
    if (!name.trim()) return setError("A label needs a name.");
    if (icon.trim() && !/^[a-z0-9]+:[a-z0-9-]+$/.test(icon.trim())) return setError("An icon looks like mdi:tag.");
    if (!dirty) return;
    setError(null);
    await propose({ kind: "label", op: "update", targetId: label.id, fields });
  };
  // No panel to close here: Cancel puts the fields back as they were.
  const revert = () => {
    setName(label.name);
    setColor(label.color ?? "");
    setIcon(label.icon ?? "");
    setDescription(label.description ?? "");
    setError(null);
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
        actions={
          <Actions
            dirty={dirty}
            onSave={() => void save()}
            onCancel={dirty ? revert : undefined}
            error={error}
            danger={
              <ConfirmAction
                wide
                question={`Delete label “${label.name}”? Home Assistant removes it from everything it's on.`}
                onConfirm={() => void propose({ kind: "label", op: "delete", targetId: label.id }).then((ok) => ok && onDeleted())}
              >
                Delete label
              </ConfirmAction>
            }
          />
        }
        title={
          <>
            <span aria-hidden className="size-3 rounded-full" style={{ background: labelColor(label.color) ?? "var(--off)" }} />
            {label.name}
          </>
        }
        description={`On ${count(usage?.areas.length ?? 0, "area")}, ${count(usage?.devices.length ?? 0, "device")} and ${count(usage?.entities.length ?? 0, "entity", "entities")}.`}
      />

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
      </section>

      <Members
        title="Areas"
        what="area"
        from={label.name}
        items={(usage?.areas ?? []).map((id) => ({ id, name: h.areas[id]?.name ?? id }))}
        onRemove={(id) => void propose(removeFrom("area", id, h.areas[id].labels))}
      />
      <Members
        title="Devices"
        what="device"
        from={label.name}
        items={(usage?.devices ?? []).map((id) => ({ id, name: h.devices[id]?.name ?? id }))}
        onRemove={(id) => void propose(removeFrom("device", id, h.devices[id].labels))}
      />
      <EntityLabels h={h} initialLabelId={label.id} title="Entities and labels" />
    </div>
  );
}

export function CategoryDetail({ h, category, members, onDeleted }: { h: Hierarchy; category: CategoryItem; members: EntityItem[]; onDeleted: () => void }) {
  const { propose } = useTaxis();
  const [name, setName] = useState(category.name);
  const [icon, setIcon] = useState(category.icon ?? "");
  const [error, setError] = useState<string | null>(null);
  const scope = category.scope;

  const fields: Record<string, unknown> = {};
  if (name.trim() !== category.name) fields.name = name.trim();
  if ((icon.trim() || null) !== category.icon) fields.icon = icon.trim() || null;
  const dirty = Object.keys(fields).length > 0;

  const save = async () => {
    if (!name.trim()) return setError("A category needs a name.");
    if (!dirty) return;
    setError(null);
    await propose({ kind: "category", op: "update", scope, targetId: category.id, fields });
  };
  const revert = () => {
    setName(category.name);
    setIcon(category.icon ?? "");
    setError(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        actions={
          <Actions
            dirty={dirty}
            onSave={() => void save()}
            onCancel={dirty ? revert : undefined}
            error={error}
            danger={
              <ConfirmAction
                wide
                question={`Delete category “${category.name}”? Its ${SCOPE_NAMES[scope].toLowerCase()} end up with no category.`}
                onConfirm={() => void propose({ kind: "category", op: "delete", scope, targetId: category.id }).then((ok) => ok && onDeleted())}
              >
                Delete category
              </ConfirmAction>
            }
          />
        }
        title={category.name}
        description={`${SCOPE_NAMES[scope]} category · ${members.length} in it`}
      />
      <section className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="cat-name">
          <input id="cat-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Icon" htmlFor="cat-icon">
          <input id="cat-icon" className={inputClass} value={icon} placeholder="mdi:…" onChange={(e) => setIcon(e.target.value)} />
        </Field>
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

function Members({
  title,
  what,
  from,
  items,
  onRemove,
}: {
  title: string;
  what: string;
  from: string;
  items: { id: string; name: string; sub?: string }[];
  onRemove: (id: string) => void;
}) {
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
              <ConfirmAction tone="ghost" question={`Take label “${from}” off ${what} “${i.name}”?`} onConfirm={() => onRemove(i.id)}>
                Remove
              </ConfirmAction>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
