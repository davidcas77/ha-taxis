import { useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, CircleCheck, LampDesk } from "lucide-react";
import { GUIDE_GOALS, ROOM_PROFILES, type AreaGuideChoice, type AreaReadiness, type RoomAutomation, type RoomAutomationKey } from "../../shared/guide.ts";
import type { GuideTestRecord } from "../../shared/guide-checks.ts";
import { defaultCapability } from "../../shared/inventory.ts";
import type { RecipeInstalled } from "../../shared/recipes.ts";
import type { Change, Hierarchy } from "../../shared/types.ts";
import { confirmDraftNavigation, useDraftGuard } from "./draft-guard.ts";
import { RoomEquipment } from "./guide-room-equipment.tsx";
import { RoomOutcomeParameters } from "./guide-room-parameters.tsx";
import { RoomAutomationReview } from "./guide-room-plan.tsx";
import { RoomAutomationReadiness } from "./guide-room-readiness.tsx";
import { readRoomAutomationSelection, rememberRoomAutomationSelection, type RoomRecord, type RoomSelection, type RoomStep } from "./guide-room-selection.ts";
import { GuideRoomTest } from "./guide-room-test.tsx";
import { RecordsSplit } from "./records.tsx";
import { useTaxis, type Route } from "./state.tsx";
import { Button, PageHeader, inputClass } from "./ui.tsx";

