import { useState } from "react";

import { CATEGORY_SCOPES, type AreaNode, type ChangeInput, type DeviceItem, type EntityItem, type FloorNode, type Hierarchy } from "../../shared/types.ts";
import { useTaxis } from "./state.tsx";
import { AreaSelect, Button, Field, inputClass, LabelPicker, Panel } from "./ui.tsx";

// Editors. Each one shows the values as they'll be (pending changes included),
// and "Add to changes" proposes only the fields that differ. Nothing reaches
// Home Assistant until Apply on the Changes page.

const SCOPE_NAMES: Record<string, string> = { automation: "Automations", script: "Scripts", scene: "Scenes", helpers: "Helpers" };

const iconOk = (v: string) => v === "" || /^[a-z0-9]+:[a-z0-9-]+$/.test(v);
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

function Actions({ onSave, onCancel, saving, error }: { onSave: () => void; onCancel: () => void; saving: boolean; error: string | null }) {
  return (
    <>
      <Button tone="primary" onClick={onSave} disabled={saving}>
        Add to changes
      </Button>
      <Button tone="ghost" onClick={onCancel}>
        Cancel
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </>
  );
}

function useSubmit(onDone: () => void) {
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
    if (ok) onDone();
  };
  return { saving, error, setError, submit };
}

export function EntityEditor({ h, entity, onClose }: { h: Hierarchy; entity: EntityItem; onClose: () => void }) {
  const device = entity.deviceId ? h.devices[entity.deviceId] : undefined;
  const deviceArea = device?.areaId ? h.areas[device.areaId]?.name : null;
  const [name, setName] = useState(entity.customName ?? "");
  const [area, setArea] = useState<string | null>(entity.ownAreaId);
  const [labels, setLabels] = useState(entity.labels);
  const scope = entity.categoryScope;
  const [category, setCategory] = useState<string>(scope ? entity.categories[scope] ?? "" : "");
  const [hidden, setHidden] = useState(entity.hidden);
  const [disabled, setDisabled] = useState(entity.disabled);
  const [icon, setIcon] = useState(entity.icon ?? "");
  const { saving, error, setError, submit } = useSubmit(onClose);

  if (!entity.inRegistry) {
    return (
      <Panel title={entity.name} onClose={onClose}>
        <p className="text-[13px] text-muted">
          This entity has no unique id (usually YAML without <code className="font-mono">unique_id</code>), so Home Assistant doesn't let it be renamed, moved or labelled.
        </p>
      </Panel>
    );
  }

  const save = () => {
    if (!iconOk(icon.trim())) return setError("An icon looks like mdi:lightbulb.");
    const fields: Record<string, unknown> = {};
    const newName = name.trim() || null;
    if (newName !== entity.customName) fields.name = newName;
    if (area !== entity.ownAreaId) fields.area_id = area;
    if (!same(labels, entity.labels)) fields.labels = labels;
    if (scope && (category || null) !== (entity.categories[scope] ?? null)) fields.categories = { [scope]: category || null };
    if (hidden !== entity.hidden) fields.hidden_by = hidden ? "user" : null;
    if (disabled !== entity.disabled) fields.disabled_by = disabled ? "user" : null;
    if ((icon.trim() || null) !== entity.icon) fields.icon = icon.trim() || null;
    void submit(Object.keys(fields).length ? { kind: "entity", op: "update", targetId: entity.entityId, fields } : null);
  };

  return (
    <Panel
      title={
        <>
          {entity.name} <code className="ml-1 font-mono text-xs font-normal text-muted">{entity.entityId}</code>
        </>
      }
      onClose={onClose}
      footer={<Actions onSave={save} onCancel={onClose} saving={saving} error={error} />}
    >
      <Field label="Name" htmlFor="ent-name" hint="Leave empty to use the name Home Assistant gives it.">
        <input id="ent-name" className={inputClass} value={name} placeholder={entity.name} onChange={(e) => setName(e.target.value)} />
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
  const { saving, error, submit } = useSubmit(onClose);
  const followers = device.entityIds.filter((id) => h.entities[id] && !h.entities[id].ownAreaId).length;

  const save = () => {
    const fields: Record<string, unknown> = {};
    if ((name.trim() || null) !== device.customName) fields.name_by_user = name.trim() || null;
    if (area !== device.areaId) fields.area_id = area;
    if (!same(labels, device.labels)) fields.labels = labels;
    if (disabled !== device.disabled) fields.disabled_by = disabled ? "user" : null;
    void submit(Object.keys(fields).length ? { kind: "device", op: "update", targetId: device.id, fields } : null);
  };

  return (
    <Panel title={device.name} onClose={onClose} footer={<Actions onSave={save} onCancel={onClose} saving={saving} error={error} />}>
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
  );
}

function DeleteButton({ what, onDelete }: { what: string; onDelete: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button tone="danger" className="ml-auto" onClick={() => setAsking(true)}>
        Delete {what}
      </Button>
    );
  }
  return (
    <span className="ml-auto flex items-center gap-2 text-xs">
      Delete this {what}?
      <Button tone="danger" onClick={onDelete}>
        Yes, delete
      </Button>
      <Button tone="ghost" onClick={() => setAsking(false)}>
        Keep it
      </Button>
    </span>
  );
}

