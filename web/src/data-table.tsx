import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Columns3 } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";

import { sortRows, type Dir, type Sort, type SortValue } from "../../shared/sort.ts";
import { fitColumns, headerRuns, NO_PREFS, parseColumnPrefs, stickyOffsets, togglePref, type ColumnPrefs, type Priority } from "../../shared/table-fit.ts";
import { TooltipButton } from "./tooltip.tsx";

// The one table of the app. It never makes the page scroll: it sits in a scroll
// area of its own, hides its least important columns when they do not fit
// (shared/table-fit.ts), always offers a Columns chooser above the table,
// lets the person show or hide optional columns, keeps the
// first column and the header in view while scrolling, and never wraps an id in
// the middle of a token. The values of a hidden column stay one click away, in
// the row's details.
//
//   <DataTable id="health" label="Findings" rows={rows} rowKey={(r) => r.id}
//     columns={[
//       { id: "name", header: "Name", priority: 1, sticky: true, minWidth: 180, cell: (r) => r.name, sort: (r) => r.name },
//       { id: "id", header: "Entity id", priority: 2, truncate: true, maxWidth: 280, cell: (r) => <code>{r.id}</code>, text: (r) => r.id, sort: (r) => r.id },
//     ]}
//     defaultSort={{ key: "name", dir: "asc" }} />

export type { Dir, Sort, SortValue };

export type CellContext = {
  // True when the cell is drawn in the row's details panel, not in its column.
  inDetails: boolean;
};

export type Column<T> = {
  id: string;
  // What the header shows; short in a matrix ("Motion"), with `icon` before it.
  header: ReactNode;
  // The full name, for screen readers, the tooltip and the Columns menu. Defaults to `header` when that is text.
  label?: string;
  // An explanation shown on hover and focus of the header.
  help?: ReactNode;
  icon?: ReactNode;
  // Columns of one group, side by side, get a header over them.
  group?: string;
  cell: (row: T, ctx: CellContext) => ReactNode;
  // Makes the column sortable: the value rows are ordered by.
  sort?: (row: T) => SortValue;
  // The cell as plain text: the tooltip of a truncated cell and the text of a hidden column.
  text?: (row: T) => string;
  // 1 is always shown, 3 is the first to hide when there is no room. Default 2.
  priority?: Priority;
  // The narrowest it is useful at, in px. Default 96.
  minWidth?: number;
  maxWidth?: number;
  // A fixed width (a checkbox, an open button); implies sticky offsets are exact.
  width?: number;
  // One line with an ellipsis, the whole text in a tooltip. For ids and long names.
  truncate?: boolean;
  align?: "left" | "center" | "right";
  // Stays in view when the table scrolls sideways.
  sticky?: boolean;
  // Always shown and not in the Columns menu.
  locked?: boolean;
  // Hidden until the person shows it from the Columns menu.
  defaultHidden?: boolean;
  // Keep the cell on one line without an ellipsis (numbers, dates).
  nowrap?: boolean;
  // A cell for the table's footer row.
  footer?: ReactNode;
  // The header is only for screen readers (a checkbox column).
  srOnlyHeader?: boolean;
  cellClassName?: string;
};

export type RowTone = "default" | "muted" | "selected";

export type DataTableProps<T> = {
  // Names the table for screen readers and keeps the person's column choices
  // in this browser (`taxis:table:v3:<id>`).
  id: string;
  label: string;
  rows: readonly T[];
  rowKey: (row: T) => string;
  columns: readonly Column<T>[];
  // Rows kept above the sorted ones (the house, interior and exterior rows).
  pinned?: readonly T[];
  // Sorting: leave both out for a table that sorts itself from `defaultSort`;
  // give both when the page orders the rows (it then owns the order).
  defaultSort?: Sort;
  sort?: Sort;
  onSort?: (key: string) => void;
  // Sections: a heading before the first row of each group, which folds its rows away.
  // Rows of a group must be next to each other (sort them that way).
  groupOf?: (row: T) => { key: string; label: ReactNode } | null;
  collapsible?: boolean;
  rowTone?: (row: T) => RowTone;
  rowAttrs?: (row: T) => Record<`data-${string}`, string | undefined> & Pick<HTMLAttributes<HTMLTableRowElement>, "aria-selected">;
  onRowClick?: (row: T) => void;
  // A panel under a row, when the page has one open for it (a finding's fix, a
  // help text). Return null for a row with nothing open. It is as wide as the
  // scroll area, so it stays in view while the table scrolls sideways.
  rowDetail?: (row: T) => ReactNode;
  density?: "normal" | "compact";
  // The scroll area's height cap, so the header stays in view in a long table. "none" lifts it.
  maxHeight?: string;
  // Left of the Columns menu, above the table: a count, a note.
  summary?: ReactNode;
  // Shown instead of the table when there are no rows.
  empty?: ReactNode;
  className?: string;
};

