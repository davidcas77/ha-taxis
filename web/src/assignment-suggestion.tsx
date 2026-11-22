import { Check } from "lucide-react";
import type { AreaPlacement, PlacementEvidence } from "../../shared/area-suggestion.ts";
import { Button } from "./ui.tsx";

export const placementEvidenceText = (evidence: readonly PlacementEvidence[]) => evidence.map(({ source, text }) => `${source} “${text}”`).join(" · ");

export function AssignmentSuggestion({
  suggestion,
  areaName,
  subject,
  disabled,
  reviewChanges,
  onChoose,
}: {
  suggestion: Extract<AreaPlacement, { kind: "suggestion" }>;
  areaName: string;
  subject: string;
  disabled: boolean;
  reviewChanges: boolean;
  onChoose: () => void;
}) {
  const evidence = placementEvidenceText(suggestion.evidence);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 text-xs">
      <div className="min-w-0 flex-1 text-muted" title={evidence}>
        <span className="block truncate">Suggested · {areaName}</span>
        <span className="block truncate">{suggestion.evidence.map(({ source }) => source).join(" + ")}</span>
      </div>
      <Button
        className="shrink-0"
        disabled={disabled}
        aria-label={`Use suggested area ${areaName} for ${subject}`}
        aria-description={evidence}
        title={reviewChanges ? "Add this area assignment to Changes" : "Preview this area assignment"}
        onClick={onChoose}
      >
        <Check className="size-3" aria-hidden />
      </Button>
    </div>
  );
}
