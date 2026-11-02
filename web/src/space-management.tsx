import { useMemo, useState } from "react";
import { areaSpace, planSpaceLabels, resolveSpaces } from "../../shared/spaces.ts";
import type { ChangeInput, Hierarchy } from "../../shared/types.ts";
import { api } from "./api.ts";
import { useDraftGuard } from "./draft-guard.ts";
import { useTaxis } from "./state.tsx";
import { Button, inputClass } from "./ui.tsx";

export function SpaceManagement({ h }: { h: Hierarchy }) {
  const { changes, propose, busy, reload, reviewChanges } = useTaxis();
  const spaces = useMemo(() => resolveSpaces(h, changes), [h, changes]);
  const [name, setName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [rename, setRename] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const renameDirty = renameId !== null && rename !== (spaces.find((space) => space.id === renameId)?.name ?? "");
  const assignmentDirty = Object.entries(draft).some(([id, value]) => {
    if (!h.areas[id]) return true;
    const scope = areaSpace(h, id);
    return value !== (scope.kind === "conflict" ? "__conflict__" : scope.kind === "space" ? scope.space.id : "");
  });
  const guard = useDraftGuard(name.trim() !== "" || renameDirty || assignmentDirty);
  const locked = busy || saving;
  const validName = (value: string, except?: string) => {
    const trimmed = value.trim();
    if (!trimmed) return "Enter a Space name.";
    if (spaces.some((space) => space.id !== except && space.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase()))
      return "A Space with this name already exists.";
    return null;
  };
  const create = async () => {
    const message = validName(name);
    if (message) return setError(message);
    setError(null);
    setSaving(true);
    try {
      if (await propose({ kind: "label", op: "create", fields: { name: `Space: ${name.trim()}` } })) {
        if (!renameDirty && !assignmentDirty) guard.release();
        setName("");
        await reload(false);
      } else setError("Could not create the Space label.");
    } finally {
      setSaving(false);
    }
  };
  const saveName = async (id: string) => {
    if (!spaces.some((space) => space.id === id)) return setError("This Space is no longer available. Refresh and review the draft.");
    const message = validName(rename, id);
    if (message) return setError(message);
    setError(null);
    setSaving(true);
    try {
      if (await propose({ kind: "label", op: "update", targetId: id, fields: { name: `Space: ${rename.trim()}` } })) {
        if (!name.trim() && !assignmentDirty) guard.release();
        setRenameId(null);
        await reload(false);
      } else setError("Could not rename the Space.");
    } finally {
      setSaving(false);
    }
  };
  const assign = async () => {
    setError(null);
    setSaving(true);
    try {
      const current = await api.hierarchy();
      if (!current.ok) return setError(current.error);
      const inputs: ChangeInput[] = [];
      for (const [areaId, value] of Object.entries(draft)) {
        if (!current.hierarchy.areas[areaId]) return setError(`Area ${areaId} is no longer available. Review the assignments.`);
        if (value && !resolveSpaces(current.hierarchy, changes).some((space) => space.id === value))
          return setError(`Space ${value} is no longer available. Review the assignments.`);
        const plan = planSpaceLabels(current.hierarchy, areaId, value || null);
        if (!plan.ok) return setError(plan.error);
        const existing = current.hierarchy.areas[areaId]?.labels ?? [];
        if (existing.length !== plan.labels.length || existing.some((id) => !plan.labels.includes(id)))
          inputs.push({ kind: "area", op: "update", targetId: areaId, fields: { labels: plan.labels } });
      }
      if (inputs.length && !(await propose(inputs))) return setError("Could not save the Space assignments.");
      if (!name.trim() && !renameDirty) guard.release();
      setDraft({});
      if (!(await reload(false))) setError("Assignments were submitted, but the view could not be refreshed.");
    } finally {
      setSaving(false);
    }
  };
  const areas = Object.values(h.areas).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const groups = h.floors.map((floor) => ({ id: floor.id, name: floor.name, areas: areas.filter((area) => area.floorId === floor.id) }));
  const floorIds = new Set(h.floors.map((floor) => floor.id));
  const loose = areas.filter((area) => !area.floorId || !floorIds.has(area.floorId));
  if (loose.length) groups.push({ id: "__loose__", name: "No floor", areas: loose });
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        Spaces group areas independently of floors. Each area can belong to one Space. Existing automations remain unchanged until reviewed and updated.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          New Space name
          <input className={`${inputClass} mt-1 block`} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <Button disabled={locked || !name.trim()} onClick={() => void create()}>
          Create Space
        </Button>
      </div>
      {spaces.length === 0 && <p className="text-muted">No Spaces yet.</p>}
      {renameId && !spaces.some((space) => space.id === renameId) && (
        <div className="text-warn">
          The Space being renamed is no longer available. Your draft: {rename}
          <Button
            onClick={() => {
              if (renameDirty && !window.confirm("Discard your unsaved Space rename?")) return;
              if (!name.trim() && !assignmentDirty) guard.release();
              setRenameId(null);
            }}
          >
            Discard rename
          </Button>
        </div>
      )}
      {spaces.map((space) => (
        <div key={space.id} className="rounded border border-line p-2">
          {renameId === space.id ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs">
                Space name
                <input className={`${inputClass} mt-1 block`} value={rename} onChange={(event) => setRename(event.target.value)} />
              </label>
              <Button disabled={locked} onClick={() => void saveName(space.id)}>
                Save name
              </Button>
              <Button
                disabled={locked}
                onClick={() => {
                  if (renameDirty && !window.confirm("Discard your unsaved Space rename?")) return;
                  if (!name.trim() && !assignmentDirty) guard.release();
                  setRenameId(null);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <strong>{space.name}</strong>
              <span className="text-xs text-muted">
                {space.areaIds.length} {space.areaIds.length === 1 ? "area" : "areas"}
              </span>
              <Button
                disabled={locked || space.id.startsWith("new:") || changes.some((change) => change.kind === "label" && change.targetId === space.id)}
                onClick={() => {
                  setRenameId(space.id);
                  setRename(space.name);
                }}
              >
                Rename
              </Button>
            </div>
          )}
          {space.blocked && <p className="mt-1 text-xs text-warn">{space.blocked}</p>}
        </div>
      ))}
      <h3 className="font-semibold">Assign areas</h3>
      <p className="text-xs text-muted">Choose a Space for each area, then save the assignments together. Unassigned areas remain in the legacy scope.</p>
      {Object.keys(draft)
        .filter((id) => !h.areas[id])
        .map((id) => (
          <p key={id} className="text-warn">
            Area {id} is no longer available; its assignment draft is retained.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                if (!window.confirm("Discard this unsaved assignment?")) return;
                setDraft((value) => {
                  const next = { ...value };
                  delete next[id];
                  return next;
                });
              }}
            >
              Discard assignment
            </button>
          </p>
        ))}
      {groups
        .filter((group) => group.areas.length)
        .map((group) => (
          <div key={group.id}>
            <h4 className="font-medium">{group.name}</h4>
            <div className="space-y-1">
              {group.areas.map((area) => {
                const scope = areaSpace(h, area.id);
                const guarded = areaSpace(h, area.id, changes);
                const pending = (guarded.kind === "conflict" && scope.kind !== "conflict") || (guarded.kind === "space" && !!guarded.space.blocked);
                const current = scope.kind === "space" ? scope.space.id : "";
                return (
                  <label key={area.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
                    <span>
                      {area.name}
                      {scope.kind === "conflict" && <span className="ml-2 text-xs text-danger">{scope.error}</span>}
                      {pending && <span className="ml-2 text-xs text-warn">Pending Space changes; apply before planning.</span>}
                    </span>
                    <select
                      aria-label={`Space for ${area.name}`}
                      className={inputClass}
                      disabled={locked}
                      value={draft[area.id] ?? (scope.kind === "conflict" ? "__conflict__" : current)}
                      onChange={(event) => {
                        const next = event.target.value;
                        setDraft((value) => {
                          const updated = { ...value };
                          if (next === (scope.kind === "conflict" ? "__conflict__" : current)) delete updated[area.id];
                          else updated[area.id] = next;
                          return updated;
                        });
                      }}
                    >
                      {scope.kind === "conflict" && (
                        <option value="__conflict__" disabled>
                          Conflicting labels
                        </option>
                      )}
                      <option value="">Unassigned</option>
                      {draft[area.id] && !spaces.some((space) => space.id === draft[area.id]) && (
                        <option value={draft[area.id]}>Unavailable Space ({draft[area.id]})</option>
                      )}
                      {spaces.map((space) => (
                        <option
                          key={space.id}
                          value={space.id}
                          disabled={spaces.filter((other) => other.name.toLocaleLowerCase() === space.name.toLocaleLowerCase()).length > 1}
                        >
                          {space.name}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      <Button disabled={locked || !assignmentDirty} onClick={() => void assign()}>
        {reviewChanges ? "Add assignments to Changes" : "Preview assignments"}
      </Button>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
