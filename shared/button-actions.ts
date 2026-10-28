import type { ButtonAction, ButtonMap } from "./buttons.ts";

// What a button may do. A button gesture ends up as a service call inside an
// automation that Taxis writes, and that automation runs on its own, with no one
// watching. So the list is closed: anything not named here is refused, and a few
// families are named below only so the refusal can say why.
//
// Shared by the server (route, planner and Apply all enforce it) and the page
// (it offers only what passes), so the two can't drift apart.

// Domains whose services reach Home Assistant itself, the host, the shell or the
// recorder rather than a device in the house.
export const BLOCKED_BUTTON_DOMAINS: readonly string[] = [
  "homeassistant",
  "hassio",
  "shell_command",
  "python_script",
  "pyscript",
  "command_line",
  "rest_command",
  "recorder",
  "logger",
  "system_log",
  "backup",
  "frontend",
  "update",
  "zha",
  "zwave_js",
  "mqtt",
  "esphome",
];

// Service names that are dangerous in any domain. "stop" is an exact name here
// because vacuum.stop is allowed on purpose (it is in the vacuum list below)
// while cover.stop_cover is a different, harmless name.
const BLOCKED_NAME_PREFIXES = ["reload", "remove", "delete", "purge", "install"];
const BLOCKED_NAMES = ["restart", "stop", "shutdown", "reboot"];

// A service name any entity-targeted domain may not use.
export function dangerousServiceName(name: string): boolean {
  return BLOCKED_NAMES.includes(name) || BLOCKED_NAME_PREFIXES.some((prefix) => name.startsWith(prefix));
}

// Any service of the domain, bar the dangerous names above.
const ANY = "any";
type Allowed = readonly string[] | typeof ANY;

// Services allowed on an entity of the same domain, by domain.
export const BUTTON_ENTITY_SERVICES: Readonly<Record<string, Allowed>> = {
  light: ANY,
  switch: ANY,
  fan: ANY,
  cover: ANY,
  media_player: ANY,
  climate: ANY,
  humidifier: ANY,
  siren: ANY,
  valve: ANY,
  lock: ["lock", "unlock"],
  scene: ["turn_on"],
  script: ["turn_on", "turn_off", "toggle"],
  input_boolean: ["turn_on", "turn_off", "toggle"],
  input_button: ["press"],
  button: ["press"],
  automation: ["trigger", "turn_on", "turn_off", "toggle"],
  vacuum: ["start", "pause", "return_to_base", "stop"],
  number: ["set_value"],
  input_number: ["set_value"],
  select: ["select_option", "select_next", "select_previous"],
  input_select: ["select_option", "select_next", "select_previous"],
  remote: ["turn_on", "turn_off", "toggle", "send_command"],
};

// The few services allowed without an entity target.
export const NOTIFY_SERVICE = "persistent_notification.create";
// script.turn_on and friends are the script domain's own services, not scripts.
const SCRIPT_DOMAIN_SERVICES = ["turn_on", "turn_off", "toggle", "reload"];

export type ButtonActionVerdict = { ok: true } | { ok: false; reason: string };

const domainOf = (id: string) => id.split(".")[0];
const nameOf = (service: string) => service.slice(service.indexOf(".") + 1);

// Whether an entity of `domain` may be the target of `service` (a full name such
// as "light.toggle"). The same rule the check below applies, for the page's lists.
export function domainAllowsService(domain: string, service: string): boolean {
  const allowed = BUTTON_ENTITY_SERVICES[domain];
  if (!allowed || domainOf(service) !== domain) return false;
  const name = nameOf(service);
  return allowed === ANY ? !dangerousServiceName(name) : allowed.includes(name);
}

// The service the page picks when a target is chosen, or "" to make the user
// choose. Only ever one that is allowed and that Home Assistant has.
const DEFAULT_SERVICE_NAME: Readonly<Record<string, string>> = { script: "turn_on", scene: "turn_on", automation: "trigger", button: "press", input_button: "press" };
export function defaultButtonService(domain: string, services: readonly string[]): string {
  const service = `${domain}.${DEFAULT_SERVICE_NAME[domain] ?? "toggle"}`;
  return services.includes(service) && domainAllowsService(domain, service) ? service : "";
}

