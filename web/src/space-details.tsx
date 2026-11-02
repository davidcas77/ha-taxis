import { useEffect, useState } from "react";
import { resolveSpaces } from "../../shared/spaces.ts";
import { useDraftGuard } from "./draft-guard.ts";
import { AREAS_HOME, toHash, useTaxis } from "./state.tsx";
import { Button, inputClass } from "./ui.tsx";

export default function SpaceDetails({ id }: { id: string }) {
  const { hierarchy: h, changes, propose, busy, reviewChanges } = useTaxis();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const spaces = h ? resolveSpaces(h, changes) : [];
  const space = spaces.find((item) => item.id === id);
  const label = h?.labels[id];
  const guard = useDraftGuard(editing && name !== (space?.name ?? ""));
  useEffect(() => {
    setEditing(false);
    setError(null);
  }, [id]);
  if (!h) return null;
  if (!space || !label)
    return (
      <div>
        <h1 className="text-xl font-semibold">Space unavailable</h1>
        <p className="mt-2 text-sm text-muted">This Space label is missing or has been deleted.</p>
        <a className="mt-3 inline-block underline" href={toHash(AREAS_HOME)}>
          Back to Areas
        </a>
      </div>
    );

  const pending = id.startsWith("new:") || changes.some((change) => change.kind === "label" && change.targetId === id);
  const areas = space.areaIds
    .map((areaId) => h.areas[areaId])
    .filter((area) => !!area)
    .sort((a, b) => a.name.localeCompare(b.name));
  const floorIds = new Set([...space.declaredFloorIds, ...areas.flatMap((area) => (area.floorId ? [area.floorId] : []))]);
  const floors = h.floors.filter((floor) => floorIds.has(floor.id));
  const deviceIds = new Set(areas.flatMap((area) => area.deviceIds.filter((deviceId) => !!h.devices[deviceId])));
  const entityIds = new Set(areas.flatMap((area) => area.entityIds.filter((entityId) => !!h.entities[entityId])));
  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a Space name.");
      return;
    }
    const key = trimmed.toLocaleLowerCase("en-US");
    const duplicate =
      spaces.some((other) => other.id !== id && other.name.trim().toLocaleLowerCase("en-US") === key) ||
      changes.some(
        (change) =>
          change.kind === "label" &&
          change.targetId !== id &&
          typeof change.after.name === "string" &&
          /^space:\s*/i.test(change.after.name) &&
          change.after.name
            .replace(/^space:\s*/i, "")
            .trim()
            .toLocaleLowerCase("en-US") === key,
      );
    if (duplicate) {
      setError("A Space with this name already exists or is pending.");
      return;
    }
    if (trimmed === space.name) {
      guard.release();
      setEditing(false);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (await propose({ kind: "label", op: "update", targetId: id, fields: { name: `Space: ${trimmed}` } })) {
        guard.release();
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{space.name}</h1>
        {!editing && (
          <Button
            disabled={busy || saving || (pending && !reviewChanges)}
            onClick={() => {
              setName(space.name);
              setError(null);
              setEditing(true);
            }}
          >
            Rename
          </Button>
        )}
      </div>
      {pending && (
        <p className="text-sm text-muted">
          {reviewChanges ? "This Space has pending label changes." : "Apply or discard the pending Space label change before renaming in direct mode."}
        </p>
      )}
      {editing && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="text-sm">
            Space name
            <input autoFocus className={`${inputClass} mt-1 block`} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <Button disabled={busy || saving} type="submit">
            {reviewChanges ? "Add rename to Changes" : "Preview rename"}
          </Button>
          <Button
            disabled={busy || saving}
            type="button"
            onClick={() =>
              guard.close(() => {
                setEditing(false);
                setError(null);
              })
            }
          >
            Cancel
          </Button>
          {error && (
            <p role="alert" className="w-full text-sm text-danger">
              {error}
            </p>
          )}
        </form>
      )}
      <p className="text-sm text-muted">Areas belong to this Space through their Home Assistant label. A Space can span floors.</p>
      <p className="text-sm text-muted">
        {areas.length} areas · {deviceIds.size} devices · {entityIds.size} entities total (including hidden and disabled items where available)
      </p>
      <div className="text-sm">
        <strong>Native label:</strong> {label.name} <span className="text-muted">({label.id})</span>
      </div>
      <section>
        <h2 className="font-semibold">Floors</h2>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          {floors.length ? (
            floors.map((floor) => (
              <a key={floor.id} className="underline" href={toHash({ page: "areas", sel: { kind: "floor", id: floor.id }, tab: "overview" })}>
                {floor.name}
              </a>
            ))
          ) : (
            <span className="text-muted">No floor</span>
          )}
          {areas.some((area) => !area.floorId || !h.floors.some((floor) => floor.id === area.floorId)) && floors.length > 0 && (
            <span className="text-muted">No floor</span>
          )}
        </div>
      </section>
      <section>
        <h2 className="font-semibold">Areas ({areas.length})</h2>
        {areas.length ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {areas.map((area) => (
              <a
                key={area.id}
                className="rounded-lg border border-line bg-surface p-3 hover:bg-sunken"
                href={toHash({ page: "areas", sel: { kind: "area", id: area.id }, tab: "overview" })}
              >
                <span className="font-medium">{area.name}</span>{" "}
                <span className="ml-2 text-sm text-muted">{h.floors.find((floor) => floor.id === area.floorId)?.name ?? "No floor"}</span>
                <span className="mt-1 block text-xs text-muted">
                  {area.deviceIds.filter((deviceId) => !!h.devices[deviceId]).length} devices ·{" "}
                  {area.entityIds.filter((entityId) => !!h.entities[entityId]).length} entities total
                </span>
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">No areas in this Space yet.</p>
        )}
      </section>
      {space.blocked && <p className="text-sm text-warn">{space.blocked}</p>}
    </div>
  );
}
