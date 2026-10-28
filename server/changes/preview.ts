import type { Change, Hierarchy } from "../../shared/types.ts";
import type { Read } from "../ha/reader.ts";
import { buildHierarchy } from "../model/hierarchy.ts";
import { overlayChanges } from "./overlay.ts";

// What the UI shows: the change list laid over the live read. With nothing
// pending it is the live hierarchy itself.
export function previewHierarchy(read: Read, pending: Change[]): Hierarchy {
  return pending.length ? buildHierarchy(overlayChanges(read.raw, pending), read.live.fetchedAt) : read.live;
}
