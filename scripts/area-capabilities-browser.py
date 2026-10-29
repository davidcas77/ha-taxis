"""Read-only area Overview capability counts and contact-state regressions."""
import copy
import json
import os
import unittest
import urllib.request
from playwright.sync_api import sync_playwright
from browser_common import BASE, launch, screenshot_dir



class AreaCapabilitiesRegression(unittest.TestCase):
    def test_counts_live_values_and_missing_or_unreadable_contacts(self):
        with urllib.request.urlopen(BASE + "/api/hierarchy", timeout=30) as response:
            body = json.load(response)
        h = body["hierarchy"]
        area = h["areas"]["living_room"]
        base = copy.deepcopy(next(iter(h["entities"].values())))
        h["entities"] = {}
        h["devices"] = {}
        for entity_id, name, domain, device_class, state, unit in [
            ("binary_sensor.overview_door", "Overview door", "binary_sensor", "door", "off", None),
            ("sensor.overview_temperature", "Overview temperature", "sensor", "temperature", "21.5", "°C"),
        ]:
            h["entities"][entity_id] = {**copy.deepcopy(base), "entityId": entity_id, "name": name, "domain": domain, "role": "opening" if domain == "binary_sensor" else "temperature", "deviceClass": device_class, "deviceClassOverride": None, "platform": "demo", "members": [], "categoryScope": None, "areaId": area["id"], "ownAreaId": area["id"], "deviceId": None, "state": state, "unit": unit, "disabled": False, "hidden": False, "maintenance": False, "labels": [], "inRegistry": True}
        area["entityIds"] = list(h["entities"])
        area["deviceIds"] = []
        with sync_playwright() as p:
            browser = launch(p)
            context = browser.new_context(viewport={"width": 1600, "height": 1100}, color_scheme="dark")
            page = context.new_page()
            page.set_default_timeout(60000)
            page.set_default_navigation_timeout(60000)
            page.route("**/api/hierarchy*", lambda route: route.fulfill(json=body))
            try:
                def open_area():
                    page.goto(BASE + "/#area/living_room", wait_until="domcontentloaded")
                    page.get_by_role("table", name="Area capabilities", exact=True).wait_for()
                def row(name):
                    return page.get_by_role("table", name="Area capabilities", exact=True).locator("tbody tr").filter(has=page.get_by_role("cell", name=name, exact=True))
                open_area()
                self.assertEqual(page.get_by_role("table", name="Area capabilities").locator("thead th").all_inner_texts(), ["Capability", "Entity count", "Current value"])
                self.assertEqual(row("Door").locator("td").nth(1).inner_text(), "1")
                self.assertEqual(row("Door").locator("td").last.inner_text(), "Closed")
                self.assertEqual(row("Window").locator("td").last.inner_text(), "N/A")
                self.assertEqual(row("Window").locator("td").nth(1).inner_text(), "0")
                self.assertIn("21.5 °C", row("Temperature").locator("td").last.inner_text())
                row("Door").get_by_role("button").hover()
                page.get_by_role("tooltip").get_by_text("binary_sensor.overview_door", exact=True).wait_for()
                page.keyboard.press("Escape")
                page.screenshot(path=str(screenshot_dir() / "area-capabilities.png"))
                for state, expected in [("on", "Open"), ("unavailable", "Unavailable"), (None, "Unknown")]:
                    h["entities"]["binary_sensor.overview_door"]["state"] = state
                    page.reload(wait_until="domcontentloaded")
                    row("Door").wait_for()
                    self.assertEqual(row("Door").locator("td").last.inner_text(), expected)
                h["entities"]["binary_sensor.overview_door"]["disabled"] = True
                page.reload(wait_until="domcontentloaded")
                row("Door").wait_for()
                self.assertEqual(row("Door").locator("td").nth(1).inner_text(), "0")
                self.assertEqual(row("Door").locator("td").last.inner_text(), "Disabled")
            finally:
                context.close()
                browser.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