// ---- the person's column choices, kept in this browser ---------------------

function useColumnPrefs(id: string): [ColumnPrefs, (next: ColumnPrefs) => void] {
  const key = `taxis:table:v3:${id}`;
  const [prefs, setPrefs] = useState<ColumnPrefs>(() => {
    try {
      return parseColumnPrefs(JSON.parse(window.localStorage.getItem(key) ?? "null"));
    } catch {
      return NO_PREFS;
    }
  });
  const set = useCallback(
    (next: ColumnPrefs) => {
      setPrefs(next);
      try {
        if (next.show.length === 0 && next.hide.length === 0) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Not remembered; the table still works.
      }
    },
    [key],
  );
  useEffect(() => {
    const reset = () => setPrefs(NO_PREFS);
    window.addEventListener("taxis:reset-layout", reset);
    return () => window.removeEventListener("taxis:reset-layout", reset);
  }, []);
  return [prefs, set];
}

// ---- sorting state for pages that own the order -----------------------------

// The sort state of a table: the column and the way, and what a click on a header does.
export function useSortState(initial: Sort) {
  const [sort, setSort] = useState<Sort>(initial);
  const toggle = useCallback((key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" })), []);
  return { sort, toggle };
}

// "Group by type" for a toolbar.
export function GroupToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--accent)]" /> Group by type
    </label>
  );
}

const TONE: Record<RowTone, string> = {
  default: "bg-surface hover:bg-sunken",
  muted: "bg-sunken hover:bg-sunken",
  selected: "bg-accent-soft hover:bg-accent-soft",
};

const DETAILS_WIDTH = 32;
const GROUP_ROW_HEIGHT = 28;

const textOf = (c: Column<never>): string => c.label ?? (typeof c.header === "string" ? c.header : c.id);