const categories: { label: string; keys: RoomAutomationKey[] }[] = [
  { label: "Lighting", keys: ["motion_lights", "exterior_lights"] },
  { label: "Comfort", keys: ["area_climate", "bathroom_fan"] },
  { label: "Everyday", keys: ["occupancy", "media_off", "appliance_done"] },
  { label: "Safety and reminders", keys: ["left_open"] },
];
const steps = [
  { key: "equipment", label: "Equipment" },
  { key: "parameters", label: "Parameters" },
  { key: "review", label: "Review & install" },
  { key: "test", label: "Room test" },
] as const;
const recordsDesktopQuery = "(min-width: 48rem)";
function subscribeToRecordsWidth(onChange: () => void) {
  const query = window.matchMedia(recordsDesktopQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const desktopRecordsVisible = () => window.matchMedia(recordsDesktopQuery).matches;

function initialSelection(area: AreaReadiness): RoomSelection {
  const saved = readRoomAutomationSelection(area.areaId);
  if (
    saved &&
    (saved.record === "equipment" || (saved.record === "legacy-test" && area.testRecord) || area.automations.some(({ key }) => key === saved.record))
  )
    return saved;
  const record =
    area.automations.find((automation) => automation.selected && automation.stage === "changes") ??
    area.automations.find((automation) => automation.selected) ??
    area.automations.find(({ key }) => key === "motion_lights") ??
    area.automations[0];
  return { record: record?.key ?? "equipment", step: record?.stage === "changes" ? "review" : "equipment" };
}

const shortState = (record: RoomAutomation) => {
  if (record.testCurrent) return "Tested";
  if (record.stage === "changes") return "Changes queued";
  if (record.configured && record.runtime === "enabled") return "Installed";
  if (record.readyRequired === record.totalRequired) return "Equipment ready";
  return `${record.readyRequired} of ${record.totalRequired} required`;
};

function assignmentQueued(h: Hierarchy, areaId: string, automation: RoomAutomation, changes: readonly Change[]): boolean {
  if ([...automation.required, ...automation.optional].some((check) => check.queuedEntityIds.length > 0)) return true;
  const capabilities = new Set(automation.required.flatMap((check) => [...check.capabilities]));
  return changes.some((change) => {
    if (change.kind !== "entity" || !Object.hasOwn(change.after, "area_id")) return false;
    const entity = h.entities[change.targetId];
    const capability = entity && defaultCapability(entity);
    const inherited = entity?.deviceId ? h.devices[entity.deviceId]?.areaId : null;
    const previous = change.before?.area_id ?? inherited;
    return Boolean(capability && capabilities.has(capability) && [previous, change.after.area_id, entity.areaId].includes(areaId));
  });
}

export function RoomGuide({
  h,
  area,
  installed,
  recipeError,
  verifying,
  verify,
  go,
  confirmEquipment,
  saveChoice,
  saveTest,
  saveAutomationTest,
}: {
  h: Hierarchy;
  area: AreaReadiness;
  installed: RecipeInstalled | null;
  recipeError: string | null;
  verifying: boolean;
  verify: () => Promise<void>;
  go: (route: Route) => void;
  confirmEquipment: () => Promise<string | null>;
  saveChoice: (choice: AreaGuideChoice) => Promise<string | null>;
  saveTest: (record: GuideTestRecord) => Promise<string | null>;
  saveAutomationTest: (automation: RoomAutomation, record: GuideTestRecord) => Promise<string | null>;
}) {
  const { busy, changes, inventorySaving, parametersSaving } = useTaxis();
  const [selection, setSelection] = useState(() => initialSelection(area));
  const [showDetails, setShowDetails] = useState(() => readRoomAutomationSelection(area.areaId)?.record === selection.record);
  const desktop = useSyncExternalStore(subscribeToRecordsWidth, desktopRecordsVisible);
  const jevVisible = desktop || showDetails;
  const [viewVersion, setViewVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const automation = area.automations.find(({ key }) => key === selection.record);
  const lockNavigation = busy || saving || inventorySaving || parametersSaving;
  const move = (next: RoomSelection, force = false) => {
    if (!force && (lockNavigation || !confirmDraftNavigation())) return;
    setSelection(next);
    setShowDetails(true);
    setError(null);
    rememberRoomAutomationSelection(area.areaId, next);
  };
  const select = (record: RoomRecord) => {
    if (record === selection.record) {
      setShowDetails(true);
      rememberRoomAutomationSelection(area.areaId, selection);
      return;
    }
    move({ record, step: area.automations.find(({ key }) => key === record)?.stage === "changes" ? "review" : "equipment" });
  };
  const step = (next: RoomStep) => move({ ...selection, step: next });
  const backToList = () => {
    if (lockNavigation || !confirmDraftNavigation()) return;
    setShowDetails(false);
    setViewVersion((version) => version + 1);
  };
  const proceed = async (record: RoomAutomation) => {
    if (lockNavigation || !confirmDraftNavigation()) return;
    if (record.selected || !record.goals.length) {
      move({ record: record.key, step: "parameters" }, true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const choice = area.choice ?? { profile: "other", goals: [] };
      const problem = await saveChoice({ ...choice, goals: [...choice.goals, record.goals[0]] });
      setError(problem);
      if (!problem) move({ record: record.key, step: "parameters" }, true);
    } finally {
      setSaving(false);
    }
  };
  const pendingAssignment = automation ? assignmentQueued(h, area.areaId, automation, changes) : false;
  const pending = automation ? automation.recipes.some((recipe) => recipe.cell?.status === "in-changes") : false;
  const testAvailable = automation?.stage === "tested" || automation?.stage === "test" || Boolean(automation?.testRecord);
  const roomOnly = area.equipmentConfirmed && area.choice?.goals.length === 0;
  return (
    <>
      <PageHeader title={area.name} description={area.floor} icon={<LampDesk className="size-5 text-accent" aria-hidden />} />
      <RecordsSplit
        paneDefault={300}
        paneMin={222}
        paneMax={440}
        paneKey="taxis:room-automation:pane"
        resetTablePreferences={false}
        listVisible={!showDetails}
        detailsVisible={showDetails}
        list={(resetControl) => (
          <div className="grid min-h-0 min-w-0 content-start gap-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Automations</h2>
              <span className="hidden md:inline">{resetControl}</span>
            </div>
            {categories.map((category) => {
              const records = category.keys.flatMap((key) => {
                const record = area.automations.find((item) => item.key === key);
                return record ? [record] : [];
              });
              if (!records.length) return null;
              return (
                <section key={category.label} aria-label={category.label}>
                  <h3 className="px-2 pb-1 text-xs font-medium text-muted">{category.label}</h3>
                  <ul className="grid gap-1">
                    {records.map((record) => (
                      <li className="min-w-0" key={record.key}>
                        <button
                          type="button"
                          onClick={() => select(record.key)}
                          aria-current={selection.record === record.key ? "true" : undefined}
                          className={`flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sunken ${selection.record === record.key ? "bg-accent-soft text-accent" : ""}`}
                        >
                          <span className="min-w-0 flex-1 break-words">
                            <span className="block text-sm font-medium">{record.label}</span>
                            <span className="block text-xs text-muted">
                              {shortState(record)}
                              {record.selected ? " · Saved" : ""}
                            </span>
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            <div className="mt-2 grid gap-1 border-t border-line pt-2">
              <Button className="justify-start" tone={selection.record === "equipment" ? "plain" : "ghost"} onClick={() => select("equipment")}>
                {roomOnly && <CircleCheck className="size-4 text-on" aria-hidden />}Room equipment
              </Button>
              {area.testRecord && (
                <Button className="justify-start" tone="ghost" onClick={() => select("legacy-test")}>
                  Previous room observations
                </Button>
              )}
            </div>
          </div>
        )}
        details={
          <>
            <div className="border-b border-line px-3 py-2 md:hidden">
              <Button tone="ghost" onClick={backToList}>
                <ChevronLeft className="size-4" aria-hidden /> Automations
              </Button>
            </div>
            <div key={`${selection.record}:${selection.step}:${viewVersion}`} className="grid min-w-0 content-start gap-4 p-3 md:p-4">
              {automation ? (
                <>
                  <div>
                    <h2 className="break-words text-lg font-semibold">{automation.label}</h2>
                    {automation.key === "motion_lights" && (
                      <p className="mt-1 max-w-xl text-sm text-muted">Use motion or presence to light the room, including a gentler setting at night.</p>
                    )}
                  </div>
                  <nav aria-label="Automation setup steps" className="flex flex-wrap gap-1 border-b border-line pb-2">
                    {steps.map(({ key, label }) => {
                      const available =
                        key === "equipment" ||
                        key === selection.step ||
                        (key === "parameters" &&
                          automation.readyRequired === automation.totalRequired &&
                          !pendingAssignment &&
                          (automation.selected || !automation.goals.length)) ||
                        (key === "review" && (Boolean(automation.installed) || pending || selection.step === "test")) ||
                        (key === "test" && testAvailable);
                      return (
                        <Button
                          key={key}
                          tone={key === selection.step ? "plain" : "ghost"}
                          disabled={!available || lockNavigation}
                          aria-current={key === selection.step ? "step" : undefined}
                          onClick={() => {
                            if (key !== selection.step) step(key);
                          }}
                        >
                          {label}
                        </Button>
                      );
                    })}
                  </nav>
                  {selection.step === "equipment" && (
                    <RoomAutomationReadiness
                      h={h}
                      area={area}
                      automation={automation}
                      pendingAssignment={pendingAssignment}
                      saving={saving}
                      error={error}
                      jevVisible={jevVisible}
                      go={go}
                      onContinue={() => void proceed(automation)}
                      onReview={() => step("review")}
                    />
                  )}
                  {selection.step === "parameters" && (
                    <RoomOutcomeParameters
                      h={h}
                      area={area}
                      outcome={automation.key}
                      pending={pending || pendingAssignment}
                      go={go}
                      onContinue={() => move({ ...selection, step: "review" }, true)}
                    />
                  )}
                  {selection.step === "review" && (
                    <RoomAutomationReview
                      h={h}
                      area={area}
                      automation={automation}
                      pendingAssignment={pendingAssignment}
                      installed={installed}
                      recipeError={recipeError}
                      verifying={verifying}
                      jevVisible={jevVisible}
                      verify={verify}
                      go={go}
                      onTest={() => step("test")}
                    />
                  )}
                  {selection.step === "test" && (
                    <GuideRoomTest
                      key={automation.testRecord?.testedAt ?? "new"}
                      area={automation}
                      canTest={automation.stage === "test" || automation.stage === "tested"}
                      onSave={(record) => saveAutomationTest(automation, record)}
                      openJevSettings={() => go({ page: "settings", tab: "ai" })}
                      adjustLighting={
                        automation.key === "motion_lights" && automation.readyRequired === automation.totalRequired ? () => step("parameters") : undefined
                      }
                    />
                  )}
                </>
              ) : selection.record === "legacy-test" && area.testRecord ? (
                <>
                  <h2 className="text-lg font-semibold">Previous room observations</h2>
                  <GuideRoomTest
                    key={area.testRecord.testedAt}
                    area={area}
                    canTest={area.equipmentConfirmed && (area.stage === "test" || area.stage === "tested")}
                    onSave={saveTest}
                    openJevSettings={() => go({ page: "settings", tab: "ai" })}
                  />
                </>
              ) : (
                <>
                  <h2 className="text-lg font-semibold">Room equipment</h2>
                  {roomOnly && <p className="text-sm text-on">Equipment organized</p>}
                  <RoomEquipment h={h} area={area} go={go} onConfirm={confirmEquipment} />
                  <SavedOutcomes choice={area.choice} onSave={saveChoice} />
                </>
              )}
            </div>
          </>
        }
      />
    </>
  );
}

function SavedOutcomes({ choice, onSave }: { choice: AreaGuideChoice | null; onSave: (value: AreaGuideChoice) => Promise<string | null> }) {
  const saved = choice ?? { profile: "other", goals: [] };
  const [draft, setDraft] = useState<AreaGuideChoice>(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const guard = useDraftGuard(dirty);
  const save = async (value: AreaGuideChoice) => {
    setSaving(true);
    setError(null);
    try {
      const problem = await onSave(value);
      setError(problem);
      if (!problem) {
        setDraft(value);
        guard.release();
      }
    } finally {
      setSaving(false);
    }
  };
  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="cursor-pointer text-sm font-semibold">Room type and saved outcomes</summary>
      <div className="mt-3 grid gap-3">
        <label className="grid max-w-xs gap-1 text-sm">
          Room type
          <select
            aria-label="Room type"
            className={inputClass}
            value={draft.profile}
            disabled={saving}
            onChange={(event) => {
              const profile = ROOM_PROFILES.find((item) => item.key === event.target.value);
              if (profile) setDraft({ ...draft, profile: profile.key });
            }}
          >
            {ROOM_PROFILES.map(({ key, label }) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <fieldset disabled={saving} className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-2 text-xs text-muted">Saved outcomes for this room</legend>
          {GUIDE_GOALS.map(({ key, label }) => (
            <label key={key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 accent-[var(--accent)]"
                checked={draft.goals.includes(key)}
                onChange={(event) => setDraft({ ...draft, goals: event.target.checked ? [...draft.goals, key] : draft.goals.filter((goal) => goal !== key) })}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-muted">
          Saving these outcomes updates the room’s plan in Taxis. Home Assistant changes are reviewed under the individual automation.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button tone="primary" disabled={saving || !dirty} onClick={() => void save(draft)}>
            Save room choices
          </Button>
          {!choice && (
            <Button disabled={saving} onClick={() => void save({ ...draft, goals: [] })}>
              Organize equipment only
            </Button>
          )}
          {dirty && (
            <Button
              tone="ghost"
              disabled={saving}
              onClick={() => {
                setDraft(saved);
                guard.release();
              }}
            >
              Undo room edits
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
