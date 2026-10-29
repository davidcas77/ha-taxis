import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent } from "react";

import { useStoredSet } from "./storage.ts";

// The width of the records list beside its details, a browser preference: dragging
// the divider never changes the house or its change list.
const PANE_KEY = "taxis:records:pane";
const PANE_DEFAULT = 416;
const PANE_MIN = 240;

function usePaneWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(PANE_KEY) ?? "{}")?.list;
      return typeof saved === "number" && Number.isFinite(saved) && saved >= PANE_MIN ? saved : PANE_DEFAULT;
    } catch {
      return PANE_DEFAULT;
    }
  });
  const change = (next: number) => {
    setWidth(next);
    try {
      window.localStorage.setItem(PANE_KEY, JSON.stringify({ list: next }));
    } catch {
      // Not remembered; the page still works.
    }
  };
  const reset = () => {
    setWidth(PANE_DEFAULT);
    try {
      window.localStorage.removeItem(PANE_KEY);
    } catch {
      // Not remembered; the page still works.
    }
  };
  return { width, change, reset };
}

// The draggable divider between the list and the details (desktop only).
function PaneDivider({ label, value, onChange, max }: { label: string; value: number; onChange: (width: number) => void; max: () => number }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const change = (width: number) => onChange(Math.round(Math.max(PANE_MIN, Math.min(max(), width))));
  const finish = () => {
    drag.current = null;
  };
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={PANE_MIN}
      tabIndex={0}
      className="records-divider hidden shrink-0 md:block"
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width: event.currentTarget.previousElementSibling?.getBoundingClientRect().width ?? value };
      }}
      onPointerMove={(event) => {
        if (drag.current) change(drag.current.width + event.clientX - drag.current.x);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          change(value + (event.key === "ArrowRight" ? 20 : -20));
        }
      }}
    />
  );
}

// Shared list/detail layout for all Records screens. Narrow screens retain their
// existing navigation; desktop widths are remembered across pages and reloads.
// "Reset layout" also puts every table's column choices back to their defaults.
export function RecordsSplit({
  list,
  details,
  listVisible = true,
  detailsVisible = true,
}: {
  list: ReactNode;
  details: ReactNode;
  listVisible?: boolean;
  detailsVisible?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const pane = usePaneWidth();
  return (
    <div ref={container} className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      <section
        aria-label="Records"
        style={{ "--records-width": `${pane.width}px` } as CSSProperties}
        className={`${listVisible ? "flex" : "hidden"} records-pane min-h-0 min-w-0 flex-1 flex-col border-b border-line md:flex md:flex-none md:border-b-0`}
      >
        <div className="flex justify-end border-b border-line px-2 py-1">
          <button
            type="button"
            className="text-xs text-accent"
            onClick={() => {
              pane.reset();
              try {
                for (const key of Object.keys(window.localStorage)) if (key.startsWith("taxis:table:v3:")) window.localStorage.removeItem(key);
              } catch {
                // Not remembered; the page still works.
              }
              window.dispatchEvent(new Event("taxis:reset-layout"));
            }}
          >
            Reset layout
          </button>
        </div>
        {list}
      </section>
      <PaneDivider
        label="Resize records and properties"
        value={pane.width}
        max={() => Math.max(PANE_MIN, (container.current?.clientWidth ?? 1000) - 327)}
        onChange={pane.change}
      />
      <section aria-label="Properties" className={`${detailsVisible ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col overflow-y-auto md:flex`}>
        {details}
      </section>
    </div>
  );
}

export function AreaMultiSelect({
  areas,
  selected,
  onChange,
}: {
  areas: readonly { id: string; name: string }[];
  selected: ReadonlySet<string>;
  onChange: (areas: ReadonlySet<string>) => void;
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
  const options = [{ id: "", name: "No area" }, ...[...areas].sort((a, b) => a.name.localeCompare(b.name))];
  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          root.current?.querySelector("button")?.focus();
        }
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label="Filter records by area"
        onClick={() => setOpen(!open)}
        className="rounded-md border border-line bg-bg px-2 py-1.5 text-[13px]"
      >
        {selected.size ? `${selected.size} ${selected.size === 1 ? "area" : "areas"}` : "All areas"} ▾
      </button>
      {open && (
        <div
          role="group"
          aria-label="Areas"
          className="absolute right-0 z-30 mt-1 flex max-h-72 w-60 flex-col gap-1 overflow-y-auto rounded-md border border-line bg-surface p-2 shadow-lg"
        >
          <button type="button" className="text-left text-xs text-accent" onClick={() => onChange(new Set())}>
            All areas
          </button>
          {options.map((area) => (
            <label key={area.id} className="flex items-center gap-2 rounded px-1 py-1 text-[13px] hover:bg-sunken">
              <input
                type="checkbox"
                checked={selected.has(area.id)}
                onChange={() => {
                  const next = new Set(selected);
                  if (!next.delete(area.id)) next.add(area.id);
                  onChange(next);
                }}
              />
              {area.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// One area-selection contract shared by Table and Records. An empty set means
// all areas; the empty string explicitly selects entities/devices with no area.
export function useAreaFilter(): [ReadonlySet<string>, (areas: ReadonlySet<string>) => void] {
  const [areas, change] = useStoredSet("taxis:filters:areas");
  return [
    areas,
    (next) =>
      change((value) => {
        value.clear();
        for (const id of next) value.add(id);
      }),
  ];
}

export function FilterChips({ items, clear }: { items: { label: string; remove: () => void }[]; clear: () => void }) {
  if (!items.length) return null;
  return (
    <div aria-label="Active filters" className="flex flex-wrap items-center gap-2 text-xs">
      {items.map((item, i) => (
        <button
          key={`${item.label}:${i}`}
          type="button"
          onClick={item.remove}
          className="rounded border border-line bg-accent-soft px-2 py-1 text-accent"
          aria-label={`Remove filter ${item.label}`}
        >
          {item.label} ×
        </button>
      ))}
      <button type="button" className="text-accent underline" onClick={clear}>
        Clear all filters
      </button>
    </div>
  );
}

// All result sets remain reachable; changing filters/sort resets the page.
export function usePagination(total: number, resetKey: string, size = 100) {
  const [state, setState] = useState({ key: resetKey, page: 0 });
  // Forget the previous filter's page when its key changes. Merely displaying
  // page zero would restore the old page when the user clears those filters.
  if (state.key !== resetKey) setState({ key: resetKey, page: 0 });
  const pages = Math.max(1, Math.ceil(total / size));
  const page = state.key === resetKey ? Math.min(state.page, pages - 1) : 0;
  const setPage = (next: number) => setState({ key: resetKey, page: Math.max(0, Math.min(pages - 1, next)) });
  return { page, pages, size, start: page * size, end: Math.min(total, (page + 1) * size), total, setPage };
}

export function Pagination({ page, pages, start, end, total, setPage }: ReturnType<typeof usePagination>) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Results pages" className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 pl-2 pr-20 text-xs text-muted">
      <span>
        {start + 1}–{end} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-3">
        <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="text-accent disabled:opacity-40">
          Previous page
        </button>
        <span>
          Page {page + 1} of {pages}
        </span>
        <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="text-accent disabled:opacity-40">
          Next page
        </button>
      </div>
    </nav>
  );
}

export function ListEmpty({ reset }: { reset?: () => void }) {
  return (
    <div role="status" className="rounded border border-dashed border-line p-5 text-sm text-muted">
      No matching devices or entities.
      {reset && (
        <button type="button" className="ml-2 text-accent underline" onClick={reset}>
          Reset filters
        </button>
      )}
    </div>
  );
}
