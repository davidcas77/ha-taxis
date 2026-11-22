import { ArrowRight, ChevronRight, DoorOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { GUIDE_STAGES, type AreaReadiness } from "../../shared/guide.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { currentRoomWork, groupHomeRooms } from "./home-dashboard-data.ts";
import type { Route } from "./state.tsx";
import { Button, EmptyState, SearchField } from "./ui.tsx";

export function roomStage(area: AreaReadiness): string {
  const work = currentRoomWork(area);
  if (work) return GUIDE_STAGES[work.stage];
  if (area.automations.some((automation) => automation.selected && automation.testCurrent)) return "Automation tested";
  return "Choose an automation";
}

export function RoomChooser({
  h,
  go,
  areas,
  compact = false,
}: {
  h: Hierarchy;
  go: (route: Route) => void;
  areas?: readonly AreaReadiness[];
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupHomeRooms(h, query), [h, query]);
  const assessment = useMemo(() => new Map(areas?.map((area) => [area.areaId, area])), [areas]);
  const hasRooms = h.counts.areas > 0;
  const searching = query.trim().length > 0;
  const Heading = compact ? "h3" : "h2";
  const count = groups.reduce((sum, group) => sum + group.rooms.length, 0);
  if (!hasRooms)
    return (
      <EmptyState action={<Button onClick={() => go({ page: "organize", type: "spaces", id: null })}>Manage floors and areas</Button>}>
        No rooms yet. Add an area to get started.
      </EmptyState>
    );

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <SearchField value={query} onChange={setQuery} placeholder="Search by room or floor" label="Search rooms" />
      {searching && (
        <p role="status" className="text-xs text-muted">
          {count === 0 ? "No rooms match your search." : `${count} matching ${count === 1 ? "room" : "rooms"}`}
        </p>
      )}
      {(!compact || searching) && count > 0 && (
        <div className={compact ? "max-h-52 overflow-y-auto overscroll-contain rounded-md border border-line bg-surface" : "columns-1 gap-3 lg:columns-2"}>
          {groups.map((group) => (
            <section
              key={group.id ?? ""}
              aria-label={group.name}
              className={compact ? "" : "mb-3 min-w-0 break-inside-avoid rounded-lg border border-line bg-surface"}
            >
              <Heading className={`break-words border-b border-line px-3 py-2 text-xs font-semibold ${compact ? "bg-sunken text-muted" : "text-fg"}`}>
                {group.name}
              </Heading>
              <ul className="divide-y divide-line">
                {group.rooms.map((room) => {
                  const ready = assessment.get(room.id);
                  return (
                    <li key={room.id}>
                      <button
                        type="button"
                        onClick={() => go({ page: "guide", areaId: room.id })}
                        className="flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent-soft focus-visible:outline-offset-[-2px]"
                      >
                        <DoorOpen className="size-4 shrink-0 text-muted" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-[13px] font-medium">{room.name}</span>
                          <span className="block text-xs text-muted">
                            {ready
                              ? roomStage(ready)
                              : `${room.deviceIds.length.toLocaleString()} ${room.deviceIds.length === 1 ? "device" : "devices"} · ${room.entityIds.length.toLocaleString()} ${room.entityIds.length === 1 ? "entity" : "entities"}`}
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {compact && (
        <Button tone="primary" className="min-h-10 self-start" onClick={() => go({ page: "rooms" })}>
          Choose a room <ArrowRight className="size-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}
