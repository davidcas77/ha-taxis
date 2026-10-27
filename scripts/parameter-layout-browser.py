"""Lighting layout and Bathroom fan area filtering; all settings writes intercepted."""
import copy
import json
import os
import unittest
import urllib.request
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("TAXIS_TEST_URL", "http://localhost:8099")


class ParameterLayoutRegression(unittest.TestCase):
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
        area = next(iter(h["areas"].values()))
        entity = next(iter(h["entities"].values()))
        h["areas"] = {key: {**area, "id": key, "name": name, "entityIds": [], "deviceIds": [], "floorId": "fixture"} for key, name in [("laundry", "Laundry"), ("nofan", "Living room"), ("excluded", "Excluded humidity")]}
        h["floors"] = [{"id": "fixture", "name": "Test floor", "level": 0, "areaIds": list(h["areas"])}]
        h["looseAreaIds"] = []
        h["devices"] = {}
        h["entities"] = {}
        h["unassignedEntityIds"] = []
        self.light_ids = []
        for index in range(20):
            entity_id = f"light.laundry_entry_fixture_{index:02}"
            self.light_ids.append(entity_id)
            h["entities"][entity_id] = {**entity, "entityId": entity_id, "name": f"Long laundry ceiling entry light {index:02} with the complete descriptive room and fitting name", "domain": "light", "role": "light", "deviceId": None, "areaId": "laundry", "ownAreaId": "laundry", "members": [], "labels": [], "disabled": False, "hidden": False, "maintenance": False, "platform": "demo"}
        for area_id in ["laundry", "excluded"]:
            for domain, device_class in [("fan", None), ("sensor", "humidity")]:
                entity_id = f"{domain}.{area_id}_{device_class or 'fan'}"
                h["entities"][entity_id] = {**entity, "entityId": entity_id, "name": entity_id, "domain": domain, "role": "humidity" if device_class else "other", "deviceClass": device_class, "deviceId": None, "areaId": area_id, "ownAreaId": area_id, "members": [], "labels": [], "disabled": False, "hidden": False, "maintenance": False, "platform": "demo"}
        for item in h["entities"].values():
            h["areas"][item["areaId"]]["entityIds"].append(item["entityId"])
        self.inventory = {"entities": {"sensor.excluded_humidity": {"counts": False}}, "areas": {}}
        self.parameters = {"house": {"day_brightness": 88}, "types": {}, "areas": {"laundry": {"entry_lights": self.light_ids.copy()}, "nofan": {"fan_abs_on": 91}}}
        self.puts = []
        self.page.route("**/api/hierarchy*", lambda route: route.fulfill(json=self.body))
        self.page.route("**/api/settings/inventory", lambda route: route.fulfill(json={"ok": True, "inventory": self.inventory, "revision": "fixture-inventory"}))
        def settings(route):
            if route.request.method == "PUT":
                self.puts.append(route.request.post_data_json)
                self.parameters = route.request.post_data_json
            route.fulfill(json={"ok": True, "parameters": self.parameters, "revision": str(len(self.puts))})
        self.page.route("**/api/settings/parameters", settings)

    def tearDown(self):
        self.context.close()

    def open(self, tab):
        self.page.goto(BASE + "/#parameters/" + tab, wait_until="domcontentloaded")
        return self.page.get_by_role("table", name="Lighting" if tab == "lighting" else "Bathroom fan", exact=True)

    def test_lighting_compact_rows_popover_and_column_memory(self):
        table = self.open("lighting")
        row = table.locator("tbody tr").filter(has=self.page.get_by_role("rowheader", name="Laundry", exact=True))
        row.wait_for()
        self.assertLessEqual(row.bounding_box()["height"], 60)
        self.assertEqual(row.get_by_role("rowheader").evaluate("element => getComputedStyle(element).textAlign"), "left")
        widths = table.locator("col").evaluate_all("columns => columns.map(column => column.getBoundingClientRect().width)")
        self.assertAlmostEqual(widths[0], 200, delta=1)
        self.assertTrue(all(76 <= width <= 96 for width in widths[1:-1]), widths)
        self.assertAlmostEqual(widths[-1], 240, delta=1)
        self.assertEqual(row.locator("td").first.evaluate("element => getComputedStyle(element).textAlign"), "center")
        trigger = row.get_by_role("button", name="Entry lights for Laundry: 20 lights, set here", exact=True)
        trigger.hover()
        tooltip = self.page.get_by_role("tooltip")
        tooltip.get_by_text(self.light_ids[-1], exact=True).wait_for()
        trigger.click()
        dialog = self.page.get_by_role("dialog", name="Entry lights for Laundry", exact=True)
        dialog.wait_for()
        self.assertEqual(dialog.get_by_role("checkbox").count(), 20)
        self.assertLessEqual(dialog.bounding_box()["height"], 546)
        self.assertEqual(dialog.locator("xpath=ancestor::table").count(), 0)
        self.assertLessEqual(row.bounding_box()["height"], 60)
        dialog.get_by_role("checkbox").first.uncheck()
        expect(trigger).to_have_count(0)
        self.assertEqual(len(self.puts[-1]["areas"]["laundry"]["entry_lights"]), 19)
        self.page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        row.get_by_role("button", name="Clear Entry lights for Laundry", exact=True).click()
        suggested = row.get_by_role("button", name="Entry lights for Laundry: 20 lights, suggested", exact=True)
        suggested.wait_for()
        self.assertLessEqual(row.bounding_box()["height"], 60)
        suggested.click()
        dialog.wait_for()
        dialog.get_by_role("checkbox").last.scroll_into_view_if_needed()
        expect(dialog.get_by_text(self.light_ids[-1], exact=True)).to_be_visible()
        table.get_by_role("rowheader", name="House default", exact=True).click()
        expect(dialog).to_have_count(0)
        handle = self.page.get_by_role("separator", name="Resize Lighting Level column", exact=True)
        handle.focus()
        self.page.keyboard.press("ArrowLeft")
        self.assertAlmostEqual(table.locator("col").first.evaluate("element => element.getBoundingClientRect().width"), 180, delta=1)
        self.page.reload(wait_until="domcontentloaded")
        table.wait_for()
        self.assertAlmostEqual(table.locator("col").first.evaluate("element => element.getBoundingClientRect().width"), 180, delta=1)
        self.page.evaluate("window.dispatchEvent(new Event('taxis:reset-layout'))")
        expect(handle).to_have_attribute("aria-valuenow", "200")
        self.page.screenshot(path="/workspace/.cache/ha-taxis/inspection/lighting-compact.png")

    def test_fan_default_filters_by_counted_capabilities_and_keeps_defaults(self):
        table = self.open("fan")
        table.get_by_role("rowheader", name="Laundry", exact=True).wait_for()
        for name in ["House default", "Interior", "Exterior"]:
            self.assertEqual(table.get_by_role("rowheader", name=name, exact=True).count(), 1)
        self.assertEqual(table.get_by_role("rowheader", name="Living room", exact=True).count(), 0)
        self.assertEqual(table.get_by_role("rowheader", name="Excluded humidity", exact=True).count(), 0)
        self.page.get_by_role("checkbox", name="Show all areas", exact=True).check()
        table.get_by_role("rowheader", name="Living room", exact=True).wait_for()
        self.page.reload(wait_until="domcontentloaded")
        expect(self.page.get_by_role("checkbox", name="Show all areas", exact=True)).to_be_checked()
        table.get_by_role("rowheader", name="Excluded humidity", exact=True).wait_for()
        self.assertEqual(self.parameters["areas"]["nofan"]["fan_abs_on"], 91)
        self.assertEqual(self.puts, [])

    def test_fan_empty_relevance_keeps_defaults_and_explains_recovery(self):
        self.inventory["entities"]["fan.laundry_fan"] = {"counts": False}
        table = self.open("fan")
        self.page.get_by_role("status").filter(has_text="No areas have both a counted fan").wait_for()
        self.assertEqual(table.get_by_role("rowheader").count(), 3)
        self.assertEqual(table.locator("th[scope=rowgroup]").count(), 0)
        self.page.get_by_role("link", name="Capabilities", exact=True).wait_for()
        self.assertEqual(self.puts, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
