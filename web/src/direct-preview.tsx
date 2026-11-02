import { useState } from "react";
import type { Change, Hierarchy } from "../../shared/types.ts";
import { ChangeDetails } from "./change-description.tsx";
import { Button } from "./ui.tsx";

export function DirectPreviewDialog({
  changes,
  hierarchy,
  requiresNoBackup,
  localOnly = false,
  notes = [],
  onConfirm,
  onCancel,
}: {
  changes: Change[];
  hierarchy: Hierarchy | null;
  requiresNoBackup: boolean;
  localOnly?: boolean;
  notes?: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="direct-preview-title"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-xl"
      >
        <h2 id="direct-preview-title" className="text-base font-semibold">
          Review before applying
        </h2>
        <p className="text-xs text-muted">
          {localOnly ? "Confirm this Taxis selection. Nothing has been saved yet." : "Confirm these changes to Home Assistant. Nothing has been applied yet."}
        </p>
        <div className="overflow-auto rounded border border-line p-3 text-sm">
          {notes.map((note) => (
            <p key={note} className="mb-2 break-words text-xs text-muted">
              {note}
            </p>
          ))}
          {changes.length === 0 ? (
            <p>No Home Assistant objects will be changed.</p>
          ) : (
            changes.map((change, index) => (
              <article key={`${change.kind}:${change.targetId}:${index}`} className="border-b border-line py-2 last:border-0">
                <h3 className="font-semibold">
                  {change.op === "create" ? "Create" : change.op === "delete" ? "Delete" : "Update"} {change.kind}{" "}
                  {change.op === "create" && change.targetId.startsWith("new:") ? (
                    <span>{String(change.after.name ?? `New ${change.kind}`)} — Home Assistant assigns the ID when created</span>
                  ) : (
                    <code className="break-all">{change.targetId}</code>
                  )}
                </h3>
                <ChangeDetails change={change} hierarchy={hierarchy} />
              </article>
            ))
          )}
        </div>
        {requiresNoBackup && (
          <label className="flex gap-2 text-sm">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            Taxis cannot make a Home Assistant backup here. Apply without a backup.
          </label>
        )}
        <div className="flex gap-2">
          <Button tone="primary" disabled={requiresNoBackup && !acknowledged} onClick={onConfirm}>
            {localOnly ? "Save in Taxis" : "Confirm and apply"}
          </Button>
          <Button tone="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </section>
    </div>
  );
}
