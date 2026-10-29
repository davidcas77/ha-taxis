import { Info } from "lucide-react";
import { useCallback } from "react";

import { diagnose, diagnoseDevice, diagnosisText, type Diagnosis } from "../../shared/entity-diagnosis.ts";
import type { DeviceItem, EntityItem } from "../../shared/types.ts";
import { useTaxis } from "./state.tsx";
import { TONE_TEXT, toneOfSeverity } from "./ui.tsx";

// Why an entity or a device does not work (shared/entity-diagnosis.ts), for the
// places that show it: a small (i) with the reason in a tooltip, and the reason as text.

export function useWhy(): { entity: (e: EntityItem) => Diagnosis | null; device: (d: DeviceItem) => Diagnosis | null } {
  const { hierarchy } = useTaxis();
  const entity = useCallback((e: EntityItem) => (hierarchy ? diagnose(e, { h: hierarchy, now: Date.now() }) : null), [hierarchy]);
  const device = useCallback((d: DeviceItem) => (hierarchy ? diagnoseDevice(d, { h: hierarchy, now: Date.now() }) : null), [hierarchy]);
  return { entity, device };
}

// The (i) next to a status: the reason, what is known about it and what can be done, on hover and to a screen reader.
export function WhyIcon({ why }: { why: Diagnosis | null }) {
  if (!why) return null;
  const text = diagnosisText(why);
  return (
    <span role="img" aria-label={`Why: ${text}`} title={text} className={`inline-flex shrink-0 ${TONE_TEXT[toneOfSeverity(why.severity)]}`}>
      <Info className="size-3.5" aria-hidden />
    </span>
  );
}
