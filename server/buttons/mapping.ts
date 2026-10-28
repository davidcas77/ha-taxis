import {
  buttonInputLoop,
  buttonOutput,
  validButtonMap,
  type ButtonAssignment,
  type ButtonInventory,
  type ButtonMap,
  type ButtonMapping,
} from "../../shared/buttons.ts";
import { checkButtonAction } from "../../shared/button-actions.ts";
import type { ChangeInput } from "../../shared/types.ts";
import { BUTTON_MARKER, buttonAutomationId, buttonHash } from "./identity.ts";

export function buttonInventoryFingerprint(i: ButtonInventory): string {
  return buttonHash({
    controls: i.controls.map((c) => [c.id, c.gestures, c.existing, c.related]),
    managed: i.managed.map((m) => [m.id, m.fingerprint, m.enabled]),
    services: i.services,
    targetServices: i.targetServices,
    coverage: i.coverage,
  });
}
export function buttonConfig(id: string, alias: string, value: ButtonMap): Record<string, unknown> {
  const stored = { ...value, expected: null, allowExisting: false };
  const active = value.bindings.filter((b) => b.enabled);
  const stateKeys = active.filter((b) => b.eventEntity).map((b) => b.key);
  // An empty/disabled map retains known triggers but has a false condition and
  // initial_state off. No deletion, dummy device gesture or service invocation.
  const triggers = (active.length ? active : value.bindings).map((b) => ({
    ...b.trigger,
    id: b.key,
    ...(b.eventType ? { variables: { taxis_button_event_type: b.eventType } } : {}),
  }));
  return {
    id,
    alias,
    description: BUTTON_MARKER + JSON.stringify(stored),
    initial_state: active.length > 0,
    mode: "queued",
    max: 20,
    trigger: triggers,
    condition: active.length
      ? [
          {
            condition: "template",
            value_template: `{{ trigger.id not in ${JSON.stringify(stateKeys)} or (trigger.from_state is not none and trigger.to_state is not none and trigger.to_state.state not in ['unknown', 'unavailable'] and trigger.to_state.state != trigger.from_state.state and as_timestamp(trigger.to_state.state, 0) >= as_timestamp(now()) - 5 and (taxis_button_event_type is not defined or trigger.to_state.attributes.get('event_type') == taxis_button_event_type)) }}`,
          },
        ]
      : [{ condition: "template", value_template: "{{ false }}" }],
    action: [
      {
        choose: active.map((b) => ({
          conditions: [{ condition: "trigger", id: b.key }],
          sequence: [
            {
              service: b.action.service,
              ...(b.action.entityId ? { target: { entity_id: b.action.entityId } } : {}),
              data: b.action.service === "automation.trigger" ? { skip_condition: false, ...b.action.data } : b.action.data,
            },
          ],
        })),
      },
    ],
  };
}
// entityIds: the enabled entities HA has, to recognise a script called directly
// (see checkButtonAction). Left out, only entity-targeted actions can pass.
export function planButtonAssignment(
  inventory: ButtonInventory,
  assignment: ButtonAssignment,
  pending: readonly { kind: string; targetId: string; after: Record<string, unknown> }[],
  entityIds: ReadonlySet<string> = new Set(),
): ChangeInput {
  if (assignment.fingerprint !== buttonInventoryFingerprint(inventory)) throw new Error("The button inventory changed. Refresh and review it before queuing.");
  const control = inventory.controls.find((c) => c.id === assignment.controlId);
  const gesture = control?.gestures.find((g) => g.key === assignment.gestureKey);
  if (!control || !gesture) throw new Error("This gesture is no longer exposed by Home Assistant.");
  const verdict = checkButtonAction(assignment.action, entityIds);
  if (!verdict.ok) throw new Error(verdict.reason);
  if (!inventory.services.includes(assignment.action.service)) throw new Error("That action service is not available in Home Assistant.");
  if (!assignment.action.entityId && inventory.targetServices.includes(assignment.action.service))
    throw new Error("This action requires an explicit entity target. Choose the light, group or other entity.");
  const output = buttonOutput(assignment.action),
    id = buttonAutomationId(output);
  const installed = inventory.managed.find((m) => m.id === id);
  const queued = pending.find((c) => c.kind === "automation" && c.targetId === id);
  const base = queued && validButtonMap(queued.after.button_map) ? queued.after.button_map : installed?.map;
  const conflict = (control.existing[gesture.key] ?? []).some((a) => a.id !== id && !a.managed && a.enabled !== false);
  if ((conflict || inventory.coverage.unreadable > 0) && !assignment.allowExisting)
    throw new Error("Existing or unreadable automations may handle this button. Review them and explicitly acknowledge coexistence before adding a handler.");
  const key = buttonHash([control.id, gesture.key]).slice(0, 24);
  const binding: ButtonMapping = {
    key,
    controlId: control.id,
    gestureKey: gesture.key,
    button: gesture.button,
    gesture: gesture.gesture,
    trigger: gesture.trigger,
    ...(gesture.eventEntity ? { eventEntity: gesture.eventEntity } : {}),
    ...(gesture.eventType ? { eventType: gesture.eventType } : {}),
    action: assignment.action,
    enabled: assignment.enabled,
  };
  const bindings = [...(base?.bindings ?? []).filter((b) => b.key !== key), binding].sort((a, b) => a.key.localeCompare(b.key));
  const map: ButtonMap = {
    version: 1,
    output,
    bindings,
    expected: queued && base ? base.expected : (installed?.fingerprint ?? null),
    allowExisting: assignment.allowExisting,
  };
  if (!validButtonMap(map)) throw new Error("This target has too many mappings or invalid action data.");
  // An installed map may still hold an action the rules now refuse. Saving the map
  // would write it again unchanged, so refuse, unless this very button is being
  // given a new action in its place.
  const kept = (installed?.blocked ?? []).find((b) => b.key !== key && bindings.some((x) => x.key === b.key));
  if (kept)
    throw new Error(
      `This button automation holds an action that Taxis's safety rules no longer allow, so Taxis won't write it again. ${kept.reason} Fix it in Home Assistant, or give that button a new allowed action to replace it.`,
    );
  const all = new Map(inventory.managed.map((m) => [m.id, m.map]));
  for (const c of pending) if (c.kind === "automation" && validButtonMap(c.after.button_map)) all.set(c.targetId, c.after.button_map);
  all.set(id, map);
  if (buttonInputLoop([...all.values()])) throw new Error("These button assignments would repeatedly press their own inputs. Remove the cycle before queuing.");
  return {
    kind: "automation",
    op: installed ? "update" : "create",
    fields: { automation_id: id, alias: `Taxis buttons · ${output}`.slice(0, 255), button_map: map },
  };
}