const refuse = (reason: string): ButtonActionVerdict => ({ ok: false, reason });

// The object id when `service` is the direct call of a script that exists
// (script.good_night runs the script entity script.good_night), otherwise null.
function directScript(service: string, entityIds: ReadonlySet<string>): string | null {
  if (domainOf(service) !== "script") return null;
  const name = nameOf(service);
  if (SCRIPT_DOMAIN_SERVICES.includes(name)) return null;
  return entityIds.has(`script.${name}`) ? name : null;
}

// Whether a button may run this action. `entityIds` are the enabled entities
// Home Assistant has, used only to recognise a script called directly.
export function checkButtonAction(action: ButtonAction, entityIds: ReadonlySet<string>): ButtonActionVerdict {
  const { service, entityId } = action;
  const domain = domainOf(service);
  const name = nameOf(service);

  if (BLOCKED_BUTTON_DOMAINS.includes(domain)) {
    return refuse(`Taxis's safety rules don't let a button run ${service}. Buttons can control devices, scripts, scenes and automations, but never Home Assistant itself, the host, shell commands or integration administration.`);
  }

  if (entityId === null) {
    if (service === NOTIFY_SERVICE || directScript(service, entityIds)) return { ok: true };
    if (dangerousServiceName(name)) {
      return refuse(`Taxis's safety rules don't let a button run ${service}: services that reload, restart, stop, remove or delete things are never allowed.`);
    }
    if (domain === "script" && !SCRIPT_DOMAIN_SERVICES.includes(name)) return refuse(`${service} isn't a script that exists in Home Assistant.`);
    if (domain in BUTTON_ENTITY_SERVICES) return refuse(`${service} needs a ${domain} entity to act on. Choose the target.`);
    return refuse(`Taxis's safety rules don't let a button run ${service} without a target. Without one, a button can only call a script or send a persistent notification.`);
  }

  const entityDomain = domainOf(entityId);
  if (entityDomain !== domain) return refuse(`${service} can't act on ${entityId}. Choose a ${entityDomain} service for it.`);
  const allowed = BUTTON_ENTITY_SERVICES[domain];
  if (!allowed) return refuse(`Taxis's safety rules don't let a button control ${domain} entities.`);
  if (domainAllowsService(domain, service)) return { ok: true };
  if (allowed === ANY) return refuse(`Taxis's safety rules don't let a button run ${service}: services that reload, restart, stop, remove or delete things are never allowed.`);
  return refuse(`A button can only run ${allowed.join(", ")} on ${domain} entities, not ${name}.`);
}

export const allowedButtonAction = (action: ButtonAction, entityIds: ReadonlySet<string>): boolean => checkButtonAction(action, entityIds).ok;

// The bindings of a map that the rules refuse now, with why. A map written
// before the rules existed, or by hand, may hold some; they are read and shown,
// never silently dropped, and never written again as they are.
export function blockedBindings(map: ButtonMap, entityIds: ReadonlySet<string>): { key: string; reason: string }[] {
  const blocked: { key: string; reason: string }[] = [];
  for (const binding of map.bindings) {
    const verdict = checkButtonAction(binding.action, entityIds);
    if (!verdict.ok) blocked.push({ key: binding.key, reason: verdict.reason });
  }
  return blocked;
}

// For the page: the domains an entity target may belong to.
export const buttonTargetDomains = (): string[] => Object.keys(BUTTON_ENTITY_SERVICES);

// For the page: the services to offer, from the ones Home Assistant has.
export function offeredButtonServices(services: readonly string[], entityId: string | null, entityIds: ReadonlySet<string>): string[] {
  return services.filter((service) => checkButtonAction({ service, entityId, data: {} }, entityIds).ok);
}
