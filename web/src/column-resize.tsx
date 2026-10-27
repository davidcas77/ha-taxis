import { useLayoutEffect, useState, type RefObject } from "react";

type Columns = {
  key: string;
  widths: number[];
  saved: number[] | null;
  preferred: Map<number, number>;
  listeners: Set<() => void>;
  render: () => void;
  resize: (index: number, width: number) => void;
  schedule: () => void;
  dispose: () => void;
};
const tables = new WeakMap<HTMLTableElement, Columns>();
const validWidth = (width: unknown): width is number => typeof width === "number" && Number.isFinite(width) && width >= 16 && width <= 2000;

// Measure the rendered headers, values and controls at their natural width.
// Existing fixed colgroups and full-width tables must not influence the result.
// Very long values wrap at 480px instead of creating an enormous column.
function contentWidths(table: HTMLTableElement): number[] {
  const clone = table.cloneNode(true) as HTMLTableElement;
  clone.removeAttribute("id");
  clone.setAttribute("aria-hidden", "true");
  Object.assign(clone.style, { position: "fixed", left: "-100000px", top: "0", visibility: "hidden", pointerEvents: "none", width: "max-content", minWidth: "0", maxWidth: "none", tableLayout: "auto" });
  clone.querySelectorAll("col, th, td").forEach(element => {
    const cell = element as HTMLElement;
    cell.style.width = "auto";
    cell.style.minWidth = "0";
    cell.style.maxWidth = "none";
  });
  clone.querySelectorAll('[role="separator"], .sr-only').forEach(element => element.remove());
  // Section headings span the table; their prose does not size data columns.
  clone.querySelectorAll("[colspan]").forEach(element => { if ((element as HTMLTableCellElement).colSpan > 1) element.textContent = ""; });
  table.parentElement!.append(clone);
  try {
    return [...(clone.tHead?.rows[0]?.cells ?? [])].map(cell => Math.max(32, Math.min(480, Math.ceil(cell.getBoundingClientRect().width) + 8)));
  } finally { clone.remove(); }
}

function tableColumns(table: HTMLTableElement): Columns {
  const headers = [...(table.tHead?.rows[0]?.cells ?? [])];
  const signature = headers.map(header => header.dataset.columnKey ?? header.textContent?.trim()).join("|");
  const key = `taxis:columns:${window.location.pathname}:${window.location.hash}:${signature}`;
  const previous = tables.get(table);
  if (previous?.key === key) return previous;
  previous?.dispose();
  const colgroup = [...table.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col")];
  const original = { width: table.style.width, minWidth: table.style.minWidth, layout: table.style.tableLayout, cells: headers.map(header => header.style.width), cols: colgroup.map(col => col.style.width) };
  let frame = 0;
  let disposed = false;
  const notify = () => columns.listeners.forEach(listener => listener());
  const columns: Columns = {
    key, widths: [], saved: null, preferred: new Map(), listeners: new Set(),
    render() {
      if (!columns.widths.length || disposed) return;
      table.dataset.contentSized = "true";
      table.style.tableLayout = "fixed";
      table.style.minWidth = "0";
      table.style.width = `${columns.widths.reduce((sum, width) => sum + width, 0)}px`;
      headers.forEach((header, index) => { header.style.width = `${columns.widths[index]}px`; });
      colgroup.forEach((col, index) => { col.style.width = `${columns.widths[index]}px`; });
    },
    resize(index, width) {
      columns.widths[index] = width;
      columns.saved = [...columns.widths];
      columns.render();
      try { localStorage.setItem(key, JSON.stringify(columns.saved)); } catch { /* Storage is optional. */ }
      notify();
    },
    schedule() {
      if (frame || disposed) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (disposed || !table.isConnected) return;
        columns.widths = columns.saved ?? contentWidths(table).map((width, index) => columns.preferred.get(index) ?? width);
        columns.render();
        notify();
      });
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("taxis:reset-layout", reset);
      table.style.width = original.width;
      table.style.minWidth = original.minWidth;
      table.style.tableLayout = original.layout;
      delete table.dataset.contentSized;
      headers.forEach((header, index) => { header.style.width = original.cells[index]; });
      colgroup.forEach((col, index) => { col.style.width = original.cols[index]; });
    },
  };
  const reset = () => {
    columns.saved = null;
    columns.preferred.clear();
    try { localStorage.removeItem(key); } catch { /* Storage is optional. */ }
    columns.schedule();
  };
  // Row/filter/value changes re-fit defaults; explicit user widths stay put.
  const observer = new MutationObserver(columns.schedule);
  observer.observe(table, { subtree: true, childList: true, characterData: true });
  window.addEventListener("taxis:reset-layout", reset);
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (Array.isArray(saved) && saved.length === headers.length && saved.every(validWidth)) columns.saved = saved;
  } catch { /* Use content widths when storage is unavailable. */ }
  tables.set(table, columns);
  columns.schedule();
  return columns;
}

// Both formerly automatic tables and explicit colgroups share content sizing.
// savedWidth migrates an existing manual preference from useWidths, if present.
export function useColumnResize(handle: RefObject<HTMLDivElement | null>, enabled: boolean, savedWidth?: number, label?: string) {
  const [width, setWidth] = useState<number | null>(null);
  const identity = `${window.location.pathname}:${window.location.hash}:${label}`;
  useLayoutEffect(() => {
    if (!enabled) return;
    const cell = handle.current?.closest("th");
    const table = cell?.closest("table");
    if (!cell || !table) return;
    const columns = tableColumns(table);
    if (validWidth(savedWidth)) columns.preferred.set(cell.cellIndex, savedWidth);
    const update = () => setWidth(columns.widths[cell.cellIndex] ?? null);
    columns.listeners.add(update);
    columns.render();
    update();
    return () => {
      columns.listeners.delete(update);
      if (!columns.listeners.size && tables.get(table) === columns) { columns.dispose(); tables.delete(table); }
    };
  }, [enabled, identity]);
  useLayoutEffect(() => {
    if (!enabled) return;
    const table = handle.current?.closest("table");
    if (table) tableColumns(table).render();
  });
  return { width, resize: (next: number) => {
    const cell = handle.current?.closest("th");
    const table = cell?.closest("table");
    if (cell && table) tableColumns(table).resize(cell.cellIndex, next);
  } };
}
