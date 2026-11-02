import { useRef, useState } from "react";
import {
  AREA_ROOM_TYPES,
  areaRoomTypes,
  nativeAreaRoomTypes,
  normalizeAreaRoomTypes,
  planRoomTypeLabels,
  type AreaRoomType,
} from "../../shared/area-room-types.ts";
import { AREA_TYPES, areaChoice, setAreaType, type AreaType } from "../../shared/inventory.ts";
import { nativeAreaLocations, nativeAreaStaircase, planLocationLabels, planStaircaseLabels } from "../../shared/area-location.ts";
import { RECIPE_LABEL } from "../../shared/recipes.ts";
import type { AreaNode, Hierarchy } from "../../shared/types.ts";
import { useTaxis } from "./state.tsx";
import { api } from "./api.ts";

const DISPLAY_ROOM_TYPES = [...AREA_ROOM_TYPES].sort((a, b) => a.label.localeCompare(b.label, "en"));

// These choices describe the room, independently of its indoor/outdoor location
// and independently of the recipes the user chooses to install.
export function AreaTypes({ h, area }: { h: Hierarchy; area: AreaNode }) {
  const { inventory, inventoryLoaded, inventorySaving, saveInventory, propose, busy, changes, reload, reviewChanges } = useTaxis();
  const [queueing, setQueueing] = useState(false);
  const queueingRef = useRef(false);
  const [optimistic, setOptimistic] = useState<{ areaId: string; types: AreaRoomType[] } | null>(null);
  const [optimisticLocation, setOptimisticLocation] = useState<{ areaId: string; type: AreaType | null } | null>(null);
  const [optimisticStaircase, setOptimisticStaircase] = useState<{ areaId: string; value: boolean } | null>(null);
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!inventoryLoaded) return <p className="text-[13px] text-muted">Loading area types…</p>;
  const selected = nativeAreaRoomTypes(h, area.id);
  const displayed = optimistic?.areaId === area.id ? optimistic.types : selected;
  const effective = areaRoomTypes(h, inventory, area.id);
  const locked = inventorySaving || busy || queueing || refreshNeeded;
  const inferred = selected.length === 0 && effective.length > 0;
  const outdoorHint = (selected.includes("garden") || selected.includes("balcony")) && areaChoice(inventory, area.id, h).type === "interior";
  const queueTypes = async (intent: { key: AreaRoomType; checked: boolean } | { suggested: AreaRoomType[] }) => {
    if (queueingRef.current) return;
    const desired = (current: Hierarchy): AreaRoomType[] => {
      const native = nativeAreaRoomTypes(current, area.id);
      if ("suggested" in intent) {
        const all = [...native.filter((key) => key !== "other"), ...intent.suggested];
        return all.some((key) => key !== "other") ? all.filter((key) => key !== "other") : ["other"];
      }
      if (!intent.checked) return native.filter((key) => key !== intent.key);
      return intent.key === "other" ? ["other"] : [...native.filter((key) => key !== "other" && key !== intent.key), intent.key];
    };
    queueingRef.current = true;
    setOptimistic({ areaId: area.id, types: desired(h) });
    setError(null);
    setQueueing(true);
    let created = false;
    let keepOptimistic = false;
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
          setError("Could not create the new labels. Please try again.");
          return;
        }
        created = true;
        result = await api.hierarchy();
        if (!result.ok) {
          setError(`${reviewChanges ? "Labels were queued" : "Labels were created"}, but the area was not updated: ${result.error}`);
          return;
        }
        plan = planRoomTypeLabels(result.hierarchy, area.id, desired(result.hierarchy));
        if (!plan.ok) {
          setError(`${reviewChanges ? "Labels were queued" : "Labels were created"}, but the area was not updated: ${plan.error}`);
          return;
        }
        if (plan.missing.length) {
          setError(`${reviewChanges ? "Labels were queued" : "Labels were created"}, but could not be found. Retry the area selection.`);
          return;
        }
      }
      const existing = result.hierarchy.areas[area.id]?.labels ?? [];
      if (existing.length === plan.labels.length && existing.every((id) => plan.labels.includes(id))) {
        await reload(false);
        return;
      }
      setOptimistic({ areaId: area.id, types: normalizeAreaRoomTypes(desired(result.hierarchy)) });
      if (!(await propose({ kind: "area", op: "update", targetId: area.id, fields: { labels: plan.labels } }))) {
        setError(
          created
            ? `${reviewChanges ? "Labels were queued" : "Labels were created"}, but the area assignment failed. Retry the selection; existing labels will be reused.`
            : "Could not save the area label assignment. Please try again.",
        );
      } else if (!(await reload(false))) {
        keepOptimistic = true;
        setRefreshNeeded(true);
      }
    } catch {
      setError(
        created
          ? `${reviewChanges ? "Labels were queued" : "Labels were created"}, but the area assignment failed. Retry the selection; existing labels will be reused.`
          : "Could not save the area label assignment. Please try again.",
      );
    } finally {
      if (!keepOptimistic) setOptimistic(null);
      queueingRef.current = false;
      setQueueing(false);
    }
  };
  const locations = nativeAreaLocations(h, area.id);
  const location = optimisticLocation?.areaId === area.id ? optimisticLocation.type : locations.length === 1 ? locations[0] : null;
  const queueLocation = async (desired: AreaType | null) => {
    if (queueingRef.current) return;
    queueingRef.current = true;
    setOptimisticLocation({ areaId: area.id, type: desired });
    setError(null);
    setQueueing(true);
    let created = false;
    let cleanedLegacy = false;
    let keepOptimistic = false;
    try {
      let result = await api.hierarchy();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      let plan = planLocationLabels(result.hierarchy, area.id, desired);
      if (!plan.ok) {
        setError(plan.error);
        return;
      }
      if (desired === null && inventory.areas[area.id]?.type !== undefined) {
        const error = await saveInventory((settings) => setAreaType(settings, area.id, "interior"));
        if (error) {
          setError(`Could not clear the saved location: ${error}`);
          return;
        }
        cleanedLegacy = true;
        result = await api.hierarchy();
        if (!result.ok) {
          setError(`The saved location was cleared, but the area label was not updated: ${result.error}`);
          return;
        }
        plan = planLocationLabels(result.hierarchy, area.id, desired);
        if (!plan.ok) {
          setError(`The saved location was cleared, but the area label was not updated: ${plan.error}`);
          return;
        }
      }
      if (plan.missing) {
        const name = plan.missing === "interior" ? "Interior" : "Exterior";
        if (!(await propose({ kind: "label", op: "create", fields: { name } }))) {
          setError("Could not create the new location label. Please try again.");
          return;
        }
        created = true;
        result = await api.hierarchy();
        if (!result.ok) {
          setError(`${reviewChanges ? "Label was queued" : "Label was created"}, but the area was not updated: ${result.error}`);
          return;
        }
        plan = planLocationLabels(result.hierarchy, area.id, desired);
        if (!plan.ok) {
          setError(`${reviewChanges ? "Label was queued" : "Label was created"}, but the area was not updated: ${plan.error}`);
          return;
        }
        if (plan.missing) {
          setError(`${reviewChanges ? "Label was queued" : "Label was created"}, but could not be found. Retry the location selection.`);
          return;
        }
      }
      const existing = result.hierarchy.areas[area.id]?.labels ?? [];
      if (existing.length === plan.labels.length && existing.every((id) => plan.labels.includes(id))) {
        if (!(await reload(false))) {
          keepOptimistic = true;
          setRefreshNeeded(true);
        }
        return;
      }
      if (!(await propose({ kind: "area", op: "update", targetId: area.id, fields: { labels: plan.labels } }))) {
        setError(
          created
            ? `${reviewChanges ? "Label was queued" : "Label was created"}, but the area assignment failed. Retry the selection; the label will be reused.`
            : cleanedLegacy
              ? "The saved location was cleared, but the area label assignment failed. Please retry."
              : "Could not save the area location. Please try again.",
        );
      } else if (!(await reload(false))) {
        keepOptimistic = true;
        setRefreshNeeded(true);
      }
    } catch {
      setError(
        created
          ? `${reviewChanges ? "Label was queued" : "Label was created"}, but the area assignment failed. Retry the selection; the label will be reused.`
          : cleanedLegacy
            ? "The saved location was cleared, but the area label assignment failed. Please retry."
            : "Could not save the area location. Please try again.",
      );
    } finally {
      if (!keepOptimistic) setOptimisticLocation(null);
      queueingRef.current = false;
      setQueueing(false);
    }
  };
  const staircase = optimisticStaircase?.areaId === area.id ? optimisticStaircase.value : nativeAreaStaircase(h, area.id);
  const queueStaircase = async (wanted: boolean) => {
    if (queueingRef.current) return;
    queueingRef.current = true;
    setOptimisticStaircase({ areaId: area.id, value: wanted });
    setError(null);
    setQueueing(true);
    let created = false;
    let keepOptimistic = false;
    try {
      let result = await api.hierarchy();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      let plan = planStaircaseLabels(result.hierarchy, area.id, wanted);
      if (!plan.ok) {
        setError(plan.error);
        return;
      }
      if (plan.missing) {
        if (!(await propose({ kind: "label", op: "create", fields: { name: "Staircase" } }))) {
          setError("Could not create the Staircase label. Please try again.");
          return;
        }
        created = true;
        result = await api.hierarchy();
        if (!result.ok) {
          setError(`${reviewChanges ? "Label was queued" : "Label was created"}, but the area was not updated: ${result.error}`);
          return;
        }
        plan = planStaircaseLabels(result.hierarchy, area.id, wanted);
        if (!plan.ok) {
          setError(`${reviewChanges ? "Label was queued" : "Label was created"}, but the area was not updated: ${plan.error}`);
          return;
        }
        if (plan.missing) {
          setError(`${reviewChanges ? "Label was queued" : "Label was created"}, but could not be found. Retry the Staircase selection.`);
          return;
        }
      }
      const existing = result.hierarchy.areas[area.id]?.labels ?? [];
      if (existing.length === plan.labels.length && existing.every((id) => plan.labels.includes(id))) {
        if (!(await reload(false))) {
          keepOptimistic = true;
          setRefreshNeeded(true);
        }
        return;
      }
      if (!(await propose({ kind: "area", op: "update", targetId: area.id, fields: { labels: plan.labels } }))) {
        setError(
          created
            ? `${reviewChanges ? "Label was queued" : "Label was created"}, but the area assignment failed. Retry the selection; the label will be reused.`
            : "Could not save the Staircase label assignment. Please try again.",
        );
      } else if (!(await reload(false))) {
        keepOptimistic = true;
        setRefreshNeeded(true);
      }
    } catch {
      setError(
        created
          ? `${reviewChanges ? "Label was queued" : "Label was created"}, but the area assignment failed. Retry the selection; the label will be reused.`
          : "Could not save the Staircase label assignment. Please try again.",
      );
    } finally {
      if (!keepOptimistic) setOptimisticStaircase(null);
      queueingRef.current = false;
      setQueueing(false);
    }
  };
  const pending = changes.some((change) => change.kind === "area" && change.targetId === area.id && Object.hasOwn(change.after, "labels"));
  const suggestions = AREA_ROOM_TYPES.filter((type) => (inferred ? effective : selected).includes(type.key));
  const recipes = [...new Set(suggestions.flatMap((type) => [...type.recipes]))];
  return (
    <section className="rounded-lg border border-line bg-surface p-3 text-[13px]" aria-label="Area classification">
      <fieldset disabled={locked}>
        <legend>Location</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {AREA_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={location === type}
              className={`rounded-md border px-3 py-1 disabled:opacity-50 ${location === type ? "border-accent bg-accent text-white" : "border-line bg-bg"}`}
              onClick={() => void queueLocation(location === type ? null : type)}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={staircase}
            className={`rounded-md border px-3 py-1 disabled:opacity-50 ${staircase ? "border-accent bg-accent text-white" : "border-line bg-bg"}`}
            onClick={() => void queueStaircase(!staircase)}
          >
            Staircase
          </button>
        </div>
      </fieldset>
      {locations.length === 0 && inventory.areas[area.id]?.type === "exterior" && (
        <p className="mt-2 text-xs text-muted">
          Saved location: Exterior. Until a location label is assigned, this setting controls parameters and recipes.{" "}
          <button type="button" className="text-accent underline" disabled={locked} onClick={() => void queueLocation("exterior")}>
            Use saved Exterior
          </button>
          {" · "}
          <button type="button" className="text-accent underline" disabled={locked} onClick={() => void queueLocation(null)}>
            Clear saved location
          </button>
        </p>
      )}
      {locations.length > 1 && (
        <p role="alert" className="mt-2 text-xs text-danger">
          This area has both location labels. Choose one to resolve the conflict.
        </p>
      )}
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
            {reviewChanges ? "Add suggested labels to Changes" : "Apply suggested labels"}
          </button>
        </p>
      )}
      <fieldset className="mt-3" disabled={locked}>
        <legend className="font-semibold">
          Area types{" "}
          <span className="font-normal text-muted">
            {reviewChanges ? "(choose all that apply; changes are queued)" : "(choose all that apply; edits apply immediately)"}
          </span>
        </legend>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {DISPLAY_ROOM_TYPES.map((type) => (
            <label key={type.key} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                checked={displayed.includes(type.key)}
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
      <p className="mt-2 text-xs text-muted">These labels are assigned to the area in Home Assistant, not to its entities.</p>
      {queueing && (
        <p role="status" className="mt-2 text-xs text-muted">
          {reviewChanges ? "Adding area labels to Changes…" : "Applying area labels…"}
        </p>
      )}
      {refreshNeeded && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {reviewChanges ? "Area labels were added to Changes" : "Area labels were applied"}, but the latest area could not be refreshed. The selection shown is
          awaiting confirmation.{" "}
          <button
            type="button"
            className="text-accent underline"
            onClick={() =>
              void reload(false).then((ok) => {
                if (ok) {
                  setOptimistic(null);
                  setOptimisticLocation(null);
                  setOptimisticStaircase(null);
                  setRefreshNeeded(false);
                }
              })
            }
          >
            Retry refresh
          </button>
        </p>
      )}
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
