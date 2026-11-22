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
        self.inventory = {"entities": {}, "areas": {}}
        self.inventory_puts = []
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
        def inventory(route):
            if route.request.method == "PUT":
                self.inventory = route.request.post_data_json
                self.inventory_puts.append(self.inventory)
            route.fulfill(json={"ok": True, "inventory": self.inventory, "revision": str(len(self.inventory_puts))})
        self.page.route("**/api/settings/inventory", inventory)
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

    def add_entity(self, entity_id, role, dc=None, platform="demo", members=None, name=None, area="living_room"):
        h = self.body["hierarchy"]
        h["entities"][entity_id] = {**copy.deepcopy(self.entity_base), "entityId": entity_id, "name": name or entity_id, "domain": entity_id.split(".")[0], "role": role, "deviceClass": dc, "deviceClassOverride": None, "platform": platform, "members": members or [], "areaId": area, "ownAreaId": area, "deviceId": None, "configEntryId": "fixture", "state": "off", "disabled": False, "hidden": False, "maintenance": False, "labels": [], "inRegistry": True}
        if area:
            h["areas"][area]["entityIds"].append(entity_id)

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
            self.page.get_by_role("heading", name="Automations", exact=True).wait_for()
        else:
            self.page.get_by_text("Whole-house guide", exact=True).click()

    def record(self, label):
        self.page.get_by_role("region", name="Records", exact=True).get_by_role("button", name=re.compile(r"^" + re.escape(label))).click()
        return self.page.get_by_role("region", name="Properties", exact=True)

    def plan(self):
        return self.page.get_by_role("region", name="Native Home Assistant plan", exact=True)

    def parameters_step(self, properties):
        properties.get_by_role("button", name="Continue to parameters", exact=False).click()
        expect(properties.get_by_role("navigation", name="Automation setup steps").get_by_role("button", name="Parameters", exact=True)).to_have_attribute("aria-current", "step")

    def open_plan(self, label="Automatic lighting"):
        self.open(True)
        properties = self.record(label)
        self.parameters_step(properties)
        properties.get_by_role("button", name="Review automation", exact=True).click()
        return self.plan()

    def apply_changes(self, panel):
        panel.get_by_role("button", name="Review queued changes", exact=True).click()
        self.page.get_by_role("heading", name="Changes", exact=True).wait_for()
        self.page.get_by_role("button", name=re.compile(r"^Apply \d+ changes? to Home Assistant$")).click()
        self.assertGreater(len(self.queued), 0)
        self.page.get_by_role("button", name="Confirm and apply", exact=True).click()
        self.page.get_by_text("No changes waiting", exact=True).wait_for()
        self.page.get_by_role("button", name=re.compile(r"^Back to Living room$", re.I)).click()
        self.plan().wait_for()

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

    def test_saved_choices_are_editable_and_preserve_other_areas(self):
        self.prefs["areas"]["kitchen"] = {"profile": "kitchen", "goals": ["appliances"]}
        self.open(True)
        settings = self.record("Room equipment")
        settings.get_by_text("Room type and saved outcomes", exact=True).click()
        settings.get_by_label("Room type", exact=True).select_option("bedroom")
        settings.get_by_role("checkbox", name="Comfortable automatic lighting", exact=True).check()
        settings.get_by_role("checkbox", name="Gentle night lighting", exact=True).check()
        self.assertEqual(self.puts, [])
        settings.get_by_role("button", name="Save room choices", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Room outcome saved").wait_for()
        self.assertEqual(self.puts[0]["revision"], "0")
        self.assertEqual(self.prefs["areas"]["living_room"], {"profile": "bedroom", "goals": ["lighting", "night"]})
        self.assertEqual(self.prefs["areas"]["kitchen"], {"profile": "kitchen", "goals": ["appliances"]})
        self.page.reload(wait_until="networkidle")
        settings.get_by_text("Room type and saved outcomes", exact=True).click()
        self.assertEqual(settings.get_by_label("Room type", exact=True).input_value(), "bedroom")
        self.assertTrue(settings.get_by_role("checkbox", name="Gentle night lighting", exact=True).is_checked())
        self.assertEqual(self.posts, [])

    def test_organize_equipment_and_resume_without_an_automation_goal(self):
        self.open(True)
        equipment = self.record("Room equipment")
        equipment.get_by_role("button", name="Confirm room equipment", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Room equipment confirmed").wait_for()
        equipment.get_by_text("Room type and saved outcomes", exact=True).click()
        equipment.get_by_role("button", name="Organize equipment only", exact=True).click()
        expect(equipment.get_by_text("Equipment organized", exact=True)).to_be_visible()
        self.page.get_by_role("navigation", name="Room navigation").get_by_role("button", name="Home", exact=True).click()
        self.page.get_by_role("button", name=re.compile(r"^Resume Living room$", re.I)).click()
        expect(equipment.get_by_text("Equipment organized", exact=True)).to_be_visible()
        self.assertEqual(self.prefs["areas"]["living_room"]["goals"], [])
        self.assertEqual(self.posts, [])

    def test_assign_compatible_equipment_in_selected_outcome(self):
        self.body["hierarchy"]["entities"]["binary_sensor.living_pir"]["state"] = "unavailable"
        self.add_entity("binary_sensor.spare_pir", "motion", "motion", name="Spare hallway sensor", area=None)
        self.add_entity("light.spare_bulb", "light", name="Spare bulb", area=None)
        self.open(True)
        properties = self.record("Automatic lighting")
        requirement = properties.locator("article").filter(has_text="An occupancy start source")
        expect(requirement.get_by_text("Unavailable", exact=True).first).to_be_visible()
        expect(properties.get_by_role("button", name="Continue to parameters", exact=False)).to_have_count(0)
        requirement.get_by_text("Find equipment to assign", exact=True).click()
        assign = requirement.get_by_role("button", name=re.compile("^Assign Spare hallway sensor to Living room$", re.I))
        expect(assign).to_be_visible()
        expect(requirement.get_by_text("Name points to Hallway", exact=False)).to_be_visible()
        expect(requirement.get_by_text("Spare bulb", exact=False)).to_have_count(0)
        assign.click()
        self.page.get_by_role("status").filter(has_text="Added to the list of changes").wait_for()
        self.assertEqual(self.posts[0]["fields"]["area_id"], "living_room")
        self.assertEqual(self.posts[0]["targetId"], "binary_sensor.spare_pir")
        expect(properties.get_by_role("button", name="Review equipment changes", exact=True)).to_be_visible()
        self.assertEqual(self.applies, [])
        self.assertEqual(self.puts, [])

    def test_can_change_hold_only_sensor_to_detect_entry_without_moving_it(self):
        self.body["hierarchy"]["entities"]["binary_sensor.living_pir"]["state"] = "unavailable"
        self.add_entity("binary_sensor.living_presence", "presence", "presence", name="Sofa presence")
        self.inventory["entities"]["binary_sensor.living_presence"] = {"role": "holds"}
        self.open(True)
        properties = self.record("Automatic lighting")
        expect(properties.get_by_text("Keeps occupancy only", exact=True)).to_be_visible()
        properties.get_by_role("button", name="Use to detect entry: Sofa presence", exact=True).click()
        expect(properties.get_by_role("button", name="Continue to parameters", exact=False)).to_be_visible()
        self.assertEqual(self.inventory["entities"]["binary_sensor.living_presence"]["role"], "starts")
        self.assertEqual(self.posts, [])

    def test_named_room_candidate_is_suggested_before_manual_search(self):
        h = self.body["hierarchy"]
        h["entities"]["binary_sensor.living_pir"]["state"] = "unavailable"
        self.add_entity("binary_sensor.spare_motion", "motion", "motion", name="Spare motion", area=None)
        self.add_entity("binary_sensor.kitchen_pir", "motion", "motion", name="Living room entry motion", area=None)
        self.add_entity("binary_sensor.living_room_offline", "motion", "motion", name="Living room offline motion", area=None)
        h["entities"]["binary_sensor.living_room_offline"]["state"] = "unavailable"
        template = next(iter(self.original["hierarchy"]["devices"].values()))
        h["devices"]["named_spare"] = {**template, "id": "named_spare", "name": "Living room spare sensor", "areaId": None, "entityIds": ["binary_sensor.spare_motion"]}
        h["entities"]["binary_sensor.spare_motion"]["deviceId"] = "named_spare"
        self.open(True)
        properties = self.record("Automatic lighting")
        requirement = properties.locator("article").filter(has_text="An occupancy start source")
        expect(requirement.get_by_role("heading", name="Suggested equipment for Living room", exact=True)).to_be_visible()
        expect(requirement.get_by_text("Device name “Living room spare sensor”", exact=False)).to_be_visible()
        expect(requirement.get_by_text("Living room entry motion", exact=False)).to_have_count(0)
        expect(requirement.get_by_text("Living room offline motion", exact=False)).to_have_count(0)
        expect(properties.get_by_role("button", name="Continue to parameters", exact=False)).to_have_count(0)
        self.assertEqual(self.posts, [])
        requirement.get_by_role("button", name=re.compile("^Assign Spare motion to Living room$", re.I)).click()
        expect(properties.get_by_role("button", name="Review equipment changes", exact=True)).to_be_visible()
        self.assertEqual(self.posts, [{"kind": "entity", "op": "update", "targetId": "binary_sensor.spare_motion", "fields": {"area_id": "living_room"}}])
        self.assertEqual(self.applies, [])

    def test_group_suggestions_use_canonical_ids_named_members_and_reviewed_proposals(self):
        h = self.body["hierarchy"]
        h["entities"]["light.living_bulb"]["name"] = "Floor lamp"
        h["entities"]["binary_sensor.living_pir"]["name"] = "Entrance motion"
        plan = self.open_plan()
        groups = plan.get_by_role("region", name="Home Assistant group plans", exact=True)
        expect(groups.get_by_text("light.living_all", exact=True)).to_be_visible()
        expect(groups.get_by_text("binary_sensor.living_motion_all", exact=True)).to_be_visible()
        expect(groups.get_by_role("list", name="Members for light.living_all")).to_contain_text("Floor lamp")
        expect(groups.get_by_role("list", name="Members for binary_sensor.living_motion_all")).to_contain_text("Entrance motion")
        expect(groups.get_by_text("The group reports on when any member reports on.", exact=True)).to_be_visible()
        self.assertEqual(self.posts, [])
        groups.get_by_role("button", name=re.compile(r"^Add .*motions to changes$", re.I)).click()
        self.page.get_by_role("status").filter(has_text="Added to the list of changes").wait_for()
        self.assertEqual(len(self.posts), 1)
        fields = self.posts[0]["fields"]
        self.assertEqual(fields["entity_id"], "binary_sensor.living_motion_all")
        self.assertEqual(fields["group_type"], "binary_sensor")
        self.assertEqual(fields["entities"], ["binary_sensor.living_pir"])
        self.assertEqual(self.applies, [])

    def test_lighting_with_other_blocked_outcomes_through_review_apply_verify_and_resume(self):
        self.controllers = {"ok": True, "controllers": [
            {"id": "entry_evening", "entityId": "automation.entry_evening", "name": "Evening trip", "lights": ["light.living_bulb"]},
        ], "unreadable": 1}
        self.prefs["areas"]["living_room"] = {"profile": "living", "goals": ["lighting", "night", "climate", "media", "openings"]}
        self.body["hierarchy"]["entities"]["binary_sensor.living_pir"]["name"] = "Hallway motion"
        self.body["hierarchy"]["entities"]["light.living_bulb"]["name"] = "Low lamp"
        self.page.goto(BASE + "/#guide", wait_until="networkidle")
        self.page.get_by_role("button", name="Choose a room", exact=True).click()
        self.page.get_by_label("Search rooms", exact=True).fill("Living room")
        self.page.get_by_role("button", name=re.compile(r"^Living room", re.I)).click()
        climate = self.record("Room climate")
        expect(climate.get_by_role("button", name="Continue to parameters", exact=False)).to_have_count(0)
        properties = self.record("Automatic lighting")
        expect(properties.get_by_role("heading", name="Room climate", exact=True)).to_have_count(0)
        expect(properties.get_by_text("2 of 2 equipment requirements met", exact=True)).to_be_visible()
        expect(properties.locator("article").filter(has_text="An occupancy start source").get_by_text("Hallway motion", exact=True)).to_be_visible()
        expect(properties.get_by_text("Low lamp", exact=True)).to_be_visible()
        expect(properties.get_by_text("Door contact", exact=True)).to_have_count(0)
        expect(properties.get_by_role("region", name="Native Home Assistant plan", exact=True)).to_have_count(0)
        self.page.screenshot(path=str(screenshot_dir() / "room-automation-equipment.png"))
        self.parameters_step(properties)
        tune = properties.get_by_role("region", name="Adjust room lighting", exact=True)
        tune.get_by_role("checkbox", name="Low lamp", exact=True).check()
        tune.get_by_label("Night brightness (%)", exact=True).fill("7")
        tune.get_by_label("How long to keep occupancy (min)", exact=True).fill("2")
        expect(self.plan()).to_have_count(0)
        self.page.screenshot(path=str(screenshot_dir() / "room-automation-parameters.png"))
        tune.get_by_role("button", name="Save room lighting settings", exact=True).click()
        review = self.plan()
        behavior = review.get_by_role("region", name="Planned lighting behavior", exact=True)
        expect(behavior.get_by_text(re.compile("Low lamp can come on at 7%"))).to_be_visible()
        expect(behavior.get_by_text(re.compile("normally holds for 2 min"))).to_be_visible()
        expect(review.get_by_text("Evening trip controls Low lamp.", exact=True)).to_be_visible()
        expect(review.get_by_text(re.compile("automations or scripts were unreadable"))).to_be_visible()
        self.assertEqual(self.parameters["areas"]["living_room"], {"night_brightness": 7, "hold_timeout": 2, "night_lights": ["light.living_bulb"]})
        self.assertEqual(self.parameters["areas"]["kitchen"], {"hold_timeout": 3})
        self.assertEqual(self.parameters["house"], {"night_brightness": 11})
        self.assertEqual(self.posts, [])
        self.page.locator("main").evaluate("(main) => { main.scrollTop = 0; }")
        self.page.screenshot(path=str(screenshot_dir() / "room-automation-review.png"))

        light_helper = review.get_by_role("button", name=re.compile(r"^Add .*light.* to changes$", re.I))
        expect(light_helper).to_be_enabled()
        light_helper.click()
        occupancy = review.get_by_role("button", name="Add Occupancy to changes", exact=True)
        occupancy.click()
        motion = review.get_by_role("button", name="Add Motion lights to changes", exact=True)
        expect(motion).to_be_enabled()
        motion.click()
        expect(motion).to_have_count(0)
        automation_fields = {item["fields"]["recipe"]: item["fields"]["use_blueprint"]["input"] for item in self.posts if item["kind"] == "automation"}
        self.assertEqual(automation_fields["occupancy"]["hold_minutes"], 2)
        self.assertEqual(automation_fields["motion_lights"]["night_brightness"], 7)
        self.assertEqual(automation_fields["motion_lights"]["night_lights"], ["light.living_bulb"])
        self.assertEqual(self.applies, [])
        self.apply_changes(review)
        expect(properties.get_by_role("heading", name="Automatic lighting", exact=True)).to_be_visible()
        review.get_by_role("button", name="Verify with Home Assistant", exact=True).click()
        expect(review.get_by_text("Home Assistant reports this setup installed and enabled.", exact=True)).to_be_visible()
        self.assertTrue(any(url.endswith("refresh=1") for url in self.recipe_reads))
        review.get_by_role("button", name="Test in the room", exact=False).click()
        checks = properties.get_by_role("region", name="Room test checklist", exact=True)
        self.assertNotIn("automationTests", self.prefs)
        expect(checks.get_by_role("button", name="Save room test record", exact=True)).to_be_disabled()
        for checkbox in checks.get_by_role("checkbox").all():
            checkbox.check()
        checks.get_by_role("button", name="Save room test record", exact=True).click()
        expect(checks.get_by_text("Tested by you for the current configuration.", exact=True)).to_be_visible()
        self.assertIn("motion_lights", self.prefs["automationTests"]["living_room"])
        self.page.get_by_role("navigation", name="Room navigation").get_by_role("button", name="Home", exact=True).click()
        self.page.get_by_role("button", name=re.compile(r"^Resume Living room$", re.I)).click()
        expect(checks.get_by_text("Tested by you for the current configuration.", exact=True)).to_be_visible()
        checks.get_by_role("button", name="Adjust lights or duration", exact=True).click()
        tune.get_by_label("Night brightness (%)", exact=True).fill("9")
        tune.get_by_role("button", name="Save room lighting settings", exact=True).click()
        expect(review.get_by_text("Update the existing automation", exact=True)).to_be_visible()
        review.get_by_role("button", name="See previous room test", exact=True).click()
        expect(checks.get_by_text("Previous observations are saved", exact=False)).to_be_visible()
        expect(checks.get_by_role("button", name="Save room test record", exact=True)).to_be_disabled()
        self.assertEqual(len(self.applies), 1)

    def test_occupancy_parameter_reaches_native_plan_and_unsaved_switch_is_guarded(self):
        self.prefs["areas"]["living_room"] = {"profile": "living", "goals": ["occupancy"]}
        self.open(True)
        properties = self.record("Room occupancy")
        self.parameters_step(properties)
        hold = properties.get_by_label("Hold timeout (min)", exact=True)
        hold.fill("4")
        dialogs = []
        def preserve(dialog):
            dialogs.append(dialog.message)
            dialog.dismiss()
        self.page.once("dialog", preserve)
        self.record("Room climate")
        self.assertEqual(len(dialogs), 1)
        expect(hold).to_have_value("4")
        expect(properties.get_by_role("heading", name="Room occupancy", exact=True)).to_be_visible()
        properties.get_by_role("button", name="Save and review automation", exact=True).click()
        review = self.plan()
        review.get_by_role("button", name="Add Occupancy to changes", exact=True).click()
        self.page.get_by_role("status").filter(has_text="changes added to the list").wait_for()
        input_fields = next(item["fields"]["use_blueprint"]["input"] for item in self.posts if item["kind"] == "automation")
        self.assertEqual(input_fields["hold_minutes"], 4)
        self.assertEqual(self.parameters["areas"]["living_room"]["hold_timeout"], 4)
        self.assertEqual(self.parameters["areas"]["kitchen"]["hold_timeout"], 3)

    def test_direct_mode_uses_confirmation_and_cancel_does_not_apply(self):
        self.prefs["areas"]["living_room"] = {"profile": "living", "goals": ["occupancy"]}
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
        plan = self.open_plan("Room occupancy")
        plan.get_by_role("button", name="Preview Occupancy", exact=True).click()
        dialog = self.page.get_by_role("dialog", name="Review before applying", exact=True)
        expect(dialog.get_by_role("heading", name="Create automation taxis_occupancy_living", exact=True)).to_be_visible()
        dialog.get_by_role("button", name="Cancel", exact=True).click()
        expect(dialog).to_have_count(0)
        self.assertEqual(len([item for item in captured if item["kind"] == "automation"]), 1)
        self.assertEqual(self.posts, [])
        self.assertEqual(self.applies, [])

    def test_failed_installation_read_stays_unknown_and_can_be_retried(self):
        self.prefs["areas"]["living_room"] = {"profile": "living", "goals": ["occupancy"]}
        self.read_failure = True
        plan = self.open_plan("Room occupancy")
        plan.get_by_role("alert").filter(has_text="Installation status is unknown").wait_for()
        expect(plan.get_by_role("button", name="Add Occupancy to changes", exact=True)).to_have_count(0)
        self.read_failure = False
        plan.get_by_role("button", name="Verify with Home Assistant", exact=True).click()
        expect(plan.get_by_role("button", name="Add Occupancy to changes", exact=True)).to_be_enabled()
        self.assertEqual(self.posts, [])

    def test_explicit_verification_does_not_reuse_stale_installed_configuration(self):
        self.ready_room()
        self.page.get_by_role("button", name="Review & install", exact=True).click()
        verification = self.plan()
        expect(verification.get_by_text("Installed and enabled", exact=True)).to_be_visible()
        self.read_failure = True
        verification.get_by_role("button", name="Verify with Home Assistant", exact=True).click()
        expect(verification.get_by_role("alert").filter(has_text="Fixture blueprint read failed")).to_be_visible()
        expect(verification.get_by_text("Installed and enabled", exact=True)).to_have_count(0)
        self.assertTrue(self.recipe_reads[-1].endswith("refresh=1"))

    def test_verification_ignores_configuration_for_a_different_hierarchy_snapshot(self):
        self.ready_room()
        self.page.get_by_role("button", name="Review & install", exact=True).click()
        verification = self.plan()
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

    def test_stale_goal_save_retains_room_decisions_draft(self):
        self.selected()
        self.open(True)
        self.fail_save = True
        room = self.record("Room equipment")
        room.get_by_text("Room type and saved outcomes", exact=True).click()
        room.get_by_label("Room type", exact=True).select_option("hallway")
        room.get_by_role("button", name="Save room choices", exact=True).click()
        room.get_by_role("alert").filter(has_text="changed in another session").wait_for()
        self.assertEqual(room.get_by_label("Room type", exact=True).input_value(), "hallway")
        self.assertEqual(self.prefs["areas"]["living_room"]["profile"], "living")
        self.assertEqual(len(self.puts), 1)
        self.assertEqual(self.posts, [])

    def ready_room(self):
        self.prefs["areas"]["living_room"] = {"profile": "living", "goals": ["occupancy"]}
        self.add_entity("binary_sensor.living_motion_all", "motion", "motion", "group", ["binary_sensor.living_pir"])
        self.add_entity("timer.living_hold", "helper", platform="timer")
        self.body["hierarchy"]["entities"]["timer.living_hold"]["state"] = "idle"
        self.add_entity("input_boolean.living_paused", "helper", platform="input_boolean")
        self.add_entity("binary_sensor.living_occupied", "presence", "occupancy", "template")
        self.add_entity("automation.taxis_occupancy_living", "automation", platform="automation")
        self.body["hierarchy"]["entities"]["automation.taxis_occupancy_living"]["state"] = "on"
        plan = self.open_plan("Room occupancy")
        plan.get_by_role("button", name="Add Occupancy to changes", exact=True).click()
        self.page.get_by_role("status").filter(has_text="changes added to the list").wait_for()
        automation = next(item["fields"] for item in self.posts if item["kind"] == "automation")
        blueprint = next(item["fields"] for item in self.posts if item["kind"] == "blueprint")
        self.installed["blueprints"][blueprint["path"]] = blueprint["version"]
        self.installed["automations"][automation["automation_id"]] = {"alias": automation["alias"], "path": automation["use_blueprint"]["path"], "input": automation["use_blueprint"]["input"], "runtimeState": "on"}
        self.installed["timers"]["timer.living_hold"] = 300
        self.queued, self.posts = [], []
        self.page.reload(wait_until="networkidle")
        plan.get_by_role("button", name="Test in the room", exact=False).click()
        return self.page.get_by_role("region", name="Room test checklist", exact=True)

    def test_room_observations_save_reload_and_require_retest_after_sensor_replacement(self):
        checks = self.ready_room()
        self.assertEqual(checks.get_by_role("checkbox").count(), 3)
        for checkbox in checks.get_by_role("checkbox").all():
            checkbox.check()
        checks.get_by_label("Room test notes", exact=True).fill("Tested both entry paths and sitting still.")
        checks.get_by_role("button", name="Save room test record", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Room test record saved").wait_for()
        record = copy.deepcopy(self.prefs["automationTests"]["living_room"]["occupancy"])
        self.assertEqual(len(record["checked"]), 3)
        self.assertTrue(record["configuration"].startswith("room-v1-"))
        self.assertEqual(self.prefs["areas"]["living_room"]["goals"], ["occupancy"])
        self.page.reload(wait_until="networkidle")
        checks.get_by_text("Tested by you for the current configuration.", exact=True).wait_for()
        self.body["hierarchy"]["entities"]["binary_sensor.living_pir"]["deviceId"] = "replacement"
        self.page.reload(wait_until="networkidle")
        checks.get_by_text("Previous test needs a retest because the room configuration changed.", exact=True).wait_for()
        self.assertFalse(any(checkbox.is_checked() for checkbox in checks.get_by_role("checkbox").all()))
        self.assertEqual(self.prefs["automationTests"]["living_room"]["occupancy"], record)
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
        self.assertNotIn("automationTests", self.prefs)
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

    def test_mobile_list_and_details_back_fit(self):
        self.selected()
        self.body["hierarchy"]["entities"]["binary_sensor.living_pir"]["name"] = "Hallway motion"
        self.body["hierarchy"]["entities"]["light.living_bulb"]["name"] = "Low lamp"
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.open(True)
        properties = self.page.get_by_role("region", name="Properties", exact=True)
        expect(properties).to_have_count(0)
        self.record("Automatic lighting")
        expect(properties.get_by_role("heading", name="Automatic lighting", exact=True)).to_be_visible()
        expect(properties.get_by_role("button", name="Continue to parameters", exact=False)).to_be_visible()
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        self.page.screenshot(path=str(screenshot_dir() / "room-automation-mobile.png"))
        properties.get_by_role("button", name="Automations", exact=True).click()
        expect(properties).to_have_count(0)
        expect(self.page.get_by_role("heading", name="Automations", exact=True)).to_be_visible()
        self.assertEqual(self.posts, [])
        self.assertEqual(self.puts, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
