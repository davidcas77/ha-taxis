import type { ComponentProps } from "react";
import { useTaxisData } from "./state.tsx";
import { Actions as BaseActions } from "./ui.tsx";

export function Actions(props: ComponentProps<typeof BaseActions>) {
  const { reviewChanges } = useTaxisData();
  return <BaseActions {...props} saveLabel={reviewChanges ? "Add to changes" : "Save to Home Assistant"} />;
}
