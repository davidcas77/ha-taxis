import { useMemo, useState } from "react";
import { ArrowRight, Check, CircleAlert } from "lucide-react";
import type { AreaReadiness, AutomationEquipmentCheck, RoomAutomation } from "../../shared/guide.ts";
import { equipmentIsReporting } from "../../shared/guide-automations.ts";
import { helperExclusions } from "../../shared/helpers.ts";
import { areaInventory, defaultCapability, setAppliance, setCounts, setRole, setTvOccupancyRole } from "../../shared/inventory.ts";
import { roomEquipmentCandidates, type RoomEquipmentCandidate } from "../../shared/room-equipment-candidates.ts";
import type { EntityItem, Hierarchy } from "../../shared/types.ts";
import { placementEvidenceText } from "./assignment-suggestion.tsx";
import { useTaxis, type Route } from "./state.tsx";
import { Button, inputClass } from "./ui.tsx";

type Props = {
  h: Hierarchy;
  area: AreaReadiness;
  automation: RoomAutomation;
  pendingAssignment: boolean;
  saving: boolean;
  error: string | null;
  go: (route: Route) => void;
  onContinue: () => void;
  onReview: () => void;
};

export function RoomAutomationReadiness({ h, area, automation, pendingAssignment, saving, error, go, onContinue, onReview }: Props) {
  const ready = automation.readyRequired === automation.totalRequired;
  const { busy, inventorySaving } = useTaxis();
  return (
    <section aria-label="Equipment readiness" className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-surface p-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            {ready ? <Check className="size-4 shrink-0 text-on" aria-hidden /> : <CircleAlert className="size-4 shrink-0 text-warn" aria-hidden />}
            <span>
              {automation.readyRequired} of {automation.totalRequired} equipment requirements met
            </span>
          </p>
          {automation.totalRequired > 0 && (
            <meter
              className="mt-2 h-2 w-full max-w-72 accent-[var(--accent)]"
              min={0}
              max={automation.totalRequired}
              value={automation.readyRequired}
              aria-label="Equipment readiness score"
            />
          )}
          {pendingAssignment ? (
            <p className="mt-1 text-xs text-warn">Apply the equipment assignment before continuing.</p>
          ) : !ready ? (
            <p className="mt-1 text-xs text-muted">Resolve the required equipment below to continue.</p>
          ) : null}
        </div>
        {pendingAssignment ? (
          <Button tone="primary" onClick={() => go({ page: "changes" })}>
            Review equipment changes
          </Button>
        ) : (
          ready && (
            <Button tone="primary" disabled={saving || busy || inventorySaving} onClick={onContinue}>
              Continue to parameters <ArrowRight className="size-4" aria-hidden />
            </Button>
          )
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {automation.required.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Required equipment</h3>
          {automation.required.map((check) => (
            <EquipmentRequirement key={check.key} h={h} area={area} check={check} />
          ))}
        </div>
      )}
      {automation.optional.length > 0 && (
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Optional equipment{" "}
            <span className="ml-1 text-xs font-normal text-muted">{automation.optional.filter((check) => check.status === "ready").length} available</span>
          </summary>
          <div className="mt-3 grid gap-2">
            {automation.optional.map((check) => (
              <EquipmentRequirement key={check.key} h={h} area={area} check={check} />
            ))}
          </div>
        </details>
      )}
      {automation.key === "motion_lights" && ready && (
        <p className="text-xs text-muted">Choose specific night lights, brightness and occupancy duration in Parameters.</p>
      )}
      {(automation.stage === "changes" || automation.installed) && (
        <div>
          <Button onClick={onReview}>View proposal and installation</Button>
        </div>
      )}
    </section>
  );
}

function EquipmentRequirement({ h, area, check }: { h: Hierarchy; area: AreaReadiness; check: AutomationEquipmentCheck }) {
  const { inventory, naming, inventorySaving, saveInventory, busy, propose, reviewChanges, changes, notify } = useTaxis();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const exclusions = useMemo(() => helperExclusions(h, naming), [h, naming]);
  const inventoryByKind = useMemo(() => areaInventory(h, inventory, area.areaId, exclusions(area.areaId)), [h, inventory, area.areaId, exclusions]);
  const usable = new Set(check.usableEntityIds);
  const queued = new Set(check.queuedEntityIds);
  const detected = check.entityIds
    .flatMap((id) => (h.entities[id] ? [h.entities[id]] : []))
    .sort((a, b) => Number(usable.has(b.entityId)) - Number(usable.has(a.entityId)) || a.name.localeCompare(b.name));
  const canFind = check.capabilities.length > 0 && check.status !== "ready" && check.status !== "queued";
  const available = useMemo(
    () => (canFind ? roomEquipmentCandidates(h, inventory, area.areaId, check, exclusions) : []),
    [h, inventory, area.areaId, check, exclusions, canFind],
  );
  const found = useMemo(
    () => (expanded && query.trim() && canFind ? roomEquipmentCandidates(h, inventory, area.areaId, check, exclusions, query) : available),
    [h, inventory, area.areaId, check, exclusions, canFind, expanded, query, available],
  );
  const recommended = available.filter((candidate) => candidate.recommended).slice(0, 3);
  const recommendedIds = new Set(recommended.map(({ entity }) => entity.entityId));
  const candidates = found.filter(({ entity }) => !recommendedIds.has(entity.entityId)).slice(0, 15);
  const label = { ready: "Ready", missing: "Missing", unavailable: "Unavailable", review: "Needs selection", queued: "Assignment queued" }[check.status];
  const applyRole = async (entity: EntityItem) => {
    setSaving(true);
    setError(null);
    try {
      const problem = await saveInventory((settings) => {
        const next = setCounts(h, settings, entity.entityId, true);
        if (check.candidateRole === "appliance") return setAppliance(next, entity.entityId, true);
        if (check.candidateRole)
          return entity.domain === "media_player"
            ? setTvOccupancyRole(h, next, entity.entityId, check.candidateRole)
            : setRole(h, next, entity.entityId, check.candidateRole);
        return next;
      });
      setError(problem);
      if (!problem && reviewChanges) notify({ tone: "ok", text: `Saved equipment choice for ${area.name}.` });
    } finally {
      setSaving(false);
    }
  };
  const shown = detected.slice(0, 4);
  const renderRow = (entity: EntityItem) => {
    const row = check.capabilities.flatMap((capability) => inventoryByKind[capability]).find((candidate) => candidate.entityId === entity.entityId);
    const isUsable = usable.has(entity.entityId);
    const assignmentPending = queued.has(entity.entityId);
    const capability = row?.capability ?? defaultCapability(entity);
    const reporting = !entity.maintenance && capability !== null && equipmentIsReporting(entity, capability);
    const isGroup = entity.domain === "light" && (entity.platform === "group" || entity.members.length > 0);
    const role = row?.role ?? row?.tvOccupancyRole;
    const eligibleRole = check.candidateRole !== "holds" || !role || role === "ignore" || !row?.counts;
    const canSelect = row && !isUsable && !assignmentPending && reporting && !isGroup && eligibleRole;
    const roleName =
      check.candidateRole === "starts"
        ? "Use to detect entry"
        : check.candidateRole === "holds"
          ? "Use to hold occupancy"
          : check.candidateRole === "appliance"
            ? "Use as appliance meter"
            : "Include equipment";
    return (
      <li key={entity.entityId} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line py-2">
        <div className="min-w-0">
          <span className="break-words font-medium">{entity.name}</span>
          <p className={isUsable ? "text-xs text-on" : reporting ? "text-xs text-muted" : "text-xs text-warn"}>
            {isUsable
              ? "Usable in this setup"
              : assignmentPending
                ? "Assignment queued"
                : entity.disabled
                  ? "Disabled in Home Assistant"
                  : !reporting
                    ? "Unavailable"
                    : role === "holds" && check.candidateRole === "starts"
                      ? "Keeps occupancy only"
                      : "Detected · not used here"}
          </p>
        </div>
        {canSelect && (
          <Button disabled={busy || saving || inventorySaving} aria-label={`${roleName}: ${entity.name}`} onClick={() => void applyRole(entity)}>
            {reviewChanges ? roleName : `Preview: ${roleName.toLowerCase()}`}
          </Button>
        )}
      </li>
    );
  };
  const renderCandidate = ({ entity, placement, recommended: isRecommended, verification }: RoomEquipmentCandidate) => {
    const assignmentQueued = changes.some((change) => change.kind === "entity" && change.targetId === entity.entityId && change.after.area_id === area.areaId);
    const previous = entity.areaId ? (h.areas[entity.areaId]?.name ?? entity.areaId) : null;
    const nameNeeded = entity.needsOwnName && !entity.customName;
    const evidence = placement.kind === "suggestion" ? placementEvidenceText(placement.evidence) : null;
    return (
      <li key={entity.entityId} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2">
        <div className="min-w-0 flex-1 break-words">
          <p className="font-medium">
            {entity.name} <span className="text-xs font-normal text-muted">· {previous ?? "Unassigned"}</span>
          </p>
          {evidence && (
            <p className="text-xs text-muted">
              {isRecommended
                ? "Matches this room by "
                : placement.kind === "suggestion"
                  ? `Name points to ${h.areas[placement.areaId]?.name ?? placement.areaId} · `
                  : ""}
              {evidence}
            </p>
          )}
          {placement.kind === "ambiguous" && <p className="text-xs text-warn">Names point to more than one room. Check the location.</p>}
          {verification && <p className="text-xs text-muted">{verification}</p>}
          {nameNeeded && <p className="text-xs text-muted">Home Assistant needs the entity's name set to assign it separately.</p>}
        </div>
        <Button
          disabled={busy || assignmentQueued}
          aria-label={`Assign ${entity.name} to ${area.name}`}
          onClick={() =>
            void propose({
              kind: "entity",
              op: "update",
              targetId: entity.entityId,
              fields: { area_id: area.areaId, ...(nameNeeded ? { name: entity.name } : {}) },
            })
          }
        >
          {assignmentQueued ? "Queued" : reviewChanges ? (previous ? "Queue move" : "Queue assignment") : "Preview assignment"}
        </Button>
      </li>
    );
  };
  return (
    <article className="min-w-0 rounded-lg border border-line bg-surface px-3 pt-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-1 pb-2">
        <h4 className="font-medium">{check.label}</h4>
        <span className={check.status === "ready" ? "text-xs text-on" : "text-xs text-warn"}>{label}</span>
      </div>
      {check.advice && <p className="pb-2 text-xs text-muted">{check.advice}</p>}
      {shown.length > 0 && <ul>{shown.map(renderRow)}</ul>}
      {detected.length > shown.length && (
        <details className="border-t border-line py-2">
          <summary className="cursor-pointer text-xs text-accent">More detected equipment ({detected.length - shown.length})</summary>
          <ul className="mt-2">{detected.slice(shown.length).map(renderRow)}</ul>
        </details>
      )}
      {recommended.length > 0 && (
        <div className="border-t border-line pt-2">
          <h5 className="mb-2 text-xs font-semibold text-accent">Suggested equipment for {area.name}</h5>
          <ul>{recommended.map(renderCandidate)}</ul>
        </div>
      )}
      {canFind && (
        <details className="border-t border-line py-2" onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary className="cursor-pointer text-xs text-accent">Find equipment to assign</summary>
          {expanded && (
            <div className="mt-2 grid gap-2">
              <label className="grid gap-1 text-xs">
                Search compatible equipment
                <input type="search" className={inputClass} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or entity ID" />
              </label>
              <p className="text-xs text-muted">Search also includes reporting equipment in other rooms. Check its location and role before assigning it.</p>
              <ul>{candidates.map(renderCandidate)}</ul>
              {!candidates.length && <p className="text-xs text-muted">No other reporting equipment found.</p>}
            </div>
          )}
        </details>
      )}
      {error && (
        <p role="alert" className="pb-2 text-xs text-danger">
          {error}
        </p>
      )}
    </article>
  );
}
