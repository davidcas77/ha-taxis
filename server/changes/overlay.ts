import { applyLabelDiff, labelDiff } from "../../shared/changes.ts";
import type { Change } from "../../shared/types.ts";
import type { RawCategory, RawRegistry } from "../model/hierarchy.ts";

// The preview: what Home Assistant will look like once the change list is
// applied. Changes are laid over a copy of the registries as last read, and the
// hierarchy is built from that copy, so every screen shows the result. Items
// created in Taxis carry their temporary ids ("new:area:12") until applied.

export function overlayChanges(raw: RawRegistry, changes: Change[]): RawRegistry {
  const r: RawRegistry = structuredClone(raw);
  r.categories = { ...(r.categories ?? {}) };

  const byId = <T,>(list: T[], key: keyof T, id: string) => list.find((x) => x[key] === id);
  const remove = <T,>(list: T[], key: keyof T, id: string) => list.filter((x) => x[key] !== id);

  // Labels are laid on as "added and removed", so a label Home Assistant gained
  // since the edit still shows.
  const withLabels = <T extends { labels?: string[] }>(item: T | undefined, c: Change, rest: Record<string, unknown>) => {
    if (!item) return;
    const { labels: _l, ...others } = rest;
    Object.assign(item, others);
    const d = labelDiff(c);
    if (d) item.labels = applyLabelDiff(item.labels ?? [], d);
  };

  for (const c of changes) {
    const a = c.after as Record<string, never>;
    switch (c.kind) {
      case "floor":
        if (c.op === "create") r.floors.push({ floor_id: c.targetId, name: a.name, level: a.level ?? null, icon: a.icon ?? null });
        else if (c.op === "delete") {
          r.floors = remove(r.floors, "floor_id", c.targetId);
          for (const area of r.areas) if (area.floor_id === c.targetId) area.floor_id = null;
        } else Object.assign(byId(r.floors, "floor_id", c.targetId) ?? {}, a);
        break;
      case "area":
        if (c.op === "create") r.areas.push({ area_id: c.targetId, name: a.name, floor_id: a.floor_id ?? null, icon: a.icon ?? null, labels: a.labels ?? [] });
        else if (c.op === "delete") {
          r.areas = remove(r.areas, "area_id", c.targetId);
          for (const d of r.devices) if (d.area_id === c.targetId) d.area_id = null;
          for (const e of r.entities) if (e.area_id === c.targetId) e.area_id = null;
        } else withLabels(byId(r.areas, "area_id", c.targetId), c, a);
        break;
      case "label":
        if (c.op === "create") r.labels.push({ label_id: c.targetId, name: a.name, color: a.color ?? null, icon: a.icon ?? null, description: a.description ?? null });
        else if (c.op === "delete") {
          r.labels = remove(r.labels, "label_id", c.targetId);
          const drop = (labels?: string[]) => labels?.filter((l) => l !== c.targetId);
          for (const x of [...r.areas, ...r.devices, ...r.entities]) x.labels = drop(x.labels);
        } else Object.assign(byId(r.labels, "label_id", c.targetId) ?? {}, a);
        break;
      case "category": {
        const scope = c.scope!;
        let list: RawCategory[] = [...(r.categories[scope] ?? [])];
        if (c.op === "create") list.push({ category_id: c.targetId, name: a.name, icon: a.icon ?? null });
        else if (c.op === "delete") {
          list = remove(list, "category_id", c.targetId);
          for (const e of r.entities) if (e.categories?.[scope] === c.targetId) delete e.categories[scope];
        } else Object.assign(byId(list, "category_id", c.targetId) ?? {}, a);
        r.categories[scope] = list;
        break;
      }
      case "device":
        withLabels(byId(r.devices, "id", c.targetId), c, a);
        break;
      case "entity": {
        const e = byId(r.entities, "entity_id", c.targetId);
        if (!e) break;
        const { categories, ...rest } = c.after as { categories?: Record<string, string | null> };
        const { new_entity_id: newId, ...fields } = rest as { new_entity_id?: string } & Record<string, unknown>;
        withLabels(e, c, fields);
        // The displayed name comes from the live state; show the new one now.
        // After Apply, the fresh read brings the name Home Assistant settles on.
        if ("name" in fields) {
          const st = r.states.find((x) => x.entity_id === c.targetId);
          if (st && typeof fields.name === "string") st.attributes = { ...st.attributes, friendly_name: fields.name };
        }
        // The class is read from the live state too; show the one chosen now (or,
        // when it is cleared, the integration's own).
        if ("device_class" in fields) {
          const st = r.states.find((x) => x.entity_id === c.targetId);
          if (st) st.attributes = { ...st.attributes, device_class: (typeof fields.device_class === "string" ? fields.device_class : e.original_device_class) ?? undefined };
        }
        // A rename shows everywhere at once: the entity, its state, the groups
        // it's in, and the area that uses it as its temperature or humidity.
        if (typeof newId === "string") renameInRaw(r, c.targetId, newId);
        if (categories) {
          const merged: Record<string, string> = { ...(e.categories ?? {}) };
          for (const [scope, id] of Object.entries(categories)) {
            if (id) merged[scope] = id;
            else delete merged[scope];
          }
          e.categories = merged;
        }
        break;
      }
    }
  }
  return r;
}

export function renameInRaw(r: RawRegistry, oldId: string, newId: string): void {
  for (const e of r.entities) if (e.entity_id === oldId) e.entity_id = newId;
  for (const st of r.states) {
    if (st.entity_id === oldId) st.entity_id = newId;
    const members = st.attributes?.entity_id;
    if (Array.isArray(members) && members.includes(oldId)) st.attributes = { ...st.attributes, entity_id: members.map((m) => (m === oldId ? newId : m)) };
  }
  for (const a of r.areas) {
    if (a.temperature_entity_id === oldId) a.temperature_entity_id = newId;
    if (a.humidity_entity_id === oldId) a.humidity_entity_id = newId;
  }
}
