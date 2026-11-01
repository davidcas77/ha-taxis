import { useState, type ReactNode } from "react";
import { setTvOccupancyNotApplicable, tvOccupancyNotApplicable } from "../../shared/inventory.ts";
import { useTaxis } from "./state.tsx";

export function TvOccupancyApplicability({ areaId, children }: { areaId: string; children: ReactNode }) {
  const { inventory, inventoryLoaded, inventorySaving, saveInventory } = useTaxis();
  const [error, setError] = useState<string | null>(null);
  const notApplicable = tvOccupancyNotApplicable(inventory, areaId);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h5 className="text-xs font-semibold">TVs</h5>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={notApplicable}
            disabled={!inventoryLoaded || inventorySaving}
            onChange={(event) => {
              const checked = event.target.checked;
              setError(null);
              void saveInventory((current) => setTvOccupancyNotApplicable(current, areaId, checked)).then(setError);
            }}
          />
          Non applicable
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          Could not save preference: {error}
        </p>
      )}
      {!notApplicable && children}
    </div>
  );
}
