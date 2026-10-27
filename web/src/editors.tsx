import { ColumnHeader } from "./table.tsx";
import { useState } from "react";

import { ENTITY_ID_RE } from "../../shared/changes.ts";
import { organizeEntityType } from "../../shared/organize.ts";
import { CATEGORY_SCOPES, type AreaNode, type ChangeInput, type DeviceItem, type EntityItem, type FloorNode, type Hierarchy } from "../../shared/types.ts";
import { useDraftGuard } from "./draft-guard.ts";
import { useTaxis } from "./state.tsx";
import { Actions, AreaSelect, Button, ConfirmAction, Field, inputClass, LabelPicker, Panel } from "./ui.tsx";

// Editors. Each one shows the values as they'll be (pending changes included),
// and "Add to changes" appears once a field differs and proposes only those. Nothing reaches
// Home Assistant until Apply on the Changes page.

const SCOPE_NAMES: Record<string, string> = { automation: "Automations", script: "Scripts", scene: "Scenes", helpers: "Helpers" };

const iconOk = (v: string) => v === "" || /^[a-z0-9]+:[a-z0-9-]+$/.test(v);
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

function useSubmit(onDone: () => void, onSaved?: () => void) {
  const { propose } = useTaxis();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (input: ChangeInput | ChangeInput[] | null) => {
    if (!input || (Array.isArray(input) && input.length === 0)) {
      setError("Nothing has changed yet.");
      return;
    }
    setSaving(true);
    const ok = await propose(input);
    setSaving(false);
    if (ok) { onSaved?.(); onDone(); }
  };
  return { saving, error, setError, submit };
}

