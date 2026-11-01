import { useState } from "react";
import { AREA_ROOM_TYPES, areaRoomTypes, nativeAreaRoomTypes, planRoomTypeLabels, type AreaRoomType } from "../../shared/area-room-types.ts";
import { AREA_TYPES, areaChoice, setAreaType, type AreaType } from "../../shared/inventory.ts";
import { RECIPE_LABEL } from "../../shared/recipes.ts";
import type { AreaNode, Hierarchy } from "../../shared/types.ts";
import { useTaxis } from "./state.tsx";
import { api } from "./api.ts";

// These choices describe the room, independently of its indoor/outdoor location
// and independently of the recipes the user chooses to install.
export function AreaTypes({ h, area }: { h: Hierarchy; area: AreaNode }) {
  const { inventory, inventoryLoaded, inventorySaving, saveInventory, propose, busy, changes, reload } = useTaxis();
  const [queueing, setQueueing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!inventoryLoaded) return <p className="text-[13px] text-muted">Loading area types…</p>;
  const selected = nativeAreaRoomTypes(h, area.id);
  const effective = areaRoomTypes(h, inventory, area.id);
  const locked = inventorySaving || busy || queueing;
  const inferred = selected.length === 0 && effective.length > 0;
  const outdoorHint = (selected.includes("garden") || selected.includes("balcony")) && areaChoice(inventory, area.id).type === "interior";
  const save = async (edit: Parameters<typeof saveInventory>[0]) => {
    setError(null);
    const err = await saveInventory(edit);
    if (err) setError(err);
  };
  const queueTypes = async (intent: { key: AreaRoomType; checked: boolean } | { suggested: AreaRoomType[] }) => {
    const desired = (current: Hierarchy): AreaRoomType[] => {
      const native = nativeAreaRoomTypes(current, area.id);
      if ("suggested" in intent) {
        const all = [...native.filter((key) => key !== "other"), ...intent.suggested];
        return all.some((key) => key !== "other") ? all.filter((key) => key !== "other") : ["other"];
      }
      if (!intent.checked) return native.filter((key) => key !== intent.key);
      return intent.key === "other" ? ["other"] : [...native.filter((key) => key !== "other" && key !== intent.key), intent.key];
    };
    setError(null);
    setQueueing(true);
    let created = false;
    try {
      let result = await api.hierarchy();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      let plan = planRoomTypeLabels(result.hierarchy, area.id, desired(result.hierarchy));
      if (!plan.ok) {
        setError(plan.error);
        return;
      }
      if (plan.missing.length) {
        const labelChanges = plan.missing.map((key) => ({
          kind: "label" as const,
          op: "create" as const,
          fields: { name: AREA_ROOM_TYPES.find((type) => type.key === key)!.labelName },
        }));
        if (!(await propose(labelChanges))) {
          setError("Could not queue the new labels. Please try again.");
          return;
        }
        created = true;
        result = await api.hierarchy();
        if (!result.ok) {
          setError(`Labels were queued, but the area was not updated: ${result.error}`);
          return;
        }
        plan = planRoomTypeLabels(result.hierarchy, area.id, desired(result.hierarchy));
        if (!plan.ok) {
          setError(`Labels were queued, but the area was not updated: ${plan.error}`);
          return;
        }
        if (plan.missing.length) {
          setError("Labels were queued, but could not be found in the preview. Retry the area selection.");
          return;
        }
      }
      const existing = result.hierarchy.areas[area.id]?.labels ?? [];
      if (existing.length === plan.labels.length && existing.every((id) => plan.labels.includes(id))) {
        await reload(false);
        return;
      }
      if (!(await propose({ kind: "area", op: "update", targetId: area.id, fields: { labels: plan.labels } }))) {
        setError(
          created
            ? "Labels were queued, but the area assignment failed. Retry the selection; queued labels will be reused."
            : "Could not queue the area label assignment. Please try again.",
        );
      }
    } catch {
      setError(
        created
          ? "Labels were queued, but the area assignment failed. Retry the selection; queued labels will be reused."
          : "Could not queue the area label assignment. Please try again.",
      );
    } finally {
      setQueueing(false);
    }
  };
  const pending = changes.some((change) => change.kind === "area" && change.targetId === area.id && Object.hasOwn(change.after, "labels"));
  const suggestions = AREA_ROOM_TYPES.filter((type) => (inferred ? effective : selected).includes(type.key));
  const selectedLabels = AREA_ROOM_TYPES.filter((type) => selected.includes(type.key));
  const recipes = [...new Set(suggestions.flatMap((type) => [...type.recipes]))];
  return (
    <section className="rounded-lg border border-line bg-surface p-3 text-[13px]" aria-label="Area classification">
      <label className="flex flex-wrap items-center gap-2">
        Location
        <select
          className="rounded-md border border-line bg-bg px-2 py-1 disabled:opacity-50"
          value={areaChoice(inventory, area.id).type}
          disabled={locked}
          onChange={(event) => void save((s) => setAreaType(s, area.id, event.target.value as AreaType))}
        >
          {AREA_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </option>
          ))}
        </select>
      </label>
      {pending && (
        <p className="mt-2 text-xs text-muted">
          Area labels queued in{" "}
          <a href="#changes" className="text-accent underline">
            Changes
          </a>
          ; apply them to update Home Assistant.
        </p>
      )}
      {inferred && (
        <p className="mt-2 text-xs text-muted">
          Suggested from existing settings/name: {suggestions.map((type) => type.label).join(", ")}.{" "}
          <button type="button" className="text-accent underline" disabled={locked} onClick={() => void queueTypes({ suggested: effective })}>
            Add suggested labels to Changes
          </button>
        </p>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer font-semibold">
          Area types: <span className="font-normal">{selectedLabels.map((type) => type.label).join(", ") || "None selected"}</span>
        </summary>
        <fieldset className="mt-2" disabled={locked}>
          <legend className="font-semibold">
            Area types <span className="font-normal text-muted">(choose all that apply; changes are queued)</span>
          </legend>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {AREA_ROOM_TYPES.map((type) => (
              <label key={type.key} className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  className="accent-[var(--accent)]"
                  checked={selected.includes(type.key)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    void queueTypes({ key: type.key, checked });
                  }}
                />
                {type.label}
              </label>
            ))}
          </div>
        </fieldset>
      </details>
      {suggestions.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          {suggestions
            .slice(0, 2)
            .map((type) => type.summary)
            .join(" ")}
          {recipes.length > 0 && (
            <>
              {" "}
              Suggested recipes:{" "}
              {recipes
                .slice(0, 5)
                .map((recipe) => RECIPE_LABEL[recipe])
                .join(", ")}
              {recipes.length > 5 ? ` and ${recipes.length - 5} more` : ""}.{" "}
              <a className="text-accent underline" href="#automations/recipes">
                View recipes
              </a>
            </>
          )}
        </p>
      )}
      {outdoorHint && <p className="mt-2 text-xs text-muted">For outdoor lighting, set Location to Exterior.</p>}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