export function AreaEditor({ h, area, onClose, onDeleted }: { h: Hierarchy; area: AreaNode; onClose: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(area.name);
  const [floor, setFloor] = useState<string>(area.floorId ?? "");
  const [labels, setLabels] = useState(area.labels);
  const [icon, setIcon] = useState(area.icon ?? "");
  const { saving, error, setError, submit } = useSubmit(onClose);
  const del = useSubmit(onDeleted);

  const save = () => {
    if (!name.trim()) return setError("An area needs a name.");
    if (!iconOk(icon.trim())) return setError("An icon looks like mdi:sofa.");
    const fields: Record<string, unknown> = {};
    if (name.trim() !== area.name) fields.name = name.trim();
    if ((floor || null) !== area.floorId) fields.floor_id = floor || null;
    if (!same(labels, area.labels)) fields.labels = labels;
    if ((icon.trim() || null) !== area.icon) fields.icon = icon.trim() || null;
    void submit(Object.keys(fields).length ? { kind: "area", op: "update", targetId: area.id, fields } : null);
  };

  return (
    <Panel
      title={`Edit area: ${area.name}`}
      onClose={onClose}
      footer={
        <>
          <Actions onSave={save} onCancel={onClose} saving={saving} error={error ?? del.error} />
          <DeleteButton what="area" onDelete={() => void del.submit({ kind: "area", op: "delete", targetId: area.id })} />
        </>
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
  const { saving, error, setError, submit } = useSubmit(onClose);
  const del = useSubmit(onDeleted);

  const save = () => {
    if (!name.trim()) return setError("A floor needs a name.");
    if (level !== "" && !/^-?\d+$/.test(level)) return setError("The level is a whole number: 0 for the ground floor, -1 below it.");
    const fields: Record<string, unknown> = {};
    if (name.trim() !== floor.name) fields.name = name.trim();
    const lv = level === "" ? null : Number(level);
    if (lv !== floor.level) fields.level = lv;
    if ((icon.trim() || null) !== floor.icon) fields.icon = icon.trim() || null;
    void submit(Object.keys(fields).length ? { kind: "floor", op: "update", targetId: floor.id, fields } : null);
  };

  return (
    <Panel
      title={`Edit floor: ${floor.name}`}
      onClose={onClose}
      footer={
        <>
          <Actions onSave={save} onCancel={onClose} saving={saving} error={error ?? del.error} />
          <DeleteButton what="floor" onDelete={() => void del.submit({ kind: "floor", op: "delete", targetId: floor.id })} />
        </>
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
  const { saving, error, setError, submit } = useSubmit(() => {
    setName("");
    setLevel("");
    onDone();
  });
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
          <input id="new-floor-level" className={`${inputClass} w-20`} inputMode="numeric" value={level} placeholder="-1" onChange={(e) => setLevel(e.target.value)} />
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
