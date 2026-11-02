"""Desktop regression checks against the local mock UI, with writes intercepted.

Run with the Python Playwright package installed and `npm run dev:mock` running:
  python3 scripts/browser-regression.py
No Home Assistant writes are performed by these checks.
"""
import os
import copy
import re
import unittest
import json
import urllib.request
from playwright.sync_api import expect, sync_playwright
from browser_common import BASE, launch, screenshot_dir



class DesktopRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urllib.request.urlopen(BASE + "/api/hierarchy", timeout=20) as response:
            cls.hierarchy_body = json.load(response)
        if not cls.hierarchy_body.get("ok"):
            raise RuntimeError("Start the mock Home Assistant and Taxis server before running browser checks")
        cls.playwright = sync_playwright().start()
        cls.browser = launch(cls.playwright)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1000})
        self.page = self.context.new_page()
        self.page.set_default_timeout(15000)
        self.page.set_default_navigation_timeout(30000)
        self.page.route("**/api/hierarchy*", lambda route: route.fulfill(json=copy.deepcopy(self.hierarchy_body)))
        self.page.route("**/api/history", lambda route: route.fulfill(json={"ok": True, "runs": []}))
        self.page.route("**/api/repairs", lambda route: route.fulfill(json={"ok": True, "repairs": []}))

    def tearDown(self):
        self.context.close()

    def test_spaces_manager_assigns_independent_of_floor_with_mocked_changes(self):
        blocked = []
        def guard(route):
            if route.request.method not in ("GET", "HEAD", "OPTIONS"):
                blocked.append((route.request.method, route.request.url))
                route.abort()
            else:
                route.continue_()
        self.page.route("**/api/**", guard)
        def fixture(h):
            area = copy.deepcopy(next(iter(h["areas"].values())))
            label = copy.deepcopy(next(iter(h["labels"].values())))
            h["labels"] = {"space_office": {**label, "id": "space_office", "name": "Space: Office"}, "interior": {**label, "id": "interior", "name": "Interior"}}
            h["areas"] = {key: {**area, "id": key, "name": name, "floorId": floor, "labels": ["interior"], "entityIds": [], "deviceIds": []} for key, name, floor in [("coffee", "Office Coffee", "first"), ("meeting", "Office Meeting", "second")]}
            h["floors"] = [{"id": "first", "name": "First", "level": 0, "areaIds": ["coffee"]}, {"id": "second", "name": "Second", "level": 1, "areaIds": ["meeting"]}]
            h["looseAreaIds"] = []
            h["devices"] = {}; h["entities"] = {}; h["unassignedEntityIds"] = []
        self.hierarchy_fixture(fixture)
        pending = [{"id": 7, "kind": "entity", "op": "update", "targetId": "light.keep", "scope": None, "before": {}, "after": {"name": "Keep"}, "createdAt": ""}]
        posted = []
        def changes(route):
            if route.request.method == "POST":
                payload = route.request.post_data_json
                inputs = payload.get("changes", [payload])
                posted.extend(inputs)
                for item in inputs:
                    pending.append({"id": 100 + len(pending), "kind": item["kind"], "op": item["op"], "targetId": item.get("targetId", "new:label:fixture"), "scope": None, "before": {}, "after": item.get("fields", {}), "createdAt": ""})
            route.fulfill(json={"ok": True, "changes": pending, "version": str(len(pending))})
        self.page.route("**/api/changes", changes)
        self.page.route("**/api/changes/batch", changes)
        self.page.goto(BASE + "/#home", wait_until="networkidle")
        self.page.get_by_role("heading", name="Spaces", exact=True).wait_for()
        self.page.get_by_label("Space for Office Coffee").select_option("space_office")
        self.page.get_by_label("Space for Office Meeting").select_option("space_office")
        self.page.screenshot(path=str(screenshot_dir() / "spaces-manager.png"))
        with self.page.expect_response(lambda response: response.url.endswith("/api/changes/batch") and response.request.method == "POST"):
            self.page.get_by_role("button", name="Add assignments to Changes").click()
        self.assertEqual({item["targetId"] for item in posted}, {"coffee", "meeting"})
        for item in posted:
            self.assertEqual(set(item["fields"]["labels"]), {"interior", "space_office"})
        self.assertEqual(pending[0]["targetId"], "light.keep")
        self.assertEqual(blocked, [])

    def test_space_pending_label_can_be_assigned_and_displayed(self):
        blocked = []
        self.page.route("**/api/**", lambda route: (blocked.append(route.request.url), route.abort()) if route.request.method not in ("GET", "HEAD", "OPTIONS") else route.continue_())
        body = copy.deepcopy(self.hierarchy_body); h = body["hierarchy"]
        template = copy.deepcopy(next(iter(h["areas"].values()))); label = copy.deepcopy(next(iter(h["labels"].values())))
        h["labels"] = {"interior": {**label, "id": "interior", "name": "Interior"}}
        h["areas"] = {"office": {**template, "id": "office", "name": "Office", "floorId": None, "labels": ["interior"], "entityIds": [], "deviceIds": []}}
        h["floors"] = []; h["looseAreaIds"] = ["office"]; h["devices"] = {}; h["entities"] = {}; h["unassignedEntityIds"] = []
        self.page.route("**/api/hierarchy*", lambda route: route.fulfill(json=copy.deepcopy(body)))
        queued = []; posted = []
        def changes(route):
            if route.request.method == "POST":
                payload = route.request.post_data_json
                for item in payload.get("changes", [payload]):
                    posted.append(item)
                    target = item.get("targetId", "new:label:space")
                    before = {}
                    if item["kind"] == "label": h["labels"][target] = {**label, "id": target, "name": item["fields"]["name"]}
                    if item["kind"] == "area":
                        before = {"labels": h["areas"][target]["labels"][:]}; h["areas"][target]["labels"] = item["fields"]["labels"][:]
                    queued.append({"id": 100 + len(queued), "kind": item["kind"], "op": item["op"], "targetId": target, "scope": None, "before": before, "after": item.get("fields", {}), "createdAt": ""})
            route.fulfill(json={"ok": True, "changes": queued, "version": str(len(queued))})
        self.page.route("**/api/changes", changes); self.page.route("**/api/changes/batch", changes)
        self.page.goto(BASE + "/#home", wait_until="networkidle")
        self.page.get_by_label("New Space name").fill("Office")
        with self.page.expect_response(lambda response: response.url.endswith("/api/changes") and response.request.method == "POST"):
            self.page.get_by_role("button", name="Create Space").click()
        picker = self.page.get_by_label("Space for Office")
        expect(picker.locator('option[value="new:label:space"]')).to_be_enabled()
        picker.select_option("new:label:space")
        with self.page.expect_response(lambda response: response.url.endswith("/api/changes") and response.request.method == "POST"):
            self.page.get_by_role("button", name="Add assignments to Changes").click()
        expect(picker).to_have_value("new:label:space")
        expect(self.page.get_by_text("Pending Space changes; apply before planning.")).to_be_visible()
        self.assertEqual(self.page.get_by_text("Conflicting labels", exact=True).count(), 0)
        self.assertEqual(set(posted[-1]["fields"]["labels"]), {"interior", "new:label:space"})
        self.assertEqual(len(queued), 2); self.assertEqual(blocked, [])
        # A real multi-Space conflict stays visible and can be resolved by choosing one.
        h["labels"]["home"] = {**label, "id": "home", "name": "Space: Home"}
        h["areas"]["office"]["labels"].append("home")
        self.page.reload(wait_until="networkidle")
        picker = self.page.get_by_label("Space for Office")
        expect(picker).to_have_value("__conflict__")
        picker.select_option("home")
        with self.page.expect_response(lambda response: response.url.endswith("/api/changes") and response.request.method == "POST"):
            self.page.get_by_role("button", name="Add assignments to Changes").click()
        expect(picker).to_have_value("home")
        self.assertEqual(set(posted[-1]["fields"]["labels"]), {"interior", "home"})
        self.assertEqual(blocked, [])

    def test_space_recipe_scope_never_falls_back_to_legacy(self):
        blocked = []
        def guard(route):
            if route.request.method not in ("GET", "HEAD", "OPTIONS"):
                blocked.append((route.request.method, route.request.url)); route.abort()
            else:
                route.continue_()
        self.page.route("**/api/**", guard)
        def fixture(h):
            area = copy.deepcopy(next(iter(h["areas"].values())))
            label = copy.deepcopy(next(iter(h["labels"].values())))
            h["labels"] = {key: {**label, "id": key, "name": "Space: " + name} for key, name in [("office", "Office"), ("studio", "Studio")]}
            h["areas"] = {key: {**area, "id": key, "name": name, "floorId": None, "labels": [scope], "entityIds": [], "deviceIds": []} for key, name, scope in [("coffee", "Office Coffee", "office"), ("meeting", "Office Meeting", "office"), ("studio_room", "Studio room", "studio")]}
            h["floors"] = []; h["looseAreaIds"] = list(h["areas"]); h["devices"] = {}; h["entities"] = {}; h["unassignedEntityIds"] = []
        self.hierarchy_fixture(fixture)
        self.page.route("**/api/changes", lambda route: route.fulfill(json={"ok": True, "changes": [], "version": "fixture"}))
        self.page.route("**/api/recipes/state", lambda route: route.fulfill(json={"ok": True, "installed": {"blueprints": {}, "automations": {}, "scripts": {"taxis_goodbye": {"alias": "Goodbye (Taxis)", "path": "taxis/goodbye.yaml", "input": {}}}, "timers": {}, "controllers": {}}}))
        saved = {"house": {"away_mode_entity": "input_boolean.global_away"}, "types": {}, "areas": {}}
        def parameters(route):
            if route.request.method == "PUT":
                saved.clear(); saved.update(route.request.post_data_json)
            route.fulfill(json={"ok": True, "parameters": saved})
        self.page.route("**/api/settings/parameters", parameters)
        self.page.goto(BASE + "/#automations/recipes", wait_until="networkidle")
        self.page.get_by_role("table", name="Recipe types").get_by_role("button", name="Goodbye", exact=True).click()
        details = self.page.get_by_role("article", name="Recipe details").first
        expect(details.get_by_role("button", name=re.compile(r"^Add to Changes"))).to_be_disabled()
        details.get_by_role("tab", name="Availability").click()
        nav = details.get_by_role("navigation", name="Recipe scopes")
        nav.get_by_role("button", name="Office", exact=True).click()
        details.get_by_text("Areas: Office Coffee, Office Meeting.", exact=False).wait_for()
        expect(details.get_by_text("No configuration found in Home Assistant.", exact=True)).to_be_visible()
        expect(details.get_by_text("Missing requirements", exact=True)).to_have_count(1)
        self.assertEqual(details.get_by_text("Studio room", exact=False).count(), 0)
        expect(details.get_by_role("heading", name="Space light group")).to_be_visible()
        expect(details.get_by_role("button", name=re.compile(r"^Add to Changes"))).to_be_disabled()
        details.get_by_role("table", name="Space parameters").wait_for()
        details.get_by_role("button", name=re.compile(r"^Away mode switch for Office:")).click()
        edit = details.get_by_label("Away mode switch for Office", exact=True)
        edit.fill("input_boolean.office_away"); edit.press("Enter")
        expect(details.get_by_role("button", name=re.compile(r"^Away mode switch for Office: input_boolean.office_away, set here"))).to_be_visible()
        self.assertEqual(saved["house"]["away_mode_entity"], "input_boolean.global_away")
        self.assertEqual(saved["spaces"]["office"]["away_mode_entity"], "input_boolean.office_away")
        self.page.screenshot(path=str(screenshot_dir() / "space-recipe-scope.png"))
        nav.get_by_role("button", name="All areas (legacy)").click()
        details.get_by_role("heading", name="All areas (legacy)").wait_for()
        expect(details.get_by_text("Configuration found in Home Assistant.", exact=True)).to_be_visible()
        expect(details.get_by_text("Missing requirements", exact=True)).to_have_count(1)
        self.page.goto(BASE + "/#parameters/house", wait_until="networkidle")
        self.page.get_by_role("button", name="Columns of House").click()
        self.page.get_by_role("group", name="Columns").get_by_label(re.compile(r"^Away mode switch")).check()
        self.page.get_by_role("button", name="Columns of House").click()
        expect(self.page.get_by_role("button", name=re.compile(r"^Away mode switch for Space · Office: input_boolean.office_away, set here"))).to_be_visible()
        self.assertEqual(blocked, [])

    def test_scoped_area_helper_action_sends_space_fence(self):
        blocked = []
        self.page.route("**/api/**", lambda route: (blocked.append(route.request.url), route.abort()) if route.request.method not in ("GET", "HEAD", "OPTIONS") else route.continue_())
        def fixture(h):
            area = copy.deepcopy(next(iter(h["areas"].values()))); label = copy.deepcopy(next(iter(h["labels"].values()))); entity = copy.deepcopy(next(iter(h["entities"].values())))
            h["labels"] = {"office": {**label, "id": "office", "name": "Space: Office"}}
            h["areas"] = {"coffee": {**area, "id": "coffee", "name": "Coffee", "floorId": None, "labels": ["office"], "entityIds": ["binary_sensor.coffee_motion"], "deviceIds": []}}
            h["floors"] = []; h["looseAreaIds"] = ["coffee"]; h["devices"] = {}; h["unassignedEntityIds"] = []
            h["entities"] = {"binary_sensor.coffee_motion": {**entity, "entityId": "binary_sensor.coffee_motion", "name": "Coffee motion", "domain": "binary_sensor", "deviceClass": "motion", "role": "motion", "platform": "demo", "members": [], "deviceId": None, "areaId": "coffee", "ownAreaId": "coffee", "disabled": False, "hidden": False, "maintenance": False}}
        self.hierarchy_fixture(fixture)
        posted = []
        def changes(route):
            if route.request.method == "POST":
                payload = route.request.post_data_json; posted.extend(payload.get("changes", [payload]))
            route.fulfill(json={"ok": True, "changes": [], "version": "fixture"})
        self.page.route("**/api/changes", changes); self.page.route("**/api/changes/batch", changes)
        self.page.route("**/api/recipes/state", lambda route: route.fulfill(json={"ok": True, "installed": {"blueprints": {}, "automations": {}, "scripts": {}, "timers": {}, "controllers": {}}}))
        self.page.goto(BASE + "/#automations/recipes", wait_until="networkidle")
        self.page.get_by_role("table", name="Recipe types").get_by_role("button", name="Occupancy", exact=True).click()
        details = self.page.get_by_role("article", name="Recipe details").first; details.get_by_role("tab", name="Availability").click()
        details.get_by_role("navigation", name="Recipe areas").get_by_role("button", name="Coffee", exact=True).click()
        with self.page.expect_response(lambda response: "/api/changes" in response.url and response.request.method == "POST"):
            details.get_by_role("button", name="Create Coffee hold").click()
        self.assertTrue(posted)
        for item in posted:
            if item["kind"] != "blueprint": self.assertEqual(item["space"], {"labelId": "office", "areaIds": ["coffee"]})
        self.assertEqual(blocked, [])

    def test_failed_remove_reports_error_and_preserves_queue(self):
        change = {"id": 999999, "kind": "entity", "op": "update", "targetId": "light.kitchen_main", "scope": None,
                  "before": {"name": None}, "after": {"name": "Regression fixture"}, "createdAt": "2026-10-27T00:00:00Z"}
        def changes(route):
            if route.request.method == "DELETE":
                route.fulfill(status=409, json={"ok": False, "error": "Simulated remove failure"})
            else:
                route.fulfill(json={"ok": True, "changes": [change], "version": "fixture"})
        self.page.route("**/api/changes", changes)
        self.page.route("**/api/changes/*", changes)
        self.page.goto(BASE + "/#changes", wait_until="networkidle")
        self.page.get_by_role("button", name=re.compile(r"^Discard:")).click()
        self.page.get_by_role("group", name="Confirm").get_by_role("button", name="Discard", exact=True).click()
        self.page.get_by_text("Simulated remove failure", exact=True).wait_for()
        self.page.get_by_text("Show planned details", exact=True).click()
        expect(self.page.locator("dd").filter(has_text="Planned: Regression fixture")).to_be_visible()
        self.assertEqual(self.page.get_by_role("button", name=re.compile(r"^Discard:")).count(), 1)

    def test_unsaved_naming_survives_cancelled_navigation(self):
        self.page.goto(BASE + "/#settings", wait_until="networkidle")
        original = self.page.locator("#id-pattern").input_value()
        self.page.locator("#id-pattern").fill(original + "_draft")
        self.page.once("dialog", lambda dialog: dialog.dismiss())
        self.page.get_by_role("navigation", name="Pages").get_by_role("button", name="Areas", exact=True).click()
        self.assertTrue(self.page.url.endswith("#settings"))
        self.assertEqual(self.page.locator("#id-pattern").input_value(), original + "_draft")
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.get_by_role("navigation", name="Pages").get_by_role("button", name="Areas", exact=True).click()
        self.page.wait_for_url("**/#home")

    def test_history_and_repairs_survive_page_reload(self):
        run = {"id": 12, "startedAt": "2026-10-27T00:00:00Z", "finishedAt": "2026-10-27T00:01:00Z", "status": "partial", "backup": {"made": True, "name": "Before fixture", "slug": "fixture-backup"}, "changes": [{"id": 7, "kind": "entity", "op": "update", "targetId": "light.fixture_before", "scope": None, "before": {"name": "Before name"}, "after": {"name": "After name"}, "createdAt": "2026-10-27T00:00:00Z"}], "results": [{"changeId": 7, "ok": True, "status": "partial", "message": "Renamed", "details": ["Needs a hand: fixture group"]}], "error": None}
        repair = {"id": 8, "runId": 12, "changeId": 7, "message": "Needs a hand: fixture group", "createdAt": "2026-10-27T00:01:00Z", "acknowledgedAt": None}
        pending = [repair]
        self.page.route("**/api/history", lambda route: route.fulfill(json={"ok": True, "runs": [run]}))
        self.page.route("**/api/repairs", lambda route: route.fulfill(json={"ok": True, "repairs": pending}))
        def acknowledge(route):
            self.assertEqual(route.request.method, "POST")
            pending.clear()
            route.fulfill(json={"ok": True, "repairs": []})
        self.page.route("**/api/repairs/8/acknowledge", acknowledge)
        self.page.goto(BASE + "/#changes", wait_until="networkidle")
        self.page.get_by_role("heading", name="Repairs needing attention (1)").wait_for()
        self.page.reload(wait_until="networkidle")
        self.page.get_by_role("heading", name="Repairs needing attention (1)").wait_for()
        self.page.locator("summary").filter(has_text="Apply #12").click()
        self.page.get_by_text("light.fixture_before", exact=True).wait_for()
        self.page.get_by_text("Before name", exact=True).wait_for()
        self.page.get_by_text("After name", exact=True).wait_for()
        self.page.get_by_text("fixture-backup", exact=True).wait_for()
        self.page.get_by_role("button", name="Mark repaired", exact=True).click()
        self.page.get_by_role("button", name="Mark repaired", exact=True).click()
        self.page.get_by_role("heading", name="Repairs needing attention (0)").wait_for()

    def test_stale_settings_send_revision_and_do_not_retry(self):
        attempts = []
        def naming(route):
            if route.request.method == "PUT":
                attempts.append(route.request.headers.get("if-match"))
                route.fulfill(status=409, json={"ok": False, "error": "These settings changed in another session. Reload before saving."})
            else:
                response = route.fetch()
                body = response.json()
                body["revision"] = "revision-before-another-session"
                route.fulfill(json=body)
        self.page.route("**/api/settings/naming", naming)
        self.page.goto(BASE + "/#settings", wait_until="networkidle")
        self.page.locator("#id-pattern").fill("{area}_{type}_{name}_draft")
        self.page.get_by_role("button", name="Save settings", exact=True).click()
        self.page.get_by_text("These settings changed in another session. Reload before saving.", exact=True).wait_for()
        self.assertEqual(attempts, ["revision-before-another-session"])

    def hierarchy_fixture(self, change):
        body = copy.deepcopy(self.hierarchy_body)
        change(body["hierarchy"])
        self.page.route("**/api/hierarchy*", lambda route: route.fulfill(json=body))

    def test_device_editor_cancel_can_preserve_unsaved_draft(self):
        self.page.goto(BASE + "/#organize/devices", wait_until="networkidle")
        self.page.get_by_role("button", name="Records", exact=True).click()
        self.page.locator("table[aria-label='Devices list'] tbody tr").first.click()
        self.page.locator("#dev-name").fill("Unsaved device draft")
        self.page.once("dialog", lambda dialog: dialog.dismiss())
        self.page.get_by_role("button", name="Cancel", exact=True).click()
        self.assertEqual(self.page.locator("#dev-name").input_value(), "Unsaved device draft")
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.get_by_role("button", name="Cancel", exact=True).click()
        # The editor closes after the hash change, so wait for it instead of reading it at once.
        expect(self.page.locator("#dev-name")).to_have_count(0)

    def test_empty_table_filters_remain_recoverable(self):
        self.page.goto(BASE + "/#organize/devices", wait_until="networkidle")
        self.page.get_by_label("Manufacturer", exact=True).select_option(label="Sonoff")
        self.page.get_by_role("button", name="Filter records by area").click()
        self.page.screenshot(path=str(screenshot_dir() / "organize-area-filter.png"))
        self.page.get_by_role("group", name="Areas", exact=True).get_by_text("Bedroom", exact=True).click()
        self.page.keyboard.press("Escape")
        self.page.get_by_text("No matching devices or entities.", exact=False).wait_for()
        self.assertTrue(self.page.get_by_label("Manufacturer", exact=True).is_visible())
        self.page.get_by_role("button", name="Reset filters", exact=True).first.click()
        self.assertGreater(self.page.get_by_role("table", name="Devices and entities").locator("tbody tr").count(), 1)

    def test_label_without_matches_does_not_keep_unrelated_devices(self):
        self.page.goto(BASE + "/#organize/devices", wait_until="networkidle")
        self.page.get_by_label("Label", exact=True).select_option(label="Kids")
        self.page.get_by_text("No matching devices or entities.", exact=False).wait_for()
        table = self.page.get_by_role("table", name="Devices and entities")
        self.assertEqual(table.locator("tbody tr").count(), 1)
        self.assertEqual(table.locator("tbody tr td").count(), 1)
        expect(table.get_by_text("No matching devices or entities.", exact=False)).to_be_visible()

    def test_record_sizes_persist_and_reset(self):
        # The list/properties divider and a table's Columns menu are both browser
        # preferences that survive a reload and that "Reset layout" puts back. (Dragging
        # a column edge to resize it was replaced by the Columns menu.)
        self.page.goto(BASE + "/#organize/devices", wait_until="networkidle")
        self.page.get_by_role("button", name="Records", exact=True).click()
        pane = self.page.locator("section[aria-label='Records']")
        original = pane.bounding_box()["width"]
        def drag(handle, amount):
            box = handle.bounding_box()
            self.page.mouse.move(box["x"] + 3, box["y"] + 8)
            self.page.mouse.down()
            self.page.mouse.move(box["x"] + 3 + amount, box["y"] + 8, steps=8)
            self.page.mouse.up()
        model = self.page.locator("table[aria-label='Devices list']").get_by_role("columnheader", name="Model", exact=True)
        expect(model).to_have_count(0)  # no room for it in the narrow list
        self.page.get_by_role("button", name="Columns of Devices list").click()
        self.page.get_by_role("group", name="Columns").get_by_label("Model").check()
        expect(model).to_have_count(1)
        self.page.keyboard.press("Escape")
        drag(self.page.get_by_role("separator", name="Resize records and properties"), 80)
        self.assertAlmostEqual(pane.bounding_box()["width"], original + 80, delta=2)
        self.page.reload(wait_until="networkidle")
        self.assertAlmostEqual(pane.bounding_box()["width"], original + 80, delta=2)
        expect(model).to_have_count(1)
        self.page.get_by_role("button", name="Columns of Devices list").click()
        self.assertTrue(self.page.get_by_role("group", name="Columns").get_by_label("Model").is_checked())
        self.page.keyboard.press("Escape")
        self.page.get_by_role("button", name="Reset layout", exact=True).click()
        self.assertAlmostEqual(pane.bounding_box()["width"], original, delta=2)
        expect(model).to_have_count(0)

    def test_helpers_navigation_excludes_ordinary_entities(self):
        def fixture(h):
            base = next(iter(h["entities"].values()))
            helper = {**copy.deepcopy(base), "entityId": "input_boolean.regression_helper", "name": "Regression helper", "domain": "input_boolean", "role": "helper", "categoryScope": "helpers", "deviceId": None, "areaId": None}
            ordinary = {**copy.deepcopy(base), "entityId": "sensor.regression_ordinary", "name": "Regression ordinary", "domain": "sensor", "role": "sensor", "categoryScope": None, "deviceId": None, "areaId": None}
            h["entities"] = {helper["entityId"]: helper, ordinary["entityId"]: ordinary}
        self.hierarchy_fixture(fixture)
        self.page.goto(BASE + "/#organize/helpers", wait_until="networkidle")
        self.page.get_by_role("navigation", name="What to organize").get_by_role("button", name=re.compile(r"^Helpers")).wait_for()
        table = self.page.locator("table[aria-label='Helpers list']")
        self.assertEqual(table.get_by_text("Regression helper", exact=True).count(), 1)
        self.assertEqual(table.get_by_text("Regression ordinary", exact=True).count(), 0)

    def organize_partition_fixture(self):
        def fixture(h):
            base = next(iter(h["entities"].values()))
            h["devices"] = {}
            h["entities"] = {}
            for entity_id, name, domain, role, platform, scope in [
                ("sensor.partition_ordinary", "Partition ordinary", "sensor", "sensor", "demo", None),
                ("automation.partition_auto", "Partition automation", "automation", "automation", "automation", "automation"),
                ("input_boolean.partition_helper", "Partition helper", "input_boolean", "helper", "input_boolean", "helpers"),
            ]:
                entity = {**copy.deepcopy(base), "entityId": entity_id, "name": name, "customName": None, "domain": domain, "role": role, "platform": platform, "categoryScope": scope, "members": [], "deviceId": None, "areaId": None, "ownAreaId": None, "disabled": False, "hidden": False, "maintenance": False, "labels": [], "categories": {}, "inRegistry": True}
                h["entities"][entity_id] = entity
        self.hierarchy_fixture(fixture)

    def test_organize_sections_are_disjoint_in_records_and_table(self):
        self.organize_partition_fixture()
        self.page.goto(BASE + "/#organize/entities", wait_until="networkidle")
        nav = self.page.get_by_role("navigation", name="What to organize")
        nav.get_by_role("button", name=re.compile(r"^Automations\b")).wait_for()
        labels = nav.get_by_role("button").all_inner_texts()
        names = [re.sub(r"\s+[\d,–+]+$", "", label).strip() for label in labels]
        self.assertLess(names.index("Automations"), names.index("Blueprints"))
        self.assertLess(names.index("Blueprints"), names.index("Devices"))
        for section, label, expected in [("entities", "Entities", "Partition ordinary"), ("automations", "Automations", "Partition automation"), ("helpers", "Helpers", "Partition helper")]:
            nav.get_by_role("button", name=re.compile(r"^" + label + r"\b")).click()
            self.page.get_by_role("button", name="Records", exact=True).click()
            table = self.page.locator(f"table[aria-label='{label} list']")
            self.assertEqual(table.locator("tbody tr").count(), 1)
            table.get_by_text(expected, exact=True).wait_for()
            for other in {"Partition ordinary", "Partition automation", "Partition helper"} - {expected}:
                self.assertEqual(table.get_by_text(other, exact=True).count(), 0)
            self.assertRegex(nav.get_by_role("button", name=re.compile(r"^" + label + r"\b")).inner_text(), r"\b1$")
            self.page.get_by_role("button", name="Table", exact=True).click()
            if section == "entities":
                self.page.get_by_role("textbox", name="Name of sensor.partition_ordinary", exact=True).wait_for()
                self.assertEqual(self.page.get_by_role("textbox", name="Name of automation.partition_auto", exact=True).count(), 0)
                self.assertEqual(self.page.get_by_role("textbox", name="Name of input_boolean.partition_helper", exact=True).count(), 0)
            else:
                table.get_by_text(expected, exact=True).wait_for()
                self.assertEqual(table.locator("tbody tr").count(), 1)
            self.page.get_by_role("button", name="Records", exact=True).click()

    def test_existing_entity_links_open_their_new_organize_sections(self):
        self.organize_partition_fixture()
        for entity_id, section in [("automation.partition_auto", "automations"), ("input_boolean.partition_helper", "helpers")]:
            self.page.goto(BASE + "/#organize/entities/" + entity_id, wait_until="networkidle")
            self.page.wait_for_function("expected => window.location.hash === expected", arg="#organize/" + section + "/" + entity_id)
            self.assertEqual(self.page.get_by_role("navigation", name="What to organize").locator("button[aria-current='true']").inner_text().split()[0].lower(), section)

    def test_disabled_device_is_hidden_until_explicitly_included(self):
        def fixture(h):
            device = next(iter(h["devices"].values()))
            device["name"] = "Regression disabled device"
            device["disabled"] = True
        self.hierarchy_fixture(fixture)
        self.page.goto(BASE + "/#organize/devices", wait_until="networkidle")
        self.assertEqual(self.page.get_by_role("textbox", name="Name of device Regression disabled device", exact=True).count(), 0)
        self.page.get_by_role("checkbox", name="Show disabled devices", exact=True).check()
        self.page.get_by_role("textbox", name="Name of device Regression disabled device", exact=True).wait_for()

    def test_table_keeps_entities_without_devices_by_default(self):
        def fixture(h):
            base = next(iter(h["entities"].values()))
            entity = {**copy.deepcopy(base), "entityId": "sensor.regression_without_device", "name": "Regression without device", "domain": "sensor", "role": "sensor", "categoryScope": None, "deviceId": None, "areaId": None, "disabled": False, "hidden": False, "maintenance": False}
            h["entities"] = {entity["entityId"]: entity}
            h["devices"] = {}
        self.hierarchy_fixture(fixture)
        self.page.goto(BASE + "/#organize/devices", wait_until="networkidle")
        self.page.get_by_role("group", name="Entity view", exact=True).get_by_role("button", name="Entities", exact=True).click()
        self.page.get_by_role("textbox", name="Name of sensor.regression_without_device", exact=True).wait_for()

    def test_records_can_page_past_four_hundred_entities(self):
        def fixture(h):
            base = next(iter(h["entities"].values()))
            h["entities"] = {}
            h["devices"] = {}
            for index in range(501):
                entity = {**copy.deepcopy(base), "entityId": f"sensor.regression_{index:03}", "name": f"Record {index:03}", "domain": "sensor", "role": "sensor", "categoryScope": None, "deviceId": None, "areaId": None, "ownAreaId": None}
                h["entities"][entity["entityId"]] = entity
        self.hierarchy_fixture(fixture)
        self.page.goto(BASE + "/#organize/entities", wait_until="networkidle")
        rows = self.page.locator("table[aria-label='Entities list'] tbody tr")
        rows.first.wait_for()
        self.assertEqual(rows.count(), 100)
        for _ in range(5):
            self.page.get_by_role("button", name="Next page", exact=True).click()
        self.assertEqual(rows.count(), 1)
        self.page.locator("table[aria-label='Entities list']").get_by_text("Record 500", exact=True).wait_for()

    def test_capability_numbers_explain_counted_and_excluded_entities(self):
        def fixture(h):
            area = copy.deepcopy(next(iter(h["areas"].values())))
            area.update({"id": "tooltip_room", "name": "Tooltip room", "floorId": None, "entityIds": [], "deviceIds": []})
            base = next(iter(h["entities"].values()))
            h["entities"] = {}
            h["devices"] = {}
            h["floors"] = []
            h["looseAreaIds"] = ["tooltip_room"]
            h["areas"] = {"tooltip_room": area}
            for suffix, name in [("first", "Fixture counted first"), ("second", "Fixture counted second"), ("excluded", "Fixture excluded light")]:
                entity = {**copy.deepcopy(base), "entityId": "light.tooltip_" + suffix, "name": name, "domain": "light", "role": "light", "platform": "demo", "members": [], "categoryScope": None, "deviceId": None, "areaId": "tooltip_room", "ownAreaId": "tooltip_room", "disabled": False, "hidden": False, "maintenance": False}
                h["entities"][entity["entityId"]] = entity
                area["entityIds"].append(entity["entityId"])
        self.hierarchy_fixture(fixture)
        self.page.route("**/api/settings/inventory", lambda route: route.fulfill(json={"ok": True, "revision": "fixture", "inventory": {"entities": {"light.tooltip_excluded": {"counts": False}}, "areas": {}}}))
        self.page.goto(BASE + "/#parameters/capabilities", wait_until="networkidle")
        counted = self.page.get_by_role("button", name="Tooltip room, Lights: 2 included", exact=True)
        counted.hover()
        tooltip = self.page.get_by_role("tooltip")
        tooltip.get_by_text("Fixture counted first", exact=True).wait_for()
        self.assertEqual(tooltip.locator("li").count(), 2)
        self.assertEqual(tooltip.get_by_text("light.tooltip_first", exact=True).count(), 1)
        self.assertEqual(tooltip.get_by_text("Fixture excluded light", exact=True).count(), 0)
        self.assertTrue(tooltip.evaluate("element => element.parentElement === document.body"))
        self.page.keyboard.press("Escape")
        counted.focus()
        self.page.get_by_role("tooltip").get_by_text("Fixture counted second", exact=True).wait_for()
        self.page.keyboard.press("Escape")
        excluded = self.page.get_by_role("button", name="Tooltip room, Lights: 1 not included", exact=True)
        excluded.focus()
        tooltip = self.page.get_by_role("tooltip")
        tooltip.get_by_text("Fixture excluded light", exact=True).wait_for()
        self.assertEqual(tooltip.locator("li").count(), 1)
        self.assertEqual(tooltip.get_by_text("light.tooltip_excluded", exact=True).count(), 1)
        self.page.keyboard.press("Escape")
        self.page.get_by_role("button", name="Total, Lights: 2 included", exact=True).focus()
        tooltip = self.page.get_by_role("tooltip")
        tooltip.get_by_text("Fixture counted first", exact=True).wait_for()
        self.assertEqual(tooltip.locator("li").count(), 2)
        excluded.hover()
        self.page.get_by_role("tooltip").get_by_text("Fixture excluded light", exact=True).wait_for()
        self.assertEqual(self.page.get_by_role("tooltip").count(), 1)

    def test_recipes_records_explain_and_queue_a_plan(self):
        queued = []
        posted = []
        def changes(route):
            if route.request.method == "POST":
                body = route.request.post_data_json
                # One edit goes to /api/changes, several in one request to /api/changes/batch.
                for value in body["changes"] if "changes" in body else [body]:
                    posted.append(value)
                    fields = value.get("fields", {})
                    queued.append({"id": 1000 + len(queued), "kind": value["kind"], "op": value["op"], "scope": value.get("scope"), "targetId": value.get("targetId") or fields.get("entity_id") or fields.get("path") or fields.get("automation_id") or "fixture", "before": {}, "after": fields, "createdAt": "2026-10-27T00:00:00Z"})
            route.fulfill(json={"ok": True, "changes": queued, "version": "fixture-" + str(len(queued))})
        self.page.route("**/api/changes", changes)
        self.page.route("**/api/changes/batch", changes)
        self.page.goto(BASE + "/#automations/recipes", wait_until="networkidle")
        self.assertEqual(self.page.get_by_role("navigation", name="Pages").get_by_role("button", name="Recipes", exact=True).get_attribute("aria-current"), "page")
        table = self.page.get_by_role("table", name="Recipe types", exact=True)
        table.wait_for()
        self.assertEqual(table.locator("tbody tr").count(), 15)
        self.assertEqual(self.page.get_by_role("heading", name="Recipes", exact=True).count(), 0)
        details = self.page.get_by_role("article", name="Recipe details").first
        names = table.locator("tbody tr button").all_inner_texts()
        self.assertEqual(len(names), 15)
        house = {"Announce", "Goodbye", "House presence", "Low batteries", "Not reporting"}
        for name in names:
            table.get_by_role("button", name=name, exact=True).click()
            details.get_by_role("heading", name=name, exact=True).wait_for()
            tabs = details.get_by_role("tablist", name="Recipe details sections")
            self.assertNotRegex(details.get_by_role("tabpanel").inner_text(), r"(?i)\bcounted\b")
            self.assertEqual(tabs.get_by_role("tab", name="Description").get_attribute("aria-selected"), "true")
            for title in ["Needed devices", "Helpers", "How it works", "Example"]:
                self.assertTrue(details.get_by_role("heading", name=title, exact=True).is_visible())
            flow = details.get_by_role("region", name=f"{name} flow")
            flow.wait_for()
            self.assertLess(details.get_by_role("heading", name="How it works").bounding_box()["y"], flow.bounding_box()["y"])
            self.assertLess(flow.bounding_box()["y"], details.get_by_role("heading", name="Example").bounding_box()["y"])
            for row in flow.locator("[aria-label$='flow steps'], [aria-label='Occupancy hierarchy'], [aria-label='Occupancy timer flow']").all():
                self.assertLessEqual(row.evaluate("el => el.scrollWidth - el.clientWidth"), 1)
                cards = row.locator("[data-flow-card]")
                boxes = [card.bounding_box() for card in cards.all()]
                self.assertGreaterEqual(len(boxes), 3)
                self.assertEqual(len({round(box["y"]) for box in boxes}), 1)
                self.assertEqual(len({round(box["height"]) for box in boxes}), 1)
                self.assertEqual(len({round(box["width"]) for box in boxes}), 1)
                for card in cards.all():
                    lines = card.evaluate("el => el.firstElementChild.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)")
                    self.assertLessEqual(lines, 2.1, card.inner_text())
            tabs.get_by_role("tab", name="Availability").click()
            details.get_by_role("heading", name="Availability by scope" if name in house else "Availability by area").wait_for()
            if name in house:
                details.get_by_role("navigation", name="Recipe scopes").get_by_role("button", name="All areas (legacy)").click()
            self.assertNotRegex(details.get_by_role("tabpanel").inner_text(), r"(?i)\bcounted\b")
            self.assertEqual(details.get_by_role("heading", name="How it works").count(), 0)
            helper_tables = details.get_by_role("table", name="Recipe helpers")
            if helper_tables.count():
                self.assertEqual([header.inner_text() for header in helper_tables.first.get_by_role("columnheader").all()], ["Helper", "Status", "Purpose", "Action"])
            if name == "House presence":
                details.get_by_role("heading", name="People", exact=True).wait_for()
                details.get_by_text(re.compile(r"Alex.*person.alex.*home")).first.wait_for()
                self.assertTrue(details.get_by_text(re.compile(r"(?:Candidate area occupancy sensors|Current area group members|Planned area group members)")).count())
            if name == "Announce":
                details.get_by_text(re.compile(r"Occupancy prerequisite")).first.wait_for()
        table.get_by_role("button", name="Occupancy", exact=True).click()
        add = details.get_by_role("button", name=re.compile(r"^Add to Changes \(\d+\)$"))
        expect(add).to_be_disabled()
        self.assertEqual(posted, [])
        expect(details.locator("#recipe-action-scope")).to_have_count(0)
        details.get_by_role("tab", name="Availability").click()
        expect(add).to_be_enabled()
        areas = details.get_by_role("navigation", name="Recipe areas")
        areas.get_by_role("button", name="Hallway", exact=True).click()
        expect(details.locator("#recipe-action-scope")).to_have_count(0)
        details.get_by_role("tab", name="Description").click()
        expect(add).to_be_disabled()
        expect(details.locator("#recipe-action-scope")).to_have_count(0)
        details.get_by_role("tab", name="Availability").click()
        details.get_by_role("navigation", name="Recipe areas").get_by_role("button", name="Bathroom", exact=True).click()
        expect(details.locator("#recipe-action-scope")).to_have_count(0)
        self.page.screenshot(path=str(screenshot_dir() / "recipe-action-area-scope.png"))
        bathroom = details
        bathroom.get_by_role("heading", name="Bathroom", exact=True).wait_for()
        bathroom.get_by_role("checkbox", name="Active: Bathroom").wait_for()
        add = bathroom.get_by_role("button", name=re.compile(r"^Add to Changes \(\d+\)$"))
        expected = int(re.search(r"\((\d+)\)", add.inner_text()).group(1))
        self.assertGreater(expected, 0)
        add.click()
        self.page.get_by_role("status").filter(has_text="changes added to the list").wait_for()
        self.assertEqual(len(posted), expected)
        self.assertTrue(any(item["kind"] == "automation" for item in posted))
        self.assertTrue(self.page.get_by_role("separator", name="Resize records and properties", exact=True).is_visible())

    def test_recipe_actions_wait_for_inventory_and_parameter_saves(self):
        # Keep writes entirely in the browser, and control when each save finishes.
        self.page.add_init_script("""(() => {
          const originalFetch = window.fetch;
          window.pendingSettingSave = null;
          window.fetch = (url, options = {}) => {
            const match = String(url).match(/api\\/settings\\/(inventory|parameters)$/);
            if (!match || options.method !== 'PUT') return originalFetch(url, options);
            return new Promise(resolve => {
              window.pendingSettingSave = {kind: match[1], value: JSON.parse(options.body), resolve};
            });
          };
          window.finishSettingSave = ok => {
            const pending = window.pendingSettingSave;
            window.pendingSettingSave = null;
            const body = ok ? {ok: true, [pending.kind]: pending.value} : {ok: false, error: 'Delayed fixture failure'};
            pending.resolve(new Response(JSON.stringify(body), {status: ok ? 200 : 500, headers: {'Content-Type': 'application/json'}}));
          };
        })();""")
        posts = []
        def changes(route):
            if route.request.method == "POST":
                posts.append(route.request.post_data_json)
            route.fulfill(json={"ok": True, "changes": [], "version": "fixture"})
        self.page.route("**/api/changes", changes)
        self.page.route("**/api/changes/batch", changes)
        self.page.route("**/api/settings/inventory", lambda route: route.fulfill(json={"ok": True, "inventory": {"entities": {}, "areas": {}}}))
        self.page.route("**/api/settings/parameters", lambda route: route.fulfill(json={"ok": True, "parameters": {"house": {}, "types": {}, "areas": {}}}))
        self.page.goto(BASE + "/#automations/recipes", wait_until="networkidle")
        details = self.page.get_by_role("article", name="Recipe details").first
        self.page.get_by_role("table", name="Recipe types").get_by_role("button", name="Occupancy", exact=True).click()
        details.get_by_role("tab", name="Availability").click()
        details.get_by_role("navigation", name="Recipe areas").get_by_role("button", name="Bathroom", exact=True).click()
        add = details.get_by_role("button", name=re.compile(r"^Add to Changes \(\d+\)$"))
        create = details.get_by_role("button", name="Create Bathroom hold", exact=True)
        expect(add).to_be_enabled()
        expect(create).to_be_enabled()
        tv = details.get_by_role("checkbox", name="Non applicable")
        tv.check()
        self.page.wait_for_function("window.pendingSettingSave?.kind === 'inventory'")
        expect(add).to_be_disabled()
        expect(create).to_be_disabled()
        self.page.screenshot(path=str(screenshot_dir() / "recipe-save-pending.png"))
        self.page.evaluate("window.finishSettingSave(false)")
        details.get_by_role("alert").filter(has_text="Delayed fixture failure").wait_for()
        expect(tv).not_to_be_checked()
        expect(add).to_be_enabled()
        expect(create).to_be_enabled()
        tv.check()
        self.page.wait_for_function("window.pendingSettingSave?.kind === 'inventory'")
        expect(add).to_be_disabled()
        expect(create).to_be_disabled()
        self.page.evaluate("window.finishSettingSave(true)")
        expect(add).to_be_enabled()
        expect(create).to_be_enabled()
        hold = details.get_by_role("button", name=re.compile(r"^Hold timeout for Bathroom:"))
        original = hold.inner_text()
        hold.click()
        edit = details.get_by_label("Hold timeout for Bathroom", exact=True)
        expect(edit).to_be_focused()
        expect(edit).to_have_value("")
        edit.fill("12")
        edit.press("Enter")
        self.page.wait_for_function("window.pendingSettingSave?.kind === 'parameters'")
        expect(add).to_be_disabled()
        expect(create).to_be_disabled()
        self.page.evaluate("window.finishSettingSave(false)")
        self.page.get_by_role("status").filter(has_text="Delayed fixture failure").wait_for()
        expect(hold).to_have_text(original)
        expect(add).to_be_enabled()
        expect(create).to_be_enabled()
        hold.click()
        expect(edit).to_be_focused()
        expect(edit).to_have_value("")
        edit.fill("12")
        edit.press("Enter")
        self.page.wait_for_function("window.pendingSettingSave?.kind === 'parameters'")
        expect(add).to_be_disabled()
        expect(create).to_be_disabled()
        self.page.evaluate("window.finishSettingSave(true)")
        expect(add).to_be_enabled()
        expect(create).to_be_enabled()
        self.assertEqual(posts, [])

    def test_occupancy_tv_role_persists_and_reports_save_failure(self):
        blocked = []
        def guard(route):
            if route.request.method not in ("GET", "HEAD", "OPTIONS"):
                blocked.append((route.request.method, route.request.url))
                route.abort()
            else:
                route.continue_()
        self.page.route("**/api/**", guard)
        def fixture(h):
            area = next(a for a in h["areas"].values() if a["name"] == "Bathroom")
            base = next(iter(h["entities"].values()))
            entity = {**copy.deepcopy(base), "entityId": "media_player.fixture_tv", "name": "Fixture TV", "domain": "media_player", "deviceClass": "tv", "platform": "demo", "members": [], "categoryScope": None, "deviceId": None, "areaId": area["id"], "ownAreaId": area["id"], "disabled": False, "hidden": False, "maintenance": False}
            h["entities"][entity["entityId"]] = entity
            area["entityIds"].append(entity["entityId"])
        self.hierarchy_fixture(fixture)
        saved = {"entities": {"light.fixture_keep": {"counts": False}, "media_player.fixture_tv": {"counts": False}}, "areas": {}}
        reject = [False]
        def inventory(route):
            if route.request.method == "PUT":
                if reject[0]:
                    route.fulfill(status=500, json={"ok": False, "error": "Fixture save failed"})
                    return
                saved.clear()
                saved.update(route.request.post_data_json)
            route.fulfill(json={"ok": True, "inventory": saved})
        self.page.route("**/api/settings/inventory", inventory)
        def open_room():
            self.page.goto(BASE + "/#automations/recipes", wait_until="networkidle")
            self.page.reload(wait_until="networkidle")
            details = self.page.get_by_role("article", name="Recipe details").first
            self.page.get_by_role("table", name="Recipe types").get_by_role("button", name="Occupancy", exact=True).click()
            flow = details.get_by_role("region", name="Occupancy flow")
            flow.wait_for()
            self.assertIn("Occupancy is triggered", flow.inner_text())
            self.assertNotRegex(flow.inner_text(), r"(?i)\b(tv|bed|humidity)\b")
            hierarchy = flow.get_by_label("Occupancy hierarchy").inner_text()
            self.assertLess(hierarchy.index("Physical or virtual occupancy sensors"), hierarchy.index("Area occupancy"))
            self.assertLess(hierarchy.index("Area occupancy"), hierarchy.index("Whole-house occupancy"))
            self.assertIn("Planned: label-based discovery", flow.inner_text())
            self.assertIn("occupancy label + assigned area", hierarchy)
            self.assertIn("Discovers sources in this area", hierarchy)
            self.assertIn("area and house outputs are excluded", flow.inner_text())
            self.assertIn("area_occupancy", hierarchy)
            self.assertIn("Labels determine membership, not proof of presence", flow.inner_text())
            self.assertLess(details.get_by_role("heading", name="How it works").bounding_box()["y"], flow.bounding_box()["y"])
            self.assertLess(flow.bounding_box()["y"], details.get_by_role("heading", name="Example").bounding_box()["y"])
            self.page.set_viewport_size({"width": 375, "height": 800})
            self.assertLessEqual(flow.evaluate("el => el.scrollWidth - el.clientWidth"), 1)
            self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"))
            self.assertGreater(flow.get_by_label("Occupancy hierarchy").evaluate("el => el.scrollWidth - el.clientWidth"), 0)
            self.page.set_viewport_size({"width": 1600, "height": 1000})
            details.get_by_role("tab", name="Availability").click()
            details.get_by_role("navigation", name="Recipe areas").get_by_role("button", name="Bathroom", exact=True).click()
            return details.get_by_role("combobox", name=re.compile("TV interaction: Fixture TV"))
        select = open_room()
        details = self.page.get_by_role("article", name="Recipe details").first
        wanted = details.get_by_role("checkbox", name="Active: Bathroom")
        expect(details.get_by_text(re.compile(r"^(?:No configuration found|Configuration found) in Home Assistant\.$"))).to_be_visible()
        heading = details.get_by_role("heading", name="TVs", exact=True)
        na = details.get_by_role("checkbox", name="Non applicable")
        self.assertLess(heading.bounding_box()["x"], na.bounding_box()["x"])
        self.assertAlmostEqual(heading.bounding_box()["y"], na.bounding_box()["y"], delta=5)
        self.assertEqual(details.get_by_text("Mark TVs as not applicable", exact=False).count(), 0)
        self.assertEqual(details.get_by_text("TV signals are excluded", exact=False).count(), 0)
        self.assertEqual(select.input_value(), "ignore")
        select.select_option("holds")
        expect(select).to_have_value("holds")
        self.assertEqual(saved["entities"]["light.fixture_keep"], {"counts": False})
        self.assertEqual(saved["entities"]["media_player.fixture_tv"]["tvOccupancyRole"], "holds")
        self.assertFalse(saved["entities"]["media_player.fixture_tv"]["counts"])
        select = open_room()
        self.assertEqual(select.input_value(), "holds")
        na = self.page.get_by_role("checkbox", name="Non applicable")
        na.check()
        expect(select).to_have_count(0)
        self.assertEqual(saved["entities"]["media_player.fixture_tv"]["tvOccupancyRole"], "holds")
        select = open_room()
        na = self.page.get_by_role("checkbox", name="Non applicable")
        expect(na).to_be_checked()
        expect(select).to_have_count(0)
        na.uncheck()
        expect(select).to_have_value("holds")
        reject[0] = True
        select.select_option("starts")
        self.page.get_by_role("alert").filter(has_text="Fixture save failed").wait_for()
        expect(select).to_have_value("holds")
        self.assertEqual(saved["entities"]["media_player.fixture_tv"]["tvOccupancyRole"], "holds")
        reject[0] = False
        config = details.locator('fieldset[aria-label="Area configuration"]')
        hold = details.get_by_role("button", name=re.compile(r"^Hold timeout for Bathroom:"))
        hold.click()
        expect(details.get_by_label("Hold timeout for Bathroom", exact=True)).to_be_visible()
        wanted.uncheck()
        expect(config).to_have_attribute("inert", "")
        self.assertTrue(config.evaluate("el => el.disabled && getComputedStyle(el).opacity === '0.5'"))
        expect(details.get_by_label("Hold timeout for Bathroom", exact=True)).to_have_count(0)
        config.locator('a[href]').first.evaluate("el => el.focus()")
        self.assertFalse(config.locator('a[href]').first.evaluate("el => document.activeElement === el"))
        expect(details.get_by_role("button", name=re.compile(r"^Add to Changes"))).to_be_disabled()
        wanted.check()
        expect(config).not_to_have_attribute("inert", "")
        expect(details.get_by_role("combobox", name=re.compile("TV interaction: Fixture TV"))).to_have_value("holds")
        reject[0] = True
        wanted.uncheck()
        details.get_by_role("alert").filter(has_text="Fixture save failed").wait_for()
        expect(wanted).to_be_checked()
        expect(config).not_to_have_attribute("inert", "")
        self.assertEqual(saved["entities"]["media_player.fixture_tv"]["tvOccupancyRole"], "holds")
        self.assertEqual(blocked, [])

    def test_recipe_wanted_persists_and_rolls_back(self):
        blocked = []
        def guard(route):
            if route.request.method not in ("GET", "HEAD", "OPTIONS"):
                blocked.append((route.request.method, route.request.url))
                route.abort()
            else:
                route.continue_()
        self.page.route("**/api/**", guard)
        def fixture(h):
            template = copy.deepcopy(next(iter(h["areas"].values())))
            h["areas"] = {}
            for area_id, name, floor in [("garden_fixture", "Garden fixture", "garden_floor"), ("room_fixture", "Room fixture", "room_floor")]:
                h["areas"][area_id] = {**template, "id": area_id, "name": name, "floorId": floor, "entityIds": [], "deviceIds": []}
            h["floors"] = [{"id": "garden_floor", "name": "Garden floor", "level": 0, "areaIds": ["garden_fixture"]}, {"id": "room_floor", "name": "Room floor", "level": 1, "areaIds": ["room_fixture"]}]
            h["looseAreaIds"] = []
            base = copy.deepcopy(next(iter(h["entities"].values())))
            entity = {**base, "entityId": "light.garden_fixture", "name": "Garden fixture light", "domain": "light", "deviceClass": None, "platform": "demo", "members": [], "categoryScope": None, "deviceId": None, "areaId": "garden_fixture", "ownAreaId": "garden_fixture", "disabled": False, "hidden": False, "maintenance": False}
            h["entities"][entity["entityId"]] = entity
            h["areas"]["garden_fixture"]["entityIds"].append(entity["entityId"])
        self.hierarchy_fixture(fixture)
        saved = {"entities": {"light.fixture_keep": {"counts": False}}, "areas": {
            "garden_fixture": {"recipePreferences": {"motion_lights": True, "occupancy": True}},
            "room_fixture": {"recipePreferences": {"motion_lights": True}},
        }}
        reject = [False]
        def inventory(route):
            if route.request.method == "PUT":
                if reject[0]:
                    route.fulfill(status=500, json={"ok": False, "error": "Fixture save failed"})
                    return
                saved.clear()
                saved.update(route.request.post_data_json)
            route.fulfill(json={"ok": True, "inventory": saved})
        self.page.route("**/api/settings/inventory", inventory)
        self.page.route("**/api/recipes/state", lambda route: route.fulfill(json={"ok": True, "installed": {"blueprints": {}, "automations": {}, "scripts": {}, "timers": {}, "controllers": {}}}))
        def open_recipe(name, area):
            self.page.goto(BASE + "/#automations/recipes", wait_until="networkidle")
            self.page.reload(wait_until="networkidle")
            self.page.get_by_role("table", name="Recipe types").get_by_role("button", name=name, exact=True).click()
            details = self.page.get_by_role("article", name="Recipe details").first
            details.get_by_role("tab", name="Availability").click()
            details.get_by_role("button", name=area, exact=True).click()
            return details
        details = open_recipe("Motion lights", "Garden fixture")
        toggle = details.get_by_role("checkbox", name="Active: Garden fixture")
        expect(toggle).to_be_checked()
        toggle.uncheck()
        expect(toggle).not_to_be_checked()
        expect(details.get_by_role("heading", name="Garden fixture", exact=True)).to_be_visible()
        nav = details.get_by_role("navigation", name="Motion lights areas")
        nav.get_by_role("checkbox", name="Hide inactive").check()
        expect(nav.get_by_role("button", name="Garden fixture", exact=True)).to_have_count(0)
        expect(nav.get_by_text("Garden floor", exact=True)).to_have_count(0)
        expect(details.get_by_role("heading", name="Garden fixture", exact=True)).to_be_visible()
        nav.get_by_role("checkbox", name="Active: Room fixture").click()
        expect(nav.get_by_text("No active areas.", exact=False)).to_be_visible()
        nav.get_by_role("checkbox", name="Hide inactive").uncheck()
        nav.get_by_role("checkbox", name="Active: Room fixture").check()
        expect(details.get_by_role("heading", name="Garden fixture", exact=True)).to_be_visible()
        expect(details.get_by_text("Not wanted here.", exact=False)).to_be_visible()
        config = details.locator('fieldset[aria-label="Area configuration"]')
        expect(config).to_have_attribute("inert", "")
        self.assertTrue(config.evaluate("el => el.disabled && getComputedStyle(el).opacity === '0.5'"))
        expect(config.locator('input[aria-label="Motion lights: Garden fixture light"]')).to_be_disabled()
        self.page.screenshot(path=str(screenshot_dir() / "unwanted-area-configuration.png"))
        toggle.focus()
        self.page.keyboard.press("Tab")
        self.assertFalse(config.evaluate("el => el.contains(document.activeElement)"))
        self.assertTrue(details.get_by_role("tab", name="Description").is_enabled())
        self.assertTrue(details.get_by_role("navigation", name="Motion lights areas").get_by_role("button", name="Room fixture").is_enabled())
        config.locator('a[href]').first.evaluate("el => el.focus()")
        self.assertFalse(config.locator('a[href]').first.evaluate("el => document.activeElement === el"))
        expect(details.get_by_role("heading", name="Missing requirements")).to_have_count(0)
        expect(details.get_by_role("button", name=re.compile(r"^Add to Changes \(\d+\)$"))).to_be_disabled()
        toggle.check()
        expect(config).not_to_have_attribute("inert", "")
        details.get_by_role("heading", name="Missing requirements").wait_for()
        toggle.uncheck()
        expect(details.get_by_role("heading", name="Missing requirements")).to_have_count(0)
        self.assertEqual(saved["areas"]["garden_fixture"]["recipePreferences"], {"motion_lights": False, "occupancy": True})
        self.assertEqual(saved["entities"]["light.fixture_keep"], {"counts": False})
        details = open_recipe("Motion lights", "Room fixture")
        expect(details.get_by_role("checkbox", name="Active: Room fixture")).to_be_checked()
        details = open_recipe("Motion lights", "Garden fixture")
        toggle = details.get_by_role("checkbox", name="Active: Garden fixture")
        expect(toggle).not_to_be_checked()
        reject[0] = True
        toggle.check()
        details.get_by_role("alert").filter(has_text="Fixture save failed").wait_for()
        expect(toggle).not_to_be_checked()
        reject[0] = False
        toggle.check()
        nav.get_by_role("checkbox", name="Hide inactive").check()
        toggle.click()
        expect(nav.get_by_role("button", name="Garden fixture", exact=True)).to_have_count(0)
        expect(details.get_by_role("heading", name="Garden fixture", exact=True)).to_be_visible()
        expect(config).to_have_attribute("inert", "")
        nav.get_by_role("checkbox", name="Hide inactive").uncheck()
        toggle.check()
        nav.get_by_role("checkbox", name="Hide inactive").check()
        reject[0] = True
        toggle.click()
        nav.get_by_role("alert").filter(has_text="Fixture save failed").wait_for()
        expect(toggle).to_be_checked()
        reject[0] = False
        details = open_recipe("Occupancy", "Garden fixture")
        expect(details.get_by_role("checkbox", name="Active: Garden fixture")).to_be_checked()
        details.get_by_role("checkbox", name="Active: Garden fixture").uncheck()
        self.assertEqual(saved["areas"]["garden_fixture"]["recipePreferences"], {"motion_lights": True, "occupancy": False})
        self.assertEqual(blocked, [])

    def test_unwanted_installed_and_pending_recipe_warns_and_keeps_queue(self):
        blocked = []
        def guard(route):
            if route.request.method not in ("GET", "HEAD", "OPTIONS"):
                blocked.append((route.request.method, route.request.url))
                route.abort()
            else:
                route.continue_()
        self.page.route("**/api/**", guard)
        def fixture(h):
            template = copy.deepcopy(next(iter(h["areas"].values())))
            h["areas"] = {"garden_fixture": {**template, "id": "garden_fixture", "name": "Garden fixture", "floorId": None, "entityIds": [], "deviceIds": []}}
            h["floors"] = []
            h["looseAreaIds"] = ["garden_fixture"]
        self.hierarchy_fixture(fixture)
        saved = {"entities": {}, "areas": {"garden_fixture": {"recipePreferences": {"occupancy": True}}}}
        pending = {"id": 9001, "kind": "automation", "op": "create", "targetId": "taxis_occupancy_garden_fixture", "scope": None, "before": {}, "after": {}, "createdAt": ""}
        self.page.route("**/api/changes", lambda route: route.fulfill(json={"ok": True, "changes": [pending], "version": "fixture"}))
        self.page.route("**/api/recipes/state", lambda route: route.fulfill(json={"ok": True, "installed": {"blueprints": {}, "automations": {"taxis_occupancy_garden_fixture": {"alias": "Existing", "path": "taxis/occupancy.yaml", "input": {}}}, "scripts": {}, "timers": {}, "controllers": {}}}))
        def inventory(route):
            if route.request.method == "PUT":
                saved.clear()
                saved.update(route.request.post_data_json)
            route.fulfill(json={"ok": True, "inventory": saved})
        self.page.route("**/api/settings/inventory", inventory)
        self.page.goto(BASE + "/#automations/recipes", wait_until="networkidle")
        self.page.get_by_role("table", name="Recipe types").get_by_role("button", name="Occupancy", exact=True).click()
        details = self.page.get_by_role("article", name="Recipe details").first
        details.get_by_role("tab", name="Availability").click()
        details.get_by_role("button", name="Garden fixture", exact=True).click()
        details.get_by_role("checkbox", name="Active: Garden fixture").uncheck()
        details.get_by_text("The automation remains installed until changed in Home Assistant", exact=False).wait_for()
        details.get_by_text("Previously queued changes remain in Changes until removed", exact=False).wait_for()
        expect(details.get_by_role("button", name=re.compile(r"^Add to Changes"))).to_be_disabled()
        expect(details.get_by_role("link", name="Review related Changes (1)")).to_be_visible()
        self.assertEqual(saved["areas"]["garden_fixture"]["recipePreferences"], {"occupancy": False})
        self.assertEqual(blocked, [])

    def test_motion_lights_areas_remain_available_when_install_read_fails(self):
        def fixture(h):
            area = copy.deepcopy(next(iter(h["areas"].values())))
            area.update({"id": "unfloored_room", "name": "Unfloored room", "floorId": None, "entityIds": [], "deviceIds": []})
            h["areas"][area["id"]] = area
            h["looseAreaIds"].append(area["id"])
        self.hierarchy_fixture(fixture)
        self.page.route("**/api/recipes/state", lambda route: route.fulfill(status=502, json={"ok": False, "error": "Fixture unavailable"}))
        self.page.goto(BASE + "/#automations/recipes", wait_until="networkidle")
        self.page.get_by_role("table", name="Recipe types").get_by_role("button", name="Motion lights", exact=True).click()
        details = self.page.get_by_role("article", name="Recipe details").first
        details.get_by_role("tab", name="Availability").click()
        tree = details.get_by_role("navigation", name="Motion lights areas")
        tree.get_by_text("No floor", exact=True).wait_for()
        tree.get_by_role("button", name="Unfloored room", exact=True).click()
        self.assertEqual(tree.get_by_role("button", name="Unfloored room", exact=True).get_attribute("aria-current"), "true")
        details.get_by_role("heading", name="Unfloored room", exact=True).wait_for()
        details.get_by_text("No lights found in this area.").wait_for()
        details.get_by_text("Area occupancy virtual sensor", exact=False).first.wait_for()
        details.get_by_role("alert").filter(has_text="Fixture unavailable").wait_for()
        expect(details.get_by_role("button", name=re.compile(r"^Add to Changes \(\d+\)$"))).to_be_disabled()
        self.page.set_viewport_size({"width": 375, "height": 800})
        details.get_by_role("button", name="Back to areas").click()
        tree.get_by_role("button", name="Unfloored room", exact=True).click()
        details.get_by_role("heading", name="Unfloored room", exact=True).wait_for()
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"))

    def test_motion_lights_selections_save_overlap_reset_and_failure(self):
        def fixture(h):
            area = copy.deepcopy(next(iter(h["areas"].values())))
            area.update({"id": "lighting_fixture", "name": "Lighting fixture", "floorId": None, "entityIds": [], "deviceIds": []})
            h["areas"][area["id"]] = area
            h["looseAreaIds"].append(area["id"])
            base = next(iter(h["entities"].values()))
            for suffix in ["one", "two", "excluded"]:
                entity = {**copy.deepcopy(base), "entityId": "light.fixture_" + suffix, "name": "Fixture " + suffix, "domain": "light", "deviceClass": None, "platform": "demo", "members": [], "categoryScope": None, "deviceId": None, "areaId": area["id"], "ownAreaId": area["id"], "disabled": False, "hidden": False, "maintenance": False}
                h["entities"][entity["entityId"]] = entity
                area["entityIds"].append(entity["entityId"])
            h["entities"]["binary_sensor.lighting_fixture_occupied"] = {**copy.deepcopy(base), "entityId": "binary_sensor.lighting_fixture_occupied", "name": "Existing unrelated sensor", "domain": "binary_sensor", "platform": "demo", "areaId": None, "ownAreaId": None}
            h["entities"]["input_boolean.fixture_guest"] = {**copy.deepcopy(base), "entityId": "input_boolean.fixture_guest", "name": "Fixture guest", "domain": "input_boolean", "platform": "input_boolean", "state": "off", "disabled": False, "areaId": None, "ownAreaId": None}
            h["entities"]["input_boolean.fixture_bad"] = {**copy.deepcopy(base), "entityId": "input_boolean.fixture_bad", "name": "Incompatible fixture guest", "domain": "input_boolean", "platform": "demo", "state": "off", "disabled": False, "areaId": None, "ownAreaId": None}
        self.hierarchy_fixture(fixture)
        pending = {"id": 8001, "kind": "helper", "op": "create", "targetId": "timer.lighting_fixture_override", "scope": None, "before": {}, "after": {"entity_id": "timer.lighting_fixture_override"}, "createdAt": "2026-10-27T00:00:00Z"}
        self.page.route("**/api/changes", lambda route: route.fulfill(json={"ok": True, "changes": [pending], "version": "fixture"}))
        inventory = {"entities": {"light.fixture_two": {"light": "accent"}, "light.fixture_excluded": {"counts": False}}, "areas": {"lighting_fixture": {"recipePreferences": {"motion_lights": True}}}}
        self.page.route("**/api/settings/inventory", lambda route: route.fulfill(json={"ok": True, "inventory": inventory}))
        saved = {"house": {"day_brightness": 80}, "types": {}, "areas": {"other_room": {"day_brightness": 42}}}
        reject = [False]
        def parameters(route):
            if route.request.method == "PUT":
                if reject[0]:
                    route.fulfill(status=500, json={"ok": False, "error": "Fixture save failed"})
                    return
                saved.clear()
                saved.update(route.request.post_data_json)
            route.fulfill(json={"ok": True, "parameters": saved})
        self.page.route("**/api/settings/parameters", parameters)
        def open_room():
            self.page.goto(BASE + "/#automations/recipes", wait_until="networkidle")
            self.page.get_by_role("table", name="Recipe types").get_by_role("button", name="Motion lights", exact=True).click()
            details = self.page.get_by_role("article", name="Recipe details").first
            details.get_by_role("tab", name="Availability").click()
            details.get_by_role("navigation", name="Motion lights areas").get_by_role("button", name="Lighting fixture", exact=True).click()
            return details
        details = open_room()
        helpers = details.get_by_role("table", name="Recipe helpers")
        helpers.get_by_role("row").filter(has_text="binary_sensor.lighting_fixture_occupied").get_by_text("Conflict", exact=True).wait_for()
        helpers.get_by_role("row").filter(has_text="timer.lighting_fixture_override").get_by_text("In changes", exact=True).wait_for()
        helpers.get_by_role("row").filter(has_text="Light group").get_by_text("Missing", exact=True).wait_for()
        self.assertIn("text-danger", helpers.get_by_role("row").filter(has_text="binary_sensor.lighting_fixture_occupied").get_by_text("Conflict", exact=True).get_attribute("class"))
        self.assertIn("text-warn", helpers.get_by_role("row").filter(has_text="Light group").get_by_text("Missing", exact=True).get_attribute("class"))
        self.assertIn("text-muted", helpers.get_by_role("row").filter(has_text="Light level").get_by_text("Missing", exact=True).get_attribute("class"))
        self.assertEqual([header.inner_text() for header in helpers.get_by_role("columnheader").all()], ["Helper", "Status", "Purpose", "Action"])
        source_table = details.get_by_role("table", name="Area light sources")
        self.assertEqual([header.inner_text() for header in source_table.get_by_role("columnheader").all()], ["Entity", "Role"])
        params_table = details.get_by_role("table", name="Area parameters")
        self.assertEqual([header.inner_text() for header in params_table.get_by_role("columnheader").all()], ["Parameter", "Value", "Source"])
        for mode in ["Away mode switch", "Sleep mode switch", "Guest mode switch"]:
            params_table.get_by_role("button", name=re.compile(r"^" + mode + r" for Lighting fixture:")).wait_for()
        params_table.get_by_role("button", name=re.compile(r"^Guest mode switch for Lighting fixture:")).click()
        guest_edit = params_table.get_by_label("Guest mode switch for Lighting fixture", exact=True)
        guest_edit.fill("input_boolean.fixture_guest")
        guest_edit.press("Enter")
        params_table.get_by_role("button", name=re.compile(r"^Guest mode switch for Lighting fixture: input_boolean.fixture_guest, set here")).wait_for()
        self.assertEqual(saved["areas"]["lighting_fixture"]["guest_mode_entity"], "input_boolean.fixture_guest")
        helpers.get_by_role("row").filter(has_text="input_boolean.fixture_guest").get_by_text("External selection").wait_for()
        helpers.get_by_role("row").filter(has_text="input_boolean.fixture_guest").get_by_text("Existing", exact=True).wait_for()
        params_table.get_by_role("button", name=re.compile(r"^Guest mode switch for Lighting fixture:")).click()
        guest_edit = params_table.get_by_label("Guest mode switch for Lighting fixture", exact=True)
        guest_edit.fill("input_boolean.fixture_bad")
        guest_edit.press("Enter")
        helpers.get_by_role("row").filter(has_text="input_boolean.fixture_bad").get_by_text("Conflict", exact=True).wait_for()
        params_table.get_by_role("button", name=re.compile(r"^Guest mode switch for Lighting fixture:")).click()
        guest_edit = params_table.get_by_label("Guest mode switch for Lighting fixture", exact=True)
        guest_edit.fill("input_boolean.fixture_guest")
        guest_edit.press("Enter")
        helpers.get_by_role("row").filter(has_text="input_boolean.fixture_guest").get_by_text("Existing", exact=True).wait_for()
        self.page.goto(BASE + "/#parameters/house", wait_until="networkidle")
        self.page.get_by_role("button", name="Columns of House").click()
        self.page.get_by_role("group", name="Columns").get_by_label(re.compile(r"^Guest mode switch")).check()
        self.page.get_by_role("button", name="Columns of House").click()
        self.page.get_by_role("button", name=re.compile(r"^Guest mode switch for Lighting fixture: input_boolean.fixture_guest, set here")).wait_for()
        details = open_room()
        motion = details.get_by_role("group", name="Motion lights", exact=True)
        ambient = details.get_by_role("group", name="Ambient lights", exact=True)
        night = details.get_by_role("group", name="Night lights", exact=True)
        expect(details.get_by_role("checkbox", name="Motion lights: Fixture one", exact=True)).to_be_checked()
        last_motion = details.get_by_role("checkbox", name="Motion lights: Fixture one", exact=True)
        expect(last_motion).to_be_disabled()
        info = details.get_by_role("button", name="Why one Motion light is required")
        info.focus()
        expect(self.page.get_by_role("tooltip")).to_contain_text("At least one Motion light must remain selected.")
        self.page.screenshot(path=str(screenshot_dir() / "motion-light-roles-tooltip.png"))
        info.press("Escape")
        details.get_by_role("checkbox", name="Main lights: Fixture two", exact=True).check()
        details.get_by_role("checkbox", name="Strong lights: Fixture one", exact=True).check()
        self.assertEqual(sorted(saved["areas"]["lighting_fixture"]["main_lights"]), ["light.fixture_one", "light.fixture_two"])
        self.assertEqual(saved["areas"]["lighting_fixture"]["strong_lights"], ["light.fixture_one"])
        expect(details.get_by_role("checkbox", name="Ambient lights: Fixture two", exact=True)).to_be_checked()
        for checkbox in details.get_by_role("checkbox", name=re.compile("Fixture excluded")).all():
            self.assertTrue(checkbox.is_disabled())
        details.get_by_role("checkbox", name="Ambient lights: Fixture one", exact=True).check()
        expect(details.get_by_role("checkbox", name="Ambient lights: Fixture one", exact=True)).to_be_checked()
        details.get_by_role("checkbox", name="Night lights: Fixture one", exact=True).check()
        expect(details.get_by_role("checkbox", name="Night lights: Fixture one", exact=True)).to_be_checked()
        self.assertEqual(sorted(saved["areas"]["lighting_fixture"]["ambient_lights"]), ["light.fixture_one", "light.fixture_two"])
        self.assertEqual(saved["areas"]["lighting_fixture"]["night_lights"], ["light.fixture_one"])
        self.assertEqual(saved["areas"]["other_room"]["day_brightness"], 42)
        brightness = details.get_by_role("button", name=re.compile(r"^Day brightness for Lighting fixture: 80 %.*, from the house default"))
        brightness.click()
        edit = details.get_by_label("Day brightness for Lighting fixture", exact=True)
        edit.fill("65")
        edit.press("Enter")
        details.get_by_role("button", name=re.compile(r"^Day brightness for Lighting fixture: 65 %.*, set here")).wait_for()
        self.assertEqual(saved["areas"]["lighting_fixture"]["day_brightness"], 65)
        self.page.goto(BASE + "/#parameters/lighting", wait_until="networkidle")
        self.page.get_by_role("button", name=re.compile(r"^Day brightness for Lighting fixture: 65 %.*, set here")).wait_for()
        self.page.get_by_role("button", name="Columns of Lighting").click()
        columns = self.page.get_by_role("group", name="Columns")
        columns.get_by_label(re.compile(r"^Ambient lights")).check()
        self.page.get_by_role("button", name="Columns of Lighting").click()
        self.page.get_by_role("button", name="Ambient lights for Lighting fixture: 2 lights, set here", exact=True).click()
        dialog = self.page.get_by_role("dialog", name="Ambient lights for Lighting fixture")
        dialog.get_by_role("checkbox", name="Fixture one is ambient lights for Lighting fixture", exact=True).uncheck()
        self.assertEqual(saved["areas"]["lighting_fixture"]["ambient_lights"], ["light.fixture_two"])
        self.page.keyboard.press("Escape")
        details = open_room()
        ambient = details.get_by_role("group", name="Ambient lights", exact=True)
        expect(details.get_by_role("checkbox", name="Ambient lights: Fixture one", exact=True)).not_to_be_checked()
        details.get_by_role("checkbox", name="Ambient lights: Fixture one", exact=True).check()
        details = open_room()
        details.get_by_role("button", name="Clear Day brightness for Lighting fixture").click()
        details.get_by_role("button", name=re.compile(r"^Day brightness for Lighting fixture: 80 %.*, from the house default")).wait_for()
        self.page.reload(wait_until="networkidle")
        details = open_room()
        ambient = details.get_by_role("group", name="Ambient lights", exact=True)
        expect(details.get_by_role("checkbox", name="Ambient lights: Fixture one", exact=True)).to_be_checked()
        details.get_by_role("checkbox", name="Ambient lights: Fixture one", exact=True).uncheck()
        details.get_by_role("checkbox", name="Ambient lights: Fixture two", exact=True).uncheck()
        self.assertEqual(saved["areas"]["lighting_fixture"]["ambient_lights"], [])
        ambient.get_by_role("button", name="Use defaults").click()
        expect(details.get_by_role("checkbox", name="Ambient lights: Fixture two", exact=True)).to_be_checked()
        self.assertNotIn("ambient_lights", saved["areas"]["lighting_fixture"])
        reject[0] = True
        details.get_by_role("checkbox", name="Ambient lights: Fixture one", exact=True).check()
        details.get_by_role("alert").filter(has_text="Fixture save failed").wait_for()
        expect(details.get_by_role("checkbox", name="Ambient lights: Fixture one", exact=True)).not_to_be_checked()
        self.assertNotIn("ambient_lights", saved["areas"]["lighting_fixture"])

    def test_area_types_queue_native_labels(self):
        # This test modifies the queue, so run only against an explicitly opted-in isolated mock.
        if os.environ.get("TAXIS_ALLOW_QUEUE_TEST") != "1":
            self.skipTest("requires an isolated mock and TAXIS_ALLOW_QUEUE_TEST=1")
        self.page.unroute("**/api/hierarchy*")
        unexpected_writes = []
        def guard_writes(route):
            if route.request.method not in ("GET", "HEAD", "OPTIONS") and not route.request.url.endswith("/api/changes"):
                unexpected_writes.append((route.request.method, route.request.url))
                route.abort()
            else:
                route.continue_()
        self.page.route("**/api/**", guard_writes)
        with urllib.request.urlopen(BASE + "/api/changes") as response:
            self.assertEqual(json.load(response)["changes"], [])
        self.page.goto(BASE + "/#area/study", wait_until="networkidle")
        area = self.page.get_by_role("region", name="Area classification")
        # Fail the second stage once: the new label should remain available for retry.
        def reject_assignment(route):
            body = route.request.post_data_json
            if route.request.method == "POST" and body.get("kind") == "area":
                route.fulfill(status=500, json={"ok": False, "error": "Fixture area failure"})
            else:
                route.continue_()
        self.page.route("**/api/changes", reject_assignment)
        area.get_by_role("checkbox", name="Bedroom", exact=True).click()
        area.get_by_role("alert").filter(has_text="Labels were queued, but the area assignment failed").wait_for()
        expect(area.get_by_role("checkbox", name="Bedroom", exact=True)).not_to_be_checked()
        self.page.unroute("**/api/changes", reject_assignment)
        def queue_type(region, name):
            checkbox = region.get_by_role("checkbox", name=name, exact=True)
            with self.page.expect_response(lambda response: response.url.endswith("/api/changes") and response.request.method == "POST" and response.request.post_data_json.get("kind") == "area") as result:
                checkbox.click()
            self.assertTrue(result.value.ok)
            expect(checkbox).to_be_enabled()
        queue_type(area, "Bedroom")
        expect(area.get_by_role("checkbox", name="Bedroom", exact=True)).to_be_checked()
        expect(area.get_by_text("Area labels queued in", exact=False)).to_be_visible()
        queue_type(area, "Bathroom")
        expect(area.get_by_role("checkbox", name="Bathroom", exact=True)).to_be_checked()
        self.page.reload(wait_until="networkidle")
        expect(area.get_by_role("checkbox", name="Bedroom", exact=True)).to_be_checked()
        expect(area.get_by_role("checkbox", name="Bathroom", exact=True)).to_be_checked()
        with urllib.request.urlopen(BASE + "/api/changes") as response:
            changes = json.load(response)["changes"]
        self.assertEqual(sum(c["kind"] == "label" and c["after"].get("name") == "Bedroom" for c in changes), 1)
        self.assertEqual(sum(c["kind"] == "label" and c["after"].get("name") == "Bathroom" for c in changes), 1)
        updates = [c for c in changes if c["kind"] == "area" and c["targetId"] == "study"]
        self.assertIn("kids", updates[-1]["after"]["labels"])
        self.assertEqual(len(updates[-1]["after"]["labels"]), 3)
        # Simulate another tab adding Office while this tab still shows the old preview.
        headers = {"X-Taxis-Request": "1", "Content-Type": "application/json"}
        response = self.page.request.post(BASE + "/api/changes", headers=headers, data={"kind": "label", "op": "create", "fields": {"name": "Office"}})
        self.assertTrue(response.ok)
        with urllib.request.urlopen(BASE + "/api/hierarchy") as response:
            preview = json.load(response)["hierarchy"]
        office = next(label["id"] for label in preview["labels"].values() if label["name"] == "Office")
        labels = preview["areas"]["study"]["labels"] + [office]
        response = self.page.request.post(BASE + "/api/changes", headers=headers, data={"kind": "area", "op": "update", "targetId": "study", "fields": {"labels": labels}})
        self.assertTrue(response.ok)
        queue_type(area, "Garden")
        expect(area.get_by_role("checkbox", name="Garden", exact=True)).to_be_checked()
        expect(area.get_by_role("checkbox", name="Office / study", exact=True)).to_be_checked()
        self.page.screenshot(path=str(screenshot_dir() / "area-types-native-queued.png"))
        self.page.goto(BASE + "/#area/bathroom", wait_until="networkidle")
        area = self.page.get_by_role("region", name="Area classification")
        expect(area.get_by_text("Suggested from existing settings/name")).to_be_visible()
        expect(area.get_by_role("checkbox", name="Bathroom", exact=True)).not_to_be_checked()
        queue_type(area, "Bathroom")
        expect(area.get_by_role("checkbox", name="Bathroom", exact=True)).to_be_checked()
        queue_type(area, "Bathroom")
        expect(area.get_by_role("checkbox", name="Other", exact=True)).to_be_checked()
        expect(area.get_by_text("Suggested from existing settings/name")).to_have_count(0)
        self.page.goto(BASE + "/#area/loft", wait_until="networkidle")
        area = self.page.get_by_role("region", name="Area classification")
        queue_type(area, "Bedroom")
        expect(area.get_by_role("checkbox", name="Bedroom", exact=True)).to_be_checked()
        with urllib.request.urlopen(BASE + "/api/changes") as response:
            changes = json.load(response)["changes"]
        self.assertEqual(sum(c["kind"] == "label" and c["after"].get("name") == "Bedroom" for c in changes), 1)
        def check_humidity(room, visible):
            self.page.goto(BASE + "/#automations/recipes", wait_until="networkidle")
            self.page.get_by_role("table", name="Recipe types").get_by_role("button", name="Occupancy", exact=True).click()
            details = self.page.get_by_role("article", name="Recipe details").first
            details.get_by_role("tab", name="Availability").click()
            details.get_by_role("navigation", name="Recipe areas").get_by_role("button", name=room, exact=True).click()
            item = details.get_by_text("Measures how quickly humidity rises for Ventilation (optional)", exact=True)
            if visible: expect(item).to_be_visible()
            else: expect(item).to_have_count(0)
        check_humidity("Study", True)
        check_humidity("Bathroom", False)
        # Only this test's queue was present at start; discard it and verify the
        # inferred classification returns without writing inventory or HA.
        response = self.page.request.delete(BASE + "/api/changes", headers={"X-Taxis-Request": "1", "Content-Type": "application/json"})
        self.assertTrue(response.ok)
        self.page.goto(BASE + "/#area/bathroom", wait_until="networkidle")
        self.page.reload(wait_until="networkidle")
        area = self.page.get_by_role("region", name="Area classification")
        expect(area.get_by_text("Suggested from existing settings/name", exact=False)).to_be_visible()
        expect(area.get_by_role("checkbox", name="Bathroom", exact=True)).not_to_be_checked()
        check_humidity("Bathroom", True)
        self.assertEqual(unexpected_writes, [])

    def test_recipe_area_sources_share_inventory_and_report_failure(self):
        def fixture(h):
            area = copy.deepcopy(next(iter(h["areas"].values())))
            area.update({"id": "source_fixture", "name": "Source fixture", "floorId": None, "entityIds": [], "deviceIds": []})
            h["areas"][area["id"]] = area
            h["looseAreaIds"].append(area["id"])
            base = next(iter(h["entities"].values()))
            entity = {**copy.deepcopy(base), "entityId": "binary_sensor.fixture_motion", "name": "Fixture motion", "domain": "binary_sensor", "deviceClass": "motion", "platform": "demo", "members": [], "categoryScope": None, "deviceId": None, "areaId": area["id"], "ownAreaId": area["id"], "disabled": False, "hidden": False, "maintenance": False}
            h["entities"][entity["entityId"]] = entity
            area["entityIds"].append(entity["entityId"])
        self.hierarchy_fixture(fixture)
        saved = {"entities": {"binary_sensor.fixture_motion": {"counts": False}, "light.keep": {"counts": False}}, "areas": {}}
        reject = [False]
        def inventory(route):
            if route.request.method == "PUT":
                if reject[0]:
                    route.fulfill(status=500, json={"ok": False, "error": "Fixture inventory failure"})
                    return
                saved.clear()
                saved.update(route.request.post_data_json)
            route.fulfill(json={"ok": True, "inventory": saved})
        self.page.route("**/api/settings/inventory", inventory)
        self.page.goto(BASE + "/#automations/recipes", wait_until="networkidle")
        self.page.get_by_role("table", name="Recipe types").get_by_role("button", name="Occupancy", exact=True).click()
        details = self.page.get_by_role("article", name="Recipe details").first
        details.get_by_role("tab", name="Availability").click()
        details.get_by_role("navigation", name="Recipe areas").get_by_role("button", name="Source fixture", exact=True).click()
        include = details.get_by_role("checkbox", name=re.compile("Fixture motion"))
        role = details.get_by_role("combobox", name="Occupancy role: Fixture motion")
        self.assertTrue(role.is_enabled())
        role.select_option("holds")
        expect(role).to_have_value("holds")
        self.assertFalse(include.is_checked())
        self.assertFalse(saved["entities"]["binary_sensor.fixture_motion"]["counts"])
        reject[0] = True
        role.select_option("starts")
        details.get_by_role("alert").filter(has_text="Fixture inventory failure").wait_for()
        expect(role).to_have_value("holds")
        self.assertFalse(include.is_checked())
        self.assertFalse(saved["entities"]["binary_sensor.fixture_motion"]["counts"])
        reject[0] = False
        include.check()
        expect(include).to_be_checked()
        expect(role).to_have_value("holds")
        self.assertEqual(saved["entities"]["binary_sensor.fixture_motion"]["role"], "holds")
        self.assertEqual(saved["entities"]["light.keep"], {"counts": False})
        self.page.reload(wait_until="networkidle")
        self.page.get_by_role("table", name="Recipe types").get_by_role("button", name="Occupancy", exact=True).click()
        details.get_by_role("tab", name="Availability").click()
        details.get_by_role("navigation", name="Recipe areas").get_by_role("button", name="Source fixture", exact=True).click()
        include = details.get_by_role("checkbox", name=re.compile("Fixture motion"))
        role = details.get_by_role("combobox", name="Occupancy role: Fixture motion")
        expect(role).to_have_value("holds")
        reject[0] = True
        include.uncheck()
        details.get_by_role("alert").filter(has_text="Fixture inventory failure").wait_for()
        expect(include).to_be_checked()
        self.assertEqual(saved["entities"]["binary_sensor.fixture_motion"]["role"], "holds")

    def test_house_presence_candidates_and_group_members_are_backed_by_helpers(self):
        def fixture(h):
            template = copy.deepcopy(next(iter(h["areas"].values())))
            base = copy.deepcopy(next(iter(h["entities"].values())))
            h["entities"].pop("binary_sensor.taxis_areas_occupied", None)
            for name in ["candidate_real", "candidate_pending", "candidate_absent"]:
                h["areas"][name] = {**copy.deepcopy(template), "id": name, "name": name, "floorId": None, "entityIds": [], "deviceIds": []}
                h["looseAreaIds"].append(name)
            entity_id = "binary_sensor.candidate_real_occupied"
            h["entities"][entity_id] = {**base, "entityId": entity_id, "name": "Real occupancy helper", "domain": "binary_sensor", "platform": "template", "inRegistry": True, "configEntryId": "fixture", "areaId": None, "ownAreaId": None}
        self.hierarchy_fixture(fixture)
        pending = {"id": 9111, "kind": "helper", "op": "create", "targetId": "binary_sensor.candidate_pending_occupied", "scope": None, "before": {}, "after": {"entity_id": "binary_sensor.candidate_pending_occupied", "name": "Pending occupancy helper"}, "createdAt": "2026-10-27T00:00:00Z"}
        changes = [pending]
        self.page.route("**/api/changes", lambda route: route.fulfill(json={"ok": True, "changes": changes, "version": str(len(changes))}))
        def show():
            self.page.goto(BASE + "/#automations/recipes", wait_until="networkidle")
            self.page.reload(wait_until="networkidle")
            self.page.get_by_role("table", name="Recipe types").get_by_role("button", name="House presence", exact=True).click()
            details = self.page.get_by_role("article", name="Recipe details").first
            details.get_by_role("tab", name="Availability").click()
            details.get_by_role("navigation", name="Recipe scopes").get_by_role("button", name="All areas (legacy)").click()
            return details
        details = show()
        details.get_by_text("Candidate area occupancy sensors", exact=False).first.wait_for()
        details.get_by_text(re.compile(r"Real occupancy helper.*binary_sensor.candidate_real_occupied")).wait_for()
        details.get_by_text(re.compile(r"Pending occupancy helper.*binary_sensor.candidate_pending_occupied.*In changes")).wait_for()
        self.assertEqual(details.get_by_text("binary_sensor.candidate_absent_occupied", exact=True).count(), 0)
        changes.append({"id": 9112, "kind": "helper", "op": "create", "targetId": "binary_sensor.taxis_areas_occupied", "scope": None, "before": {}, "after": {"entity_id": "binary_sensor.taxis_areas_occupied", "entities": ["binary_sensor.candidate_absent_occupied", "binary_sensor.candidate_pending_occupied"]}, "createdAt": "2026-10-27T00:00:00Z"})
        details = show()
        details.get_by_text("Planned area group members", exact=False).first.wait_for()
        missing = details.get_by_text(re.compile(r"Missing from current snapshot.*binary_sensor.candidate_absent_occupied"))
        missing.wait_for()
        self.assertEqual(missing.inner_text().count("binary_sensor.candidate_absent_occupied"), 1)
        details.get_by_text(re.compile(r"Pending occupancy helper.*binary_sensor.candidate_pending_occupied.*In changes")).wait_for()

    def test_house_recipe_parameter_shared_with_parameters(self):
        saved = {"house": {}, "types": {}, "areas": {"other_room": {"day_brightness": 42}}}
        def parameters(route):
            if route.request.method == "PUT":
                saved.clear()
                saved.update(route.request.post_data_json)
            route.fulfill(json={"ok": True, "parameters": saved})
        self.page.route("**/api/settings/parameters", parameters)
        self.page.goto(BASE + "/#automations/recipes", wait_until="networkidle")
        self.page.get_by_role("table", name="Recipe types").get_by_role("button", name="Low batteries", exact=True).click()
        details = self.page.get_by_role("article", name="Recipe details").first
        details.get_by_role("tab", name="Availability").click()
        details.get_by_role("navigation", name="Recipe scopes").get_by_role("button", name="All areas (legacy)").click()
        params_table = details.get_by_role("table", name="House parameters")
        self.assertEqual([header.inner_text() for header in params_table.get_by_role("columnheader").all()], ["Parameter", "Value", "Source"])
        details.get_by_role("button", name=re.compile(r"^Battery low below for House default:")).click()
        edit = details.get_by_label("Battery low below for House default", exact=True)
        edit.fill("30")
        edit.press("Enter")
        details.get_by_role("button", name=re.compile(r"^Battery low below for House default: 30 %.*, set here")).wait_for()
        self.assertEqual(saved["house"]["battery_threshold"], 30)
        self.assertEqual(saved["areas"]["other_room"]["day_brightness"], 42)
        self.page.goto(BASE + "/#parameters/safety", wait_until="networkidle")
        self.page.get_by_role("button", name="Columns of Safety").click()
        self.page.get_by_role("group", name="Columns").get_by_label(re.compile(r"^Battery low below")).check()
        self.page.get_by_role("button", name="Columns of Safety").click()
        self.page.get_by_role("button", name=re.compile(r"^Battery low below for House default: 30 %.*, set here")).wait_for()

    def test_recipe_pane_has_independent_width_and_no_column_chooser(self):
        self.page.goto(BASE + "/#automations/recipes", wait_until="networkidle")
        self.page.evaluate("""() => {
            localStorage.setItem('taxis:records:pane', JSON.stringify({list: 416}));
            localStorage.removeItem('taxis:recipes:pane');
            localStorage.setItem('taxis:table:v3:recipe-types', JSON.stringify({show: [], hide: ['recipe'], widths: {recipe: 900}}));
        }""")
        self.page.reload(wait_until="networkidle")
        pane = self.page.locator("section[aria-label='Records']")
        table = self.page.get_by_role("table", name="Recipe types", exact=True)
        self.assertAlmostEqual(pane.bounding_box()["width"], 240, delta=2)
        self.assertEqual(self.page.get_by_role("button", name="Columns of Recipe types").count(), 0)
        self.assertTrue(table.get_by_role("button", name="Occupancy", exact=True).is_visible())
        divider = self.page.get_by_role("separator", name="Resize records and properties")
        divider.focus()
        for _ in range(8):
            self.page.keyboard.press("ArrowLeft")
        self.assertAlmostEqual(pane.bounding_box()["width"], 140, delta=2)
        self.page.reload(wait_until="networkidle")
        self.assertAlmostEqual(pane.bounding_box()["width"], 140, delta=2)
        self.assertLessEqual(table.evaluate("el => el.scrollWidth - el.parentElement.clientWidth"), 1)
        for button in table.locator("tbody button").all():
            self.assertTrue(button.is_visible())
            self.assertLessEqual(button.evaluate("el => el.scrollWidth - el.clientWidth"), 1)
            self.assertEqual(button.evaluate("el => getComputedStyle(el).whiteSpace"), "normal")
        divider.focus()
        for _ in range(12):
            self.page.keyboard.press("ArrowRight")
        self.assertAlmostEqual(pane.bounding_box()["width"], 320, delta=2)
        self.page.reload(wait_until="networkidle")
        self.assertAlmostEqual(pane.bounding_box()["width"], 320, delta=2)
        self.assertEqual(self.page.get_by_role("button", name="Reset layout", exact=True).count(), 0)
        self.assertEqual(self.page.evaluate("JSON.parse(localStorage.getItem('taxis:records:pane')).list"), 416)
        self.page.goto(BASE + "/#organize/devices", wait_until="networkidle")
        self.page.get_by_role("button", name="Records", exact=True).click()
        self.assertTrue(self.page.get_by_role("button", name="Columns of Devices list").is_visible())
        self.assertAlmostEqual(self.page.locator("section[aria-label='Records']").bounding_box()["width"], 416, delta=2)

    def test_recipes_explain_when_installed_state_is_unavailable(self):
        self.page.route("**/api/recipes/state", lambda route: route.fulfill(status=502, json={"ok": False, "error": "Fixture unavailable"}))
        self.page.goto(BASE + "/#automations/recipes", wait_until="networkidle")
        table = self.page.get_by_role("table", name="Recipe types", exact=True)
        self.assertEqual(table.locator("tbody tr").count(), 15)
        details = self.page.get_by_role("article", name="Recipe details").first
        table.get_by_role("button", name="Goodbye", exact=True).click()
        details.get_by_role("heading", name="Goodbye", exact=True).wait_for()
        self.assertTrue(details.get_by_role("heading", name="How it works").is_visible())
        details.get_by_role("tab", name="Availability").click()
        self.assertTrue(details.get_by_role("alert").filter(has_text="Fixture unavailable").is_visible())
        expect(details.get_by_role("button", name=re.compile(r"^Add to Changes \(\d+\)$"))).to_be_disabled()

    def test_recipe_type_navigation_on_phone(self):
        self.page.set_viewport_size({"width": 375, "height": 800})
        self.page.goto(BASE + "/#automations/recipes", wait_until="networkidle")
        table = self.page.get_by_role("table", name="Recipe types", exact=True)
        table.get_by_role("button", name="Motion lights", exact=True).click()
        details = self.page.get_by_role("article", name="Recipe details").first
        details.get_by_role("heading", name="Motion lights", exact=True).wait_for()
        self.assertFalse(table.is_visible())
        description = details.get_by_role("tab", name="Description")
        description.focus()
        self.page.keyboard.press("ArrowRight")
        self.assertEqual(details.get_by_role("tab", name="Availability").get_attribute("aria-selected"), "true")
        details.get_by_role("heading", name="Availability by area").wait_for()
        self.page.keyboard.press("Home")
        self.assertEqual(description.get_attribute("aria-selected"), "true")
        details.get_by_role("button", name="Back to recipes").click()
        self.assertTrue(table.is_visible())

    def test_device_details_include_entities(self):
        self.page.goto(BASE + "/#organize/devices", wait_until="networkidle")
        self.page.get_by_role("button", name="Records", exact=True).click()
        self.page.locator("table[aria-label='Devices list'] tbody tr").first.click()
        section = self.page.locator("section[aria-label='Properties']")
        section.get_by_role("heading", name=re.compile(r"^Entities \(")).wait_for()
        self.assertGreater(section.locator("a[href^='#organize/entities/']").count(), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
