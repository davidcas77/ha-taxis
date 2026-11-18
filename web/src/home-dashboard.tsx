import { ArrowRight, ChevronRight, Cpu, DoorOpen, HeartPulse, House, Layers3, ListChecks, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { GUIDE_IDEAS, type AreaReadiness } from "../../shared/guide.ts";
import { HEALTH_CHECK_LABEL } from "../../shared/health.ts";
import type { RecipeInstalled } from "../../shared/recipes.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { GuideOverview } from "./guide-instructions.tsx";
import { GuidePath } from "./guide-path.tsx";
import { useHealth } from "./health.tsx";
import { activeHomeRooms, groupHomeHealth, roomWorkReason, suggestHomeRooms } from "./home-dashboard-data.ts";
import { readHomeRoom } from "./home-room-memory.ts";
import { HouseModes } from "./house-modes.tsx";
import { RoomChooser, roomStage } from "./room-chooser.tsx";
import { AREAS_HOME, useTaxis, type Route } from "./state.tsx";
import { Button, PageHeader, Section } from "./ui.tsx";

type Go = (route: Route) => void;

const roomRoute = (areaId: string): Route => ({ page: "guide", areaId });

export function HomeDashboard({
  h,
  go,
  areas,
  installed,
  recipeError,
  notReady,
  loadingText,
  retry,
}: {
  h: Hierarchy;
  go: Go;
  areas: AreaReadiness[];
  installed: RecipeInstalled | null;
  recipeError: string | null;
  notReady: boolean;
  loadingText: string;
  retry: () => void;
}) {
  const { inventory, naming, changes } = useTaxis();
  const [lastRoomId] = useState(readHomeRoom);
  const active = useMemo(() => activeHomeRooms(areas), [areas]);
  const resumeId = (lastRoomId && Object.hasOwn(h.areas, lastRoomId) ? lastRoomId : active[0]?.areaId) ?? null;
  const resumeRoom = resumeId ? h.areas[resumeId] : null;
  const resumeAssessment = areas.find(({ areaId }) => areaId === resumeId);
  const workReason = resumeAssessment?.equipmentConfirmed && roomWorkReason(resumeAssessment);
  const suggestions = useMemo(() => suggestHomeRooms(h, inventory, naming, areas, resumeId), [h, inventory, naming, areas, resumeId]);

  return (
    <>
      <PageHeader title="Home" icon={<House className="size-5 text-accent" aria-hidden />} description={h.home.name} />
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <section
          aria-labelledby="home-organize-room"
          className="min-w-0 rounded-xl border border-accent/30 bg-linear-to-br from-accent-soft to-surface p-4 sm:p-5"
        >
          <div className="mb-3 flex items-start gap-3">
            <span className="rounded-lg border border-accent/20 bg-surface p-2 text-accent">
              <DoorOpen className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id="home-organize-room" className="text-lg font-semibold tracking-tight">
                Organize a room
              </h2>
              <p className="mt-0.5 text-[13px] text-muted">Review its equipment and choose what you want it to do.</p>
            </div>
          </div>
          <RoomChooser h={h} go={go} areas={areas} compact />
        </section>

        <section aria-labelledby="home-resume-room" className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="rounded-lg border border-line bg-bg p-2 text-accent">
              <RotateCcw className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id="home-resume-room" className="text-lg font-semibold tracking-tight">
                Resume work
              </h2>
              {resumeRoom ? (
                <>
                  <p className="mt-0.5 break-words text-[13px] font-medium">
                    {resumeRoom.name}
                    {resumeAssessment && <span className="font-normal text-muted"> · {resumeAssessment.floor}</span>}
                  </p>
                  {resumeAssessment && <p className="mt-1 text-[13px] text-accent">{roomStage(resumeAssessment)}</p>}
                  {workReason && <p className="mt-0.5 text-xs text-muted">{workReason}</p>}
                </>
              ) : (
                <p className="mt-0.5 text-[13px] text-muted">
                  {changes.length ? "Continue with the changes already waiting for review." : "The last room you open will appear here."}
                </p>
              )}
            </div>
          </div>
          {resumeRoom && (
            <Button className="min-h-10 self-start text-left" onClick={() => go(roomRoute(resumeRoom.id))}>
              <span className="wrap-anywhere">Resume {resumeRoom.name}</span> <ArrowRight className="size-4 shrink-0" aria-hidden />
            </Button>
          )}
          {changes.length > 0 && (
            <button
              type="button"
              onClick={() => go({ page: "changes" })}
              className="flex min-h-10 items-center gap-2 self-start text-left text-[13px] font-medium text-warn hover:underline"
            >
              <ListChecks className="size-4 shrink-0" aria-hidden />
              Review {changes.length} pending {changes.length === 1 ? "change" : "changes"}
            </button>
          )}
        </section>
      </div>

      <div className="grid min-w-0 items-start gap-4 md:grid-cols-2">
        <Section id="home-suggested" title="Suggested rooms">
          {notReady ? (
            <p role="status" className="rounded-lg border border-line bg-surface p-3 text-[13px] text-muted">
              {loadingText}
            </p>
          ) : suggestions.length > 0 ? (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {suggestions.map(({ room, title, reason }) => (
                <li key={room.areaId}>
                  <button
                    type="button"
                    onClick={() => go(roomRoute(room.areaId))}
                    className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-accent-soft"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block wrap-anywhere text-[13px] font-semibold">
                        {room.name} <span className="font-normal text-muted">· {room.floor}</span>
                      </span>
                      <span className="mt-0.5 block text-xs font-medium text-accent">{title}</span>
                      <span className="mt-0.5 block text-xs text-muted">{reason}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-line bg-surface p-3 text-[13px] text-muted">
              {h.counts.areas > 0
                ? "No other rooms have a clear next step from their saved work or equipment."
                : "Suggestions appear when rooms and equipment are available."}
            </p>
          )}
          {recipeError && installed === null && (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-warn">
              Automation status could not be read.
              <Button onClick={retry}>Retry reading automations</Button>
            </div>
          )}
        </Section>
        <HomeHealth go={go} />
      </div>

      <Section
        id="home-inventory"
        title="House inventory"
        actions={
          <Button tone="ghost" onClick={() => go(AREAS_HOME)}>
            Browse inventory <ArrowRight className="size-4" aria-hidden />
          </Button>
        }
      >
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
          {[
            { label: "Floors", value: h.counts.floors, icon: Layers3 },
            { label: "Rooms", value: h.counts.areas, icon: DoorOpen },
            { label: "Devices", value: h.counts.devices, icon: Cpu },
            { label: "Active entities", value: h.counts.entities, icon: ListChecks },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex min-w-0 items-center gap-2 bg-surface px-3 py-2.5">
              <Icon className="size-4 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-base leading-tight font-semibold tabular-nums">{value.toLocaleString()}</dd>
              </div>
            </div>
          ))}
        </dl>
      </Section>
      <WholeHouseGuide h={h} go={go} installed={installed} recipeError={recipeError} retry={retry} />
    </>
  );
}

function WholeHouseGuide({
  h,
  go,
  installed,
  recipeError,
  retry,
}: {
  h: Hierarchy;
  go: Go;
  installed: RecipeInstalled | null;
  recipeError: string | null;
  retry: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="rounded-lg border border-line bg-surface" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer rounded-lg px-3 py-2.5 text-[13px] font-medium hover:bg-sunken">Whole-house guide</summary>
      {open && (
        <div className="flex min-w-0 flex-col gap-5 border-t border-line px-3 py-4 sm:px-4">
          <GuideOverview go={go} />
          <GuidePath h={h} go={go} installed={installed} recipeError={recipeError} retryRecipes={retry} />
          <HouseModes h={h} go={go} />
          <Section id="home-ideas" title="Automation ideas">
            <ul className="grid gap-2 sm:grid-cols-2">
              {GUIDE_IDEAS.map((idea) => (
                <li key={idea.title} className="min-w-0 rounded-lg border border-line p-3 text-[13px]">
                  <h3 className="font-medium">{idea.title}</h3>
                  <p className="mt-1 text-xs text-muted">{idea.text}</p>
                  <p className="mt-1 text-xs">{idea.implementation}</p>
                  <a className="mt-2 inline-block text-xs text-accent hover:underline" href={idea.source} target="_blank" rel="noreferrer">
                    Read the community discussion
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </details>
  );
}

function HomeHealth({ go }: { go: Go }) {
  const { report, loading, error, refresh } = useHealth();
  const groups = useMemo(() => groupHomeHealth(report?.findings ?? []).slice(0, 4), [report]);
  return (
    <Section
      id="home-health"
      title={
        <span className="inline-flex items-center gap-1.5">
          <HeartPulse className="size-4 text-accent" aria-hidden /> Health priorities
        </span>
      }
      actions={
        <Button tone="ghost" onClick={() => go({ page: "health" })}>
          Open Health <ArrowRight className="size-4" aria-hidden />
        </Button>
      }
    >
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-warn">
          {report ? "Showing the last Health report. The latest check failed." : "Health checks could not be read."}
          <Button onClick={() => void refresh()} disabled={loading}>
            Retry Health
          </Button>
        </div>
      )}
      {report && groups.length > 0 ? (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {groups.map((group) => (
            <li key={group.check}>
              <button
                type="button"
                onClick={() => go({ page: "health", check: group.check })}
                className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-accent-soft"
              >
                <span
                  aria-label={`${group.count} ${group.count === 1 ? "finding" : "findings"}${group.errors ? `, ${group.errors} ${group.errors === 1 ? "error" : "errors"}` : ""}`}
                  className={`min-w-7 rounded-md px-1 py-1 text-center text-xs font-semibold tabular-nums ${group.errors ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn"}`}
                >
                  {group.count}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{HEALTH_CHECK_LABEL[group.check]}</span>
                  <span className="mt-0.5 block wrap-anywhere text-xs text-muted">{group.example.title}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : report ? (
        <p className="rounded-lg border border-line bg-surface p-3 text-[13px] text-muted">
          The latest report has no findings among the checks prioritized here.
        </p>
      ) : !error ? (
        <p role="status" className="rounded-lg border border-line bg-surface p-3 text-[13px] text-muted">
          Reading Health checks…
        </p>
      ) : null}
      {report && report.notes.length > 0 && <p className="text-xs text-muted">See Health for coverage notes.</p>}
    </Section>
  );
}
