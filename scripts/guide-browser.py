"""House-guide flows against the isolated mock. All writes are intercepted."""
import copy
import json
import re
import unittest
import urllib.request
from playwright.sync_api import expect, sync_playwright
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
        self.recipe_snapshot = None
        self.applies, self.parameter_puts, self.recipe_reads = [], [], []
        self.parameters = {"house": {"night_brightness": 11}, "types": {}, "areas": {"kitchen": {"hold_timeout": 3}}}
        self.controllers = {"ok": True, "controllers": [], "unreadable": 0}
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
        def parameters(route):
            if route.request.method == "PUT":
                self.parameters = route.request.post_data_json
                self.parameter_puts.append(self.parameters)
            route.fulfill(json={"ok": True, "parameters": self.parameters, "revision": str(len(self.parameter_puts))})
        self.page.route("**/api/settings/parameters", parameters)
        self.page.route("**/api/health/room-light-controllers*", lambda route: route.fulfill(json=self.controllers))
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
            self.recipe_reads.append(route.request.url)
            if self.read_failure:
                route.fulfill(status=502, json={"ok": False, "error": "Fixture blueprint read failed"})
            else:
                snapshot = self.recipe_snapshot or self.body["hierarchy"]["fetchedAt"]
                route.fulfill(json={"ok": True, "installed": copy.deepcopy(self.installed), "fetchedAt": snapshot})
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
        def apply(route):
            self.applies.append(route.request.post_data_json)
            done = []
            for item in self.queued:
                target = item["targetId"]
                fields = item["after"]
                if item["kind"] == "blueprint":
                    self.installed["blueprints"][fields["path"]] = fields["version"]
                elif item["kind"] == "automation":
                    ub = fields["use_blueprint"]
                    self.installed["automations"][target] = {"alias": fields["alias"], "path": ub["path"], "input": ub["input"], "runtimeState": "on"}
                    self.ensure_entity("automation." + target, "automation", "automation", state="on")
                elif item["kind"] == "helper":
                    helper = fields.get("helper") or target.split(".")[0]
                    role, dc = ("light", None) if target.startswith("light.") else ("motion", "motion") if fields.get("device_class") == "motion" or "motion" in target else ("presence", "occupancy") if target.startswith("binary_sensor.") else ("helper", None)
                    self.ensure_entity(target, role, helper, dc, fields.get("entities"), "idle" if helper == "timer" else "off")
                    if helper == "timer":
                        duration = fields["duration"]
                        if isinstance(duration, str):
                            hours, minutes, seconds = map(int, duration.split(":"))
                            duration = hours * 3600 + minutes * 60 + seconds
                        self.installed["timers"][target] = duration
                elif item["kind"] == "entity":
                    h = self.body["hierarchy"]
                    old = h["entities"][target]["areaId"]
                    new = fields["area_id"]
                    if old:
                        h["areas"][old]["entityIds"].remove(target)
                    if new:
                        h["areas"][new]["entityIds"].append(target)
                    h["entities"][target].update(areaId=new, ownAreaId=new)
                done.append({"changeId": item["id"], "ok": True, "message": "Applied.", "status": "verified"})
            self.queued.clear()
            self.body["hierarchy"]["fetchedAt"] = "2026-11-18T14:00:0%d.000Z" % len(self.applies)
            route.fulfill(json={"ok": True, "backup": {"made": False}, "results": done})
        self.page.route("**/api/apply", apply)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.unexpected, [])
        self.assertEqual(self.errors, [])

    def add_entity(self, entity_id, role, dc=None, platform="demo", members=None):
        h = self.body["hierarchy"]
        h["entities"][entity_id] = {**copy.deepcopy(self.entity_base), "entityId": entity_id, "name": entity_id, "domain": entity_id.split(".")[0], "role": role, "deviceClass": dc, "deviceClassOverride": None, "platform": platform, "members": members or [], "areaId": "living_room", "ownAreaId": "living_room", "deviceId": None, "configEntryId": "fixture", "state": "off", "disabled": False, "hidden": False, "maintenance": False, "labels": [], "inRegistry": True}
        h["areas"]["living_room"]["entityIds"].append(entity_id)

    def ensure_entity(self, entity_id, role, platform, dc=None, members=None, state="off"):
        if entity_id not in self.body["hierarchy"]["entities"]:
            self.add_entity(entity_id, role, dc, platform, members)
        entity = self.body["hierarchy"]["entities"][entity_id]
        entity["state"] = state
        if members is not None:
            entity["members"] = members

    def selected(self):
        self.prefs["areas"]["living_room"] = {"profile": "living", "goals": ["lighting"]}

    def open(self, area=False):
        self.page.goto(BASE + ("/#guide/living_room" if area else "/#guide"), wait_until="networkidle")
        if area:
            self.page.get_by_role("button", name="Confirm equipment", exact=True).wait_for()
        else:
            self.page.get_by_text("Whole-house guide", exact=True).click()

    def step(self, name):
        self.page.get_by_role("button", name=name, exact=True).click()
        return self.page.get_by_role("region", name=name, exact=True)

    def confirm_equipment(self):
        panel = self.step("Confirm equipment")
        panel.get_by_role("button", name="Confirm room equipment", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Room equipment confirmed").wait_for()
        return self.page.get_by_role("region", name="Choose an outcome", exact=True)

    def open_plan(self):
        self.open(True)
        self.confirm_equipment()
        self.puts.clear()
        return self.step("Review what will happen")

    def apply_changes(self, panel):
        panel.get_by_role("button", name="Review queued changes", exact=True).click()
        self.page.get_by_role("heading", name="Changes", exact=True).wait_for()
        self.page.get_by_role("button", name=re.compile(r"^Apply \d+ changes? to Home Assistant$")).click()
        self.assertGreater(len(self.queued), 0)
        self.page.get_by_role("button", name="Confirm and apply", exact=True).click()
        self.page.get_by_text("No changes waiting", exact=True).wait_for()
        self.page.get_by_role("button", name=re.compile(r"^Back to Living room$", re.I)).click()
        self.page.get_by_role("button", name="Verify installation", exact=True).wait_for()

    def test_seven_setup_instructions_and_live_plans_are_connected(self):
        self.open()
        self.page.get_by_role("heading", name="How Taxis builds your home", exact=True).wait_for()
        steps = self.page.get_by_role("list", name="Steps", exact=True)
        self.assertEqual(steps.get_by_role("listitem").count(), 7)
        titles = steps.locator(":scope > li > div > div > h3 > button")
        self.assertEqual(titles.count(), 7)
        previous = None
        for title in titles.all():
            expect(title).to_have_attribute("aria-expanded", "false")
            title.click()
            expect(title).to_have_attribute("aria-expanded", "true")
            if previous is not None:
                expect(previous).to_have_attribute("aria-expanded", "false")
            self.assertEqual(steps.get_by_text("What to do and why", exact=True).count(), 1)
            previous = title
        areas_title = titles.nth(0)
        areas_title.click()
        link = steps.get_by_role("link", name="Home Assistant labels", exact=True)
        self.assertIn("home-assistant.io/docs/organizing/labels/", link.get_attribute("href"))
        self.context.route("https://www.home-assistant.io/**", lambda route: route.abort())
        with self.context.expect_page() as popup_info:
            link.click()
        popup_info.value.close()
        expect(areas_title).to_have_attribute("aria-expanded", "true")
        entities_title = titles.nth(1)
        entities_title.click()
        self.page.get_by_text("Equipment by area", exact=True).click()
        expect(entities_title).to_have_attribute("aria-expanded", "true")
        self.assertIn("No included motion or presence sensor", steps.inner_text())
        titles.nth(4).click()
        expect(entities_title).to_have_attribute("aria-expanded", "false")
        self.page.get_by_text("Current helper plan", exact=True).click()
        self.assertIn("light.living_all", steps.inner_text())
        self.assertIn("Review, build and verify", self.page.locator("body").inner_text())
        self.assertIn("Buttons and remotes are a later phase", self.page.locator("body").inner_text())
        self.assertEqual(self.puts, [])
        self.assertEqual(self.posts, [])

    def test_room_purpose_and_chosen_goals_save_reload_and_preserve_other_areas(self):
        self.prefs["areas"]["kitchen"] = {"profile": "kitchen", "goals": ["appliances"]}
        self.open(True)
        outcome = self.confirm_equipment()
        outcome.get_by_label("Room type", exact=True).select_option("bedroom")
        outcome.get_by_role("checkbox", name="Comfortable automatic lighting", exact=True).check()
        outcome.get_by_role("checkbox", name=re.compile("Gentle night lighting")).check()
        self.assertEqual(len(self.puts), 1)
        outcome.get_by_role("button", name="Review selected outcomes", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Room outcome saved").wait_for()
        self.assertEqual(self.puts[1]["revision"], "1")
        self.assertEqual(self.prefs["areas"]["living_room"], {"profile": "bedroom", "goals": ["lighting", "night"]})
        self.assertEqual(self.prefs["areas"]["kitchen"], {"profile": "kitchen", "goals": ["appliances"]})
        self.page.reload(wait_until="networkidle")
        outcome = self.step("Choose an outcome")
        self.assertEqual(outcome.get_by_label("Room type", exact=True).input_value(), "bedroom")
        self.assertTrue(outcome.get_by_role("checkbox", name=re.compile("Gentle night lighting")).is_checked())
        self.assertEqual(self.posts, [])

    def test_organize_equipment_and_resume_without_an_automation_goal(self):
        self.open(True)
        outcome = self.confirm_equipment()
        outcome.get_by_role("button", name="Organize equipment only", exact=True).click()
        expect(self.page.get_by_text("Equipment organized", exact=True)).to_be_visible()
        self.page.get_by_role("navigation", name="Room navigation").get_by_role("button", name="Home", exact=True).click()
        self.page.get_by_role("button", name=re.compile(r"^Resume Living room$", re.I)).click()
        expect(self.page.get_by_text("Equipment organized", exact=True)).to_be_visible()
        expect(self.page.get_by_role("button", name="Review what will happen", exact=True)).to_have_count(0)
        self.assertEqual(self.posts, [])

    def test_correct_assignment_uses_changes_before_equipment_confirmation(self):
        self.open(True)
        self.page.get_by_text("Correct an equipment assignment", exact=True).click()
        self.page.get_by_label("Equipment to move", exact=True).select_option("light.living_bulb")
        self.page.get_by_label("Destination room", exact=True).select_option("kitchen")
        self.page.get_by_role("button", name="Add assignment to changes", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Added to the list of changes").wait_for()
        self.assertEqual(self.posts[0]["fields"]["area_id"], "kitchen")
        self.assertEqual(self.posts[0]["targetId"], "light.living_bulb")
        expect(self.page.get_by_role("button", name="Review assignment in Changes", exact=True)).to_be_visible()
        self.assertEqual(self.applies, [])
        self.assertEqual(self.puts, [])

    def test_night_lighting_through_room_picker_settings_review_apply_verify_and_resume(self):
        self.controllers = {"ok": True, "controllers": [
            {"id": "entry_evening", "entityId": "automation.entry_evening", "name": "Evening trip", "lights": ["light.living_bulb"]},
        ], "unreadable": 1}
        self.page.goto(BASE + "/#guide", wait_until="networkidle")
        self.page.get_by_role("button", name="Choose a room", exact=True).click()
        self.page.get_by_label("Search rooms", exact=True).fill("Living room")
        self.page.get_by_role("button", name=re.compile(r"^Living room", re.I)).click()
        outcome = self.confirm_equipment()
        outcome.get_by_role("checkbox", name=re.compile("Gentle night lighting")).check()
        outcome.get_by_role("button", name="Review selected outcomes", exact=True).click()
        review = self.page.get_by_role("region", name="Review what will happen", exact=True)
        behavior = review.get_by_role("region", name="Planned lighting behavior", exact=True)
        expect(behavior.get_by_text("binary_sensor.living_pir", exact=True)).to_be_visible()
        expect(review.get_by_text("Evening trip controls light.living_bulb.", exact=True)).to_be_visible()
        expect(review.get_by_text(re.compile("1 automations or scripts were unreadable"))).to_be_visible()
        tune = review.get_by_role("region", name="Adjust room lighting", exact=True)
        tune.get_by_role("checkbox", name="light.living_bulb", exact=True).check()
        tune.get_by_label("Night brightness (%)", exact=True).fill("7")
        tune.get_by_label("How long to keep occupancy (min)", exact=True).fill("2")
        occupancy = review.get_by_role("button", name="Add Occupancy to changes", exact=True)
        expect(occupancy).to_be_disabled()
        expect(review.get_by_text("Save or discard the room lighting edits before proposing changes.", exact=True)).to_be_visible()
        tune.get_by_role("button", name="Save room lighting settings", exact=True).click()
        expect(behavior.get_by_text(re.compile("light.living_bulb can come on at 7%"))).to_be_visible()
        expect(behavior.get_by_text(re.compile("normally holds for 2 min"))).to_be_visible()
        self.assertEqual(self.parameters["areas"]["living_room"], {"night_brightness": 7, "hold_timeout": 2, "night_lights": ["light.living_bulb"]})
        self.assertEqual(self.parameters["areas"]["kitchen"], {"hold_timeout": 3})
        self.assertEqual(self.parameters["house"], {"night_brightness": 11})
        self.assertEqual(self.posts, [])
        self.page.locator("main").evaluate("(main) => { main.scrollTop = 0; }")
        self.page.screenshot(path=str(screenshot_dir() / "room-lighting-review.png"))

        helpers = review.get_by_role("button", name="Add helper to changes", exact=True)
        for remaining in range(helpers.count(), 0, -1):
            helpers.first.click()
            expect(helpers).to_have_count(remaining - 1)
        occupancy.click()
        motion = review.get_by_role("button", name="Add Motion lights to changes", exact=True)
        expect(motion).to_be_enabled()
        motion.click()
        expect(motion).to_have_count(0)
        expect(tune.get_by_label("Night brightness (%)", exact=True)).to_be_disabled()
        automation_fields = {item["fields"]["recipe"]: item["fields"]["use_blueprint"]["input"] for item in self.posts if item["kind"] == "automation"}
        self.assertEqual(automation_fields["occupancy"]["hold_minutes"], 2)
        self.assertEqual(automation_fields["motion_lights"]["night_brightness"], 7)
        self.assertEqual(automation_fields["motion_lights"]["night_lights"], ["light.living_bulb"])
        self.assertEqual(self.applies, [])
        self.apply_changes(review)
        installation = self.step("Verify installation")
        installation.get_by_role("button", name="Verify with Home Assistant", exact=True).click()
        expect(installation.get_by_text("Installed and enabled", exact=True)).to_have_count(2)
        self.assertTrue(any(url.endswith("refresh=1") for url in self.recipe_reads))
        expect(installation.get_by_text("Home Assistant reports the expected room setup installed and enabled.", exact=True)).to_be_visible()
        checks = self.step("Test in the room")
        self.assertNotIn("tests", self.prefs)
        expect(checks.get_by_role("button", name="Save room test record", exact=True)).to_be_disabled()
        for checkbox in checks.get_by_role("region", name="Room test checklist").get_by_role("checkbox").all():
            checkbox.check()
        checks.get_by_role("button", name="Save room test record", exact=True).click()
        expect(checks.get_by_text("Tested by you for the current configuration.", exact=True)).to_be_visible()
        self.page.get_by_role("navigation", name="Room navigation").get_by_role("button", name="Home", exact=True).click()
        self.page.get_by_role("button", name=re.compile(r"^Resume Living room$", re.I)).click()
        expect(self.page.get_by_role("button", name="Test in the room", exact=True)).to_have_attribute("aria-expanded", "true")
        checks.get_by_role("button", name="Adjust lights or duration", exact=True).click()
        tune.get_by_label("Night brightness (%)", exact=True).fill("9")
        tune.get_by_role("button", name="Save room lighting settings", exact=True).click()
        expect(review.get_by_text("The installed configuration needs an update for this plan.", exact=True)).to_be_visible()
        previous = self.step("Test in the room")
        expect(previous.get_by_text("Previous test needs a retest because the room configuration changed.", exact=True)).to_be_visible()
        self.assertEqual(len(self.applies), 1)

    def test_direct_mode_uses_confirmation_and_cancel_does_not_apply(self):
        self.selected()
        self.page.route("**/api/settings/general", lambda route: route.fulfill(json={
            "ok": True, "general": {"reviewChangesBeforeApplying": False}, "revision": "0", "directEditingAvailable": True,
        }))
        captured = []
        def preview(route):
            captured.extend(route.request.post_data_json["changes"])
            changes = [{
                "id": index, "kind": item["kind"], "op": item["op"],
                "targetId": item["fields"].get("automation_id") or item["fields"].get("entity_id") or item["fields"].get("path"),
                "after": item["fields"], "scope": None, "before": {}, "createdAt": "2026-11-18T00:00:00Z",
            } for index, item in enumerate(captured)]
            route.fulfill(json={"ok": True, "changes": changes, "previewVersion": "fixture"})
        self.page.route("**/api/direct-preview", preview)
        plan = self.open_plan()
        plan.get_by_role("button", name="Preview Occupancy", exact=True).click()
        dialog = self.page.get_by_role("dialog", name="Review before applying", exact=True)
        expect(dialog.get_by_role("heading", name="Create automation taxis_occupancy_living", exact=True)).to_be_visible()
        dialog.get_by_role("button", name="Cancel", exact=True).click()
        expect(dialog).to_have_count(0)
        self.assertEqual(len([item for item in captured if item["kind"] == "automation"]), 1)
        self.assertEqual(self.posts, [])
        self.assertEqual(self.applies, [])

    def test_failed_installation_read_stays_unknown_and_can_be_retried(self):
        self.selected()
        self.read_failure = True
        self.open(True)
        self.confirm_equipment()
        self.puts.clear()
        verification = self.step("Verify installation")
        verification.get_by_role("alert").filter(has_text="Installation status is unknown").wait_for()
        self.read_failure = False
        verification.get_by_role("button", name="Verify with Home Assistant", exact=True).click()
        plan = self.step("Review what will happen")
        expect(plan.get_by_role("button", name="Add Occupancy to changes", exact=True)).to_be_enabled()
        self.assertEqual(self.posts, [])

    def test_explicit_verification_does_not_reuse_stale_installed_configuration(self):
        self.ready_room()
        verification = self.step("Verify installation")
        expect(verification.get_by_text("Installed and enabled", exact=True)).to_be_visible()
        self.read_failure = True
        verification.get_by_role("button", name="Verify with Home Assistant", exact=True).click()
        expect(verification.get_by_role("alert").filter(has_text="Fixture blueprint read failed")).to_be_visible()
        expect(verification.get_by_text("Installed and enabled", exact=True)).to_have_count(0)
        self.assertTrue(self.recipe_reads[-1].endswith("refresh=1"))
        checks = self.step("Test in the room")
        expect(checks.get_by_role("button", name="Save room test record", exact=True)).to_be_disabled()

    def test_verification_ignores_configuration_for_a_different_hierarchy_snapshot(self):
        self.ready_room()
        verification = self.step("Verify installation")
        expect(verification.get_by_text("Installed and enabled", exact=True)).to_be_visible()
        self.recipe_snapshot = self.body["hierarchy"]["fetchedAt"]
        self.body["hierarchy"]["fetchedAt"] = "2026-11-18T14:40:00.000Z"
        verification.get_by_role("button", name="Verify with Home Assistant", exact=True).click()
        expect(verification.get_by_role("alert").filter(has_text="The Home Assistant view changed during the read")).to_be_visible()
        expect(verification.get_by_text("Installed and enabled", exact=True)).to_have_count(0)
        self.assertTrue(any(url.endswith("refresh=1") for url in self.recipe_reads))
        self.recipe_snapshot = None
        verification.get_by_role("button", name="Verify with Home Assistant", exact=True).click()
        expect(verification.get_by_text("Installed and enabled", exact=True)).to_be_visible()

    def test_unavailable_sources_are_reviewed_without_claiming_that_equipment_is_absent(self):
        self.selected()
        self.body["hierarchy"]["entities"]["binary_sensor.living_pir"]["state"] = "unavailable"
        plan = self.open_plan()
        equipment = plan.get_by_role("region", name="Equipment readiness", exact=True)
        activity = equipment.get_by_role("listitem").filter(has_text="Motion, presence or an opted-in TV").first
        self.assertIn("Review existing entities", activity.inner_text())
        self.assertIn("before buying anything", activity.inner_text())
        self.assertNotIn("Needed for this outcome", activity.inner_text())

    def test_stale_goal_save_retains_the_draft_and_does_not_queue_anything(self):
        self.selected()
        self.open(True)
        outcome = self.confirm_equipment()
        self.puts.clear()
        self.fail_save = True
        outcome.get_by_label("Room type", exact=True).select_option("hallway")
        outcome.get_by_role("button", name="Review selected outcomes", exact=True).click()
        outcome.get_by_role("alert").filter(has_text="changed in another session").wait_for()
        self.assertEqual(outcome.get_by_label("Room type", exact=True).input_value(), "hallway")
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
        plan = self.open_plan()
        plan.get_by_role("button", name="Add Occupancy to changes", exact=True).click()
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
        self.page.get_by_role("status").filter(has_text="Room test record saved").wait_for()
        record = copy.deepcopy(self.prefs["tests"]["living_room"])
        self.assertEqual(len(record["checked"]), 3)
        self.assertTrue(record["configuration"].startswith("room-v1-"))
        self.assertEqual(self.prefs["areas"]["living_room"]["goals"], ["occupancy"])
        self.page.reload(wait_until="networkidle")
        checks.get_by_text("Tested by you for the current configuration.", exact=True).wait_for()
        self.body["hierarchy"]["entities"]["binary_sensor.living_pir"]["deviceId"] = "replacement"
        self.page.reload(wait_until="networkidle")
        self.step("Test in the room")
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
        checks = self.step("Test in the room").get_by_role("region", name="Room test checklist", exact=True)
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
        outcome = self.step("Choose an outcome")
        outcome.get_by_label("Room type", exact=True).select_option("bedroom")
        dialogs = []
        def dismiss(dialog):
            dialogs.append(dialog.message)
            dialog.dismiss()
        self.page.once("dialog", dismiss)
        self.page.get_by_role("button", name="All rooms", exact=True).click()
        self.assertEqual(len(dialogs), 1)
        self.assertTrue(self.page.url.endswith("#guide/living_room"))
        self.page.get_by_role("button", name="Undo outcome edits", exact=True).click()
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        output = screenshot_dir()
        output.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(output / "house-guide-mobile.png"), full_page=True)
        self.assertEqual(self.posts, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
