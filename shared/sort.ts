// Sorting rows by a column: numbers as numbers, text case-insensitively and
// numerically ("light 2" before "light 10"), blanks always last. Shared by the
// sortable tables of the app and by the device tree.

export type SortValue = string | number | null | undefined;
export type Dir = "asc" | "desc";
export type Sort = { key: string; dir: Dir };

export const isBlank = (v: SortValue): v is null | undefined | "" => v === null || v === undefined || v === "";

// One collator for every comparison: making one per call is the slow part of sorting.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

// The rows in order of `get`. Blanks go last whichever way it sorts, so they
// never bury real values. Stable, and the rows given are not touched.
export function sortRows<T>(rows: readonly T[], get: (row: T) => SortValue, dir: Dir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row) => ({ row, v: get(row) }))
    .sort((x, y) => {
      if (isBlank(x.v) || isBlank(y.v)) return isBlank(x.v) === isBlank(y.v) ? 0 : isBlank(x.v) ? 1 : -1;
      return sign * compareValues(x.v, y.v);
    })
    .map((x) => x.row);
}
