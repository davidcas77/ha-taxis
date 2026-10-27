import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useCallback, useMemo, useState, type ReactNode } from "react";

import { sectionsByRole } from "../../shared/roles.ts";
import type { EntityRole } from "../../shared/types.ts";

// Click-to-sort column headers shared by the entity lists, and the optional
// grouping of their rows by type.

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
  title,
  k,
  sort,
  onToggle,
  className = "px-3 py-2",
}: {
  label: string;
  // The full name, when the label is short.
  title?: string;
  k: string;
  sort: Sort;
  onToggle: (key: string) => void;
  className?: string;
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`${className} font-medium`}>
      <button type="button" title={title} onClick={() => onToggle(k)} className="inline-flex items-center gap-1 hover:text-fg">
        {label}
        <Icon className={`size-3 ${active ? "text-accent" : "opacity-50"}`} aria-hidden />
      </button>
    </th>
  );
}

// "Group by type": the rows in sections by role, each with a header that folds
// it away. The rows come in already sorted, so each section is sorted too.
export function GroupToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--accent)]" /> Group by type
    </label>
  );
}

// The body rows of a table: flat, or in sections when `grouped`. `colSpan` is
// the number of columns, for the section headers.
export function GroupedRows<T>({ rows, grouped, roleOf, colSpan, row }: { rows: readonly T[]; grouped: boolean; roleOf: (row: T) => EntityRole; colSpan: number; row: (row: T) => ReactNode }) {
  const [closed, setClosed] = useState<ReadonlySet<EntityRole>>(new Set());
  const sections = useMemo(() => (grouped ? sectionsByRole(rows, roleOf) : []), [grouped, rows, roleOf]);
  if (!grouped) return <>{rows.map(row)}</>;
  return (
    <>
      {sections.map((sec) => {
        const open = !closed.has(sec.role);
        const Chevron = open ? ChevronDown : ChevronRight;
        return (
          <Fragment key={sec.role}>
            <tr className="border-t border-line bg-sunken">
              <td colSpan={colSpan} className="p-0">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() =>
                    setClosed((c) => {
                      const n = new Set(c);
                      if (!n.delete(sec.role)) n.add(sec.role);
                      return n;
                    })
                  }
                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs font-medium hover:text-accent"
                >
                  <Chevron className="size-3.5 shrink-0" aria-hidden />
                  {sec.label}
                  <span className="font-normal tabular-nums text-muted">{sec.rows.length}</span>
                </button>
              </td>
            </tr>
            {open && sec.rows.map(row)}
          </Fragment>
        );
      })}
    </>
  );
}
