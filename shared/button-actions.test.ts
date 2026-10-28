import { describe, expect, it } from "vitest";
import {
  BLOCKED_BUTTON_DOMAINS,
  BUTTON_ENTITY_SERVICES,
  blockedBindings,
  buttonTargetDomains,
  checkButtonAction,
  dangerousServiceName,
  defaultButtonService,
  domainAllowsService,
  offeredButtonServices,
} from "./button-actions.ts";
import type { ButtonAction, ButtonMap } from "./buttons.ts";

const ENTITIES = new Set(["script.good_night", "script.turn_on", "light.lamp", "switch.heater"]);
const act = (service: string, entityId: string | null = null): ButtonAction => ({ service, entityId, data: {} });
const ok = (service: string, entityId: string | null = null) => checkButtonAction(act(service, entityId), ENTITIES).ok;
const reason = (service: string, entityId: string | null = null) => {
  const verdict = checkButtonAction(act(service, entityId), ENTITIES);
  return verdict.ok ? "" : verdict.reason;
};

describe("button actions with an entity target", () => {
  it("allows the listed services on an entity of the same domain", () => {
    const cases: [string, string][] = [
      ["light.toggle", "light.lamp"],
      ["light.turn_on", "light.lamp"],
      ["switch.turn_off", "switch.heater"],
      ["fan.set_percentage", "fan.bedroom"],
      ["cover.open_cover", "cover.blind"],
      ["cover.stop_cover", "cover.blind"],
      ["media_player.media_play_pause", "media_player.tv"],
      ["climate.set_temperature", "climate.hall"],
      ["lock.lock", "lock.front"],
      ["lock.unlock", "lock.front"],
      ["scene.turn_on", "scene.evening"],
      ["script.turn_on", "script.good_night"],
      ["script.turn_off", "script.good_night"],
      ["script.toggle", "script.good_night"],
      ["input_boolean.toggle", "input_boolean.guest"],
      ["input_button.press", "input_button.desk"],
      ["button.press", "button.doorbell"],
      ["automation.trigger", "automation.lights"],
      ["automation.turn_off", "automation.lights"],
      ["vacuum.start", "vacuum.robot"],
      ["vacuum.return_to_base", "vacuum.robot"],
      ["vacuum.stop", "vacuum.robot"],
      ["number.set_value", "number.volume"],
      ["input_number.set_value", "input_number.target"],
      ["select.select_next", "select.mode"],
      ["input_select.select_option", "input_select.mode"],
      ["humidifier.turn_on", "humidifier.bedroom"],
      ["siren.turn_on", "siren.alarm"],
      ["valve.open_valve", "valve.garden"],
      ["remote.send_command", "remote.tv"],
    ];
    for (const [service, entity] of cases) expect(ok(service, entity), `${service} on ${entity}`).toBe(true);
  });

  it("refuses a service from another domain than the target", () => {
    expect(ok("switch.turn_on", "light.lamp")).toBe(false);
    expect(reason("switch.turn_on", "light.lamp")).toContain("light service");
  });

  it("blocks the homeassistant domain entirely, even with an entity of any domain", () => {
    for (const service of ["homeassistant.turn_on", "homeassistant.toggle", "homeassistant.restart", "homeassistant.stop"]) {
      expect(ok(service, "light.lamp"), service).toBe(false);
      expect(ok(service), service).toBe(false);
    }
    expect(reason("homeassistant.turn_on", "light.lamp")).toContain("safety rules");
  });

  it("allows only the listed services on restricted domains", () => {
    expect(ok("lock.open", "lock.front")).toBe(false);
    expect(ok("scene.create", "scene.evening")).toBe(false);
    expect(ok("script.reload", "script.good_night")).toBe(false);
    expect(ok("automation.reload", "automation.lights")).toBe(false);
    expect(ok("input_number.increment", "input_number.target")).toBe(false);
    expect(ok("vacuum.clean_spot", "vacuum.robot")).toBe(false);
    expect(reason("lock.open", "lock.front")).toContain("lock, unlock");
  });

  it("blocks dangerous service names even in domains that allow any service", () => {
    for (const name of ["reload", "reload_all", "restart", "stop", "shutdown", "reboot", "remove_entry", "delete_user", "purge_keep_days", "install"]) {
      expect(ok(`light.${name}`, "light.lamp"), name).toBe(false);
      expect(ok(`media_player.${name}`, "media_player.tv"), name).toBe(false);
    }
    expect(reason("light.reload", "light.lamp")).toContain("never allowed");
  });

  it("keeps stop_cover and the vacuum's own stop, which are different from a bare stop", () => {
    expect(dangerousServiceName("stop")).toBe(true);
    expect(dangerousServiceName("stop_cover")).toBe(false);
    expect(ok("cover.stop_cover", "cover.blind")).toBe(true);
    expect(ok("vacuum.stop", "vacuum.robot")).toBe(true);
  });

  it("refuses domains that are not on the list", () => {
    expect(ok("notify.mobile_app_phone", "notify.mobile_app_phone")).toBe(false);
    expect(ok("camera.turn_off", "camera.porch")).toBe(false);
    expect(ok("alarm_control_panel.alarm_disarm", "alarm_control_panel.house")).toBe(false);
    expect(ok("input_text.set_value", "input_text.note")).toBe(false);
  });

  it("blocks every admin domain with or without a target", () => {
    for (const domain of BLOCKED_BUTTON_DOMAINS) {
      expect(ok(`${domain}.anything`), domain).toBe(false);
      expect(ok(`${domain}.anything`, `${domain}.x`), domain).toBe(false);
    }
    for (const service of ["hassio.host_shutdown", "hassio.addon_restart", "shell_command.reboot_pi", "python_script.cleanup", "pyscript.run", "command_line.reload", "rest_command.hook", "recorder.purge", "logger.set_level", "system_log.clear", "backup.create", "frontend.reload_themes", "update.install", "zha.permit", "zwave_js.reset_meter", "mqtt.publish", "esphome.node_service"]) {
      expect(ok(service), service).toBe(false);
    }
  });
});

