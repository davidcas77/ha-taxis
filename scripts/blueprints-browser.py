"""Read-only Blueprints Records regressions against `npm run dev:mock`.

python3 scripts/blueprints-browser.py
Requires Python Playwright and Chromium; blueprint HTTP responses are fixtures.
"""
import copy
import json
import os
import unittest
import urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get("TAXIS_TEST_URL", "http://localhost:5173")
ITEMS = [
    {"domain": "automation", "path": "community/shared.yaml", "name": "Community motion", "description": "Turns a room light on after motion.", "author": "Community author", "sourceUrl": "https://github.com/example/blueprints", "error": None, "inputs": {
        "motion": {"name": "Motion sensor", "description": "The sensor to watch.", "selector": {"entity": {"domain": "binary_sensor"}}},
        "timing.delay": {"name": "Hold delay", "section": "Timing", "description": "Delay before clearing.", "default": None, "selector": {"number": {"min": 0}}},
    }},
    {"domain": "script", "path": "community/shared.yaml", "name": "Community announcement", "description": "A reusable house announcement script.", "author": "Community author", "sourceUrl": "javascript:alert('not-a-web-source')", "error": None, "inputs": {"message": {"name": "Message", "description": None, "selector": {"text": {}}}}},
    {"domain": "automation", "path": "broken.yaml", "name": "Broken blueprint", "description": None, "author": None, "sourceUrl": None, "inputs": {}, "error": "Invalid blueprint configuration"},
]


class BlueprintRecordsRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urllib.request.urlopen(BASE + "/api/hierarchy", timeout=20) as response:
            cls.hierarchy = json.load(response)
        if not cls.hierarchy.get("ok"):
            raise RuntimeError("Start mock HA and Taxis before running browser checks")
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"), headless=True, args=["--no-sandbox"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1000})
        self.page = self.context.new_page()
        self.page.set_default_timeout(15000)
        self.page.route("**/api/hierarchy*", lambda route: route.fulfill(json=copy.deepcopy(self.hierarchy)))
        self.response = {"ok": True, "blueprints": copy.deepcopy(ITEMS), "complete": True, "warnings": []}
        self.requests = []
        def blueprints(route):
            self.requests.append(route.request.method)
            route.fulfill(status=200 if self.response["ok"] else 502, json=self.response)
        self.page.route("**/api/blueprints", blueprints)

    def tearDown(self):
        self.assertTrue(all(method == "GET" for method in self.requests))
        self.context.close()

    def open(self):
        self.page.goto(BASE + "/#organize/blueprints", wait_until="networkidle")
        self.page.get_by_role("textbox", name="Find blueprints", exact=True).wait_for()

    def test_external_automation_and_script_details_are_listed(self):
        self.open()
        table = self.page.locator("section[aria-label='Records'] table")
        self.assertEqual(table.locator("tbody tr").count(), 3)
        table.get_by_text("Community motion", exact=True).click()
        details = self.page.get_by_role("article", name="Blueprint details")
        details.get_by_role("heading", name="Community motion", exact=True).wait_for()
        details.get_by_text("Motion sensor", exact=True).wait_for()
        self.assertEqual(details.get_by_text("Required", exact=True).count(), 1)
        self.assertEqual(details.get_by_text("Has a default", exact=True).count(), 1)
        details.get_by_text("Section: Timing", exact=True).wait_for()
        self.assertEqual(details.get_by_role("link", name="View blueprint source").get_attribute("href"), "https://github.com/example/blueprints")
        self.page.get_by_label("Blueprint type", exact=True).select_option("script")
        self.assertEqual(table.locator("tbody tr").count(), 1)
        table.locator("tbody tr").first.focus()
        self.page.keyboard.press("Enter")
        details.get_by_role("heading", name="Community announcement", exact=True).wait_for()
        self.assertEqual(details.get_by_role("link", name="View blueprint source").count(), 0)
        self.page.reload(wait_until="networkidle")
        self.assertEqual(self.page.get_by_label("Blueprint type", exact=True).input_value(), "script")
        self.assertEqual(table.locator("tbody tr").count(), 1)

    def test_error_entries_are_visible_and_filters_remain_usable(self):
        self.open()
        self.page.locator("section[aria-label='Records'] tbody tr").filter(has_text="Broken blueprint").click()
        alert = self.page.get_by_role("article", name="Blueprint details").get_by_role("alert")
        alert.wait_for()
        self.assertIn("Invalid blueprint configuration", alert.inner_text())
        self.page.get_by_role("textbox", name="Find blueprints").fill("does-not-exist")
        self.page.get_by_text("No blueprints match these filters.", exact=True).wait_for()
        self.assertTrue(self.page.get_by_label("Blueprint type", exact=True).is_visible())
        self.page.get_by_role("button", name="Reset filters", exact=True).click()
        self.assertEqual(self.page.locator("section[aria-label='Records'] tbody tr").count(), 3)

    def test_partial_and_empty_inventory_are_not_confused(self):
        self.response = {"ok": True, "blueprints": [], "complete": False, "warnings": ["Script blueprints could not be read."]}
        self.open()
        self.page.get_by_text("This inventory may be incomplete.", exact=True).wait_for()
        self.page.get_by_text("No blueprints were returned from the domains that could be read.", exact=True).wait_for()
        self.assertEqual(self.page.get_by_text("No automation or script blueprints are installed in Home Assistant.", exact=True).count(), 0)
        self.response = {"ok": True, "blueprints": [], "complete": True, "warnings": []}
        self.page.get_by_role("button", name="Refresh blueprints", exact=True).click()
        self.page.get_by_text("No automation or script blueprints are installed in Home Assistant.", exact=True).wait_for()
        self.assertEqual(self.page.get_by_text("This inventory may be incomplete.", exact=True).count(), 0)

    def test_failed_refresh_keeps_last_successful_inventory(self):
        self.open()
        self.response = {"ok": False, "error": "Blueprint transport failed"}
        self.page.get_by_role("button", name="Refresh blueprints", exact=True).click()
        self.page.get_by_text("Couldn't read installed blueprints: Blueprint transport failed Showing the last successful read.", exact=True).wait_for()
        self.assertEqual(self.page.locator("section[aria-label='Records'] tbody tr").count(), 3)

    def test_pagination_keeps_every_installed_blueprint_reachable(self):
        self.response["blueprints"] = [{**copy.deepcopy(ITEMS[0]), "path": f"community/item_{index:03}.yaml", "name": f"Blueprint {index:03}"} for index in range(151)]
        self.open()
        table = self.page.locator("section[aria-label='Records'] table")
        self.assertEqual(table.locator("tbody tr").count(), 100)
        self.page.get_by_role("button", name="Next page", exact=True).click()
        table.get_by_text("Blueprint 150", exact=True).wait_for()
        self.assertEqual(table.locator("tbody tr").count(), 51)
        table.get_by_text("Blueprint 150", exact=True).click()
        self.page.get_by_role("article", name="Blueprint details").get_by_role("heading", name="Blueprint 150", exact=True).wait_for()


if __name__ == "__main__":
    unittest.main(verbosity=2)