export function EntityEditor({ h, entity, onClose }: { h: Hierarchy; entity: EntityItem; onClose: () => void }) {
  const device = entity.deviceId ? h.devices[entity.deviceId] : undefined;
  const deviceArea = device?.areaId ? h.areas[device.areaId]?.name : null;
  const [name, setName] = useState(entity.customName ?? "");
  const domain = entity.entityId.split(".")[0];
  const [objectId, setObjectId] = useState(entity.entityId.slice(domain.length + 1));
  const [area, setArea] = useState<string | null>(entity.ownAreaId);
  const [labels, setLabels] = useState(entity.labels);
  const scope = entity.categoryScope;
  const [category, setCategory] = useState<string>(scope ? entity.categories[scope] ?? "" : "");
  const [hidden, setHidden] = useState(entity.hidden);
  const [disabled, setDisabled] = useState(entity.disabled);
  const [icon, setIcon] = useState(entity.icon ?? "");
  const { saving, error, setError, submit } = useSubmit(onClose, () => guard.release());

  // What differs from the item now. Dirty means save would send a field.
  const newId = `${domain}.${objectId.trim()}`;
  const fields: Record<string, unknown> = {};
  if (newId !== entity.entityId) fields.new_entity_id = newId;
  const newName = name.trim() || null;
  if (newName !== entity.customName) fields.name = newName;
  if (area !== entity.ownAreaId) fields.area_id = area;
  if (!same(labels, entity.labels)) fields.labels = labels;
  if (scope && (category || null) !== (entity.categories[scope] ?? null)) fields.categories = { [scope]: category || null };
  if (hidden !== entity.hidden) fields.hidden_by = hidden ? "user" : null;
  if (disabled !== entity.disabled) fields.disabled_by = disabled ? "user" : null;
  if ((icon.trim() || null) !== entity.icon) fields.icon = icon.trim() || null;
  const dirty = Object.keys(fields).length > 0;
  const guard = useDraftGuard(dirty);

  if (!entity.inRegistry) {
    return (
      <Panel title={entity.name} onClose={() => guard.close(onClose)}>
        <p className="text-[13px] text-muted">
          This entity has no unique id (usually YAML without <code className="font-mono">unique_id</code>), so Home Assistant doesn't let it be renamed, moved or labelled.
        </p>
      </Panel>
    );
  }

  const save = () => {
    if (!iconOk(icon.trim())) return setError("An icon looks like mdi:lightbulb.");
    if (!ENTITY_ID_RE.test(newId)) return setError("An entity id uses lower-case letters, digits and single underscores.");
    void submit(dirty ? { kind: "entity", op: "update", targetId: entity.entityId, fields } : null);
  };

  return (
    <Panel
      title={
        <>
          {entity.name} <code className="ml-1 font-mono text-xs font-normal text-muted">{entity.entityId}</code>
        </>
      }
      onClose={() => guard.close(onClose)}
      actions={<Actions dirty={dirty} onSave={save} onCancel={() => guard.close(onClose)} saving={saving} error={error} />}
    >
      <Field label="Name" htmlFor="ent-name" hint="Leave empty to use the name Home Assistant gives it.">
        <input id="ent-name" className={inputClass} value={name} placeholder={entity.name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field
        label="Entity id"
        htmlFor="ent-id"
        hint="Apply also updates the automations, scripts, scenes and dashboards that use it, and lists anything it can't update."
      >
        <div className="flex items-center gap-1">
          <span className="font-mono text-[13px] text-muted">{domain}.</span>
          <input id="ent-id" className={`${inputClass} font-mono`} value={objectId} spellCheck={false} onChange={(e) => setObjectId(e.target.value)} />
        </div>
      </Field>
      <Field
        label="Area"
        htmlFor="ent-area"
        hint={
          entity.needsOwnName && !name.trim()
            ? "This is its device's main entity, with no name of its own. Home Assistant only allows it an area of its own once it has a name: give it one above, or move the device instead."
            : device
              ? "Setting an area here overrides the device's area for this entity only."
              : undefined
        }
      >
        <AreaSelect
          h={h}
          id="ent-area"
          value={area}
          onChange={setArea}
          noneLabel={device ? `Same as its device${deviceArea ? ` (${deviceArea})` : " (no area)"}` : "No area"}
        />
      </Field>
      <Field label="Labels" htmlFor="ent-labels">
        <LabelPicker h={h} id="ent-labels" value={labels} onChange={setLabels} />
      </Field>
      {scope && (
        <Field label={`Category (${SCOPE_NAMES[scope]})`} htmlFor="ent-category">
          <select id="ent-category" className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">No category</option>
            {h.categories[scope].map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Icon" htmlFor="ent-icon" hint="For example mdi:ceiling-light. Leave empty for the default.">
        <input id="ent-icon" className={inputClass} value={icon} placeholder="mdi:…" onChange={(e) => setIcon(e.target.value)} />
      </Field>
      <div className="flex flex-col gap-1.5 text-[13px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hidden in Home Assistant's dashboards
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={disabled}
            disabled={entity.disabledBy === "device" || entity.disabledBy === "config_entry"}
            onChange={(e) => setDisabled(e.target.checked)}
          />{" "}
          Disabled
        </label>
        {entity.hiddenBy && entity.hiddenBy !== "user" && !hidden && (
          <p className="text-xs text-warn">Its integration hid it ({entity.hiddenBy}). Showing it overrides that choice.</p>
        )}
        {entity.disabledBy === "integration" && !disabled && <p className="text-xs text-warn">Its integration disabled it. Enabling it overrides that choice.</p>}
        {(entity.disabledBy === "device" || entity.disabledBy === "config_entry") && (
          <p className="text-xs text-muted">
            It's disabled because its {entity.disabledBy === "device" ? "device is" : "integration entry is"} disabled. Enable the{" "}
            {entity.disabledBy === "device" ? "device" : "integration entry"} instead; Home Assistant ignores enabling the entity alone.
          </p>
        )}
        {disabled !== entity.disabled && (
          <p className="text-xs text-warn">
            {disabled ? "Home Assistant stops this entity: it stops updating and automations can't use it." : "Home Assistant starts this entity again; its integration may reload."}
          </p>
        )}
      </div>
    </Panel>
  );
}

export function DeviceEditor({ h, device, onClose }: { h: Hierarchy; device: DeviceItem; onClose: () => void }) {
  const [name, setName] = useState(device.customName ?? "");
  const [area, setArea] = useState<string | null>(device.areaId);
  const [labels, setLabels] = useState(device.labels);
  const [disabled, setDisabled] = useState(device.disabled);
  const { saving, error, submit } = useSubmit(onClose, () => guard.release());
  const followers = device.entityIds.filter((id) => h.entities[id] && !h.entities[id].ownAreaId).length;

  const fields: Record<string, unknown> = {};
  if ((name.trim() || null) !== device.customName) fields.name_by_user = name.trim() || null;
  if (area !== device.areaId) fields.area_id = area;
  if (!same(labels, device.labels)) fields.labels = labels;
  if (disabled !== device.disabled) fields.disabled_by = disabled ? "user" : null;
  const dirty = Object.keys(fields).length > 0;
  const guard = useDraftGuard(dirty);
  const save = () => void submit(dirty ? { kind: "device", op: "update", targetId: device.id, fields } : null);

  return (
    <div className="flex flex-col gap-4">
    <Panel title={device.name} onClose={() => guard.close(onClose)} actions={<Actions dirty={dirty} onSave={save} onCancel={() => guard.close(onClose)} saving={saving} error={error} />}>
      <p className="text-xs text-muted">{[device.manufacturer, device.model].filter(Boolean).join(" · ") || "Unknown model"}</p>
      <Field label="Name" htmlFor="dev-name" hint="Leave empty to use the name its integration gives it.">
        <input id="dev-name" className={inputClass} value={name} placeholder={device.name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Area" htmlFor="dev-area" hint={`${followers} of its ${device.entityIds.length} entities follow the device's area.`}>
        <AreaSelect h={h} id="dev-area" value={area} onChange={setArea} noneLabel="No area" />
      </Field>
      <Field label="Labels" htmlFor="dev-labels">
        <LabelPicker h={h} id="dev-labels" value={labels} onChange={setLabels} />
      </Field>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} /> Disabled (all its entities stop)
      </label>
    </Panel>
    <DeviceEntities h={h} device={device} />
    </div>
  );
}

// Every entity is shown here, including diagnostics and disabled entities, so a
// device's detail never looks empty merely because a list filter hid its children.
export function DeviceEntities({ h, device }: { h: Hierarchy; device: DeviceItem }) {
  const entities = device.entityIds.map(id => h.entities[id]).filter((entity): entity is EntityItem => Boolean(entity)).sort((a, b) => a.name.localeCompare(b.name));
  return <section aria-labelledby={`device-entities-${device.id}`} className="rounded-lg border border-line bg-surface">
    <h2 id={`device-entities-${device.id}`} className="border-b border-line px-3.5 py-3 text-sm font-semibold">Entities ({entities.length})</h2>
    {entities.length === 0 ? <p className="p-3.5 text-[13px] text-muted">This device has no entities.</p> : <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-sunken text-xs text-muted"><tr><ColumnHeader>Name / entity id</ColumnHeader><ColumnHeader>State</ColumnHeader><ColumnHeader>Area</ColumnHeader></tr></thead>
        <tbody>{entities.map(entity => <tr key={entity.entityId} className="border-t border-line align-top">
          <td className="px-3 py-2"><a className="text-accent hover:underline" href={`#organize/${organizeEntityType(entity)}/${encodeURIComponent(entity.entityId)}`}>{entity.name}</a><code className="block break-all font-mono text-[11px] text-muted">{entity.entityId}</code>
            <div className="flex flex-wrap gap-1 text-[11px] text-muted">{entity.disabled && <span>Disabled</span>}{entity.hidden && <span>Hidden</span>}{entity.maintenance && <span>Diagnostic / configuration</span>}</div>
          </td>
          <td className="px-3 py-2">{entity.state ?? "No state"}{entity.unit && <span> {entity.unit}</span>}</td>
          <td className="px-3 py-2">{entity.areaId ? h.areas[entity.areaId]?.name ?? entity.areaId : "No area"}{entity.ownAreaId === null && <span className="block text-[11px] text-muted">Follows device</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}

export function AreaEditor({ h, area, onClose, onDeleted }: { h: Hierarchy; area: AreaNode; onClose: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(area.name);
  const [floor, setFloor] = useState<string>(area.floorId ?? "");
  const [labels, setLabels] = useState(area.labels);
  const [icon, setIcon] = useState(area.icon ?? "");
  const { saving, error, setError, submit } = useSubmit(onClose, () => guard.release());
  const del = useSubmit(onDeleted, () => guard.release());

  const fields: Record<string, unknown> = {};
  if (name.trim() !== area.name) fields.name = name.trim();
  if ((floor || null) !== area.floorId) fields.floor_id = floor || null;
  if (!same(labels, area.labels)) fields.labels = labels;
  if ((icon.trim() || null) !== area.icon) fields.icon = icon.trim() || null;
  const dirty = Object.keys(fields).length > 0;
  const guard = useDraftGuard(dirty);

  const save = () => {
    if (!name.trim()) return setError("An area needs a name.");
    if (!iconOk(icon.trim())) return setError("An icon looks like mdi:sofa.");
    void submit(dirty ? { kind: "area", op: "update", targetId: area.id, fields } : null);
  };

  return (
    <Panel
      title={`Edit area: ${area.name}`}
      onClose={() => guard.close(onClose)}
      actions={
        <Actions
          dirty={dirty}
          onSave={save}
          onCancel={() => guard.close(onClose)}
          saving={saving}
          error={error ?? del.error}
          danger={
            <ConfirmAction
              wide
              question={`Delete area “${area.name}”? Its devices and entities end up with no area.`}
              onConfirm={() => void del.submit({ kind: "area", op: "delete", targetId: area.id })}
            >
              Delete area
            </ConfirmAction>
          }
        />
      }
    >
      <Field label="Name" htmlFor="area-name">
        <input id="area-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Floor" htmlFor="area-floor">
        <select id="area-floor" className={inputClass} value={floor} onChange={(e) => setFloor(e.target.value)}>
          <option value="">No floor</option>
          {h.floors.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Icon" htmlFor="area-icon">
        <input id="area-icon" className={inputClass} value={icon} placeholder="mdi:…" onChange={(e) => setIcon(e.target.value)} />
      </Field>
      <Field label="Labels" htmlFor="area-labels">
        <LabelPicker h={h} id="area-labels" value={labels} onChange={setLabels} />
      </Field>
      <p className="text-xs text-muted">Deleting an area keeps its devices and entities; they end up with no area.</p>
    </Panel>
  );
}

export function FloorEditor({ floor, onClose, onDeleted }: { floor: FloorNode; onClose: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(floor.name);
  const [level, setLevel] = useState(floor.level === null ? "" : String(floor.level));
  const [icon, setIcon] = useState(floor.icon ?? "");
  const { saving, error, setError, submit } = useSubmit(onClose, () => guard.release());
  const del = useSubmit(onDeleted, () => guard.release());

  const lv = level === "" ? null : Number(level);
  const fields: Record<string, unknown> = {};
  if (name.trim() !== floor.name) fields.name = name.trim();
  if (lv !== floor.level) fields.level = lv;
  if ((icon.trim() || null) !== floor.icon) fields.icon = icon.trim() || null;
  const dirty = Object.keys(fields).length > 0;
  const guard = useDraftGuard(dirty);

  const save = () => {
    if (!name.trim()) return setError("A floor needs a name.");
    if (level !== "" && !/^-?\d+$/.test(level)) return setError("The level is a whole number: 0 for the ground floor, -1 below it.");
    void submit(dirty ? { kind: "floor", op: "update", targetId: floor.id, fields } : null);
  };

  return (
    <Panel
      title={`Edit floor: ${floor.name}`}
      onClose={() => guard.close(onClose)}
      actions={
        <Actions
          dirty={dirty}
          onSave={save}
          onCancel={() => guard.close(onClose)}
          saving={saving}
          error={error ?? del.error}
          danger={
            <ConfirmAction
              wide
              question={`Delete floor “${floor.name}”? Its areas end up with no floor.`}
              onConfirm={() => void del.submit({ kind: "floor", op: "delete", targetId: floor.id })}
            >
              Delete floor
            </ConfirmAction>
          }
        />
      }
    >
      <Field label="Name" htmlFor="floor-name">
        <input id="floor-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Level" htmlFor="floor-level" hint="Sets the order: 0 is the ground floor, -1 the one below.">
        <input id="floor-level" className={inputClass} inputMode="numeric" value={level} onChange={(e) => setLevel(e.target.value)} />
      </Field>
      <Field label="Icon" htmlFor="floor-icon">
        <input id="floor-icon" className={inputClass} value={icon} placeholder="mdi:…" onChange={(e) => setIcon(e.target.value)} />
      </Field>
      <p className="text-xs text-muted">Deleting a floor keeps its areas; they end up with no floor.</p>
    </Panel>
  );
}

// A one-line form that creates an area (on a floor) or a floor.
export function NewItemForm({ kind, floorId, onDone }: { kind: "area" | "floor"; floorId?: string | null; onDone: () => void }) {
  const [name, setName] = useState("");
  const [level, setLevel] = useState("");
  const guard = useDraftGuard(name.trim() !== "" || level.trim() !== "");
  const { saving, error, setError, submit } = useSubmit(() => {
    setName("");
    setLevel("");
    onDone();
  }, () => guard.release());
  const create = () => {
    if (!name.trim()) return setError(`Give the new ${kind} a name.`);
    const fields: Record<string, unknown> = { name: name.trim() };
    if (kind === "area" && floorId) fields.floor_id = floorId;
    if (kind === "floor" && level !== "") {
      if (!/^-?\d+$/.test(level)) return setError("The level is a whole number.");
      fields.level = Number(level);
    }
    void submit({ kind, op: "create", fields });
  };
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        create();
      }}
    >
      <Field label={kind === "area" ? "New area" : "New floor"} htmlFor={`new-${kind}`}>
        <input id={`new-${kind}`} className={inputClass} value={name} placeholder={kind === "area" ? "Laundry room" : "Basement"} onChange={(e) => setName(e.target.value)} />
      </Field>
      {kind === "floor" && (
        <Field label="Level" htmlFor="new-floor-level">
          <input id="new-floor-level" className={`${inputClass} w-20!`} inputMode="numeric" value={level} placeholder="-1" onChange={(e) => setLevel(e.target.value)} />
        </Field>
      )}
      <Button type="submit" disabled={saving}>
        Add
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </form>
  );
}

export { CATEGORY_SCOPES, SCOPE_NAMES };
