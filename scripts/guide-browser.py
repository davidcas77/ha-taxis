"""House-guide flows against the isolated mock. All writes are intercepted."""
import copy
import json
import os
from pathlib import Path
import unittest
import urllib.request
from playwright.sync_api import sync_playwright
from browser_common import BASE, launch, screenshot_dir



class GuideRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urllib.request.urlopen(BASE + "/api/hierarchy", timeout=20) as response:
            cls.original = json.load(response)
        if not cls.original.get("ok") or "kitchen" not in cls.original["hierarchy"]["areas"]:
            raise RuntimeError("Use the documented dummy HA, not live HA")
        with urllib.request.urlopen(BASE + "/api/settings/naming", timeout=20) as response:
            cls.naming = json.load(response)["naming"]
        cls.pw = sync_playwright().start()
        cls.browser = launch(cls.pw)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1100}, color_scheme="dark")
        self.page = self.context.new_page()
        self.page.set_default_timeout(10000)
        self.body = copy.deepcopy(self.original)
        h = self.body["hierarchy"]
        self.entity_base = copy.deepcopy(next(iter(h["entities"].values())))
        h["entities"], h["devices"] = {}, {}
        for area in h["areas"].values():
            area["entityIds"], area["deviceIds"] = [], []
        self.add_entity("light.living_bulb", "light")
        self.add_entity("binary_sensor.living_pir", "motion", "motion")
        self.prefs = {"areas": {}}
        self.queued, self.puts, self.posts, self.unexpected, self.errors = [], [], [], [], []
        self.read_failure = False
        self.installed = {"blueprints": {}, "automations": {}, "scripts": {}, "timers": {}, "controllers": {}}
        self.fail_save = False
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        def guard(route):
            if route.request.method in ["GET", "HEAD"]:
                route.continue_()
            else:
                self.unexpected.append(route.request.url)
                route.fulfill(status=409, json={"ok": False, "error": "Unexpected live write blocked"})
        self.page.route("**/api/**", guard)
        self.page.route("**/api/hierarchy*", lambda route: route.fulfill(json=copy.deepcopy(self.body)))
        names = {**copy.deepcopy(self.naming), "areaCodes": {"living_room": "living"}, "helperNames": {}}
        names.pop("aggregationMarkers", None)
        self.page.route("**/api/settings/naming", lambda route: route.fulfill(json={"ok": True, "naming": names, "revision": "0"}))
        self.page.route("**/api/settings/inventory", lambda route: route.fulfill(json={"ok": True, "inventory": {"entities": {}, "areas": {}}, "revision": "0"}))
        self.page.route("**/api/settings/parameters", lambda route: route.fulfill(json={"ok": True, "parameters": {"house": {}, "types": {}, "areas": {}}, "revision": "0"}))
        def preferences(route):
            if route.request.method == "PUT":
                self.puts.append({"body": route.request.post_data_json, "revision": route.request.headers.get("if-match")})
                if self.fail_save:
                    route.fulfill(status=409, json={"ok": False, "error": "These settings changed in another session. Reload before saving."})
                    return
                self.prefs = copy.deepcopy(route.request.post_data_json)
            route.fulfill(json={"ok": True, "guide": self.prefs, "revision": str(len(self.puts))})
        self.page.route("**/api/settings/guide", preferences)
        def recipes(route):
            if self.read_failure:
                route.fulfill(status=502, json={"ok": False, "error": "Fixture blueprint read failed"})
            else:
                route.fulfill(json={"ok": True, "installed": copy.deepcopy(self.installed)})
        self.page.route("**/api/recipes/state*", recipes)
        def changes(route):
            if route.request.method == "POST":
                body = route.request.post_data_json
                # One edit goes to /api/changes; several edits go in one request to /api/changes/batch.
                for item in body["changes"] if "changes" in body else [body]:
                    self.posts.append(item)
                    fields = item.get("fields", {})
                    self.queued.append({"id": len(self.queued) + 1, "kind": item["kind"], "op": item["op"], "targetId": item.get("targetId") or fields.get("entity_id") or fields.get("automation_id") or fields.get("path") or "fixture", "scope": None, "before": {}, "after": fields, "createdAt": "2026-10-28T00:00:00Z"})
            route.fulfill(json={"ok": True, "changes": self.queued, "version": str(len(self.queued))})
        self.page.route("**/api/changes", changes)
        self.page.route("**/api/changes/batch", changes)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.unexpected, [])
        self.assertEqual(self.errors, [])

    def add_entity(self, entity_id, role, dc=None, platform="demo", members=None):
        h = self.body["hierarchy"]
        h["entities"][entity_id] = {**copy.deepcopy(self.entity_base), "entityId": entity_id, "name": entity_id, "domain": entity_id.split(".")[0], "role": role, "deviceClass": dc, "deviceClassOverride": None, "platform": platform, "members": members or [], "areaId": "living_room", "ownAreaId": "living_room", "deviceId": None, "configEntryId": "fixture", "state": "off", "disabled": False, "hidden": False, "maintenance": False, "labels": [], "inRegistry": True}
        h["areas"]["living_room"]["entityIds"].append(entity_id)

    def selected(self):
        self.prefs["areas"]["living_room"] = {"profile": "living", "goals": ["lighting"]}

    def open(self, area=False):
        self.page.goto(BASE + ("/#guide/living_room" if area else "/#guide"), wait_until="networkidle")
        if not area:
            self.page.get_by_text("Room-by-room goals and testing", exact=True).click()
        # The Guide opens with the path to a complete home; the room-by-room guide is below it.
        self.page.get_by_role("heading", name="Choose this area's purpose" if area else "Room by room", exact=True).wait_for()
        if area:
            self.page.get_by_role("region", name="Area goals", exact=True).wait_for()
        else:
            self.page.get_by_role("region", name="Area readiness", exact=True).wait_for()

    def test_house_overview_does_not_invent_goals_or_write_on_open(self):
        self.open()
        region = self.page.get_by_role("region", name="Area readiness", exact=True)
        self.assertEqual(region.get_by_role("button").count(), len(self.body["hierarchy"]["areas"]))
        self.assertIn("Choose room type and goals", region.inner_text())
        self.assertEqual(self.puts, [])
        self.assertEqual(self.posts, [])
        self.assertGreater(self.page.get_by_role("region", name="Automation ideas", exact=True).get_by_role("link").count(), 1)

    def test_seven_setup_instructions_and_live_plans_are_connected(self):
        self.open()
        self.page.get_by_role("heading", name="How Taxis builds your home", exact=True).wait_for()
        steps = self.page.get_by_role("list", name="Steps", exact=True)
        self.assertEqual(steps.get_by_role("listitem").count(), 7)
        instructions = steps.get_by_text("What to do and why", exact=True)
        self.assertEqual(instructions.count(), 7)
        for item in instructions.all():
            item.click()
        self.page.get_by_text("Equipment by area", exact=True).click()
        self.assertIn("No counted motion or presence sensor", steps.inner_text())
        self.page.get_by_text("Current helper plan by area, floor and house", exact=True).click()
        self.assertIn("light.living_all", steps.inner_text())
        self.assertIn("Review, build and verify", self.page.locator("body").inner_text())
        self.assertIn("Buttons and remotes are a later phase", self.page.locator("body").inner_text())
        self.assertEqual(self.puts, [])
        self.assertEqual(self.posts, [])

    def test_room_purpose_and_chosen_goals_save_reload_and_preserve_other_areas(self):
        self.prefs["areas"]["kitchen"] = {"profile": "kitchen", "goals": ["appliances"]}
        self.open(True)
        self.page.get_by_label("Room type", exact=True).select_option("bedroom")
        self.page.get_by_role("checkbox", name="Comfortable room climate", exact=True).uncheck()
        self.assertEqual(self.puts, [])
        self.page.get_by_role("button", name="Save area goals", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Area goals saved in Taxis").wait_for()
        self.assertEqual(self.puts[0]["revision"], "0")
        self.assertEqual(self.prefs["areas"]["living_room"], {"profile": "bedroom", "goals": ["lighting", "night"]})
        self.assertEqual(self.prefs["areas"]["kitchen"], {"profile": "kitchen", "goals": ["appliances"]})
        self.page.reload(wait_until="networkidle")
        self.assertEqual(self.page.get_by_label("Room type", exact=True).input_value(), "bedroom")
        self.assertTrue(self.page.get_by_role("checkbox", name="Gentle night lighting", exact=True).is_checked())
        self.assertEqual(self.posts, [])

    def test_saved_goals_show_real_helper_ids_and_queue_only_the_selected_helper(self):
        self.selected()
        self.open(True)
        helpers = self.page.get_by_role("region", name="Required helpers", exact=True)
        light = helpers.get_by_role("listitem").filter(has_text="light.living_all").first
        self.assertIn("Missing", light.inner_text())
        light.get_by_role("button", name="Add helper to changes", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Added to the list of changes").wait_for()
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.posts[0]["fields"]["entity_id"], "light.living_all")
        self.assertEqual(self.posts[0]["fields"]["entities"], ["light.living_bulb"])
        self.assertIn("In changes", light.inner_text())
        self.assertNotIn("light.living_all", self.body["hierarchy"]["entities"])
        self.assertEqual(self.puts, [])

    def test_occupancy_preparation_queues_native_blueprint_and_helpers_without_apply(self):
        self.selected()
        self.open(True)
        recipes = self.page.get_by_role("region", name="Guided automations", exact=True)
        recipes.get_by_role("button", name="Add Occupancy to changes", exact=True).click()
        self.page.get_by_role("status").filter(has_text="changes added to the list").wait_for()
        self.assertEqual(sum(item["kind"] == "automation" for item in self.posts), 1)
        self.assertTrue(any(item["kind"] == "blueprint" for item in self.posts))
        self.assertTrue(any(item["kind"] == "helper" for item in self.posts))
        self.assertIn("not installed yet", recipes.inner_text())
        self.assertEqual(self.puts, [])

    def test_failed_installation_read_stays_unknown_and_can_be_retried(self):
        self.selected()
        self.read_failure = True
        self.open(True)
        self.page.get_by_role("alert").filter(has_text="Installation readiness is unknown").wait_for()
        recipes = self.page.get_by_role("region", name="Guided automations", exact=True)
        self.assertIn("Installation status unknown", recipes.inner_text())
        self.assertEqual(recipes.get_by_role("button").count(), 1)  # navigation only
        self.read_failure = False
        self.page.get_by_role("button", name="Retry reading automations", exact=True).click()
        recipes.get_by_role("button", name="Add Occupancy to changes", exact=True).wait_for()
        self.assertEqual(self.posts, [])

    def test_unavailable_sources_are_reviewed_without_claiming_that_equipment_is_absent(self):
        self.selected()
        self.body["hierarchy"]["entities"]["binary_sensor.living_pir"]["state"] = "unavailable"
        self.open(True)
        equipment = self.page.get_by_role("region", name="Equipment readiness", exact=True)
        activity = equipment.get_by_role("listitem").filter(has_text="Motion or presence detection").first
        self.assertIn("Review existing entities", activity.inner_text())
        self.assertIn("before buying anything", activity.inner_text())
        self.assertNotIn("Needed for this goal", activity.inner_text())

    def test_stale_goal_save_retains_the_draft_and_does_not_queue_anything(self):
        self.selected()
        self.fail_save = True
        self.open(True)
        self.page.get_by_label("Room type", exact=True).select_option("hallway")
        self.page.get_by_role("button", name="Save area goals", exact=True).click()
        self.page.get_by_role("alert").filter(has_text="changed in another session").wait_for()
        self.assertEqual(self.page.get_by_label("Room type", exact=True).input_value(), "hallway")
        self.assertEqual(self.prefs["areas"]["living_room"]["profile"], "living")
        self.assertEqual(len(self.puts), 1)
        self.assertEqual(self.posts, [])

    def ready_room(self):
        self.selected()
        self.prefs["areas"]["living_room"]["goals"] = ["occupancy"]
        self.add_entity("binary_sensor.living_motion_all", "motion", "motion", "group", ["binary_sensor.living_pir"])
        self.add_entity("timer.living_hold", "helper", platform="timer")
        self.body["hierarchy"]["entities"]["timer.living_hold"]["state"] = "idle"
        self.add_entity("input_boolean.living_paused", "helper", platform="input_boolean")
        self.add_entity("binary_sensor.living_occupied", "presence", "occupancy", "template")
        self.add_entity("automation.taxis_occupancy_living", "automation", platform="automation")
        self.body["hierarchy"]["entities"]["automation.taxis_occupancy_living"]["state"] = "on"
        self.open(True)
        self.page.get_by_role("region", name="Guided automations", exact=True).get_by_role("button", name="Add Occupancy to changes", exact=True).click()
        self.page.get_by_role("status").filter(has_text="changes added to the list").wait_for()
        automation = next(item["fields"] for item in self.posts if item["kind"] == "automation")
        blueprint = next(item["fields"] for item in self.posts if item["kind"] == "blueprint")
        self.installed["blueprints"][blueprint["path"]] = blueprint["version"]
        self.installed["automations"][automation["automation_id"]] = {"alias": automation["alias"], "path": automation["use_blueprint"]["path"], "input": automation["use_blueprint"]["input"]}
        self.installed["timers"]["timer.living_hold"] = 300
        self.queued, self.posts = [], []
        self.page.reload(wait_until="networkidle")
        self.page.get_by_text("Ready for a room test", exact=True).wait_for()
        return self.page.get_by_role("region", name="Room test checklist", exact=True)

    def test_room_observations_save_reload_and_require_retest_after_sensor_replacement(self):
        checks = self.ready_room()
        self.assertEqual(checks.get_by_role("checkbox").count(), 3)
        for checkbox in checks.get_by_role("checkbox").all():
            checkbox.check()
        checks.get_by_label("Room test notes", exact=True).fill("Tested both entry paths and sitting still.")
        checks.get_by_role("button", name="Save room test record", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Room test record saved in Taxis").wait_for()
        record = copy.deepcopy(self.prefs["tests"]["living_room"])
        self.assertEqual(len(record["checked"]), 3)
        self.assertTrue(record["configuration"].startswith("room-v1-"))
        self.assertEqual(self.prefs["areas"]["living_room"]["goals"], ["occupancy"])
        self.page.reload(wait_until="networkidle")
        checks.get_by_text("Tested by you for the current configuration.", exact=True).wait_for()
        self.body["hierarchy"]["entities"]["binary_sensor.living_pir"]["deviceId"] = "replacement"
        self.page.reload(wait_until="networkidle")
        checks.get_by_text("Previous test needs a retest because the room configuration changed.", exact=True).wait_for()
        self.assertFalse(any(checkbox.is_checked() for checkbox in checks.get_by_role("checkbox").all()))
        self.assertEqual(self.prefs["tests"]["living_room"], record)
        self.assertEqual(self.posts, [])

    def test_room_observation_conflict_keeps_answers_and_notes_for_review(self):
        checks = self.ready_room()
        self.fail_save = True
        checks.get_by_role("checkbox").first.check()
        checks.get_by_label("Room test notes", exact=True).fill("Still working on coverage.")
        checks.get_by_role("button", name="Save room test record", exact=True).click()
        checks.get_by_role("alert").filter(has_text="changed in another session").wait_for()
        self.assertTrue(checks.get_by_role("checkbox").first.is_checked())
        self.assertEqual(checks.get_by_label("Room test notes", exact=True).input_value(), "Still working on coverage.")
        self.assertNotIn("tests", self.prefs)
        self.assertEqual(self.posts, [])

    def test_room_setup_refresh_preserves_dirty_observations_until_explicit_retest(self):
        checks = self.ready_room()
        checks.get_by_role("checkbox").first.check()
        checks.get_by_label("Room test notes", exact=True).fill("Keep these observations while refreshing.")
        self.body["hierarchy"]["entities"]["binary_sensor.living_pir"]["deviceId"] = "replacement"
        self.page.get_by_role("button", name="Refresh", exact=True).click()
        checks.get_by_role("alert").filter(has_text="Your draft is kept").wait_for()
        self.assertTrue(checks.get_by_role("checkbox").first.is_checked())
        self.assertEqual(checks.get_by_label("Room test notes", exact=True).input_value(), "Keep these observations while refreshing.")
        self.assertTrue(checks.get_by_role("button", name="Save room test record", exact=True).is_disabled())
        checks.get_by_role("button", name="Start new room test", exact=True).click()
        self.assertFalse(any(checkbox.is_checked() for checkbox in checks.get_by_role("checkbox").all()))
        self.assertEqual(checks.get_by_label("Room test notes", exact=True).input_value(), "")
        self.assertEqual(self.puts, [])
        self.assertEqual(self.posts, [])

    def test_uninstalled_room_cannot_be_recorded_as_physically_tested(self):
        self.selected()
        self.open(True)
        checks = self.page.get_by_role("region", name="Room test checklist", exact=True)
        self.assertTrue(checks.get_by_role("button", name="Save room test record", exact=True).is_disabled())
        self.assertTrue(all(checkbox.is_disabled() for checkbox in checks.get_by_role("checkbox").all()))
        self.assertEqual(self.puts, [])

    def test_house_modes_queue_only_one_native_switch_and_show_pending(self):
        self.open()
        modes = self.page.get_by_role("region", name="House modes", exact=True)
        self.assertIn("input_boolean.taxis_guest", modes.inner_text())
        modes.get_by_role("button", name="Add guest switch to changes", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Added to the list of changes").wait_for()
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.posts[0]["kind"], "helper")
        self.assertEqual(self.posts[0]["op"], "create")
        self.assertEqual(self.posts[0]["fields"]["helper"], "input_boolean")
        self.assertEqual(self.posts[0]["fields"]["entity_id"], "input_boolean.taxis_guest")
        self.assertIn("not live yet", modes.inner_text())
        self.assertEqual(modes.get_by_role("button", name="Add guest switch to changes", exact=True).count(), 0)
        self.assertEqual(self.puts, [])

    def test_existing_unavailable_guest_switch_is_reviewed_without_replacement(self):
        self.add_entity("input_boolean.taxis_guest", "helper", platform="input_boolean")
        self.body["hierarchy"]["entities"]["input_boolean.taxis_guest"]["state"] = "unavailable"
        self.open()
        modes = self.page.get_by_role("region", name="House modes", exact=True)
        self.assertIn("state cannot be used", modes.inner_text())
        self.assertEqual(modes.get_by_role("button", name="Add guest switch to changes", exact=True).count(), 0)
        self.assertEqual(self.posts, [])

    def test_mobile_layout_and_draft_navigation_guard(self):
        self.selected()
        self.open(True)
        self.page.get_by_label("Room type", exact=True).select_option("bedroom")
        dialogs = []
        def dismiss(dialog):
            dialogs.append(dialog.message)
            dialog.dismiss()
        self.page.once("dialog", dismiss)
        self.page.get_by_role("button", name="Back to the path", exact=True).click()
        self.assertEqual(len(dialogs), 1)
        self.assertTrue(self.page.url.endswith("#guide/living_room"))
        self.page.get_by_role("button", name="Undo", exact=True).click()
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        output = screenshot_dir()
        output.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(output / "house-guide-mobile.png"), full_page=True)
        self.assertEqual(self.posts, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
