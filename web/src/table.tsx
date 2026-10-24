import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

// Click-to-sort column headers shared by the entity lists.

export type SortValue = string | number | null | undefined;
export type Dir = "asc" | "desc";
export type Sort = { key: string; dir: Dir };

const empty = (v: SortValue) => v === null || v === undefined || v === "";

// Numeric and case-insensitive, so "light 2" sorts before "light 10".
function compare(a: SortValue, b: SortValue) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function useSort<T>(rows: T[], columns: Record<string, (row: T) => SortValue>, initial: Sort) {
  const [sort, setSort] = useState<Sort>(initial);
  const toggle = useCallback((key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" })), []);
  const sorted = useMemo(() => {
    const get = columns[sort.key];
    if (!get) return rows;
    const sign = sort.dir === "asc" ? 1 : -1;
    return rows
      .map((row) => ({ row, v: get(row) }))
      .sort((x, y) => {
        // Blanks go last whichever way it sorts, so they never bury real values.
        if (empty(x.v) || empty(y.v)) return empty(x.v) === empty(y.v) ? 0 : empty(x.v) ? 1 : -1;
        return sign * compare(x.v, y.v);
      })
      .map((x) => x.row);
    // columns is a new object every render; re-sorting on rows/sort alone is enough.
  }, [rows, sort]);
  return { rows: sorted, sort, toggle };
}

export function SortHeader({
  label,
  k,
  sort,
  onToggle,
  className = "px-3 py-2",
}: {
  label: string;
  k: string;
  sort: Sort;
  onToggle: (key: string) => void;
  className?: string;
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`${className} font-medium`}>
      <button type="button" onClick={() => onToggle(k)} className="inline-flex items-center gap-1 hover:text-fg">
        {label}
        <Icon className={`size-3 ${active ? "text-accent" : "opacity-50"}`} aria-hidden />
      </button>
    </th>
  );
}
