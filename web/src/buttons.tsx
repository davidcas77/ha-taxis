import { Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { buttonTargetDomains, defaultButtonService, domainAllowsService, offeredButtonServices } from "../../shared/button-actions.ts";
import { buttonMatrix, type MatrixCell } from "../../shared/button-matrix.ts";
import {
  buttonOutput,
  isIdentifyButton,
  validButtonAction,
  validButtonMap,
  type ButtonAction,
  type ButtonAnalysisAction,
  type ButtonAnalysisHandler,
  type ButtonControl,
  type ButtonExisting,
  type ButtonGesture,
  type ButtonGestureAnalysis,
  type ButtonInventory,
  type ButtonAiPreview,
  type ButtonAiResponse,
  type ButtonMapping,
} from "../../shared/buttons.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { api } from "./api.ts";
import { ButtonReferences } from "./button-references.tsx";
import { summarizeButtonPress } from "./button-press-summary.ts";
import { DataTable, type Column } from "./data-table.tsx";
import { JEV_SETTINGS, useTaxis, type Route } from "./state.tsx";
import { useStoredChoice } from "./storage.ts";
import { confirmDraftNavigation, useDraftGuard } from "./draft-guard.ts";
import { JevCheck } from "./jev-check.tsx";
import { Badge, Button, Card, Chip, EmptyState, inputClass, Toolbar } from "./ui.tsx";

// What a Taxis assignment is, as the pages below hold it.
type Binding = ButtonMapping & { queued: boolean; output: string; automationId: string; automationEnabled: boolean | null; blocked: string | null };
type Editing = { key: string; action: ButtonAction | null; enabled: boolean };

const haAutomation = (id: string) => `/config/automation/edit/${encodeURIComponent(id)}`;
const gestureSourceEntity = (gesture: ButtonGesture) => gesture.eventEntity ?? gesture.enumSensor;

// The Buttons tab of the Automations page: the controls on the left, and for the
// one picked, its buttons by press types. Content only; the page supplies the header.
export function ButtonsPanel({ h, controlId, go }: { h: Hierarchy; controlId: string | null; go: (r: Route) => void }) {
  const { changes, reload, reviewChanges } = useTaxis();
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
  const maps = new Map((data?.inventory.managed ?? []).map((m) => [m.id, { map: m.map, queued: false, enabled: m.enabled, blocked: m.blocked }]));
  for (const c of changes)
    if (c.kind === "automation" && validButtonMap(c.after.button_map))
      maps.set(c.targetId, { map: c.after.button_map, queued: true, enabled: null, blocked: [] });
  const bindings: Binding[] = [...maps.entries()].flatMap(([automationId, m]) =>
    m.map.bindings.map((b) => ({
      ...b,
      queued: m.queued,
      output: m.map.output,
      automationId,
      automationEnabled: m.enabled,
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
  const refreshButtons = () => {
    setLoading(true);
    setRefresh((v) => v + 1);
  };
  const added = async () => {
    await reload(false);
    if (!reviewChanges) refreshButtons();
  };
  const selectControl = (id: string | null) => go({ page: "automations", tab: "buttons", controlId: id });
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Toolbar label="Buttons actions">
        <p className="min-w-[16rem] flex-1 text-[13px] text-muted">
          Every remote, wall control and HA button input. One automation per light, group or other output combines its assigned buttons; each press type can run
          its own action. {reviewChanges ? "Nothing changes in HA until Apply." : "Assignments apply to Home Assistant immediately."}
        </p>
        <Button disabled={loading || submitting} onClick={refreshButtons}>
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
              refreshing={loading}
              revision={refresh}
              bindings={bindings.filter((b) => b.controlId === source.id)}
              editing={editing}
              busy={submitting}
              onEdit={(gesture, action, enabled) => {
                if (!submitting && confirmDraftNavigation()) setEditing({ key: source.id + gesture.key, action, enabled });
              }}
              onClose={() => setEditing(null)}
              onBusy={setSubmitting}
              onAdded={added}
              openJevSettings={() => go(JEV_SETTINGS)}
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
function Coverage({ data }: { data: { inventory: ButtonInventory } }) {
  const { coverage, notes } = data.inventory;
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer">
        Discovery coverage: {coverage.readable} of {coverage.automations} automation configs readable
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
  refreshing,
  revision,
  bindings,
  editing,
  busy,
  onEdit,
  onClose,
  onBusy,
  onAdded,
  openJevSettings,
}: {
  h: Hierarchy;
  control: ButtonControl;
  data: { inventory: ButtonInventory; fingerprint: string };
  refreshing: boolean;
  revision: number;
  bindings: Binding[];
  editing: Editing | null;
  busy: boolean;
  onEdit: (gesture: ButtonGesture, action: ButtonAction | null, enabled: boolean) => void;
  onClose: () => void;
  onBusy: (value: boolean) => void;
  onAdded: () => Promise<void>;
  openJevSettings: () => void;
}) {
  const matrix = buttonMatrix(control.gestures, bindings, control.existing);
  const [layout, setLayout] = useStoredChoice("taxis:buttons:layout", ["tree", "table"] as const, "tree");
  const [attempt, setAttempt] = useState(0);
  const [evidence, setEvidence] = useState<{ request: string; result: Awaited<ReturnType<typeof api.buttonAiPreview>> } | null>(null);
  const request = JSON.stringify([control.id, data.fingerprint, revision, attempt]);
  const hasEvidence = control.gestures.length > 0 || Boolean(control.related?.length);
  useEffect(() => {
    if (refreshing || !hasEvidence) return;
    let current = true;
    void api.buttonAiPreview(control.id).then((result) => {
      if (current) setEvidence({ request, result });
    });
    return () => {
      current = false;
    };
  }, [control.id, hasEvidence, refreshing, request]);
  const result = !refreshing && evidence?.request === request ? evidence.result : null;
  const preview = result?.ok ? result.preview : null;
  const pressEvidence = new Map(preview?.analysis?.gestures.map((item) => [item.key, item]));
  const relatedEvidence = new Map(preview?.analysis?.related.map((handler) => [handler.id, handler]));
  // The form opens below the gestures; bring it into view.
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editing) editor.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [editing]);
  const editingGesture = control.gestures.find((g) => control.id + g.key === editing?.key) ?? null;
  const discoveredKeys = new Set(control.gestures.map(({ key }) => key));
  const blocked = bindings.filter((binding) => binding.blocked && !discoveredKeys.has(binding.gestureKey));
  const renderSources = (button: string, sources: readonly MatrixCell<Binding>[]) => (
    <ul className="grid gap-2 divide-y divide-line">
      {sources.map((cell, index) => {
        const { gesture } = cell;
        const sameIntegration = sources.filter((source) => source.gesture.source === gesture.source);
        const sameLabel = sameIntegration.filter((source) => gestureSourceEntity(source.gesture) === gestureSourceEntity(gesture));
        const ordinal =
          sameLabel.length > 1
            ? sameLabel
                .map((source) => source.gesture.key)
                .sort()
                .indexOf(gesture.key) + 1
            : null;
        return (
          <li key={gesture.key} className={index > 0 ? "pt-2" : undefined}>
            <GestureCell
              button={button}
              cell={cell}
              analysis={pressEvidence.get(gesture.key)}
              qualifyActions={sources.length > 1}
              qualifyGroup={sameIntegration.length > 1}
              sourceOrdinal={ordinal}
              busy={busy}
              onEdit={(action, enabled) => onEdit(gesture, action, enabled)}
            />
          </li>
        );
      })}
    </ul>
  );
  const renderPress = (button: string, press: string, sources: readonly MatrixCell<Binding>[], showPress: boolean) => (
    <ButtonPressDetails
      button={button}
      press={press}
      showPress={showPress}
      description={summarizeButtonPress(sources, pressEvidence, describePressAction, (id) => h.entities[id]?.name ?? id)}
    >
      {renderSources(button, sources)}
    </ButtonPressDetails>
  );
  // Integrations can expose combinations or a generic control without naming a physical button.
  const buttonNoun = matrix.buttons.some(({ label }) => /^(both|button \/ control)$/i.test(label)) ? "button group" : "button";
  const gestureCount = control.gestures.length;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Coverage data={data} />
      <div>
        <h2 className="text-lg font-semibold">{control.name}</h2>
        <p className="mt-1 text-sm text-muted">{[control.manufacturer, control.model, ...control.integrations].filter(Boolean).join(" · ")}</p>
      </div>
      <ButtonReferences key={control.id} h={h} control={control} inventory={data.inventory} serviceLabel={actionLabel} />
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
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-muted">Other automations that may use this device (they reference it but not a specific gesture):</p>
          {control.related.map((handler) => {
            const analysis = relatedEvidence.get(handler.id);
            return analysis ? <HandlerEvidence key={handler.id} handler={analysis} /> : <HandlerSummary key={handler.id} handler={handler} />;
          })}
        </div>
      )}
      {hasEvidence && (
        <div className="grid gap-2">
          <JevCheck
            subject={{ kind: "buttons", controlId: control.id }}
            label="Check button mapping with Jev"
            title={`Jev · ${control.name} button mapping`}
            revision={`${data.fingerprint}:${revision}`}
            disabled={refreshing}
            openSettings={openJevSettings}
          />
          <ButtonAiReview
            controlId={control.id}
            preview={preview}
            error={result?.ok === false ? result.error : null}
            onRefresh={() => setAttempt((v) => v + 1)}
          />
        </div>
      )}
      {matrix.buttons.length > 0 && (
        <section aria-label="Button gestures" className="grid min-w-0 gap-2">
          <Toolbar label="Button layout">
            <p className="mr-auto text-sm font-medium">
              {matrix.buttons.length} {buttonNoun}
              {matrix.buttons.length === 1 ? "" : "s"} · {gestureCount} {gestureCount === 1 ? "gesture" : "gestures"}
            </p>
            <Chip pressed={layout === "tree"} onClick={() => setLayout("tree")}>
              Tree
            </Chip>
            <Chip pressed={layout === "table"} onClick={() => setLayout("table")}>
              Table
            </Chip>
          </Toolbar>
          {layout === "tree" ? (
            <ul aria-label={`Button tree for ${control.name}`} className="grid min-w-0 gap-2">
              {matrix.buttons.map(({ label, presses }) => (
                <li key={label} className="min-w-0 rounded-lg border border-line bg-surface">
                  <details open aria-label={label}>
                    <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold hover:bg-sunken">{label}</summary>
                    <ul className="divide-y divide-line border-t border-line px-3">
                      {matrix.pressTypes.flatMap((press) => {
                        const sources = presses.get(press);
                        return sources
                          ? [
                              <li key={press} className="min-w-0 py-1">
                                {renderPress(label, press, sources, true)}
                              </li>,
                            ]
                          : [];
                      })}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <div role="region" aria-label="Scrollable button table" tabIndex={0} className="min-w-0 overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="min-w-full border-separate border-spacing-0 text-left">
                <caption className="sr-only">Buttons of {control.name}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="sticky left-0 z-10 min-w-28 border-r border-line bg-sunken px-2 py-2 text-xs font-semibold">
                      Press type
                    </th>
                    {matrix.buttons.map(({ label }) => (
                      <th scope="col" key={label} className="min-w-52 bg-sunken px-3 py-2 text-[13px] font-semibold">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.pressTypes.map((press) => (
                    <tr key={press}>
                      <th scope="row" className="sticky left-0 z-10 border-t border-r border-line bg-surface px-2 py-3 align-top text-[13px] font-medium">
                        {press}
                      </th>
                      {matrix.buttons.map(({ label, presses }) => {
                        const sources = presses.get(press);
                        return (
                          <td key={label} className="border-t border-line px-3 py-2 align-top">
                            {sources ? (
                              renderPress(label, press, sources, false)
                            ) : (
                              <span className="text-xs text-muted" aria-label="Press unavailable">
                                –
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted">
            A trigger match identifies a handler. Its conditions determine when it can run. Check discovery coverage for unreadable automations.
          </p>
          {preview?.analysis?.notes.map((note) => (
            <p key={note} className="text-xs text-muted">
              {note}
            </p>
          ))}
        </section>
      )}
      {blocked.map((binding) => (
        <BlockedMapping key={`${binding.key}:${buttonOutput(binding.action)}`} binding={binding} />
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

function describePressAction(service: string, targets: readonly string[]) {
  const target = targets.length > 1 ? `${targets.length} targets` : targets[0];
  return [actionLabel(service, targets.length > 0), target].filter(Boolean).join(" · ");
}

function ButtonPressDetails({
  button,
  press,
  showPress,
  description,
  children,
}: {
  button: string;
  press: string;
  showPress: boolean;
  description: string;
  children: ReactNode;
}) {
  const label = `${button} · ${press}`;
  return (
    <details aria-label={label} className="min-w-0">
      <summary aria-label={`${label} · ${description}`} className="cursor-pointer break-words rounded-md px-1.5 py-2 text-[13px] hover:bg-sunken">
        {showPress && <span className="mr-2 font-medium">{press}</span>}
        <span className="text-xs text-muted">{description}</span>
      </summary>
      <div className="border-l border-line pl-3 pt-2 pb-1">{children}</div>
    </details>
  );
}

function BlockedMapping({ binding }: { binding: Binding }) {
  return (
    <Card tone="danger">
      <p className="text-xs font-medium text-danger">
        {binding.button} · {binding.gesture} · Blocked by Taxis's safety rules
      </p>
      <p className="mt-1 text-xs text-muted">
        {binding.blocked}{" "}
        <a className="text-accent" href={haAutomation(binding.automationId)} target="_blank" rel="noreferrer">
          Open it in HA
        </a>{" "}
        to review, change or remove this assignment.
      </p>
    </Card>
  );
}

// One press type combines queued assignments and evidence from the installed automations.
function GestureCell({
  button,
  cell,
  analysis,
  qualifyActions,
  qualifyGroup,
  sourceOrdinal,
  busy,
  onEdit,
}: {
  button: string;
  cell: MatrixCell<Binding>;
  analysis: ButtonGestureAnalysis | undefined;
  qualifyActions: boolean;
  qualifyGroup: boolean;
  sourceOrdinal: number | null;
  busy: boolean;
  onEdit: (action: ButtonAction | null, enabled: boolean) => void;
}) {
  const { gesture, bindings, external } = cell;
  const sourceEntity = gestureSourceEntity(gesture);
  const sourceNumber = sourceOrdinal === null ? null : `Source ${sourceOrdinal}`;
  const sourceName = [gesture.source, sourceEntity, sourceNumber].filter(Boolean).join(" · ");
  const triggerDetail = sourceNumber
    ? [gesture.trigger.type, gesture.trigger.subtype, gesture.eventType ?? gesture.trigger.to]
        .filter((part): part is string => typeof part === "string" && Boolean(part))
        .join(" / ")
    : "";
  const label = `${button} · ${gesture.gesture}${qualifyActions ? ` · ${sourceName}` : ""}`;
  const handlers = analysis?.handlers ?? [];
  const detailed = new Set(handlers.map((handler) => handler.id));
  const empty = bindings.length === 0 && external.length === 0 && handlers.length === 0;
  return (
    <div role="group" aria-label={`${gesture.gesture} · ${qualifyGroup ? sourceName : gesture.source}`} className="flex flex-col gap-1">
      <p className="break-words text-[11px] text-muted">
        {gesture.source}
        {sourceEntity && (
          <>
            {" "}
            · <code className="break-all">{sourceEntity}</code>
          </>
        )}
        {sourceNumber && <> · {sourceNumber}</>}
        {triggerDetail && (
          <>
            {" "}
            · <code className="break-all">{triggerDetail}</code>
          </>
        )}
      </p>
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
      {bindings
        .filter((binding) => binding.blocked)
        .map((binding) => (
          <BlockedMapping key={`${binding.key}:${buttonOutput(binding.action)}`} binding={binding} />
        ))}
      {handlers.slice(0, 2).map((handler) => (
        <HandlerEvidence key={handler.id} handler={handler} />
      ))}
      {handlers.length > 2 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-accent">
            {handlers.length - 2} more {handlers.length === 3 ? "handler" : "handlers"}
          </summary>
          <div className="mt-1 flex flex-col gap-1">
            {handlers.slice(2).map((handler) => (
              <HandlerEvidence key={handler.id} handler={handler} />
            ))}
          </div>
        </details>
      )}
      {external
        .filter((handler) => !detailed.has(handler.id))
        .map((handler) => (
          <HandlerSummary key={handler.id} handler={handler} />
        ))}
      {analysis?.overlaps.map((overlap) => (
        <p key={`${overlap.kind}:${overlap.target.id}`} className="break-words text-xs font-medium text-warn" title={overlap.target.id}>
          {overlap.kind === "opposing" ? (overlap.conditional ? "Possible opposing actions on " : "Opposing actions on ") : "Multiple handlers target "}
          {overlap.target.name}
        </p>
      ))}
      {empty && <p className="text-xs text-muted">No readable handler matched</p>}
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

function HandlerSource({ handler }: { handler: Pick<ButtonAnalysisHandler, "id" | "name" | "enabled" | "match"> }) {
  return (
    <p>
      <a className="font-medium text-accent hover:underline" href={haAutomation(handler.id)} target="_blank" rel="noreferrer">
        {handler.name}
      </a>{" "}
      <span className="text-muted">
        {handler.enabled === true ? "On" : handler.enabled === false ? "Off" : "State unknown"} ·{" "}
        {handler.match === "exact" ? "Trigger match" : "Possible match"}
      </span>
    </p>
  );
}

function HandlerSummary({ handler }: { handler: ButtonExisting }) {
  const summary = [...handler.services, ...handler.targets].join(" · ");
  return (
    <div className="break-words text-xs">
      <HandlerSource handler={handler} />
      {summary && <p className="text-muted">{summary}</p>}
    </div>
  );
}

function HandlerEvidence({ handler }: { handler: ButtonAnalysisHandler }) {
  return (
    <div className="flex flex-col gap-1 break-words border-l border-line pl-2 text-xs">
      <HandlerSource handler={handler} />
      {handler.conditions.length > 0 && (
        <p className="text-muted">
          <span className="font-medium">Conditions</span> · {handler.conditions.join(" · ")}
        </p>
      )}
      {handler.actions.length > 0 && <ActionList actions={handler.actions.slice(0, 2)} />}
      {handler.actions.length > 2 && (
        <details>
          <summary className="cursor-pointer font-medium text-accent">
            {handler.actions.length - 2} more {handler.actions.length === 3 ? "action" : "actions"}
          </summary>
          <ActionList actions={handler.actions.slice(2)} />
        </details>
      )}
      {handler.notes.map((note) => (
        <p key={note} className="text-muted">
          {note}
        </p>
      ))}
    </div>
  );
}

function ActionList({ actions }: { actions: ButtonAnalysisAction[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {actions.map((action, i) => (
        <li key={i}>
          <ActionEvidence action={action} />
        </li>
      ))}
    </ul>
  );
}

function ActionEvidence({ action }: { action: ButtonAnalysisAction }) {
  const details = [...action.branches, ...action.conditions, ...action.via, ...(action.settings ?? [])];
  return (
    <div>
      <p>
        <span title={action.service}>{actionLabel(action.service, action.targets.length > 0)}</span>
        {action.targets.map((target) => (
          <span key={target.id} title={target.id}>
            {" "}
            · {target.name}
          </span>
        ))}
        {action.uncertain && <span className="text-muted"> · Possible behavior</span>}
      </p>
      {details.length > 0 && <p className="text-muted">{details.join(" · ")}</p>}
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
  const { version, assignButton, busy: editsBusy, reviewChanges } = useTaxis();
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
  const identifyIds = new Set(inventory.identifyButtons);
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
        if (editsBusy) {
          setError("Wait for the current operation to finish.");
          return;
        }
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
          const ok = await assignButton({
            controlId: control.id,
            gestureKey: gesture.key,
            action,
            enabled,
            allowExisting: coexist,
            fingerprint: reviewedFingerprint,
            changesVersion: reviewedChangesVersion,
          });
          if (ok) {
            setDirty(false);
            await onQueued();
          } else setError("The button assignment could not be saved. See the message above.");
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
            .filter(
              (e) =>
                !e.disabled &&
                ((!identifyIds.has(e.entityId) && !isIdentifyButton(e)) || e.entityId === initial?.entityId) &&
                !inventory.managed.some((m) => m.entityId === e.entityId) &&
                targetDomains.has(e.domain),
            )
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
          This edit keeps the same output. To replace it, disable this assignment and add the new output.{" "}
          {reviewChanges ? "Review both changes together." : "Each edit applies immediately."}
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
        {reviewChanges ? "Enable this assignment after Apply" : "Enable this assignment"}
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
        <Button type="submit" tone="primary" disabled={busy || editsBusy || !service}>
          {busy ? (reviewChanges ? "Adding…" : "Applying…") : reviewChanges ? "Add to changes" : "Apply assignment"}
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

function ButtonAiReview({
  controlId,
  preview,
  error,
  onRefresh,
}: {
  controlId: string;
  preview: ButtonAiPreview | null;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <>
      {error && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <p role="alert" className="text-warn">
            {error} The button table still shows the available match summaries.
          </p>
          <Button onClick={onRefresh}>Retry reading evidence</Button>
        </div>
      )}
      <details className="rounded-lg border border-line bg-surface p-3 text-xs">
        <summary className="cursor-pointer text-sm font-medium text-accent">Analyze with AI</summary>
        {preview ? (
          <>
            <p className="mt-2 text-muted">
              The data below is the exact request evidence for this control. Review it before sending it to the configured Medium AI model.
            </p>
            <pre tabIndex={0} aria-label="AI request evidence" className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-sunken p-2">
              {preview.content}
            </pre>
            <ButtonAiRequest key={preview.fingerprint} controlId={controlId} fingerprint={preview.fingerprint} onRefresh={onRefresh} />
          </>
        ) : error ? (
          <p className="mt-2 text-muted">Retry reading the evidence to prepare a preview.</p>
        ) : (
          <p role="status" className="mt-2 text-muted">
            Reading automation evidence…
          </p>
        )}
      </details>
    </>
  );
}

function ButtonAiRequest({ controlId, fingerprint, onRefresh }: { controlId: string; fingerprint: string; onRefresh: () => void }) {
  const [result, setResult] = useState<ButtonAiResponse | null>(null);
  const [sending, setSending] = useState(false);
  const send = async () => {
    setSending(true);
    setResult(null);
    setResult(await api.buttonAiReview(controlId, fingerprint));
    setSending(false);
  };
  if (result?.ok) {
    return (
      <section aria-label="AI analysis" className="mt-3 flex flex-col gap-2 rounded-md border border-line p-3">
        <h3 className="text-sm font-medium">AI analysis</h3>
        <p className="whitespace-pre-wrap break-words text-sm">{result.text}</p>
        <p className="text-muted">{result.model}</p>
        {result.truncated && <p className="text-warn">This reply reached the model's response limit.</p>}
      </section>
    );
  }
  return (
    <div className="mt-2 flex flex-col items-start gap-2">
      {result?.ok === false && (
        <p role="alert" className="text-danger">
          {result.error}
        </p>
      )}
      {result?.ok === false && result.code === "stale" ? (
        <Button onClick={onRefresh}>Refresh preview</Button>
      ) : (
        <Button tone="primary" disabled={sending} onClick={() => void send()}>
          {sending ? "Analyzing…" : "Send this review to Medium AI"}
        </Button>
      )}
      {sending && (
        <p role="status" className="text-muted">
          Waiting for the AI analysis…
        </p>
      )}
    </div>
  );
}
