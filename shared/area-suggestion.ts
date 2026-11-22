// Suggestions use exact words, never fuzzy spelling or a list of home-specific
// names. A suggestion is only a proposal; accepting it still queues Changes.
type AreaName = { id: string; name: string };
export type AreaSuggestion = { areaId: string; source: "name" | "entityId" };
const words = (value: string) =>
  value
    .normalize("NFC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];

function findMatches(value: string, areas: readonly AreaName[], useAreaId = false) {
  const tokens = words(value);
  return areas.flatMap((area) => {
    const phrases = useAreaId ? [area.name, area.id] : [area.name];
    return phrases.flatMap((phrase) => {
      const parts = words(phrase);
      return parts.length
        ? tokens.flatMap((_, start) =>
            parts.every((word, offset) => tokens[start + offset] === word) ? [{ id: area.id, start, end: start + parts.length }] : [],
          )
        : [];
    });
  });
}

function match(value: string, areas: readonly AreaName[]): string | null | undefined {
  const candidates = findMatches(value, areas);
  if (!candidates.length) return undefined;
  const leading = candidates.filter(({ start }) => start === 0);
  const longest = Math.max(...leading.map(({ end }) => end));
  const preferred = leading.length ? leading.filter(({ end }) => end === longest) : candidates;
  const ids = new Set(preferred.map(({ id }) => id));
  return ids.size === 1 ? ids.values().next().value : null;
}

const objectIdOf = (entityId: string) => entityId.slice(entityId.indexOf(".") + 1);

export function suggestEntityArea(name: string, entityId: string, areas: readonly AreaName[]): AreaSuggestion | null {
  const named = match(name, areas);
  if (named !== undefined) return named ? { areaId: named, source: "name" } : null;
  const fromId = match(objectIdOf(entityId), areas);
  return fromId ? { areaId: fromId, source: "entityId" } : null;
}

export type PlacementEvidence = { source: "Entity name" | "Entity ID" | "Device name"; text: string };
export type AreaPlacement = { kind: "suggestion"; areaId: string; evidence: PlacementEvidence[] } | { kind: "ambiguous" } | { kind: "none" };

/** Resolve only when the available names agree on an existing room. A longer
 * name can absorb a shorter one inside it, but separate room mentions conflict. */
export function suggestAreaPlacement(subject: { entityName?: string; entityId?: string; deviceName?: string }, areas: readonly AreaName[]): AreaPlacement {
  const evidence: PlacementEvidence[] = [];
  if (subject.entityName) evidence.push({ source: "Entity name", text: subject.entityName });
  if (subject.entityId) evidence.push({ source: "Entity ID", text: subject.entityId });
  if (subject.deviceName) evidence.push({ source: "Device name", text: subject.deviceName });
  const matched: PlacementEvidence[] = [];
  const ids = new Set<string>();
  const existingAreas = areas.filter((area) => !area.id.startsWith("new:"));
  for (const item of evidence) {
    const isId = item.source === "Entity ID";
    const candidates = findMatches(isId ? objectIdOf(item.text) : item.text, existingAreas, isId);
    if (!candidates.length) continue;
    matched.push(item);
    for (const candidate of candidates) {
      const shadowed = candidates.some(
        (other) => other.start <= candidate.start && other.end >= candidate.end && other.end - other.start > candidate.end - candidate.start,
      );
      if (!shadowed) ids.add(candidate.id);
    }
  }
  if (ids.size > 1) return { kind: "ambiguous" };
  const areaId = ids.values().next().value;
  return areaId ? { kind: "suggestion", areaId, evidence: matched } : { kind: "none" };
}
