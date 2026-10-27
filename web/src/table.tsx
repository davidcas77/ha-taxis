import { TooltipButton } from "./tooltip.tsx";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useCallback, useMemo, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { AutoColumnResize } from "./column-resize.tsx";
import { sectionsByRole } from "../../shared/roles.ts";
import { sortRows, type Dir, type Sort, type SortValue } from "../../shared/sort.ts";
import type { EntityRole } from "../../shared/types.ts";

// Click-to-sort column headers shared by the entity lists, and the optional
// grouping of their rows by type.

export type { Dir, Sort, SortValue };

// The sort state of a table: the column and the way, and what a click on a header does.
export function useSortState(initial: Sort) {
  const [sort, setSort] = useState<Sort>(initial);
  const toggle = useCallback((key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" })), []);
  return { sort, toggle };
}

export function useSort<T>(rows: T[], columns: Record<string, (row: T) => SortValue>, initial: Sort) {
  const { sort, toggle } = useSortState(initial);
  const sorted = useMemo(() => {
    const get = columns[sort.key];
    return get ? sortRows(rows, get, sort.dir) : rows;
    // columns is a new object every render; re-sorting on rows/sort alone is enough.
  }, [rows, sort]);
  return { rows: sorted, sort, toggle };
}

export function SortHeader({
  label,
  title,
  help,
  resize,
  k,
  sort,
  onToggle,
  className = "px-3 py-2",
}: {
  label: string;
  // The full name, when the label is short.
  title?: string;
  help?: string;
  resize?: ReactNode;
  k: string;
  sort: Sort;
  onToggle: (key: string) => void;
  className?: string;
}) {
  const header = useRef<HTMLTableCellElement>(null);
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th ref={header} data-column-key={`${k}:${label}`} scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`${className} relative pr-3 font-medium`}>
      {help ? <TooltipButton label={title ?? label} content={help} compact onClick={() => onToggle(k)} className="inline-flex min-w-0 max-w-full items-center gap-1 hover:text-fg">
        <span className="min-w-0">{label}</span><Icon className={`size-3 shrink-0 ${active ? "text-accent" : "opacity-50"}`} aria-hidden />
      </TooltipButton> : <button type="button" title={title} onClick={() => onToggle(k)} className="inline-flex min-w-0 max-w-full items-center gap-1 hover:text-fg">
        <span className="min-w-0">{label}</span><Icon className={`size-3 shrink-0 ${active ? "text-accent" : "opacity-50"}`} aria-hidden />
      </button>}
      {resize ?? <AutoColumnResize header={header} label={label} />}
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


// Non-sortable data columns use the same resize engine as sortable headers.
export function ColumnHeader({ children, help, className = "px-3 py-2", ...props }: ComponentPropsWithoutRef<"th"> & { help?: string }) {
  const header = useRef<HTMLTableCellElement>(null);
  const label = props["aria-label"] ?? (typeof children === "string" ? children : "Column");
  return <th {...props} ref={header} scope="col" className={`${className} relative pr-3 font-medium`}>{help ? <TooltipButton label={label} content={help} compact className="inline-flex min-w-0 max-w-full items-center"><span className="min-w-0">{children}</span></TooltipButton> : children}<AutoColumnResize header={header} label={label} /></th>;
}
