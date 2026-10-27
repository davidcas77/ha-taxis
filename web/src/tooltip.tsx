import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Render outside scroll containers so table cells never clip their explanations.
// Keep the popup open while the pointer is over it, including when scrolling a list.
let activeTooltip: { id: string; close: () => void } | null = null;

export function TooltipButton({ label, children, content, onClick, compact = false, className = "" }: {
  label: string; children: ReactNode; content: ReactNode; onClick?: () => void; compact?: boolean; className?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    if (activeTooltip?.id !== id) activeTooltip?.close();
    activeTooltip = { id, close: () => { if (timer.current) clearTimeout(timer.current); setOpen(false); } };
    setOpen(true);
  };
  const hideSoon = () => { timer.current = setTimeout(() => setOpen(false), 120); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); if (activeTooltip?.id === id) activeTooltip = null; }, [id]);
  useLayoutEffect(() => {
    if (!open) return;
    const positionPopup = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const box = popup.current?.getBoundingClientRect();
      if (!anchor || !box) return;
      if (anchor.bottom < 0 || anchor.top > innerHeight || anchor.right < 0 || anchor.left > innerWidth) { setOpen(false); return; }
      const left = Math.max(8, Math.min(innerWidth - box.width - 8, anchor.left + anchor.width / 2 - box.width / 2));
      const below = anchor.bottom + 6;
      const top = below + box.height <= innerHeight - 8 ? below : Math.max(8, anchor.top - box.height - 6);
      setPosition({ left, top });
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    positionPopup();
    window.addEventListener("resize", positionPopup);
    window.addEventListener("scroll", positionPopup, true);
    document.addEventListener("keydown", escape);
    return () => { window.removeEventListener("resize", positionPopup); window.removeEventListener("scroll", positionPopup, true); document.removeEventListener("keydown", escape); };
  }, [open, content]);
  return <>
    <button ref={trigger} type="button" aria-label={label} aria-describedby={open ? id : undefined}
      className={className} onMouseEnter={show} onMouseLeave={hideSoon} onFocus={show} onBlur={() => setOpen(false)}
      onClick={() => { if (onClick) onClick(); else show(); }}>{children}</button>
    {open && createPortal(<div ref={popup} id={id} role="tooltip" onMouseEnter={show} onMouseLeave={hideSoon}
      className="fixed z-[1000] max-h-[min(24rem,calc(100vh-1rem))] overflow-y-auto rounded-lg border border-line bg-surface p-3 text-left text-xs text-fg shadow-xl"
      style={{ ...position, width: compact ? "min(18rem, calc(100vw - 1rem))" : "min(26rem, calc(100vw - 1rem))" }}>{content}</div>, document.body)}
  </>;
}
