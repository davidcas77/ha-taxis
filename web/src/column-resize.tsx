import { useEffect, useState, type RefObject } from "react";

import { ResizeHandle } from "./records.tsx";

type Columns = {
  key: string;
  widths: number[] | null;
  listeners: Set<() => void>;
  apply: (widths: number[]) => void;
  reset: () => void;
  dispose: () => void;
};
const tables = new WeakMap<HTMLTableElement, Columns>();

function tableColumns(table: HTMLTableElement): Columns {
  const headers = [...(table.tHead?.rows[0]?.cells ?? [])];
  const signature = headers.map(header => header.dataset.columnKey ?? header.textContent?.trim()).join("|");
  const key = `taxis:columns:${window.location.pathname}:${window.location.hash}:${signature}`;
  const previous = tables.get(table);
  if (previous?.key === key) return previous;
  previous?.dispose();
  const original = { width: table.style.width, layout: table.style.tableLayout, cells: headers.map(header => header.style.width) };
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  const restore = () => {
    table.style.width = original.width;
    table.style.tableLayout = original.layout;
    headers.forEach((header, index) => { header.style.width = original.cells[index]; });
  };
  const columns: Columns = {
    key, widths: null, listeners,
    apply(widths) {
      columns.widths = widths;
      // Fixed layout uses the first header row's explicit widths, including any
      // non-sortable selection/action columns, without modifying other tables.
      table.style.tableLayout = "fixed";
      table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
      headers.forEach((header, index) => { header.style.width = `${widths[index]}px`; });
      notify();
    },
    reset() {
      columns.widths = null;
      restore();
      try { localStorage.removeItem(key); } catch { /* Storage is optional. */ }
      notify();
    },
    dispose() { restore(); window.removeEventListener("taxis:reset-layout", columns.reset); },
  };
  tables.set(table, columns);
  window.addEventListener("taxis:reset-layout", columns.reset);
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (Array.isArray(saved) && saved.length === headers.length && saved.every(width => typeof width === "number" && Number.isFinite(width) && width >= 16 && width <= 2000)) columns.apply(saved);
  } catch { /* Keep the table's normal automatic layout. */ }
  return columns;
}

// SortHeader opts into this engine by default. Explicit resize controls retain
// ownership of their colgroup and do not initialize automatic column sizing.
export function AutoColumnResize({ header, label }: { header: RefObject<HTMLTableCellElement | null>; label: string }) {
  const [width, setWidth] = useState(100);
  useEffect(() => {
    const cell = header.current;
    const table = cell?.closest("table");
    if (!cell || !table) return;
    const columns = tableColumns(table);
    const update = () => setWidth(Math.round(cell.getBoundingClientRect().width));
    columns.listeners.add(update);
    update();
    return () => {
      columns.listeners.delete(update);
      if (!columns.listeners.size && tables.get(table) === columns) { columns.dispose(); tables.delete(table); }
    };
  });
  return <ResizeHandle label={`Resize ${label} column`} value={width} onChange={next => {
    const cell = header.current;
    const table = cell?.closest("table");
    if (!cell || !table) return;
    const columns = tableColumns(table);
    const headers = [...(table.tHead?.rows[0]?.cells ?? [])];
    const widths = columns.widths ? [...columns.widths] : headers.map(header => Math.max(16, Math.round(header.getBoundingClientRect().width)));
    widths[cell.cellIndex] = next;
    columns.apply(widths);
    try { localStorage.setItem(columns.key, JSON.stringify(widths)); } catch { /* Storage is optional. */ }
  }} />;
}
