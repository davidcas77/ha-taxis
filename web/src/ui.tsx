import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";

import { Search, ShieldCheck } from "lucide-react";

import type { Hierarchy, LabelItem } from "../../shared/types.ts";

// Small building blocks shared by every screen.

export function Button({
  tone = "plain",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "plain" | "primary" | "danger" | "ghost"; ref?: Ref<HTMLButtonElement> }) {
  const tones = {
    plain: "border border-line bg-surface hover:bg-sunken",
    primary: "border border-transparent bg-accent text-[var(--on-accent)] hover:opacity-90",
    danger: "border border-line text-danger hover:bg-danger-soft",
    ghost: "border border-transparent hover:bg-sunken",
  };
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]} ${className}`}
    />
  );
}

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: ReactNode; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass = "w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent";

// Home Assistant's label colors (the names its color picker uses).
export const LABEL_COLORS = [
  "red",
  "pink",
  "purple",
  "deep-purple",
  "indigo",
  "blue",
  "light-blue",
  "cyan",
  "teal",
  "green",
  "light-green",
  "lime",
  "yellow",
  "amber",
  "orange",
  "deep-orange",
  "brown",
  "grey",
  "blue-grey",
];
const SWATCH: Record<string, string> = {
  red: "#e53935",
  pink: "#d81b60",
  purple: "#8e24aa",
  "deep-purple": "#5e35b1",
  indigo: "#3949ab",
  blue: "#1e88e5",
  "light-blue": "#039be5",
  cyan: "#00acc1",
  teal: "#00897b",
  green: "#43a047",
  "light-green": "#7cb342",
  lime: "#c0ca33",
  yellow: "#fdd835",
  amber: "#ffb300",
  orange: "#fb8c00",
  "deep-orange": "#f4511e",
  brown: "#6d4c41",
  grey: "#757575",
  "blue-grey": "#546e7a",
  primary: "#03a9f4",
  accent: "#ff9800",
  black: "#000000",
  white: "#ffffff",
};
export const labelColor = (color: string | null) => (color ? (SWATCH[color] ?? (color.startsWith("#") ? color : null)) : null);

export function LabelChip({ label, onRemove }: { label: LabelItem; onRemove?: () => void }) {
  const color = labelColor(label.color);
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs">
      <span aria-hidden className="size-2 rounded-full" style={{ background: color ?? "var(--off)" }} />
      {label.name}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove label ${label.name}`} className="ml-0.5 text-muted hover:text-fg">
          ×
        </button>
      )}
    </span>
  );
}

// Toggle labels on and off. Shows every label in the home.
export function LabelPicker({ h, value, onChange, id }: { h: Hierarchy; value: string[]; onChange: (v: string[]) => void; id: string }) {
  const labels = Object.values(h.labels).sort((a, b) => a.name.localeCompare(b.name));
  if (labels.length === 0)
    return (
      <p id={id} className="text-xs text-muted">
        No labels yet. Create them under Organize.
      </p>
    );
  return (
    <div id={id} role="group" className="flex flex-wrap gap-1.5">
      {labels.map((l) => {
        const on = value.includes(l.id);
        const color = labelColor(l.color);
        return (
          <Chip key={l.id} pressed={on} compact onClick={() => onChange(on ? value.filter((x) => x !== l.id) : [...value, l.id])}>
            <span aria-hidden className="size-2 rounded-full" style={{ background: color ?? "var(--off)" }} />
            {l.name}
          </Chip>
        );
      })}
    </div>
  );
}

