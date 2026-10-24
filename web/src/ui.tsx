import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";

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
  "red", "pink", "purple", "deep-purple", "indigo", "blue", "light-blue", "cyan", "teal",
  "green", "light-green", "lime", "yellow", "amber", "orange", "deep-orange", "brown", "grey", "blue-grey",
];
const SWATCH: Record<string, string> = {
  red: "#e53935", pink: "#d81b60", purple: "#8e24aa", "deep-purple": "#5e35b1", indigo: "#3949ab", blue: "#1e88e5",
  "light-blue": "#039be5", cyan: "#00acc1", teal: "#00897b", green: "#43a047", "light-green": "#7cb342", lime: "#c0ca33",
  yellow: "#fdd835", amber: "#ffb300", orange: "#fb8c00", "deep-orange": "#f4511e", brown: "#6d4c41", grey: "#757575",
  "blue-grey": "#546e7a", primary: "#03a9f4", accent: "#ff9800", black: "#000000", white: "#ffffff",
};
export const labelColor = (color: string | null) => (color ? SWATCH[color] ?? (color.startsWith("#") ? color : null) : null);

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
  if (labels.length === 0) return <p id={id} className="text-xs text-muted">No labels yet. Create them under Organize.</p>;
  return (
    <div id={id} role="group" className="flex flex-wrap gap-1.5">
      {labels.map((l) => {
        const on = value.includes(l.id);
        const color = labelColor(l.color);
        return (
          <button
            key={l.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== l.id) : [...value, l.id])}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}
          >
            <span aria-hidden className="size-2 rounded-full" style={{ background: color ?? "var(--off)" }} />
            {l.name}
          </button>
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
}: {
  h: Hierarchy;
  value: string | null;
  onChange: (v: string | null) => void;
  id: string;
  noneLabel: string;
}) {
  const groups = [
    ...h.floors.map((f) => ({ name: f.name, ids: f.areaIds })),
    ...(h.looseAreaIds.length ? [{ name: "No floor", ids: h.looseAreaIds }] : []),
  ];
  return (
    <select id={id} className={inputClass} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
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
    <div className="sticky top-0 z-10 flex min-h-[3.25rem] flex-wrap items-center gap-2 rounded-t-lg border-b border-line bg-surface px-3.5 py-2.5">{children}</div>
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
