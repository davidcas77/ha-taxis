import type { ButtonControl } from "../../shared/buttons.ts";
import type { Hierarchy } from "../../shared/types.ts";
import type { RawRegistry } from "../model/hierarchy.ts";

// Which devices are worth asking Home Assistant for device triggers.
//
// device_automation/trigger/list is one WebSocket round trip per device, and a
// house has hundreds of devices (lamps, speakers, sensors) that have no button
// at all. Asking all of them made the Buttons page slow on a large install.
// A device is asked when any of these holds:
//
//   - it has an entity that can report a press: an event, button or input_button
//     entity, or a sensor that reports presses as options (enum);
//   - its integration is one known to expose device triggers for buttons
//     (BUTTON_TRIGGER_INTEGRATIONS);
//   - an automation already mentions the device by id (any config that holds the
//     device id counts, which is a superset of "has a device trigger");
//   - Taxis can't tell which integration it belongs to (nothing to rule it out).
//
// THE TRADE-OFF. A device that none of these catches, whose integration is not
// in the list and has no event/button entity, and that no automation mentions,
// shows no native-trigger gestures on the Buttons page. It still appears as a
// control, and any automation that handles it is still found. To cover another
// integration, add its domain below: this is the only place the list lives.
// docs/design/button-map.md says the same in user terms.

export const BUTTON_TRIGGER_INTEGRATIONS: ReadonlySet<string> = new Set([
  "zha",
  "mqtt", // Zigbee2MQTT and other MQTT bridges
  "deconz",
  "hue",
  "tradfri",
  "homekit_controller",
  "lutron_caseta",
  "lutron",
  "shelly",
  "tasmota",
  "zwave_js",
  "matter",
  "xiaomi_aqara",
  "aqara", // custom Aqara integrations
  "xiaomi_ble",
  "bthome",
  "switchbot",
  "insteon",
  "enocean",
  "homematicip_local",
]);

const BUTTON_ENTITY_DOMAINS = new Set(["event", "button", "input_button"]);
// The id of a device in Home Assistant's registry: 32 lowercase hex characters.
const DEVICE_ID = /\b[0-9a-f]{32}\b/g;
// Same words the discovery uses to tell a sensor that reports presses.
const PRESS_OPTION = /press|click|hold|release|double|single|long|triple|action/i;

// The ids of the devices that some automation config mentions.
export function devicesMentionedBy(configs: readonly unknown[], deviceIds: ReadonlySet<string>): Set<string> {
  const found = new Set<string>();
  for (const config of configs) {
    if (!config) continue;
    for (const id of JSON.stringify(config).match(DEVICE_ID) ?? []) if (deviceIds.has(id)) found.add(id);
  }
  return found;
}

// Integration domains a device is known by: the platforms of its entities, the
// first part of its identifiers (["zha", "00:15:..."]), and the domain of each
// config entry it belongs to.
function domainsOf(control: ButtonControl, raw: RawRegistry, entries: ReadonlyMap<string, string>): Set<string> {
  const domains = new Set(control.integrations);
  const device = raw.devices.find((d) => d.id === control.deviceId) as { identifiers?: unknown; config_entries?: unknown } | undefined;
  if (Array.isArray(device?.identifiers)) {
    for (const pair of device.identifiers) if (Array.isArray(pair) && typeof pair[0] === "string") domains.add(pair[0]);
  }
  if (Array.isArray(device?.config_entries)) {
    for (const id of device.config_entries) {
      const domain = typeof id === "string" ? entries.get(id) : undefined;
      if (domain) domains.add(domain);
    }
  }
  return domains;
}

// A sensor whose options read like presses (the same test discovery.ts applies
// when it turns one into gestures, only cheaper).
function reportsPresses(attributes: Record<string, unknown> | undefined): boolean {
  return (
    attributes?.device_class === "enum" && Array.isArray(attributes.options) && attributes.options.some((o) => typeof o === "string" && PRESS_OPTION.test(o))
  );
}

/** Builds the test "is this control worth asking for device triggers?". */
export function buttonTriggerFilter(raw: RawRegistry, h: Hierarchy, mentioned: ReadonlySet<string>): (control: ButtonControl) => boolean {
  const attributes = new Map(raw.states.map((s) => [s.entity_id, s.attributes as Record<string, unknown> | undefined]));
  const entries = new Map((raw.integrations ?? []).flatMap((entry) => (entry.domain ? [[entry.entry_id, entry.domain] as const] : [])));

  return (control) => {
    const deviceId = control.deviceId;
    if (!deviceId) return false;
    if (mentioned.has(deviceId)) return true;

    const entityIds = h.devices[deviceId]?.entityIds ?? [];
    for (const entityId of entityIds) {
      const domain = entityId.slice(0, entityId.indexOf("."));
      if (BUTTON_ENTITY_DOMAINS.has(domain)) return true;
      if (domain === "sensor" && reportsPresses(attributes.get(entityId))) return true;
    }

    const domains = domainsOf(control, raw, entries);
    // Nothing says what it is: it can't be ruled out.
    if (domains.size === 0) return true;
    return [...domains].some((domain) => BUTTON_TRIGGER_INTEGRATIONS.has(domain));
  };
}
