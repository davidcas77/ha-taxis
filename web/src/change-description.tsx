import { changeFields } from "../../shared/change-description.ts";
import type { Change, Hierarchy } from "../../shared/types.ts";

function valueText(value: unknown, key: string, h?: Hierarchy | null): string {
  if (value === null) return "None";
  if (value === undefined) return "Not set";
  if (Array.isArray(value)) return value.length ? value.map((v) => valueText(v, key, h)).join(", ") : "None";
  if (typeof value === "object")
    return (
      Object.entries(value)
        .map(([k, v]) => `${k.replaceAll("_", " ")}: ${valueText(v, k, h)}`)
        .join("; ") || "None"
    );
  if (typeof value !== "string") return String(value);
  const name =
    key === "labels"
      ? h?.labels[value]?.name
      : key === "area_id"
        ? h?.areas[value]?.name
        : key === "floor_id"
          ? h?.floors.find((f) => f.id === value)?.name
          : h?.entities[value]?.name;
  return name && name !== value ? `${name} (${value})` : value || "None";
}

export function ChangeDetails({ change, hierarchy }: { change: Change; hierarchy?: Hierarchy | null }) {
  const rows = changeFields(change);
  const id = change.targetId;
  const targetName =
    change.kind === "area"
      ? hierarchy?.areas[id]?.name
      : change.kind === "label"
        ? hierarchy?.labels[id]?.name
        : change.kind === "floor"
          ? hierarchy?.floors.find((floor) => floor.id === id)?.name
          : change.kind === "device"
            ? hierarchy?.devices[id]?.name
            : change.kind === "entity" || change.kind === "helper"
              ? (hierarchy?.entities[id]?.name ?? hierarchy?.entities[String(change.after.new_entity_id ?? "")]?.name)
              : undefined;
  const helperKind = change.after.helper;
  const isGroup = change.kind === "helper" && (helperKind === "group" || hierarchy?.entities[id]?.platform === "group");
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="break-words text-muted">
        {change.op === "create" && id.startsWith("new:")
          ? `Target: ${String(change.after.name ?? `New ${change.kind}`)}. Home Assistant assigns the ID when created.`
          : `Target: ${targetName && targetName !== id ? `${targetName} (${id})` : id}`}
      </p>
      {change.disclosures?.map((disclosure, index) => (
        <p key={`${index}:${disclosure}`} className="break-words text-warn">
          {disclosure}
        </p>
      ))}
      {change.kind === "area" && change.op === "update" && (Object.hasOwn(change.after, "floor_id") || Object.hasOwn(change.after, "labels")) && (
        <p className="text-warn">
          After applying, review affected floor and Space light and occupancy groups, scripts and recipes. Their installed members and settings are not updated
          by this area change.
        </p>
      )}
      {change.op === "delete" && <p>Delete the {change.kind} from Home Assistant when applied.</p>}
      {change.kind === "automation" && change.op !== "delete" && (
        <p>Once installed or updated, this Home Assistant automation may run when its triggers occur.</p>
      )}
      {change.kind === "script" && change.op !== "delete" && <p>This Home Assistant script runs when invoked; installing or updating it does not run it.</p>}
      {isGroup && <p>This Home Assistant group helper combines the listed member entities.</p>}
      {change.kind === "helper" && helperKind === "timer" && <p>This Home Assistant timer helper tracks a duration.</p>}
      {change.kind === "helper" && helperKind === "input_boolean" && <p>This Home Assistant toggle helper stores an on or off state.</p>}
      {change.kind === "helper" && helperKind === "min_max" && <p>This Home Assistant sensor helper combines the listed source sensors.</p>}
      {rows.length === 0 && change.op !== "delete" && <p>No field values are available for this planned change.</p>}
      <dl className="flex flex-col gap-2">
        {rows.map((row) => {
          const key = row.path.at(-1) ?? "";
          return (
            <div key={row.path.join(".")} className="break-words">
              <dt className="font-medium">{row.path.map((part) => part.replaceAll("_", " ")).join(" / ")}</dt>
              <dd>
                <span className="text-muted">Before: </span>
                {change.op === "create" ? "Not applicable (new)" : row.beforeKnown ? valueText(row.before, key, hierarchy) : "Previous value unavailable"}
                <br />
                <span className="text-muted">Planned: </span>
                {valueText(row.after, key, hierarchy)}
                {row.added && row.added.length > 0 && <div>Added: {row.added.map((v) => valueText(v, key, hierarchy)).join(", ")}</div>}
                {row.removed && row.removed.length > 0 && <div>Removed: {row.removed.map((v) => valueText(v, key, hierarchy)).join(", ")}</div>}
              </dd>
            </div>
          );
        })}
      </dl>
      {change.kind === "entity" && Object.hasOwn(change.after, "new_entity_id") && (
        <p>Taxis checks references to the old entity ID; some sites may need manual updates.</p>
      )}
    </div>
  );
}