export function DataTable<T>({
  id,
  label,
  rows,
  rowKey,
  columns,
  pinned,
  defaultSort,
  sort: controlledSort,
  onSort,
  groupOf,
  collapsible = true,
  rowTone,
  rowAttrs,
  onRowClick,
  rowDetail,
  density = "normal",
  maxHeight = "70vh",
  summary,
  empty,
  className = "",
}: DataTableProps<T>) {
  const [prefs, setPrefs] = useColumnPrefs(id);
  const scroller = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(Number.POSITIVE_INFINITY);
  const [ownSort, setOwnSort] = useState<Sort>(defaultSort ?? { key: "", dir: "asc" });
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const sort = controlledSort ?? ownSort;
  const toggleSort = onSort ?? ((key: string) => setOwnSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" })));

  // The width of the scroll area, now and whenever it changes.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setAvailable(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setAvailable(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const colsRef = useRef(columns);
  colsRef.current = columns;
  const sorted = useMemo(() => {
    // A page that gives `sort` and `onSort` orders the rows itself.
    if (controlledSort) return rows;
    const get = colsRef.current.find((c) => c.id === sort.key)?.sort;
    return get ? sortRows(rows, get, sort.dir) : rows;
  }, [rows, sort.key, sort.dir, controlledSort]);

  // Which columns are drawn. The minimum widths decide first; a column's
  // content can be wider than its minimum, so after drawing the table measures
  // itself and drops one more column while it still overflows its scroll area.
  const hasSticky = columns.some((c) => c.sticky);
  const fitInput = columns.map((c) => ({
    id: c.id,
    priority: c.priority ?? 2,
    minWidth: c.width ?? c.minWidth ?? 96,
    locked: c.locked,
    defaultHidden: c.defaultHidden,
  }));
  const fitKey = `${available}|${fitInput.map((c) => c.id).join()}|${prefs.show.join()}|${prefs.hide.join()}`;
  const [drops, setDrops] = useState({ key: "", n: 0 });
  const extraDrops = drops.key === fitKey ? drops.n : 0;
  const fit = fitColumns(fitInput, prefs, available, 0, extraDrops);
  const visibleKey = fit.visible.join();
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !Number.isFinite(available) || !fit.canDropMore) return;
    if (el.scrollWidth > el.clientWidth + 1) setDrops({ key: fitKey, n: extraDrops + 1 });
  }, [fitKey, visibleKey, extraDrops, available, rows, fit.canDropMore]);
  const visible = columns.filter((c) => fit.visible.includes(c.id));
  const hidden = columns.filter((c) => fit.autoHidden.includes(c.id));
  const withDetails = hidden.length > 0;
  const offsets = stickyOffsets([
    ...(withDetails && hasSticky ? [{ id: "\u0000details", sticky: true, width: DETAILS_WIDTH }] : []),
    ...visible.map((c) => ({ id: c.id, sticky: c.sticky, width: c.width ?? c.minWidth ?? 96 })),
  ]);
  const span = visible.length + (withDetails ? 1 : 0);
  const grouped = headerRuns(visible).some((r) => r.group !== null);
  const compact = density === "compact";
  const pad = compact ? "px-2 py-1" : "px-3 py-1.5";

  const cellStyle = (c: Column<T>, header = false): CSSProperties => {
    const style: CSSProperties = {};
    if (c.width !== undefined) {
      style.width = c.width;
      style.minWidth = c.width;
      style.maxWidth = c.width;
    } else {
      if (c.minWidth !== undefined) style.minWidth = c.minWidth;
      if (c.maxWidth !== undefined && !(c.truncate && !header)) style.maxWidth = c.maxWidth;
    }
    if (c.sticky) {
      style.position = "sticky";
      style.left = offsets[c.id];
    }
    return style;
  };
  const align = (c: Column<T>) => (c.align === "center" ? "text-center" : c.align === "right" ? "text-right" : "text-left");
  const justify = (c: Column<T>) => (c.align === "center" ? "justify-center" : c.align === "right" ? "justify-end" : "justify-start");

  // ---- header ---------------------------------------------------------------

  const headerContent = (c: Column<T>) => {
    const name = textOf(c as Column<never>);
    const active = sort.key === c.id;
    const Icon = !c.sort ? null : !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    const inner = (
      <>
        {c.icon}
        <span className={c.srOnlyHeader ? "sr-only" : "whitespace-nowrap"}>{c.header}</span>
        {Icon && <Icon className={`size-3 shrink-0 ${active ? "text-accent" : "opacity-50"}`} aria-hidden />}
      </>
    );
    const cls = `inline-flex items-center gap-1 rounded ${c.sort ? "hover:text-fg" : ""}`;
    if (c.help) {
      return (
        <TooltipButton label={name} content={c.help} compact onClick={c.sort ? () => toggleSort(c.id) : undefined} className={cls}>
          {inner}
        </TooltipButton>
      );
    }
    if (c.sort) {
      return (
        <button
          type="button"
          title={name !== c.header ? name : undefined}
          aria-label={name !== c.header ? name : undefined}
          onClick={() => toggleSort(c.id)}
          className={cls}
        >
          {inner}
        </button>
      );
    }
    return (
      <span title={name !== c.header ? name : undefined} className={cls}>
        {inner}
      </span>
    );
  };

  const thClass = (c: Column<T>, extra = "") =>
    `border-b border-line bg-sunken ${compact ? "px-2 py-1.5" : "px-3 py-2"} text-xs font-medium text-muted ${align(c)} ${c.sticky ? "z-20" : "z-10"} ${extra}`;
  const ariaSort = (c: Column<T>) =>
    c.sort ? (sort.key === c.id ? (sort.dir === "asc" ? ("ascending" as const) : ("descending" as const)) : ("none" as const)) : undefined;

  const head = (
    <thead>
      {grouped && (
        <tr style={{ height: GROUP_ROW_HEIGHT }}>
          {withDetails && (
            <th
              scope="col"
              rowSpan={2}
              className="sticky top-0 z-20 border-b border-line bg-sunken"
              style={{ width: DETAILS_WIDTH, minWidth: DETAILS_WIDTH, ...(hasSticky ? { left: 0 } : {}) }}
            />
          )}
          {headerRuns(visible).map((run) => {
            const first = visible.find((c) => c.id === run.ids[0])!;
            if (run.group === null) {
              return (
                <th
                  key={first.id}
                  scope="col"
                  rowSpan={2}
                  aria-sort={ariaSort(first)}
                  style={{ ...cellStyle(first, true), top: 0 }}
                  className={`sticky ${thClass(first)}`}
                >
                  <span className={`flex ${justify(first)}`}>{headerContent(first)}</span>
                </th>
              );
            }
            return (
              <th
                key={`${run.group}:${first.id}`}
                scope="colgroup"
                colSpan={run.ids.length}
                style={{ top: 0 }}
                className="sticky z-10 border-b border-l border-line bg-sunken px-3 text-center text-xs font-semibold text-fg"
              >
                {run.group}
              </th>
            );
          })}
        </tr>
      )}
      <tr>
        {withDetails && !grouped && (
          <th
            scope="col"
            className="sticky top-0 z-20 border-b border-line bg-sunken"
            style={{ width: DETAILS_WIDTH, minWidth: DETAILS_WIDTH, ...(hasSticky ? { left: 0 } : {}) }}
          >
            <span className="sr-only">Details</span>
          </th>
        )}
        {visible
          .filter((c) => !grouped || headerRuns(visible).some((r) => r.group !== null && r.ids.includes(c.id)))
          .map((c) => (
            <th
              key={c.id}
              scope="col"
              aria-sort={ariaSort(c)}
              style={{ ...cellStyle(c, true), top: grouped ? GROUP_ROW_HEIGHT : 0 }}
              className={`sticky ${thClass(c, grouped ? "border-l" : "")}`}
            >
              <span className={`flex ${justify(c)}`}>{headerContent(c)}</span>
            </th>
          ))}
      </tr>
    </thead>
  );

  // ---- body -----------------------------------------------------------------

  const counts = useMemo(() => {
    const n = new Map<string, number>();
    if (groupOf)
      for (const r of sorted) {
        const g = groupOf(r);
        if (g) n.set(g.key, (n.get(g.key) ?? 0) + 1);
      }
    return n;
  }, [sorted, groupOf]);

  const renderCell = (c: Column<T>, row: T) => {
    const content = c.cell(row, { inDetails: false });
    if (!c.truncate) return content;
    const text = c.text?.(row) ?? (typeof content === "string" ? content : undefined);
    return (
      <div className="truncate" style={{ maxWidth: c.maxWidth ?? 280 }} title={text}>
        {content}
      </div>
    );
  };

  const renderRow = (row: T) => {
    const key = rowKey(row);
    const tone = rowTone?.(row) ?? "default";
    const open = opened.has(key);
    return (
      <Fragment key={key}>
        <tr
          {...rowAttrs?.(row)}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          className={`group align-top ${TONE[tone]} ${onRowClick ? "cursor-pointer" : ""}`}
        >
          {withDetails && (
            <td
              className="border-t border-line bg-inherit p-0 text-center align-top"
              style={{ width: DETAILS_WIDTH, minWidth: DETAILS_WIDTH, ...(hasSticky ? { position: "sticky", left: 0, zIndex: 1 } : {}) }}
            >
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${open ? "Hide" : "Show"} the other columns of this row`}
                title="Other columns"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpened((s) => {
                    const n = new Set(s);
                    if (!n.delete(key)) n.add(key);
                    return n;
                  });
                }}
                className="mt-1 rounded p-0.5 text-muted hover:bg-line hover:text-fg"
              >
                {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
              </button>
            </td>
          )}
          {visible.map((c) => (
            <td
              key={c.id}
              style={{ ...cellStyle(c), ...(c.sticky ? { zIndex: 1 } : {}) }}
              className={`border-t border-line bg-inherit ${pad} ${align(c)} ${c.nowrap ? "whitespace-nowrap" : ""} ${c.cellClassName ?? ""}`}
            >
              {renderCell(c, row)}
            </td>
          ))}
        </tr>
        {(() => {
          const detail = rowDetail?.(row);
          if (detail === null || detail === undefined || detail === false) return null;
          return (
            <tr className={TONE[tone]}>
              <td colSpan={span} className="bg-inherit p-0">
                <div className="sticky left-0" style={{ width: Number.isFinite(available) ? available : undefined }}>
                  {detail}
                </div>
              </td>
            </tr>
          );
        })()}
        {withDetails && open && (
          <tr className={TONE[tone]}>
            <td colSpan={span} className="border-t border-line bg-inherit p-0">
              <dl className="sticky left-0 grid gap-x-6 gap-y-2 px-3 py-2 sm:grid-cols-2" style={{ width: Number.isFinite(available) ? available : undefined }}>
                {hidden.map((c) => (
                  <div key={c.id} className="min-w-0">
                    <dt className="text-[11px] font-medium text-muted">{textOf(c as Column<never>)}</dt>
                    <dd className="min-w-0 break-words">{c.cell(row, { inDetails: true }) ?? "–"}</dd>
                  </div>
                ))}
              </dl>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  const body: ReactNode[] = [];
  for (const row of pinned ?? []) body.push(renderRow(row));
  let previousGroup: string | null = null;
  for (const row of sorted) {
    const g = groupOf?.(row) ?? null;
    if (g && g.key !== previousGroup) {
      const open = !folded.has(g.key);
      const Chevron = open ? ChevronDown : ChevronRight;
      body.push(
        <tr key={`group:${g.key}`} className="bg-sunken">
          <td colSpan={span} className="border-t border-line p-0">
            <div className="sticky left-0" style={{ width: Number.isFinite(available) ? available : undefined }}>
              {collapsible ? (
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() =>
                    setFolded((s) => {
                      const n = new Set(s);
                      if (!n.delete(g.key)) n.add(g.key);
                      return n;
                    })
                  }
                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs font-medium hover:text-accent"
                >
                  <Chevron className="size-3.5 shrink-0" aria-hidden />
                  {g.label}
                  <span className="font-normal tabular-nums text-muted">{counts.get(g.key)}</span>
                </button>
              ) : (
                <div className="px-3 py-1.5 text-xs font-medium text-muted">{g.label}</div>
              )}
            </div>
          </td>
        </tr>,
      );
    }
    previousGroup = g ? g.key : null;
    if (g && folded.has(g.key)) continue;
    body.push(renderRow(row));
  }

  const footers = visible.some((c) => c.footer !== undefined);
  const noRows = rows.length === 0 && !(pinned?.length ?? 0);

  return (
    <div className={`w-full min-w-0 max-w-full rounded-lg border border-line bg-surface ${className}`}>
      <div
        role="toolbar"
        aria-label={`Table controls for ${label}`}
        className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1 text-xs text-muted"
      >
        <div className="min-w-0 flex-1">{summary}</div>
        {fit.autoHidden.length > 0 && (
          <span>
            {fit.autoHidden.length} column{fit.autoHidden.length === 1 ? "" : "s"} don't fit: open a row's arrow to see{" "}
            {fit.autoHidden.length === 1 ? "it" : "them"}
          </span>
        )}
        <ColumnsMenu label={label} columns={columns} fit={fit} prefs={prefs} onChange={setPrefs} />
      </div>
      {noRows && empty ? (
        <div className="p-3">{empty}</div>
      ) : (
        <div
          ref={scroller}
          role="region"
          aria-label={label}
          tabIndex={0}
          className="max-w-full overflow-auto rounded-b-lg"
          style={{ maxHeight: maxHeight === "none" ? undefined : maxHeight }}
        >
          <table aria-label={label} className="w-full border-separate border-spacing-0 text-[13px]">
            {head}
            <tbody>{body}</tbody>
            {footers && (
              <tfoot>
                <tr className="bg-sunken font-medium">
                  {withDetails && <td className="border-t border-line" />}
                  {visible.map((c) => (
                    <td key={c.id} style={cellStyle(c)} className={`border-t border-line bg-sunken ${pad} ${align(c)} ${c.sticky ? "z-[1]" : ""}`}>
                      {c.footer}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

// ---- the Columns menu --------------------------------------------------------

function ColumnsMenu<T>({
  label,
  columns,
  fit,
  prefs,
  onChange,
}: {
  label: string;
  columns: readonly Column<T>[];
  fit: ReturnType<typeof fitColumns>;
  prefs: ColumnPrefs;
  onChange: (p: ColumnPrefs) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [open]);
  const changed = prefs.show.length > 0 || prefs.hide.length > 0;
  return (
    <div
      ref={root}
      // ml-auto: when the toolbar wraps (a narrow pane) the button would sit at the left,
      // and its menu, right-aligned to it, would open outside the table, behind the sidebar.
      className="relative ml-auto"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          root.current?.querySelector("button")?.focus();
        }
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Columns of ${label}`}
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 rounded-md border border-line bg-bg px-2 py-1 text-xs text-fg hover:bg-sunken"
      >
        <Columns3 className="size-3.5" aria-hidden />
        Columns
      </button>
      {open && (
        <div
          role="group"
          aria-label="Columns"
          className="absolute right-0 z-30 mt-1 flex max-h-72 w-60 flex-col gap-0.5 overflow-y-auto rounded-md border border-line bg-surface p-2 text-[13px] text-fg shadow-lg"
        >
          {columns.map((c) => {
            const visible = fit.visible.includes(c.id);
            const noRoom = fit.autoHidden.includes(c.id);
            return (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-sunken">
                <input
                  type="checkbox"
                  checked={visible}
                  disabled={c.locked}
                  onChange={() => onChange(togglePref(prefs, c.id, visible))}
                  className="accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1 truncate">{textOf(c as Column<never>)}</span>
                {c.locked && <span className="text-[11px] text-muted">required</span>}
                {noRoom && <span className="text-[11px] text-muted">no room</span>}
              </label>
            );
          })}
          {changed && (
            <button type="button" className="mt-1 text-left text-xs text-accent hover:underline" onClick={() => onChange(NO_PREFS)}>
              Reset columns
            </button>
          )}
        </div>
      )}
    </div>
  );
}
