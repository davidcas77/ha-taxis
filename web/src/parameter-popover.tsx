import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// Interactive settings stay outside the table, with a bounded scrolling body.
export function ParameterPopover({ anchor, title, onClose, children }: {
  anchor: RefObject<HTMLElement | null>; title: string; onClose: () => void; children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      const box = panel.current?.getBoundingClientRect();
      if (!rect || !box) return;
      if (rect.bottom < 0 || rect.top > innerHeight) { close.current(); return; }
      setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - box.width - 8)), top: rect.bottom + box.height + 6 <= innerHeight - 8 ? rect.bottom + 6 : Math.max(8, rect.top - box.height - 6) });
    };
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) close.current(); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key !== "Tab") return;
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? [])];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    place();
    panel.current?.querySelector<HTMLElement>("input:not(:disabled),button")?.focus();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keyboard);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keyboard);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      anchor.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    };
  }, [anchor]);
  return createPortal(<div ref={panel} role="dialog" aria-label={title} style={{ ...position, width: "min(28rem, calc(100vw - 1rem))", maxHeight: "min(34rem, calc(100vh - 2rem))" }} className="fixed z-[1100] flex min-h-0 flex-col rounded-lg border border-accent bg-surface text-fg shadow-xl">
    <h3 className="shrink-0 border-b border-line px-3 py-2 text-sm font-semibold">{title}</h3>
    <div className="min-h-0 overflow-y-auto p-3">{children}</div>
    <div className="shrink-0 border-t border-line px-3 py-2"><button type="button" onClick={onClose} className="rounded px-2 py-1 text-sm text-accent hover:bg-sunken">Done</button></div>
  </div>, document.body);
}
