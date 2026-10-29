"""Lighting layout and Bathroom fan area filtering; all settings writes intercepted."""
import copy
import json
import os
import unittest
import urllib.request
from playwright.sync_api import sync_playwright, expect
from browser_common import BASE, launch, screenshot_dir



class ParameterLayoutRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urllib.request.urlopen(BASE + "/api/hierarchy", timeout=30) as response:
            cls.base = json.load(response)
        cls.pw = sync_playwright().start()
        cls.browser = launch(cls.pw)

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

    def area_row(self, table, name):
        """The row of a level (house default, interior, exterior, an area) by the name in its first column."""
        return table.locator("tbody tr").filter(has=self.page.get_by_text(name, exact=True))

    def test_lighting_compact_rows_popover_and_column_memory(self):
        table = self.open("lighting")
        row = self.area_row(table, "Laundry")
        row.wait_for()
        self.assertLessEqual(row.bounding_box()["height"], 60)
        level = row.locator("td").filter(has=self.page.get_by_text("Laundry", exact=True))
        self.assertEqual(level.evaluate("element => getComputedStyle(element).textAlign"), "left")
        # Compact: no value column is stretched, and the table never makes the page scroll sideways.
        widths = row.locator("td").evaluate_all("cells => cells.map(cell => cell.getBoundingClientRect().width)")
        self.assertTrue(all(width <= 320 for width in widths), widths)
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
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
        self.area_row(table, "House default").get_by_text("House default", exact=True).click()
        expect(dialog).to_have_count(0)
        # Which columns show is the person's choice from the Columns menu: it survives a reload and a layout reset undoes it.
        night = table.get_by_role("columnheader", name="Brightness (%)")
        self.assertEqual(night.count(), 2)  # Day and Night
        self.page.get_by_role("button", name="Columns of Lighting", exact=True).click()
        self.page.get_by_role("group", name="Columns").get_by_label("Night brightness (%)", exact=True).uncheck()
        expect(night).to_have_count(1)
        self.page.keyboard.press("Escape")
        self.page.reload(wait_until="domcontentloaded")
        table.wait_for()
        expect(night).to_have_count(1)
        self.page.evaluate("window.dispatchEvent(new Event('taxis:reset-layout'))")
        expect(night).to_have_count(2)
        self.page.screenshot(path=str(screenshot_dir() / "lighting-compact.png"))

    def test_fan_default_filters_by_counted_capabilities_and_keeps_defaults(self):
        table = self.open("fan")
        self.area_row(table, "Laundry").wait_for()
        for name in ["House default", "Interior", "Exterior"]:
            self.assertEqual(table.get_by_text(name, exact=True).count(), 1)
        self.assertEqual(table.get_by_text("Living room", exact=True).count(), 0)
        self.assertEqual(table.get_by_text("Excluded humidity", exact=True).count(), 0)
        self.page.get_by_role("checkbox", name="Show all areas", exact=True).check()
        self.area_row(table, "Living room").wait_for()
        self.page.reload(wait_until="domcontentloaded")
        expect(self.page.get_by_role("checkbox", name="Show all areas", exact=True)).to_be_checked()
        self.area_row(table, "Excluded humidity").wait_for()
        self.assertEqual(self.parameters["areas"]["nofan"]["fan_abs_on"], 91)
        self.assertEqual(self.puts, [])

    def test_fan_empty_relevance_keeps_defaults_and_explains_recovery(self):
        self.inventory["entities"]["fan.laundry_fan"] = {"counts": False}
        table = self.open("fan")
        self.page.get_by_role("status").filter(has_text="No areas have both a counted fan").wait_for()
        # Only the house, interior and exterior defaults remain: no area and no floor heading.
        self.assertEqual(table.locator("tbody tr").count(), 3)
        for name in ["House default", "Interior", "Exterior"]:
            self.assertEqual(table.get_by_text(name, exact=True).count(), 1)
        self.assertEqual(table.get_by_text("Test floor", exact=True).count(), 0)
        self.page.get_by_role("link", name="Capabilities", exact=True).wait_for()
        self.assertEqual(self.puts, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