// Pick an area, grouped by floor. `followLabel` adds an option for "no area of
// its own" (an entity then follows its device).
export function AreaSelect({
  h,
  value,
  onChange,
  id,
  noneLabel,
  disabled,
}: {
  h: Hierarchy;
  value: string | null;
  onChange: (v: string | null) => void;
  id: string;
  noneLabel: string;
  disabled?: boolean;
}) {
  const groups = [...h.floors.map((f) => ({ name: f.name, ids: f.areaIds })), ...(h.looseAreaIds.length ? [{ name: "No floor", ids: h.looseAreaIds }] : [])];
  return (
    <select disabled={disabled} id={id} className={`${inputClass} area-select`} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{noneLabel}</option>
      {groups.map((g) => (
        <optgroup key={g.name} label={g.name}>
          {g.ids.map((aid) => (
            <option key={aid} value={aid}>
              {h.areas[aid].name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function EditedDot({ title = "Changed in Taxis, not applied yet" }: { title?: string }) {
  return <span role="img" aria-label={title} title={title} className="inline-block size-1.5 shrink-0 rounded-full bg-warn" />;
}

// An editor's frame. `actions` render in the title row, top right, and the row
// is sticky so Add to changes stays in view while the body scrolls.
export function Panel({ title, onClose, children, actions }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  // An editor opens at the top of the page; bring it into view and put the
  // cursor in its first field.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    ref.current?.querySelector<HTMLElement>("input, select")?.focus({ preventScroll: true });
  }, []);
  return (
    <section ref={ref} aria-label={typeof title === "string" ? title : "Editor"} className="flex flex-col rounded-lg border border-accent/40 bg-surface">
      <HeaderBar>
        <h2 className="min-w-[6rem] flex-1 truncate text-sm font-semibold">{title}</h2>
        {actions}
        <button type="button" onClick={onClose} aria-label="Close" className="rounded px-1.5 text-lg leading-none text-muted hover:text-fg">
          ×
        </button>
      </HeaderBar>
      <div className="flex flex-col gap-3.5 p-3.5">{children}</div>
    </section>
  );
}

// The top row of every editor and detail form. Sticky, with a fixed minimum
// height so nothing jumps when buttons appear.
export function HeaderBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex min-h-[3.25rem] flex-wrap items-center gap-2 rounded-t-lg border-b border-line bg-surface px-3.5 py-2.5">
      {children}
    </div>
  );
}

// The one place that decides what the header actions show, left to right:
// "Unsaved edits", Add to changes, Cancel, then `danger` (a Delete). Saving is
// offered only once something differs; Delete is an action, not a save, so it
// is always there and, being last, never moves.
export function Actions({
  dirty,
  onSave,
  onCancel,
  saving = false,
  error,
  danger,
}: {
  dirty: boolean;
  onSave: () => void;
  onCancel?: () => void;
  saving?: boolean;
  error?: string | null;
  danger?: ReactNode;
}) {
  return (
    <>
      {dirty && <span className="text-xs text-muted">Unsaved edits</span>}
      {dirty && (
        <Button tone="primary" onClick={onSave} disabled={saving}>
          Add to changes
        </Button>
      )}
      {onCancel && (
        <Button tone="ghost" onClick={onCancel}>
          {dirty ? "Cancel" : "Close"}
        </Button>
      )}
      {danger}
      {error && (
        <span role="alert" className="basis-full text-right text-xs text-danger">
          {error}
        </span>
      )}
    </>
  );
}

// A destructive button that asks first, in place. The confirm button repeats
// the trigger's own text. Focus lands on Cancel so a stray Enter doesn't
// delete; Escape cancels. `wide` drops the question onto its own line (used in
// a header, so it sits right under the title row).
export function ConfirmAction({
  children,
  question,
  onConfirm,
  tone = "danger",
  disabled,
  ariaLabel,
  className = "",
  wide = false,
}: {
  children: ReactNode;
  question: ReactNode;
  onConfirm: () => void;
  tone?: "plain" | "danger" | "ghost";
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  wide?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (asking) cancelRef.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [asking]);
  // Nothing left to act on (e.g. the selection was cleared): drop the question.
  useEffect(() => {
    if (disabled) setAsking(false);
  }, [disabled]);

  const cancel = () => {
    returnFocus.current = true;
    setAsking(false);
  };

  if (!asking) {
    return (
      <Button ref={triggerRef} tone={tone} className={className} disabled={disabled} aria-label={ariaLabel} onClick={() => setAsking(true)}>
        {children}
      </Button>
    );
  }
  return (
    <span
      role="group"
      aria-label="Confirm"
      className={`flex flex-wrap items-center gap-2 text-xs ${wide ? "basis-full justify-end" : ""}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          cancel();
        }
      }}
    >
      <span>{question}</span>
      <Button
        tone="danger"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {children}
      </Button>
      <Button ref={cancelRef} tone="ghost" onClick={cancel}>
        Cancel
      </Button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// The page-level primitives. Every page is a Page with a PageHeader, then
// Sections and Cards; filters sit in a Toolbar; an empty list is an EmptyState;
// status is a Badge with one colour map. Use these, not new ad-hoc classes, so
// the screens look like one product.
// ---------------------------------------------------------------------------

// The one colour map for status: ok, warn, error, info and muted.
export type Tone = "ok" | "warn" | "error" | "info" | "muted";
export const TONE_TEXT: Record<Tone, string> = { ok: "text-on", warn: "text-warn", error: "text-danger", info: "text-accent", muted: "text-muted" };
const TONE_PILL: Record<Tone, string> = {
  ok: "border-on/40 bg-ok-soft text-on",
  warn: "border-warn/40 bg-warn-soft text-warn",
  error: "border-danger/40 bg-danger-soft text-danger",
  info: "border-accent/40 bg-accent-soft text-accent",
  muted: "border-line bg-sunken text-muted",
};
// A health severity is a tone too.
export const toneOfSeverity = (severity: "error" | "warning" | "info"): Tone => (severity === "warning" ? "warn" : severity === "info" ? "muted" : "error");

export function Badge({ tone = "muted", icon, children, title }: { tone?: Tone; icon?: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-medium ${TONE_PILL[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

// A full page: scrolls on its own, content centred and capped. `min-w-0` lets
// wide children (tables) scroll inside themselves instead of widening the page.
export function Page({ children, width = "6xl" }: { children: ReactNode; width?: "3xl" | "4xl" | "6xl" | "7xl" }) {
  const max = { "3xl": "max-w-3xl", "4xl": "max-w-4xl", "6xl": "max-w-6xl", "7xl": "max-w-7xl" }[width];
  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className={`mx-auto flex min-w-0 flex-col gap-5 ${max}`}>{children}</div>
    </main>
  );
}

// Title, one line saying what the page is for, and the page's actions. In a
// pane that already sits under a Page, use `level={2}`.
export function PageHeader({
  title,
  icon,
  description,
  actions,
  level = 1,
}: {
  title: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <header className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Heading className={`flex items-center gap-2 font-semibold tracking-tight ${level === 1 ? "text-xl" : "text-base"}`}>
          {icon}
          {title}
        </Heading>
        {description && (
          <p className="max-w-full truncate text-[13px] text-muted" title={typeof description === "string" ? description : undefined}>
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// A titled part of a page.
export function Section({
  title,
  description,
  actions,
  children,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section aria-labelledby={id ? `${id}-title` : undefined} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <div className="flex min-w-[10rem] flex-1 flex-col gap-0.5">
          <h2 id={id ? `${id}-title` : undefined} className="text-sm font-semibold">
            {title}
          </h2>
          {description && <p className="max-w-[72ch] text-xs text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Card({
  children,
  className = "",
  padded = true,
  tone,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  tone?: "accent" | "warn" | "danger";
}) {
  const border = tone === "accent" ? "border-accent/40" : tone === "warn" ? "border-warn/50" : tone === "danger" ? "border-danger/50" : "border-line";
  return <div className={`min-w-0 rounded-lg border bg-surface ${border} ${padded ? "p-3.5" : ""} ${className}`}>{children}</div>;
}

export function EmptyState({ title, children, action, icon }: { title?: ReactNode; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
      {icon}
      {title && <p className="font-medium text-fg">{title}</p>}
      {children && <div className="max-w-[60ch]">{children}</div>}
      {action}
    </div>
  );
}

// Filters and view switches on one row that wraps. Give it a `label` so the
// row is announced.
export function Toolbar({ children, label, className = "" }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <div role="group" aria-label={label} className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 ${className}`}>
      {children}
    </div>
  );
}

// A search box for a Toolbar.
export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label?: string }) {
  return (
    <label className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-md border border-line bg-bg px-2 py-1.5 focus-within:border-accent">
      <Search className="size-4 shrink-0 text-muted" aria-hidden />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className="w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted"
      />
    </label>
  );
}

// A filter or view choice: a pill that is pressed or not.
// `ariaLabel` names it when the text alone is not enough; `compact` is the
// shorter one for a table cell.
export function Chip({
  pressed,
  onClick,
  children,
  title,
  ariaLabel,
  disabled,
  compact,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md border px-2 ${compact ? "py-0.5" : "py-1"} text-xs disabled:cursor-not-allowed disabled:opacity-50 ${pressed ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}
    >
      {children}
    </button>
  );
}

export type TabItem<T extends string> = { key: T; label: ReactNode; icon?: ReactNode; count?: number; title?: string };

// Page tabs: one look for Parameters, Automations, Settings, Helpers and an
// area's tools. The panel it controls gets `role="tabpanel"` and
// `id={tabPanelId(label)}`.
export const tabPanelId = (label: string) => `tabpanel-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: readonly TabItem<T>[]; value: T; onChange: (key: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex min-w-0 gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          title={t.title}
          aria-selected={value === t.key}
          aria-controls={tabPanelId(label)}
          onClick={() => onChange(t.key)}
          className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] ${value === t.key ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-fg"}`}
        >
          {t.icon}
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="rounded-full bg-sunken px-1.5 text-[11px] tabular-nums text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// A confirmation that opens in place of what asked for it, as a dialog: for an
// action that writes to Home Assistant (Apply), where the question is a few
// lines, not one. ConfirmAction is the one-line version for a button. Both
// answer with the same words: the action's own name, and Cancel.
export function ConfirmPanel({
  children,
  onYes,
  onNo,
  yes,
  danger,
}: {
  children: ReactNode;
  onYes: () => void;
  onNo: () => void;
  yes: string;
  danger?: boolean;
}) {
  return (
    <div role="alertdialog" aria-label="Confirm" className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-surface p-3.5">
      <p className="flex items-start gap-2 text-[13px]">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <span>{children}</span>
      </p>
      <div className="flex gap-2">
        <Button tone={danger ? "danger" : "primary"} onClick={onYes}>
          {yes}
        </Button>
        <Button tone="ghost" onClick={onNo}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