describe("button actions without a target", () => {
  it("allows calling a script that exists, and a persistent notification", () => {
    expect(ok("script.good_night")).toBe(true);
    expect(ok("persistent_notification.create")).toBe(true);
  });

  it("refuses a script that does not exist, and the script domain's own services", () => {
    expect(ok("script.missing")).toBe(false);
    expect(reason("script.missing")).toContain("isn't a script");
    // script.turn_on is a service of the domain, not a script, even if an entity is named like it.
    expect(ok("script.turn_on")).toBe(false);
    expect(ok("script.reload")).toBe(false);
  });

  it("needs a target for services that act on an entity", () => {
    expect(ok("scene.turn_on")).toBe(false);
    expect(reason("scene.turn_on")).toContain("needs a scene entity");
    expect(ok("light.turn_off")).toBe(false);
  });

  it("refuses everything else, notify included", () => {
    for (const service of ["notify.notify", "notify.mobile_app_phone", "persistent_notification.dismiss", "persistent_notification.dismiss_all", "tts.speak", "input_text.set_value", "light.reload"]) {
      expect(ok(service), service).toBe(false);
    }
  });
});

describe("what the page offers", () => {
  const services = ["light.turn_on", "light.toggle", "light.reload", "switch.toggle", "script.good_night", "script.turn_on", "persistent_notification.create", "persistent_notification.dismiss", "homeassistant.restart", "homeassistant.turn_on", "notify.notify"];

  it("lists only allowed services for a chosen entity", () => {
    expect(offeredButtonServices(services, "light.lamp", ENTITIES)).toEqual(["light.turn_on", "light.toggle"]);
    expect(offeredButtonServices(services, "script.good_night", ENTITIES)).toEqual(["script.turn_on"]);
  });

  it("lists only targetless scripts and the notification without a target", () => {
    expect(offeredButtonServices(services, null, ENTITIES)).toEqual(["script.good_night", "persistent_notification.create"]);
  });

  it("picks a sensible default that is allowed and exists, or nothing", () => {
    expect(defaultButtonService("light", services)).toBe("light.toggle");
    expect(defaultButtonService("script", services)).toBe("script.turn_on");
    expect(defaultButtonService("scene", ["scene.turn_on"])).toBe("scene.turn_on");
    expect(defaultButtonService("automation", ["automation.trigger"])).toBe("automation.trigger");
    expect(defaultButtonService("input_button", ["input_button.press"])).toBe("input_button.press");
    expect(defaultButtonService("lock", ["lock.lock"])).toBe("");
    expect(defaultButtonService("homeassistant", services)).toBe("");
    expect(defaultButtonService("light", [])).toBe("");
  });

  it("knows which domains can be targets", () => {
    expect(buttonTargetDomains()).toEqual(Object.keys(BUTTON_ENTITY_SERVICES));
    expect(buttonTargetDomains()).not.toContain("homeassistant");
    expect(domainAllowsService("light", "light.toggle")).toBe(true);
    expect(domainAllowsService("light", "switch.toggle")).toBe(false);
    expect(domainAllowsService("homeassistant", "homeassistant.toggle")).toBe(false);
  });
});

describe("blocked bindings in a stored map", () => {
  const binding = (key: string, action: ButtonAction) => ({ key, controlId: "device:r", gestureKey: key, button: "1", gesture: "Press", trigger: {}, action, enabled: true });
  const map = (actions: ButtonAction[]): ButtonMap => ({ version: 1, output: "light.lamp", bindings: actions.map((a, i) => binding(`k${i}`, a)), expected: null, allowExisting: false });

  it("lists each refused binding with its reason and leaves allowed ones out", () => {
    const blocked = blockedBindings(map([act("light.toggle", "light.lamp"), act("light.reload", "light.lamp"), act("homeassistant.restart")]), ENTITIES);
    expect(blocked.map((b) => b.key)).toEqual(["k1", "k2"]);
    expect(blocked.every((b) => b.reason.includes("safety rules"))).toBe(true);
  });

  it("lists nothing for a clean map", () => {
    expect(blockedBindings(map([act("light.toggle", "light.lamp")]), ENTITIES)).toEqual([]);
  });
});
