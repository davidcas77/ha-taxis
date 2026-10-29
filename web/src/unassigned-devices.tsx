import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { suggestEntityArea } from "../../shared/area-suggestion.ts";
import { sortRows } from "../../shared/sort.ts";
import { deviceAreaAssignments, unassignedDevices } from "../../shared/unassigned-devices.ts";
import type { DeviceItem, Hierarchy } from "../../shared/types.ts";
import { DataTable, useSortState, type Column } from "./data-table.tsx";
import { Pagination, usePagination } from "./records.tsx";
import { useTaxisData } from "./state.tsx";
import { AreaSelect, Button, SearchField, Toolbar } from "./ui.tsx";

export function UnassignedDevices({ h, showDisabled }: { h: Hierarchy; showDisabled: boolean }) {
  const { propose, busy } = useTaxisData();
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [area, setArea] = useState<string | null>(null);
  const devices = unassignedDevices(h, showDisabled);
  const matches = devices.filter((device) =>
    `${device.name} ${device.manufacturer ?? ""} ${device.model ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const { sort, toggle } = useSortState({ key: "name", dir: "asc" });
  const sorted = useMemo(
    () =>
      sortRows(
        matches,
        {
          name: (d: DeviceItem) => d.name,
          manufacturer: (d: DeviceItem) => d.manufacturer,
          model: (d: DeviceItem) => d.model,
          entities: (d: DeviceItem) => d.entityIds.length,
        }[sort.key as "name" | "manufacturer" | "model" | "entities"],
        sort.dir,
      ),
    [matches, sort],
  );
  const paging = usePagination(sorted.length, JSON.stringify([query, showDisabled, sort]));
  const shown = sorted.slice(paging.start, paging.end);
  const selected = shown.filter((device) => picked.has(device.id)).map((device) => device.id);
  const all = shown.length > 0 && selected.length === shown.length;
  const locked = busy || saving;
  const assign = async (ids: string[], areaId: string | null) => {
    if (!areaId || locked) return;
    const inputs = deviceAreaAssignments(h, ids, areaId);
    if (!inputs.length) return;
    setSaving(true);
    try {
      if (await propose(inputs)) setPicked(new Set());
    } finally {
      setSaving(false);
    }
  };
  const columns: Column<DeviceItem>[] = [
    {
      id: "pick",
      label: "Select",
      priority: 1,
      locked: true,
      sticky: true,
      width: 32,
      header: (
        <input
          type="checkbox"
          aria-label="Select all shown devices"
          checked={all}
          disabled={locked || !shown.length}
          ref={(node) => {
            if (node) node.indeterminate = selected.length > 0 && !all;
          }}
          onChange={() => setPicked(all ? new Set() : new Set(shown.map((device) => device.id)))}
        />
      ),
      cell: (device) => (
        <input
          type="checkbox"
          aria-label={`Select ${device.name}`}
          checked={picked.has(device.id)}
          disabled={locked}
          onChange={() =>
            setPicked((old) => {
              const next = new Set(old);
              if (!next.delete(device.id)) next.add(device.id);
              return next;
            })
          }
        />
      ),
    },
    {
      id: "name",
      header: "Device",
      priority: 1,
      sticky: true,
      minWidth: 170,
      maxWidth: 300,
      truncate: true,
      text: (device) => device.name,
      sort: (device) => device.name,
      cell: (device) => (
        <span>
          {device.name}
          {device.disabled && <span className="text-muted"> · Disabled</span>}
        </span>
      ),
    },
    {
      id: "area",
      header: "Area",
      priority: 1,
      locked: true,
      minWidth: 190,
      maxWidth: 260,
      cell: (device) => {
        const suggestion = suggestEntityArea(device.name, "", Object.values(h.areas));
        return (
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="w-28 min-w-0 max-w-[50%] shrink-0">
              <label className="sr-only" htmlFor={`unassigned-device-area-${device.id}`}>
                Area for device {device.name}
              </label>
              <AreaSelect
                h={h}
                id={`unassigned-device-area-${device.id}`}
                value={device.areaId}
                onChange={(value) => void assign([device.id], value)}
                noneLabel="Choose an area…"
                disabled={locked}
              />
            </div>
            {suggestion && (
              <div className="flex min-w-0 flex-1 items-center gap-1 text-xs">
                <span className="min-w-0 truncate text-muted" title={h.areas[suggestion.areaId].name}>
                  {h.areas[suggestion.areaId].name}
                </span>
                <Button
                  className="shrink-0"
                  disabled={locked}
                  aria-label={`Use suggested area ${h.areas[suggestion.areaId].name} for device ${device.name}`}
                  title="Add this device area assignment to Changes"
                  onClick={() => void assign([device.id], suggestion.areaId)}
                >
                  <Check className="size-3" aria-hidden />
                </Button>
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: "manufacturer",
      header: "Manufacturer",
      priority: 2,
      minWidth: 130,
      maxWidth: 200,
      truncate: true,
      text: (device) => device.manufacturer ?? "",
      sort: (device) => device.manufacturer,
      cell: (device) => device.manufacturer ?? "—",
    },
    {
      id: "model",
      header: "Model",
      priority: 2,
      minWidth: 130,
      maxWidth: 200,
      truncate: true,
      text: (device) => device.model ?? "",
      sort: (device) => device.model,
      cell: (device) => device.model ?? "—",
    },
    { id: "entities", header: "Entities", priority: 2, minWidth: 85, sort: (device) => device.entityIds.length, cell: (device) => device.entityIds.length },
  ];
  return (
    <section aria-label="Unassigned devices" className="flex min-w-0 flex-col gap-3">
      <Toolbar label="Unassigned devices toolbar">
        <SearchField
          label="Find unassigned devices"
          placeholder="Find device, manufacturer or model"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPicked(new Set());
          }}
        />
        <span className="text-xs text-muted">{matches.length} matching devices</span>
      </Toolbar>
      <div
        role="region"
        aria-label="Assign selected devices"
        className="flex min-w-0 max-w-full flex-nowrap items-center gap-3 overflow-x-auto rounded-lg border border-accent/40 bg-surface p-2"
      >
        <span className="shrink-0 whitespace-nowrap text-[13px] font-medium">{selected.length} devices selected</span>
        <label
          className="shrink-0 whitespace-nowrap text-xs text-muted"
          htmlFor="bulk-device-area"
          title="Only selected devices on this page are assigned. Entities with their own area keep it; other entities inherit the device area."
        >
          Assign area
        </label>
        <div className="w-48 shrink-0">
          <AreaSelect h={h} id="bulk-device-area" value={area} onChange={setArea} disabled={locked || !selected.length} noneLabel="Choose an area…" />
        </div>
        <Button disabled={locked || !selected.length || !area} onClick={() => void assign(selected, area)}>
          Move devices
        </Button>
        {!!selected.length && (
          <Button className="shrink-0 whitespace-nowrap" disabled={locked} tone="ghost" onClick={() => setPicked(new Set())}>
            Clear selection
          </Button>
        )}
      </div>
      <DataTable
        id="unassigned-devices"
        label="Unassigned devices table"
        rows={shown}
        rowKey={(device) => device.id}
        columns={columns}
        sort={sort}
        onSort={toggle}
        empty="No devices without an area match your search and visibility filters."
      />
      <Pagination {...paging} />
    </section>
  );
}
