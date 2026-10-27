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
from playwright.sync_api import sync_playwright

BASE = os.environ.get("TAXIS_TEST_URL", "http://localhost:5173")


class DesktopRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urllib.request.urlopen(BASE + "/api/hierarchy", timeout=20) as response:
            cls.hierarchy_body = json.load(response)
        if not cls.hierarchy_body.get("ok"):
            raise RuntimeError("Start the mock Home Assistant and Taxis server before running browser checks")
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
            headless=True, args=["--no-sandbox"],
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1000})
        self.page = self.context.new_page()
        self.page.set_default_timeout(15000)
        self.page.route("**/api/hierarchy*", lambda route: route.fulfill(json=copy.deepcopy(self.hierarchy_body)))
        self.page.route("**/api/history", lambda route: route.fulfill(json={"ok": True, "runs": []}))
        self.page.route("**/api/repairs", lambda route: route.fulfill(json={"ok": True, "repairs": []}))

    def tearDown(self):
        self.context.close()

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
        self.page.get_by_role("button", name=re.compile(r"^Remove:")).click()
        self.page.get_by_role("button", name="Remove", exact=True).click()
        self.page.get_by_text("Simulated remove failure", exact=True).wait_for()
        self.assertEqual(self.page.get_by_text("Regression fixture", exact=True).count(), 1)

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
        self.page.locator(".records-table tbody tr").first.click()
        self.page.locator("#dev-name").fill("Unsaved device draft")
        self.page.once("dialog", lambda dialog: dialog.dismiss())
        self.page.get_by_role("button", name="Cancel", exact=True).click()
        self.assertEqual(self.page.locator("#dev-name").input_value(), "Unsaved device draft")
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.get_by_role("button", name="Cancel", exact=True).click()
        self.assertEqual(self.page.locator("#dev-name").count(), 0)

    def test_empty_table_filters_remain_recoverable(self):
        self.page.goto(BASE + "/#organize/devices", wait_until="networkidle")
        self.page.get_by_label("Manufacturer", exact=True).select_option(label="Sonoff")
        self.page.get_by_role("button", name="Filter records by area").click()
        self.page.get_by_role("group", name="Areas", exact=True).get_by_text("Bedroom", exact=True).click()
        self.page.keyboard.press("Escape")
        self.page.get_by_text("No matching devices or entities.", exact=False).wait_for()
        self.assertTrue(self.page.get_by_label("Manufacturer", exact=True).is_visible())
        self.page.get_by_role("button", name="Reset filters", exact=True).first.click()
        self.assertGreater(self.page.locator("tbody tr").count(), 0)

    def test_label_without_matches_does_not_keep_unrelated_devices(self):
        self.page.goto(BASE + "/#organize/devices", wait_until="networkidle")
        self.page.get_by_label("Label", exact=True).select_option(label="Kids")
        self.page.get_by_text("No matching devices or entities.", exact=False).wait_for()
        self.assertEqual(self.page.locator("tbody tr").count(), 0)

    def test_record_sizes_persist_and_reset(self):
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
        drag(self.page.get_by_role("separator", name="Resize records and properties"), 80)
        self.assertAlmostEqual(pane.bounding_box()["width"], original + 80, delta=2)
        column = self.page.get_by_role("separator", name="Resize Name column", exact=True)
        initial_column = column.locator("..").bounding_box()["width"]
        drag(column, 60)
        self.assertAlmostEqual(column.locator("..").bounding_box()["width"], initial_column + 60, delta=2)
        self.page.reload(wait_until="networkidle")
        self.assertAlmostEqual(pane.bounding_box()["width"], original + 80, delta=2)
        self.assertAlmostEqual(column.locator("..").bounding_box()["width"], initial_column + 60, delta=2)
        self.page.get_by_role("button", name="Reset layout", exact=True).click()
        self.assertAlmostEqual(pane.bounding_box()["width"], original, delta=2)
        self.assertAlmostEqual(column.locator("..").bounding_box()["width"], initial_column, delta=2)

    def test_helpers_navigation_excludes_ordinary_entities(self):
        def fixture(h):
            base = next(iter(h["entities"].values()))
            helper = {**copy.deepcopy(base), "entityId": "input_boolean.regression_helper", "name": "Regression helper", "domain": "input_boolean", "role": "helper", "categoryScope": "helpers", "deviceId": None, "areaId": None}
            ordinary = {**copy.deepcopy(base), "entityId": "sensor.regression_ordinary", "name": "Regression ordinary", "domain": "sensor", "role": "sensor", "categoryScope": None, "deviceId": None, "areaId": None}
            h["entities"] = {helper["entityId"]: helper, ordinary["entityId"]: ordinary}
        self.hierarchy_fixture(fixture)
        self.page.goto(BASE + "/#organize/helpers", wait_until="networkidle")
        self.page.get_by_role("navigation", name="What to organize").get_by_role("button", name=re.compile(r"^Helpers")).wait_for()
        table = self.page.locator(".records-table")
        self.assertEqual(table.get_by_text("Regression helper", exact=True).count(), 1)
        self.assertEqual(table.get_by_text("Regression ordinary", exact=True).count(), 0)

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
        self.page.get_by_role("checkbox", name="Show entities", exact=True).check()
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
        self.page.locator(".records-table tbody tr").first.wait_for()
        self.assertEqual(self.page.locator(".records-table tbody tr").count(), 100)
        for _ in range(5):
            self.page.get_by_role("button", name="Next page", exact=True).click()
        self.assertEqual(self.page.locator(".records-table tbody tr").count(), 1)
        self.page.locator(".records-table").get_by_text("Record 500", exact=True).wait_for()

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
        counted = self.page.get_by_role("button", name="Tooltip room, Lights: 2 counted", exact=True)
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
        excluded = self.page.get_by_role("button", name="Tooltip room, Lights: 1 not counted", exact=True)
        excluded.focus()
        tooltip = self.page.get_by_role("tooltip")
        tooltip.get_by_text("Fixture excluded light", exact=True).wait_for()
        self.assertEqual(tooltip.locator("li").count(), 1)
        self.assertEqual(tooltip.get_by_text("light.tooltip_excluded", exact=True).count(), 1)
        self.page.keyboard.press("Escape")
        self.page.get_by_role("button", name="Total, Lights: 2 counted", exact=True).focus()
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
                value = route.request.post_data_json
                posted.append(value)
                fields = value.get("fields", {})
                queued.append({"id": 1000 + len(queued), "kind": value["kind"], "op": value["op"], "scope": value.get("scope"), "targetId": value.get("targetId") or fields.get("entity_id") or fields.get("path") or fields.get("automation_id") or "fixture", "before": {}, "after": fields, "createdAt": "2026-10-27T00:00:00Z"})
            route.fulfill(json={"ok": True, "changes": queued, "version": "fixture-" + str(len(queued))})
        self.page.route("**/api/changes", changes)
        self.page.goto(BASE + "/#recipes", wait_until="networkidle")
        self.page.get_by_role("heading", name="Recipes", exact=True).wait_for()
        self.page.get_by_role("group", name="Recipe view").get_by_role("button", name="Records", exact=True).click()
        self.page.get_by_role("textbox", name="Find recipes").fill("Occupancy")
        self.page.get_by_label("Recipe status", exact=True).select_option("ready")
        records = self.page.locator("section[aria-label='Records']")
        records.locator("tbody tr").filter(has_text="Bathroom").click()
        details = self.page.get_by_role("article", name="Recipe details")
        details.get_by_role("heading", name="Occupancy · Bathroom", exact=True).wait_for()
        self.assertTrue(details.get_by_role("heading", name="How it behaves", exact=True).is_visible())
        self.assertTrue(details.get_by_role("heading", name="Current installation", exact=True).is_visible())
        heading = details.get_by_role("heading", name=re.compile(r"^\d+ proposed changes?$")).inner_text()
        expected = int(heading.split()[0])
        self.assertGreater(expected, 0)
        details.get_by_role("button", name="Add to changes", exact=True).click()
        self.page.get_by_role("status").filter(has_text="changes added to the list").wait_for()
        self.assertEqual(len(posted), expected)
        self.assertTrue(any(item["kind"] == "automation" for item in posted))
        self.page.get_by_role("group", name="Recipe view").get_by_role("button", name="Table", exact=True).click()
        self.assertTrue(self.page.get_by_role("checkbox", name="Select all that can be added", exact=True).is_visible())
        self.page.get_by_role("group", name="Recipe view").get_by_role("button", name="Records", exact=True).click()
        self.page.reload(wait_until="networkidle")
        self.page.get_by_role("textbox", name="Find recipes").wait_for()
        self.assertTrue(self.page.get_by_role("separator", name="Resize records and properties", exact=True).is_visible())

    def test_device_details_include_entities(self):
        self.page.goto(BASE + "/#organize/devices", wait_until="networkidle")
        self.page.get_by_role("button", name="Records", exact=True).click()
        self.page.locator(".records-table tbody tr").first.click()
        section = self.page.locator("section[aria-label='Properties']")
        section.get_by_role("heading", name=re.compile(r"^Entities \(")).wait_for()
        self.assertGreater(section.locator("a[href^='#organize/entities/']").count(), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
