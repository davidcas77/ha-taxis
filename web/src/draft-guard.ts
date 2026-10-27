import { useEffect, useRef } from "react";

const drafts = new Map<symbol, boolean>();
let approvedHash: string | null = null;
export function confirmDraftNavigation() {
  return ![...drafts.values()].some(Boolean) || window.confirm("Discard your unsaved edits? Changes already added to the list or saved in Taxis will be kept.");
}
export function approveHash(hash: string) { approvedHash = hash; }
export function consumeApprovedHash(hash: string) {
  const approved = approvedHash === hash;
  approvedHash = null;
  return approved;
}
export function useDraftGuard(dirty: boolean) {
  const token = useRef(Symbol("draft"));
  useEffect(() => {
    drafts.set(token.current, dirty);
    const unload = (event: BeforeUnloadEvent) => { if (drafts.get(token.current)) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => { drafts.delete(token.current); window.removeEventListener("beforeunload", unload); };
  }, [dirty]);
  const release = () => { drafts.delete(token.current); };
  return {
    release,
    close: (callback: () => void) => {
      if (!drafts.get(token.current) || window.confirm("Discard your unsaved edits?")) { release(); callback(); }
    },
  };
}
