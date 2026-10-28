import { useEffect, useMemo, useState } from "react";
import type { ChangeInput, EntityItem, Hierarchy } from "../../shared/types.ts";
import { NewForm } from "./new-form.tsx";
import { AreaMultiSelect, Pagination, ResizeHandle, usePagination, useWidths } from "./records.tsx";
import { useTaxis } from "./state.tsx";
import { SortHeader, useSort } from "./table.tsx";
import { Button, ConfirmAction, LabelChip, inputClass } from "./ui.tsx";

// A single table for area and global label assignment. Labels always shows the
// entity's complete label list; choosing an action never changes the inventory.
export function EntityLabels({
  h,
  fixedArea,
  initialLabelId,
  title = "Entities and labels",
}: {
  h: Hierarchy;
  fixedArea?: string;
  initialLabelId?: string;
  title?: string;
}) {
  const { propose, busy } = useTaxis();
  const [query, setQuery] = useState("");
  const [areas, setAreas] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [labelId, setLabelId] = useState(initialLabelId ?? "");
  const [creating, setCreating] = useState(false);
  const [createdName, setCreatedName] = useState<string | null>(null);
  const labels = Object.values(h.labels).sort((a, b) => a.name.localeCompare(b.name));
  useEffect(() => {
    if (!createdName) return;
    const label = Object.values(h.labels).find((label) => label.name === createdName);
    if (label) {
      setLabelId(label.id);
      setCreatedName(null);
    }
  }, [h.labels, createdName]);
  const deviceName = (e: EntityItem) => (e.deviceId ? (h.devices[e.deviceId]?.name ?? e.deviceId) : "");
  const labelNames = (e: EntityItem) => [...new Set(e.labels)].map((id) => h.labels[id]?.name ?? id).join(", ");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(h.entities).filter(
      (e) =>
        (!fixedArea || e.areaId === fixedArea) &&
        (!areas.size || areas.has(e.areaId ?? "")) &&
        (!q || `${e.name} ${e.entityId} ${deviceName(e)} ${labelNames(e)}`.toLowerCase().includes(q)),
    );
  }, [h, fixedArea, areas, query]);
  const {
    rows,
    sort,
    toggle: sortBy,
  } = useSort(
    filtered,
    {
      name: (e) => e.name,
      entityId: (e) => e.entityId,
      device: deviceName,
      area: (e) => (e.areaId ? (h.areas[e.areaId]?.name ?? e.areaId) : ""),
      labels: labelNames,
    },
    { key: "name", dir: "asc" },
  );
  const paging = usePagination(rows.length, JSON.stringify([fixedArea, query, [...areas], sort]));
  const shown = rows.slice(paging.start, paging.end);
  const eligible = shown.filter((e) => e.inRegistry);
  const selected = eligible.filter((e) => picked.has(e.entityId));
  const all = eligible.length > 0 && selected.length === eligible.length;
  const adding = selected.filter((e) => !e.labels.includes(labelId));
  const removing = selected.filter((e) => e.labels.includes(labelId));
  const choose = (id: string) =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const assign = async (remove = false) => {
    if (!h.labels[labelId]) return;
    const changes: ChangeInput[] = (remove ? removing : adding).map((e) => ({
      kind: "entity",
      op: "update",
      targetId: e.entityId,
      fields: { labels: remove ? [...new Set(e.labels)].filter((id) => id !== labelId) : [...new Set([...e.labels, labelId])] },
    }));
    if (changes.length) await propose(changes);
  };
  const { widths, setWidth, savedWidth } = useWidths("taxis:entity-labels:columns", { name: 230, entityId: 270, device: 200, area: 140, labels: 260 });
  const columns = [
    { key: "name", label: "Name" },
    { key: "entityId", label: "Entity ID" },
    { key: "device", label: "Device" },
    { key: "area", label: "Area" },
    { key: "labels", label: "Labels" },
  ];
  return (
    <section aria-label="Entity label assignment" className="flex min-w-0 flex-col gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Search label entities"
          className={`${inputClass} max-w-md`}
          placeholder="Search name, entity ID, device or label"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPicked(new Set());
          }}
        />
        {!fixedArea && (
          <AreaMultiSelect
            areas={Object.values(h.areas)}
            selected={areas}
            onChange={(next) => {
              setAreas(next);
              setPicked(new Set());
            }}
          />
        )}
        {(query || areas.size > 0) && (
          <Button
            tone="ghost"
            onClick={() => {
              setQuery("");
              setAreas(new Set());
              setPicked(new Set());
            }}
          >
            Reset filters
          </Button>
        )}
        <span className="text-xs text-muted">
          {rows.length} matching entities · {selected.length} selected on this page
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            aria-label="Select all shown label entities"
            checked={all}
            disabled={!eligible.length || busy}
            onChange={() => setPicked(all ? new Set() : new Set(eligible.map((e) => e.entityId)))}
          />
          Select all shown ({eligible.length})
        </label>
        <select
          aria-label="Label to add"
          className={`${inputClass} w-48!`}
          value={h.labels[labelId] ? labelId : ""}
          onChange={(event) => setLabelId(event.target.value)}
        >
          <option value="">Choose a label…</option>
          {labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
        <Button disabled={busy || !h.labels[labelId] || !adding.length} onClick={() => void assign()}>
          Add label
        </Button>
        {h.labels[labelId] && removing.length > 0 && (
          <ConfirmAction
            tone="plain"
            disabled={busy}
            question={`Remove “${h.labels[labelId].name}” from ${removing.length} selected entities?`}
            onConfirm={() => void assign(true)}
          >
            Remove label
          </ConfirmAction>
        )}
        <Button tone="ghost" disabled={busy} onClick={() => setCreating((value) => !value)} aria-expanded={creating}>
          + Add new label
        </Button>
        {selected.length > 0 && (
          <Button tone="ghost" onClick={() => setPicked(new Set())}>
            Clear selection
          </Button>
        )}
      </div>
      {creating && (
        <div className="rounded border border-line p-3">
          <NewForm
            kind="label"
            existingNames={labels.map((label) => label.name)}
            onCreated={(name) => {
              setCreatedName(name);
              setCreating(false);
            }}
          />
        </div>
      )}
      <p className="text-xs text-muted">
        Labels shows every label on each entity, including queued changes. Add label keeps existing labels. Only selected registry entities on the current page
        and under the current filters are changed; other entities remain visible and read-only.
      </p>
      {!rows.length ? (
        <p role="status" className="p-3 text-sm text-muted">
          No entities match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table
            aria-label="Entities and labels"
            className="records-table table-fixed text-[13px]"
            style={{ width: 44 + Object.values(widths).reduce((sum, width) => sum + width, 0), minWidth: "100%" }}
          >
            <colgroup>
              <col style={{ width: 44 }} />
              {columns.map((column) => (
                <col key={column.key} style={{ width: widths[column.key] }} />
              ))}
            </colgroup>
            <thead className="bg-sunken text-left text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Select</span>
                </th>
                {columns.map((column) => (
                  <SortHeader
                    key={column.key}
                    label={column.label}
                    k={column.key}
                    sort={sort}
                    onToggle={sortBy}
                    resize={
                      <ResizeHandle
                        label={`Resize label entities ${column.label} column`}
                        value={widths[column.key]}
                        savedWidth={savedWidth(column.key)}
                        onChange={(width) => setWidth(column.key, width)}
                      />
                    }
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.entityId} className="border-t border-line hover:bg-sunken">
                  <td className="px-3 py-2">
                    {e.inRegistry ? (
                      <input
                        type="checkbox"
                        disabled={busy}
                        aria-label={`Select ${e.name}`}
                        checked={picked.has(e.entityId)}
                        onChange={() => choose(e.entityId)}
                      />
                    ) : (
                      <span title="Not in the entity registry">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {e.name}
                    {(!e.inRegistry || e.disabled || e.hidden || e.maintenance) && (
                      <span className="block text-xs text-muted">
                        {[!e.inRegistry && "Read-only · not in registry", e.disabled && "Disabled", e.hidden && "Hidden", e.maintenance && "Diagnostic"]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{e.entityId}</td>
                  <td className="px-3 py-2">{deviceName(e) || "No device"}</td>
                  <td className="px-3 py-2">{e.areaId ? (h.areas[e.areaId]?.name ?? e.areaId) : "No area"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {e.labels.length ? (
                        [...new Set(e.labels)].map((id) =>
                          h.labels[id] ? (
                            <LabelChip key={id} label={h.labels[id]} />
                          ) : (
                            <span key={id} className="break-all text-xs text-muted">
                              {id}
                            </span>
                          ),
                        )
                      ) : (
                        <span className="text-muted">No labels</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination {...paging} />
    </section>
  );
}
