import type { AreaReadiness, GuideStage } from "../../shared/guide.ts";
import type { HealthCheck, HealthFinding } from "../../shared/health.ts";
import { helperExclusions } from "../../shared/helpers.ts";
import { areaChoice, areaInventory, recipeWanted, tvOccupancyNotApplicable, type InventoryRow, type InventorySettings } from "../../shared/inventory.ts";
import type { NamingSettings } from "../../shared/naming.ts";
import type { AreaNode, Hierarchy } from "../../shared/types.ts";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const searchText = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ς/g, "σ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function groupHomeRooms(h: Hierarchy, query: string): { id: string | null; name: string; rooms: AreaNode[] }[] {
  const groups = new Map(h.floors.map((floor) => [floor.id, { id: floor.id, name: floor.name, rooms: [] as AreaNode[] }]));
  const loose = { id: null, name: "No floor", rooms: [] as AreaNode[] };
  const terms = searchText(query).split(" ").filter(Boolean);
  for (const room of Object.values(h.areas)) {
    const group = (room.floorId && groups.get(room.floorId)) || loose;
    const haystack = searchText(`${room.name} ${room.id} ${group.name}`);
    if (terms.every((term) => haystack.includes(term))) group.rooms.push(room);
  }
  return [...groups.values(), loose]
    .filter((group) => group.rooms.length > 0)
    .map((group) => ({ ...group, rooms: group.rooms.sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id)) }));
}

const workOrder: readonly GuideStage[] = ["changes", "test", "recipes", "check", "helpers", "equipment", "unread"];

export function activeHomeRooms(areas: readonly AreaReadiness[]): AreaReadiness[] {
  return areas.filter(({ stage }) => workOrder.includes(stage)).sort((a, b) => workOrder.indexOf(a.stage) - workOrder.indexOf(b.stage));
}

export function roomWorkReason(area: AreaReadiness): string | null {
  if (!area.equipmentConfirmed) return "Review the equipment already assigned here.";
  switch (area.stage) {
    case "changes":
      return "This room has changes ready for review.";
    case "test":
      return "Walk through the room and check the chosen behavior.";
    case "recipes":
      return area.recipes.some((recipe) => recipe.cell?.actionable)
        ? "A native automation is ready to set up or update."
        : "Review what the native automations still need.";
    case "check":
      return "Review the status and controls of installed automations.";
    case "helpers":
      return "Review the helpers needed for your saved goals.";
    case "equipment": {
      const needsReview = area.equipment.find((item) => item.required && item.status === "review");
      const missing = area.equipment.find((item) => item.required && item.status === "missing");
      return needsReview ? `Review ${needsReview.label.toLowerCase()}.` : missing ? `Your goals need ${missing.label.toLowerCase()}.` : null;
    }
    default:
      return null;
  }
}

type RoomSuggestion = { room: AreaReadiness; title: string; reason: string };

export function suggestHomeRooms(
  h: Hierarchy,
  inventory: InventorySettings,
  naming: NamingSettings,
  areas: readonly AreaReadiness[],
  resumedId: string | null,
): RoomSuggestion[] {
  const work = activeHomeRooms(areas).flatMap((room) => {
    const reason = roomWorkReason(room);
    return room.areaId !== resumedId && reason ? [{ room, title: "Continue setup", reason }] : [];
  });
  const eligible = areas.filter((area) => area.areaId !== resumedId && area.stage === "choose" && area.hasEntities);
  if (work.length >= 3 || eligible.length === 0) return work.slice(0, 3);

  const exclusions = helperExclusions(h, naming);
  const opportunities: (RoomSuggestion & { matches: number })[] = [];
  for (const room of eligible) {
    const inv = areaInventory(h, inventory, room.areaId, exclusions(room.areaId));
    const available = (row: InventoryRow) => {
      const state = h.entities[row.entityId]?.state;
      return row.counts && Boolean(state) && !row.flags.includes("unavailable");
    };
    const sources = inv.motion.some((row) => available(row) && row.role === "starts")
      ? "a motion sensor"
      : inv.presence.some((row) => available(row) && row.role === "starts")
        ? "a presence sensor"
        : !tvOccupancyNotApplicable(inventory, room.areaId) && inv.tv.some((row) => available(row) && row.tvOccupancyRole === "starts")
          ? "a TV chosen to start occupancy"
          : null;
    const lights = inv.lights.some(available);
    const canUse = (key: Parameters<typeof recipeWanted>[2]) => recipeWanted(inventory, room.areaId, key, h);
    const reasons: Pick<RoomSuggestion, "title" | "reason">[] = [];
    if (
      inv.fan.some(available) &&
      inv.humidity.some((row) => available(row) && Number.isFinite(Number(h.entities[row.entityId]?.state))) &&
      canUse("bathroom_fan")
    )
      reasons.push({ title: "Explore humidity-controlled ventilation", reason: "A controllable fan and a humidity sensor are already reporting here." });
    if (sources && canUse("occupancy")) {
      if (lights && canUse("motion_lights"))
        reasons.push({ title: "Explore automatic lighting", reason: `Controllable lights and ${sources} are already in this room.` });
      if (inv.thermostat.some(available) && canUse("area_climate"))
        reasons.push({ title: "Explore room climate", reason: `A climate control and ${sources} are already in this room.` });
    }
    if (lights && areaChoice(inventory, room.areaId, h).type === "exterior" && canUse("exterior_lights"))
      reasons.push({ title: "Explore outdoor lighting", reason: "Controllable lights already report in this outdoor area." });
    if ([...inv.door, ...inv.window].some(available) && canUse("left_open"))
      reasons.push({ title: "Explore opening reminders", reason: "A door or window contact is already reporting in this room." });
    if (reasons[0]) opportunities.push({ room, ...reasons[0], matches: reasons.length });
  }
  opportunities.sort((a, b) => b.matches - a.matches);
  return [...work, ...opportunities].slice(0, 3);
}

const priorityChecks = [
  "references",
  "conditions",
  "automation-ids",
  "automation-startup",
  "groups",
  "unavailable",
  "automation-conflicts",
  "lights",
  "away-people",
  "climate",
  "setup",
] as const satisfies readonly HealthCheck[];

type HomeHealthGroup = { check: HealthCheck; count: number; errors: number; example: HealthFinding };

export function groupHomeHealth(findings: readonly HealthFinding[]): HomeHealthGroup[] {
  const groups: HomeHealthGroup[] = [];
  for (const check of priorityChecks) {
    const matching = findings.filter((finding) => finding.check === check && finding.severity !== "info");
    if (matching.length === 0) continue;
    const errors = matching.filter((finding) => finding.severity === "error");
    groups.push({ check, count: matching.length, errors: errors.length, example: errors[0] ?? matching[0] });
  }
  return groups.sort((a, b) => Number(b.errors > 0) - Number(a.errors > 0));
}
