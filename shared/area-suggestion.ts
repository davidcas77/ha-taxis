// Suggestions use exact words, never fuzzy spelling or a list of home-specific
// names. A suggestion is only a proposal; accepting it still queues Changes.
type AreaName = { id: string; name: string };
export type AreaSuggestion = { areaId: string; source: "name" | "entityId" };
const words = (value: string) =>
  value
    .normalize("NFC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];

function match(value: string, areas: readonly AreaName[]): string | null | undefined {
  const tokens = words(value);
  const candidates = areas.flatMap((area) => {
    const phrase = words(area.name);
    if (!phrase.length) return [];
    const positions = tokens.flatMap((_, index) => (phrase.every((word, offset) => tokens[index + offset] === word) ? [index] : []));
    return positions.length ? [{ id: area.id, length: phrase.length, leading: positions[0] === 0 }] : [];
  });
  if (!candidates.length) return undefined;
  const leading = candidates.filter((candidate) => candidate.leading);
  const longest = Math.max(...leading.map((candidate) => candidate.length));
  const preferred = leading.length ? leading.filter((candidate) => candidate.length === longest) : candidates;
  return preferred.length === 1 ? preferred[0].id : null;
}

export function suggestEntityArea(name: string, entityId: string, areas: readonly AreaName[]): AreaSuggestion | null {
  const named = match(name, areas);
  if (named !== undefined) return named ? { areaId: named, source: "name" } : null;
  const objectId = entityId.includes(".") ? entityId.slice(entityId.indexOf(".") + 1) : entityId;
  const fromId = match(objectId, areas);
  return fromId ? { areaId: fromId, source: "entityId" } : null;
}
