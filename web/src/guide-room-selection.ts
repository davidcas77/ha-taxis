import { ROOM_AUTOMATIONS, type RoomAutomationKey } from "../../shared/guide-automations.ts";

export type RoomRecord = RoomAutomationKey | "equipment" | "legacy-test";
export type RoomStep = "equipment" | "parameters" | "review" | "test";
export type RoomSelection = { record: RoomRecord; step: RoomStep };

const memoryKey = (areaId: string) => `taxis:room-automation:${areaId}`;

export function readRoomAutomationSelection(areaId: string): RoomSelection | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(memoryKey(areaId)) ?? "null") as RoomSelection | null;
    if (
      saved &&
      ["equipment", "parameters", "review", "test"].includes(saved.step) &&
      (["equipment", "legacy-test"].includes(saved.record) || ROOM_AUTOMATIONS.some(({ key }) => key === saved.record))
    )
      return saved;
  } catch {
    // The room remains accessible if session storage is unavailable.
  }
  return null;
}

export function rememberRoomAutomationSelection(areaId: string, selection: RoomSelection) {
  try {
    sessionStorage.setItem(memoryKey(areaId), JSON.stringify(selection));
  } catch {
    // Session navigation still works.
  }
}
