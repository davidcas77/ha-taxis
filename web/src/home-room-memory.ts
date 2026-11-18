const LAST_ROOM_KEY = "taxis:last-worked-room";
let lastRoomInTab: string | null = null;

export function rememberHomeRoom(areaId: string): void {
  lastRoomInTab = areaId;
  try {
    window.localStorage.setItem(LAST_ROOM_KEY, areaId);
  } catch {
    // The current tab still remembers the room when browser storage is blocked.
  }
}

export function readHomeRoom(): string | null {
  try {
    return window.localStorage.getItem(LAST_ROOM_KEY) || lastRoomInTab;
  } catch {
    return lastRoomInTab;
  }
}
