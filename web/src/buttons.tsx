import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buttonTargetDomains, defaultButtonService, domainAllowsService, offeredButtonServices } from "../../shared/button-actions.ts";
import { buttonMatrix, type MatrixCell } from "../../shared/button-matrix.ts";
import {
  buttonOutput,
  validButtonAction,
  validButtonMap,
  type ButtonAction,
  type ButtonControl,
  type ButtonGesture,
  type ButtonInventory,
  type ButtonAiPreview,
  type ButtonMapping,
} from "../../shared/buttons.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { api } from "./api.ts";
import { DataTable, type Column } from "./data-table.tsx";
import { useTaxis, type Route } from "./state.tsx";
import { confirmDraftNavigation, useDraftGuard } from "./draft-guard.ts";
import { Badge, Button, Card, Chip, EmptyState, inputClass, Toolbar } from "./ui.tsx";

// What a Taxis assignment is, as the pages below hold it.
type Binding = ButtonMapping & { queued: boolean; output: string; automationId: string; blocked: string | null };
type Editing = { key: string; action: ButtonAction | null; enabled: boolean };

const haAutomation = (id: string) => `/config/automation/edit/${encodeURIComponent(id)}`;

// The Buttons tab of the Automations page: the controls on the left, and for the
// one picked, its buttons by press types. Content only; the page supplies the header.
export function ButtonsPanel({ h, controlId, go }: { h: Hierarchy; controlId: string | null; go: (r: Route) => void }) {
  const { changes, reload, notify } = useTaxis();
  const [data, setData] = useState<{ inventory: ButtonInventory; fingerprint: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const [mode, setMode] = useState<"controls" | "targets">("controls");
  const [output, setOutput] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    let stale = false;
    setLoading(true);
    void api.buttons(refresh > 0).then((r) => {
      if (stale) return;
      if (r.ok) {
        setData({ inventory: r.inventory, fingerprint: r.fingerprint });
        setError(null);
      } else setError(r.error);
      setLoading(false);
    });
    return () => {
      stale = true;
    };
  }, [refresh]);
  const maps = new Map((data?.inventory.managed ?? []).map((m) => [m.id, { map: m.map, queued: false, blocked: m.blocked }]));
  for (const c of changes)
    if (c.kind === "automation" && validButtonMap(c.after.button_map)) maps.set(c.targetId, { map: c.after.button_map, queued: true, blocked: [] });
  const bindings: Binding[] = [...maps.entries()].flatMap(([automationId, m]) =>
    m.map.bindings.map((b) => ({
      ...b,
      queued: m.queued,
      output: m.map.output,
      automationId,
      blocked: m.blocked.find((x) => x.key === b.key)?.reason ?? null,
    })),
  );
  const source = data?.inventory.controls.find((c) => c.id === controlId) ?? null;
  const potentials = (c: ButtonControl) =>
    c.gestures.length > 0 ||
    /button|remote|keypad|keyfob|doorbell/i.test(`${c.name} ${c.model ?? ""}`) ||
    (!!c.deviceId && Object.values(h.entities).some((e) => e.domain === "remote" && e.deviceId === c.deviceId));
  const list = (data?.inventory.controls ?? []).filter(
    (c) =>
      (all || potentials(c)) &&
      `${c.name} ${c.model} ${c.integrations.join(" ")} ${h.areas[c.areaId ?? ""]?.name ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const added = async () => {
    await reload(false);
    notify({ tone: "ok", text: "Button mapping added to changes. Review Changes, then Apply to enable it in Home Assistant." });
  };
  const selectControl = (id: string | null) => go({ page: "automations", tab: "buttons", controlId: id });
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Toolbar label="Buttons actions">
        <p className="min-w-[16rem] flex-1 text-[13px] text-muted">
          Every remote, wall control and HA button input. One automation per light, group or other output combines its assigned buttons; each press type can run
          its own action. Nothing changes in HA until Apply.
        </p>
        <Button disabled={loading || submitting} onClick={() => setRefresh((v) => v + 1)}>
          {loading ? "Reading buttons…" : "Refresh buttons and automations"}
        </Button>
        <Button onClick={() => go({ page: "changes" })}>Review changes</Button>
      </Toolbar>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start">
        <aside
          aria-label="Button controls"
          className="max-h-[35vh] shrink-0 overflow-auto rounded-lg border border-line bg-surface p-3 md:max-h-[75vh] md:w-72"
        >
          <div className="mb-3 flex gap-1">
            <Chip
              pressed={mode === "controls"}
              onClick={() => {
                if (!submitting && confirmDraftNavigation()) setMode("controls");
              }}
            >
              By control
            </Chip>
            <Chip
              pressed={mode === "targets"}
              onClick={() => {
                if (!submitting && confirmDraftNavigation()) setMode("targets");
              }}
            >
              By output
            </Chip>
          </div>
          {mode === "controls" ? (
            <>
              <input
                aria-label="Find button control"
                placeholder="Find control, area or integration"
                className={inputClass}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <label className="my-3 flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
                Show devices without button metadata
              </label>
              {list.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  disabled={submitting}
                  onClick={() => selectControl(c.id)}
                  className={`mb-1 block w-full rounded-lg p-2 text-left text-sm ${source?.id === c.id ? "bg-accent-soft text-accent" : "hover:bg-sunken"}`}
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {h.areas[c.areaId ?? ""]?.name ?? "No area"} · {c.integrations.join(", ") || "Integration unknown"} · {c.gestures.length} gestures
                  </span>
                </button>
              ))}
              {!loading && !list.length && (
                <p className="text-sm text-muted">
                  No discovered button inputs match. Show all devices to inspect controls whose integration exposes no metadata.
                </p>
              )}
            </>
          ) : (
            <>
              {[...maps.values()].map((m) => (
                <button
                  key={m.map.output}
                  type="button"
                  onClick={() => setOutput(m.map.output)}
                  className={`mb-1 block w-full rounded-lg p-2 text-left text-sm ${output === m.map.output ? "bg-accent-soft text-accent" : "hover:bg-sunken"}`}
                >
                  <span className="font-medium">{h.entities[m.map.output]?.name ?? m.map.output}</span>
                  <span className="block text-xs text-muted">
                    {m.map.bindings.length} assignments · {m.queued ? "In changes" : "Installed map"}
                  </span>
                </button>
              ))}
              {!maps.size && (
                <p className="text-sm text-muted">No Taxis button maps yet. Assign a control first. Existing external handlers appear under each control.</p>
              )}
            </>
          )}
        </aside>
        <div className="min-w-0 flex-1">
          {mode === "targets" ? (
            <OutputView
              h={h}
              output={output}
              bindings={bindings}
              controls={data?.inventory.controls ?? []}
              coverage={data}
              onOpen={(id) => {
                setMode("controls");
                selectControl(id);
              }}
            />
          ) : source && data ? (
            <ControlView
              key={source.id}
              h={h}
              control={source}
              data={data}
              bindings={bindings.filter((b) => b.controlId === source.id)}
              editing={editing}
              busy={submitting}
              onEdit={(gesture, action, enabled) => {
                if (!submitting && confirmDraftNavigation()) setEditing({ key: source.id + gesture.key, action, enabled });
              }}
              onClose={() => setEditing(null)}
              onBusy={setSubmitting}
              onAdded={added}
            />
          ) : (
            <EmptyState>
              {loading ? "Reading supported gestures and existing automations…" : "Select a control to inspect its buttons and press types."}
            </EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}

// Until the Automations page carries it, Buttons is a page of its own.
// One line, collapsed, about what discovery could and could not read.
function Coverage({ data, summary }: { data: { inventory: ButtonInventory }; summary?: string }) {
  const { coverage, notes } = data.inventory;
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer">
        {summary ? `${summary} · ` : ""}Discovery coverage: {coverage.readable} of {coverage.automations} automation configs readable
      </summary>
      <ul className="mt-2 list-disc pl-4">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </details>
  );
}

// The buttons of one output, from every control that drives it.
function OutputView({
  h,
  output,
  bindings,
  controls,
  coverage,
  onOpen,
}: {
  h: Hierarchy;
  output: string | null;
  bindings: Binding[];
  controls: ButtonControl[];
  coverage: { inventory: ButtonInventory } | null;
  onOpen: (controlId: string) => void;
}) {
  const rows = bindings.filter((b) => b.output === output);
  const columns: Column<Binding>[] = [
    {
      id: "control",
      header: "Control",
      priority: 1,
      sticky: true,
      minWidth: 130,
      sort: (b) => controls.find((c) => c.id === b.controlId)?.name ?? b.controlId,
      cell: (b) => (
        <button type="button" className="text-left text-accent hover:underline" onClick={() => onOpen(b.controlId)}>
          {controls.find((c) => c.id === b.controlId)?.name ?? b.controlId}
        </button>
      ),
    },
    { id: "button", header: "Button", priority: 2, minWidth: 90, sort: (b) => b.button, cell: (b) => b.button },
    { id: "gesture", header: "Press type", priority: 2, minWidth: 100, sort: (b) => b.gesture, cell: (b) => b.gesture },
    {
      id: "action",
      header: "Action",
      priority: 2,
      minWidth: 140,
      truncate: true,
      maxWidth: 280,
      sort: (b) => b.action.service,
      text: (b) => b.action.service,
      cell: (b) => b.action.service,
    },
    {
      id: "status",
      header: "Status",
      priority: 1,
      minWidth: 120,
      sort: (b) => (b.blocked ? "Blocked" : b.queued ? "In changes" : b.enabled ? "Enabled" : "Disabled"),
      cell: (b) => (b.blocked ? "Blocked by Taxis's safety rules" : b.queued ? "In changes" : b.enabled ? "Enabled" : "Disabled"),
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      {coverage && <Coverage data={coverage} />}
      <h2 className="text-lg font-semibold">{output ? (h.entities[output]?.name ?? output) : "Select an output"}</h2>
      {output && (
        <DataTable
          id="buttons-output"
          label="Buttons controlling output"
          rows={rows}
          rowKey={(b) => b.key}
          columns={columns}
          defaultSort={{ key: "control", dir: "asc" }}
          maxHeight="none"
          empty={<EmptyState>No buttons control this output yet.</EmptyState>}
        />
      )}
    </div>
  );
}

// A control: what it is, then its buttons by press types, one cell each.
function ControlView({
  h,
  control,
  data,
  bindings,
  editing,
  busy,
  onEdit,
  onClose,
  onBusy,
  onAdded,
}: {
  h: Hierarchy;
  control: ButtonControl;
  data: { inventory: ButtonInventory; fingerprint: string };
  bindings: Binding[];
  editing: Editing | null;
  busy: boolean;
  onEdit: (gesture: ButtonGesture, action: ButtonAction | null, enabled: boolean) => void;
  onClose: () => void;
  onBusy: (value: boolean) => void;
  onAdded: () => Promise<void>;
}) {
  const matrix = buttonMatrix(control.gestures, bindings, control.existing);
  // The form opens below the table; bring it into view.
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editing) editor.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [editing]);
  type Row = (typeof matrix.rows)[number];
  const editingGesture = control.gestures.find((g) => control.id + g.key === editing?.key) ?? null;
  const blocked = bindings.filter((b) => b.blocked);
  const columns: Column<Row>[] = [
    {
      id: "button",
      header: "Button",
      priority: 1,
      sticky: true,
      minWidth: 110,
      sort: (r) => r.button,
      text: (r) => r.button,
      cell: (r) => <span className="font-medium">{r.button}</span>,
    },
    ...matrix.columns.map<Column<Row>>((press, i) => ({
      id: `press:${press}`,
      header: press,
      label: press,
      priority: i < 3 ? 2 : 3,
      minWidth: 180,
      cell: (r) => {
        const cell = r.cells[press];
        return cell ? (
          <GestureCell button={r.button} cell={cell} busy={busy} onEdit={(action, enabled) => onEdit(cell.gesture, action, enabled)} />
        ) : (
          <span className="text-muted/60" title="This button has no such press type">
            –
          </span>
        );
      },
    })),
  ];
  return (
    <div className="flex flex-col gap-3">
      <Coverage
        data={data}
        summary={`${control.gestures.length} press type${control.gestures.length === 1 ? "" : "s"}: ${matrix.counts.assigned} with a handler, ${matrix.counts.empty} free`}
      />
      <div>
        <h2 className="text-lg font-semibold">{control.name}</h2>
        <p className="mt-1 text-sm text-muted">{[control.manufacturer, control.model, ...control.integrations].filter(Boolean).join(" · ")}</p>
      </div>
      {control.notes.map((n) => (
        <p key={n} className="text-xs text-warn">
          {n}
        </p>
      ))}
      {!control.gestures.length && (
        <p className="text-sm text-muted">
          HA did not expose button gestures for this device. Its button count and click combinations will not be guessed. Check its integration's
          event/device-trigger support, then refresh.
        </p>
      )}
      {!!control.related?.length && (
        <div className="text-sm">
          <p className="text-muted">Other automations that may use this device (they reference it but not a specific gesture):</p>
          {control.related.map((a) => (
            <p key={a.id} className="mt-2">
              <a className="text-accent" href={haAutomation(a.id)} target="_blank" rel="noreferrer">
                {a.name}
              </a>{" "}
              · {a.enabled ? "On" : a.enabled === false ? "Off" : "State unknown"} · {a.services.join(", ")} · {a.targets.join(", ")}
            </p>
          ))}
        </div>
      )}
      <ButtonAiReview key={control.id + data.fingerprint} control={control} />
      {matrix.rows.length > 0 && (
        <>
          <DataTable id="buttons-control" label={`Buttons of ${control.name}`} rows={matrix.rows} rowKey={(r) => r.button} columns={columns} maxHeight="none" />
          <p className="text-xs text-muted">
            An existing handler is not changed by assigning a new Taxis action. Its conditions, choose branches and blueprint inputs can change what a press
            does, so open it in HA before relying on it. A faint + means no readable automation matched that press type; see the discovery coverage line for
            gaps.
          </p>
        </>
      )}
      {blocked.map((b) => (
        <Card key={b.key} tone="danger">
          <p className="text-xs font-medium text-danger">
            {b.button} · {b.gesture}: Blocked by Taxis's safety rules
          </p>
          <p className="mt-1 text-xs text-muted">
            {b.blocked} This automation is still active in Home Assistant, and Taxis won't write it again as it is.{" "}
            <a className="text-accent" href={haAutomation(b.automationId)} target="_blank" rel="noreferrer">
              Open it in HA
            </a>{" "}
            to change or remove it, or assign this button a new action here to replace it.
          </p>
        </Card>
      ))}
      <div ref={editor} />
      {editing && editingGesture && (
        <AssignmentEditor
          key={`${editingGesture.key}:${JSON.stringify(editing.action)}:${editing.enabled}`}
          h={h}
          control={control}
          gesture={editingGesture}
          inventory={data.inventory}
          fingerprint={data.fingerprint}
          initial={editing.action}
          initiallyEnabled={editing.enabled}
          onBusy={onBusy}
          onCancel={onClose}
          onQueued={async () => {
            await onAdded();
            onClose();
          }}
        />
      )}
    </div>
  );
}

// One button, one press type: what is assigned, what already handles it, and a
// "+" to assign. Nothing assigned is a faint "+" alone.
function GestureCell({
  button,
  cell,
  busy,
  onEdit,
}: {
  button: string;
  cell: MatrixCell<Binding>;
  busy: boolean;
  onEdit: (action: ButtonAction | null, enabled: boolean) => void;
}) {
  const { gesture, bindings, external } = cell;
  const label = `${button} · ${gesture.gesture}`;
  const empty = bindings.length === 0 && external.length === 0;
  return (
    <div role="group" aria-label={`${gesture.gesture} · ${gesture.source}`} className="flex flex-col gap-1">
      {bindings.map((b) => (
        <div key={`${b.key}:${buttonOutput(b.action)}`} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <code className="break-all text-xs" title={`${b.action.service} → ${b.action.entityId ?? "Service action"}`}>
            {b.action.service} → {b.action.entityId ?? "Service action"}
          </code>
          {b.blocked ? (
            <Badge tone="error">Blocked</Badge>
          ) : (
            <>
              <Badge tone={b.queued ? "info" : b.enabled ? "ok" : "muted"}>{b.queued ? "In changes" : b.enabled ? "Enabled" : "Disabled"}</Badge>
              <Button
                tone="ghost"
                className="px-1.5 py-0.5 text-xs"
                disabled={busy}
                aria-label={`Edit assignment of ${label}`}
                onClick={() => onEdit(b.action, b.enabled)}
              >
                Edit assignment
              </Button>
            </>
          )}
        </div>
      ))}
      {external.map((a) => (
        <div
          key={a.id}
          className="text-xs"
          title={`${a.services.join(", ") || "No service summary"} · ${a.targets.join(", ") || "No explicit target summary"}`}
        >
          <a className="text-accent hover:underline" href={haAutomation(a.id)} target="_blank" rel="noreferrer">
            {a.name}
          </a>{" "}
          <span className="text-muted">
            {a.enabled === true ? "On" : a.enabled === false ? "Off" : "State unknown"} · {a.match === "exact" ? "Trigger match" : "Possible match"}
          </span>
        </div>
      ))}
      <button
        type="button"
        disabled={busy}
        aria-label={`Assign action to ${label}`}
        title={empty ? "Nothing matched this press type. Assign an action." : "Assign another action"}
        onClick={() => onEdit(null, true)}
        className={`inline-flex w-fit items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-sunken hover:text-accent disabled:opacity-50 ${empty ? "text-muted/60" : "text-muted"}`}
      >
        <Plus className="size-3.5" aria-hidden />
        {!empty && "Add"}
      </button>
    </div>
  );
}

// What an action is called in the list. Only allowed services reach it.
function actionLabel(s: string, hasTarget: boolean): string {
  if (s === "persistent_notification.create") return "Show a notification in HA";
  if (!hasTarget && s.startsWith("script.")) return `Run script ${s.slice(7)}`;
  if (s === "script.turn_on") return "Run script";
  if (s === "script.turn_off") return "Stop script";
  if (s === "automation.turn_on") return "Enable automation";
  if (s === "automation.turn_off") return "Disable automation";
  if (s === "automation.toggle") return "Toggle automation enabled";
  if (s === "scene.turn_on") return "Activate scene";
  if (s.endsWith(".turn_on")) return "On";
  if (s.endsWith(".turn_off")) return "Off";
  if (s.endsWith(".toggle")) return "Toggle";
  if (s.endsWith(".trigger")) return "Run automation actions";
  if (s.endsWith(".press")) return "Press";
  return s;
}

function AssignmentEditor({
  h,
  control,
  gesture,
  inventory,
  fingerprint,
  initial,
  initiallyEnabled,
  onCancel,
  onQueued,
  onBusy,
}: {
  h: Hierarchy;
  control: ButtonControl;
  gesture: ButtonGesture;
  inventory: ButtonInventory;
  fingerprint: string;
  initial: ButtonAction | null;
  initiallyEnabled: boolean;
  onCancel: () => void;
  onQueued: () => Promise<void>;
  onBusy: (value: boolean) => void;
}) {
  const { version } = useTaxis();
  const [reviewedFingerprint] = useState(fingerprint);
  const [reviewedChangesVersion] = useState(version);
  const [entity, setEntity] = useState(initial?.entityId ?? "");
  const [service, setService] = useState(initial?.service ?? "");
  const [json, setJson] = useState(initial ? JSON.stringify(initial.data, null, 2) : "{}");
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [coexist, setCoexist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useDraftGuard(dirty || busy);
  // Only what Taxis's safety rules allow, by the same check the server makes.
  const entityIds = new Set(
    Object.values(h.entities)
      .filter((e) => !e.disabled)
      .map((e) => e.entityId),
  );
  const allowed = offeredButtonServices(inventory.services, entity || null, entityIds);
  const targetDomains = new Set(buttonTargetDomains().filter((d) => inventory.services.some((s) => domainAllowsService(d, s))));
  const act = (change: () => void) => {
    change();
    setDirty(true);
  };
  return (
    <form
      aria-label={`Assign ${gesture.gesture}`}
      className="mt-3 grid gap-3 rounded-lg border border-accent/30 bg-surface p-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        let action: ButtonAction;
        try {
          action = { entityId: entity || null, service, data: JSON.parse(json) };
          if (!validButtonAction(action)) throw new Error();
        } catch {
          setError("Choose a service and valid JSON data. Entity/device/area targets belong in the target picker; templates are not accepted.");
          return;
        }
        setBusy(true);
        onBusy(true);
        setError(null);
        try {
          const r = await api.assignButton({
            controlId: control.id,
            gestureKey: gesture.key,
            action,
            enabled,
            allowExisting: coexist,
            fingerprint: reviewedFingerprint,
            changesVersion: reviewedChangesVersion,
          });
          if (r.ok) {
            setDirty(false);
            await onQueued();
          } else setError(r.error);
        } finally {
          setBusy(false);
          onBusy(false);
        }
      }}
    >
      <label>
        Target
        <select
          aria-label="Button action target"
          disabled={busy || initial !== null}
          className={`${inputClass} mt-1`}
          value={entity}
          onChange={(e) =>
            act(() => {
              setEntity(e.target.value);
              const d = e.target.value.split(".")[0];
              setService(defaultButtonService(d, inventory.services));
            })
          }
        >
          <option value="">Service action without an entity target</option>
          {Object.values(h.entities)
            .filter((e) => !e.disabled && !inventory.managed.some((m) => m.entityId === e.entityId) && targetDomains.has(e.domain))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((e) => (
              <option key={e.entityId} value={e.entityId}>
                {e.name} · {e.entityId}
              </option>
            ))}
        </select>
      </label>
      <label>
        Action
        <select
          aria-label="Button action service"
          disabled={busy || (initial !== null && initial.entityId === null)}
          className={`${inputClass} mt-1`}
          value={service}
          onChange={(e) => act(() => setService(e.target.value))}
        >
          <option value="">Choose an action</option>
          {allowed.map((s) => (
            <option key={s} value={s}>
              {actionLabel(s, !!entity)} · {s}
            </option>
          ))}
        </select>
      </label>
      {initial && (
        <p className="text-xs text-muted sm:col-span-2">
          This edit keeps the same output. To replace it, disable this assignment and add the new output; review both changes together.
        </p>
      )}
      <details className="sm:col-span-2">
        <summary className="cursor-pointer text-xs text-muted">Optional action data (JSON)</summary>
        <textarea
          aria-label="Button action data"
          disabled={busy}
          className={`${inputClass} mt-2 font-mono`}
          rows={3}
          value={json}
          onChange={(e) => act(() => setJson(e.target.value))}
        />
        <p className="mt-1 text-xs text-muted">
          For example brightness_pct or script variables. Service-only actions must not require an entity target. Automation actions respect their conditions by
          default.
        </p>
      </details>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => act(() => setEnabled(e.target.checked))} />
        Enable this assignment after Apply
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input className="mt-0.5" type="checkbox" checked={coexist} disabled={busy} onChange={(e) => act(() => setCoexist(e.target.checked))} />I reviewed
        existing handlers and any coverage gaps; allow coexistence.
      </label>
      {error && (
        <p role="alert" className="text-xs text-danger sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" tone="primary" disabled={busy || !service}>
          {busy ? "Adding…" : "Add to changes"}
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            if (!dirty || window.confirm("Discard this unsaved button assignment?")) {
              setDirty(false);
              onCancel();
            }
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ButtonAiReview({ control }: { control: ButtonControl }) {
  const [preview, setPreview] = useState<ButtonAiPreview | null>(null),
    [text, setText] = useState(""),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  return (
    <details className="mt-4 rounded-lg border border-line p-3 text-xs">
      <summary className="cursor-pointer text-accent">AI review of existing button automations</summary>
      <p className="mt-2 text-muted">
        The local scan reads all available automation configs. AI explains this control's exact/possible matches using service and target summaries, not raw
        YAML or credentials. It cannot assign actions.
      </p>
      <Button
        className="mt-2"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          setText("");
          try {
            const r = await api.buttonAiPreview(control.id);
            if (r.ok) setPreview(r.preview);
            else setError(r.error);
          } finally {
            setBusy(false);
          }
        }}
      >
        Prepare AI preview
      </Button>
      {preview && (
        <>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words bg-surface p-2">{preview.content}</pre>
          <Button
            className="mt-2"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await api.buttonAiReview(control.id, preview.fingerprint);
                if (r.ok) setText(`${r.model}\n${r.text}${r.truncated ? "\nIncomplete reply: the response reached its output limit." : ""}`);
                else setError(r.error);
              } finally {
                setBusy(false);
              }
            }}
          >
            Send this review to Medium AI
          </Button>
        </>
      )}
      {busy && (
        <p role="status" className="mt-2">
          Reading…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-danger">
          {error}
        </p>
      )}
      {text && <p className="mt-3 whitespace-pre-wrap">{text}</p>}
    </details>
  );
}
