import type { ButtonControl } from "../../shared/buttons.ts";
import type { RawDevice } from "../model/hierarchy.ts";

const serialPattern = /^[a-f0-9]{16}$/i;
const lanlinkPattern = /^lumi\.([a-fA-F0-9]{16})$/;

// The same switch can be registered under separate integrations. Describe the
// registry proof without joining gestures, copying mappings or exposing serials.
export function linkCompanionControls(devices: readonly RawDevice[], controls: Map<string, ButtonControl>): void {
  const bySerial = new Map<string, { lanlink: string[]; homekit: string[] }>();
  const ambiguous = new Set<string>();
  const add = (serial: string, integration: "lanlink" | "homekit", id: string) => {
    const key = serial.toLowerCase();
    const pair = bySerial.get(key) ?? { lanlink: [], homekit: [] };
    if (!pair[integration].includes(id)) pair[integration].push(id);
    bySerial.set(key, pair);
  };
  for (const device of devices) {
    const identifiers = Array.isArray(device.identifiers) ? device.identifiers.filter((id) => Array.isArray(id) && id.length === 2) : [];
    const lanlink = new Set(
      identifiers.flatMap(([namespace, value]) => {
        const serial = namespace === "aqara_lanlink" && typeof value === "string" ? lanlinkPattern.exec(value)?.[1] : undefined;
        return serial ? [serial.toLowerCase()] : [];
      }),
    );
    for (const serial of lanlink) add(serial, "lanlink", device.id);
    if (lanlink.size > 1) ambiguous.add(device.id);
    if (
      typeof device.serial_number === "string" &&
      serialPattern.test(device.serial_number) &&
      identifiers.some(([namespace, value]) => namespace === "homekit_controller:accessory-id" && typeof value === "string" && value.length > 0)
    )
      add(device.serial_number, "homekit", device.id);
  }
  const pairs: [ButtonControl, ButtonControl][] = [];
  const partners = new Map<string, Set<string>>();
  for (const { lanlink, homekit } of bySerial.values()) {
    if (lanlink.length !== 1 || homekit.length !== 1 || lanlink[0] === homekit[0] || ambiguous.has(lanlink[0])) continue;
    const aqara = controls.get(`device:${lanlink[0]}`);
    const hk = controls.get(`device:${homekit[0]}`);
    if (!aqara || !hk) continue;
    pairs.push([aqara, hk]);
    for (const [id, other] of [
      [aqara.id, hk.id],
      [hk.id, aqara.id],
    ]) {
      const candidates = partners.get(id) ?? new Set<string>();
      candidates.add(other);
      partners.set(id, candidates);
    }
  }
  for (const [aqara, hk] of pairs) {
    if (partners.get(aqara.id)?.size !== 1 || partners.get(hk.id)?.size !== 1) continue;
    aqara.companionControl = { id: hk.id, name: hk.name, integration: "homekit_controller" };
    hk.companionControl = { id: aqara.id, name: aqara.name, integration: "aqara_lanlink" };
  }
}
