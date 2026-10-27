"""Read-only Unassigned view browser regressions; all writes are intercepted.

Run against npm run dev:mock: python3 scripts/unassigned-browser.py
"""
import copy
import json
import os
import unittest
import urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get("TAXIS_TEST_URL", "http://localhost:5173")


class UnassignedRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urllib.request.urlopen(BASE + "/api/hierarchy", timeout=30) as response:
            cls.base = json.load(response)
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"), args=["--no-sandbox"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1100})
        self.page = self.context.new_page()
        self.page.set_default_timeout(60000)
        self.page.set_default_navigation_timeout(60000)
        self.body = copy.deepcopy(self.base)
        h = self.body["hierarchy"]
        template = next(iter(h["entities"].values()))
        h["entities"] = {}
        h["unassignedEntityIds"] = []
        h["devices"]["fixture_device"] = {**next(iter(h["devices"].values())), "id": "fixture_device", "name": "Unplaced fixture bridge", "areaId": None, "entityIds": []}
        for i in range(451):
            entity_id = f"sensor.unplaced_{i:03}"
            h["entities"][entity_id] = {**template, "entityId": entity_id, "name": f"Unplaced {i:03}", "domain": "sensor", "role": "sensor", "areaId": None, "ownAreaId": None, "deviceId": "fixture_device" if i < 3 else None, "members": [], "inRegistry": i != 2, "needsOwnName": i == 1, "customName": None, "disabled": False, "hidden": False, "maintenance": False}
            h["unassignedEntityIds"].append(entity_id)
        self.area = next(iter(h["areas"]))
        self.posted = []
        self.queue = []
        self.page.route("**/api/hierarchy*", lambda route: route.fulfill(json=self.body))
        def changes(route):
            if route.request.method == "POST":
                value = route.request.post_data_json
                self.posted.append(value)
                self.queue.append({"id": len(self.queue) + 1, "kind": value["kind"], "op": value["op"], "targetId": value["targetId"], "scope": None, "before": {}, "after": value["fields"], "createdAt": "2026-10-27T00:00:00Z"})
            route.fulfill(json={"ok": True, "changes": self.queue, "version": str(len(self.queue))})
        self.page.route("**/api/changes", changes)
        self.page.goto(BASE + "/#unassigned", wait_until="domcontentloaded")
        self.section = self.page.get_by_role("region", name="Unassigned entities", exact=True)
        self.section.get_by_role("textbox", name="Find unassigned entities").wait_for()

    def tearDown(self):
        self.context.close()

    def table(self):
        self.section.get_by_role("button", name="Table", exact=True).click()
        return self.section.get_by_role("table", name="Unassigned entities table")

    def test_cards_and_table_preference_and_resize_persist(self):
        self.assertEqual(self.section.get_by_role("button", name="Cards", exact=True).get_attribute("aria-pressed"), "true")
        h = self.body["hierarchy"]
        floor = next(floor for floor in h["floors"] if floor["areaIds"])
        area = h["areas"][floor["areaIds"][0]]
        spaces = self.page.get_by_role("navigation", name="Spaces", exact=True)
        floor_label = spaces.locator("button[aria-expanded]").get_by_text(floor["name"], exact=True)
        area_label = spaces.locator("button:not([aria-expanded])").get_by_text(area["name"], exact=True)
        self.assertAlmostEqual(area_label.bounding_box()["x"] - floor_label.bounding_box()["x"], 12, delta=1)
        self.assertAlmostEqual(area_label.locator("..").bounding_box()["width"], floor_label.locator("..").bounding_box()["width"], delta=1)
        table = self.table()
        handle = self.section.get_by_role("separator", name="Resize unassigned Name column", exact=True)
        before = table.locator("col").nth(1).evaluate("element => element.getBoundingClientRect().width")
        handle.focus()
        self.page.keyboard.press("ArrowRight")
        after = table.locator("col").nth(1).evaluate("element => element.getBoundingClientRect().width")
        self.assertGreater(after, before)
        self.page.reload(wait_until="domcontentloaded")
        table.wait_for()
        self.assertEqual(self.section.get_by_role("button", name="Table", exact=True).get_attribute("aria-pressed"), "true")
        self.assertAlmostEqual(table.locator("col").nth(1).evaluate("element => element.getBoundingClientRect().width"), after, delta=1)
        screenshot = os.environ.get("TAXIS_UNASSIGNED_SCREENSHOT")
        if screenshot:
            os.makedirs(os.path.dirname(os.path.abspath(screenshot)), exist_ok=True)
            self.page.screenshot(path=screenshot, full_page=True)
        self.assertEqual(len(self.posted), 0)

    def test_pagination_reaches_records_past_four_hundred(self):
        table = self.table()
        self.assertEqual(table.locator("tbody tr").count(), 100)
        for _ in range(4):
            self.section.get_by_role("button", name="Next page", exact=True).click()
        table.get_by_role("button", name="Unplaced 450", exact=True).wait_for()
        self.assertEqual(table.locator("tbody tr").count(), 51)
        search = self.section.get_by_role("textbox", name="Find unassigned entities")
        search.fill("sensor.unplaced_450")
        self.assertEqual(table.locator("tbody tr").count(), 1)
        self.assertEqual(self.section.get_by_role("button", name="Next page", exact=True).count(), 0)

    def test_search_select_and_bulk_area_queue_respect_editability(self):
        table = self.table()
        search = self.section.get_by_role("textbox", name="Find unassigned entities")
        search.fill("Unplaced fixture bridge")
        self.assertEqual(table.locator("tbody tr").count(), 3)
        self.section.get_by_role("checkbox", name="Select all shown entities", exact=True).check()
        bulk = self.section.get_by_role("region", name="Change the selected entities")
        self.assertIn("2 selected", bulk.inner_text())
        bulk.locator("select#bulk-area").select_option(self.area)
        bulk.get_by_role("button", name="Move", exact=True).click()
        self.page.get_by_role("status").filter(has_text="1 left out").wait_for()
        self.assertEqual(self.posted, [{"kind": "entity", "op": "update", "targetId": "sensor.unplaced_000", "fields": {"area_id": self.area}}])
        search.fill("Unplaced 450")
        self.assertEqual(table.locator("tbody tr").count(), 1)
        self.assertEqual(self.section.get_by_role("region", name="Change the selected entities").count(), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
