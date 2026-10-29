"""Three Devices & entities modes, tested against the local mock only.

Start the mock app, then run:
  TAXIS_TEST_URL=http://localhost:5173 python3 scripts/device-views-browser.py
All browser writes are intercepted. No live HA access is used.
"""
import os
from pathlib import Path
import re
import unittest
from playwright.sync_api import sync_playwright, expect
from browser_common import BASE, launch, screenshot_dir

MODE_KEY = "taxis:devices-entities:mode:v2"


class DeviceViews(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = launch(cls.playwright)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1000})
        self.page = self.context.new_page()
        self.page.set_default_timeout(60000)
        self.page.set_default_navigation_timeout(60000)
        expect.set_options(timeout=60000)
        self.page.route("**/api/**", lambda route: route.continue_() if route.request.method == "GET" else route.fulfill(status=403, json={"ok": False, "error": "Browser regression blocks writes"}))
        self.page.add_init_script("localStorage.setItem('taxis:organize-view:devices', 'table')")

    def tearDown(self):
        self.context.close()

    def open(self, hash="organize/devices"):
        self.page.goto(BASE + "/#" + hash, wait_until="networkidle")
        self.modes = self.page.get_by_role("group", name="Entity view", exact=True)
        expect(self.modes).to_be_visible()
        expect(self.modes.get_by_role("button")).to_have_count(3)
        expect(self.page.get_by_role("checkbox", name="Show entities", exact=True)).to_have_count(0)
        expect(self.page.get_by_role("checkbox", name="Group by type", exact=True)).to_have_count(0)

    def mode(self, name):
        button = self.modes.get_by_role("button", name=name, exact=True)
        button.click()
        expect(button).to_have_attribute("aria-pressed", "true")

    def test_device_hierarchy_and_flat_entities_share_selection(self):
        self.open()
        self.mode("Devices")
        expect(self.page.locator('tr[data-device-child="true"]')).to_have_count(0)
        parents = self.page.locator('tr[data-branch="device"]')
        self.assertGreater(parents.count(), 0)
        parent = next(parents.nth(index) for index in range(parents.count()) if "0 entities" not in parents.nth(index).inner_text())
        parent.get_by_role("button", name=re.compile("^Show the entities of ")).click()
        child = self.page.locator('tr[data-device-child="true"]').first
        expect(child).to_be_visible()
        parent_name = parent.get_by_role("textbox", name=re.compile("^Name of device ")).bounding_box()
        child_name = child.get_by_role("textbox", name=re.compile("^Name of ")).bounding_box()
        self.assertGreaterEqual(child_name["x"] - parent_name["x"], 16)
        self.assertLessEqual(child_name["x"] - parent_name["x"], 22)
        entity_id = child.get_attribute("data-entity-id")
        child.get_by_role("checkbox").check()
        self.mode("Entities")
        expect(self.page.locator('tr[data-branch]')).to_have_count(0)
        expect(self.page.locator('tr[data-device-child="true"]')).to_have_count(0)
        search = self.page.get_by_role("textbox", name="Find a device or an entity")
        search.fill(entity_id)
        entity = self.page.locator('tr[data-entity-id="' + entity_id + '"]')
        expect(entity.get_by_role("checkbox")).to_be_checked()
        expect(entity.get_by_role("button", name=re.compile("^Open "))).to_be_visible()
        # Every visible column resizes; the chooser also keeps visibility choices.
        visible_headers = self.page.locator("table th[data-column-id]").count()
        self.assertGreater(visible_headers, 0)
        self.assertEqual(self.page.get_by_role("separator", name=re.compile(r"^Resize .* column")).count(), visible_headers)
        expect(self.page.get_by_role("button", name=re.compile(r"^Columns of "))).to_have_count(1)
        self.mode("Devices")
        expect(self.page.locator('tr[data-device-child="true"]').first).to_be_visible()
        expect(search).to_have_value(entity_id)

    def test_global_groups_and_filters_are_meaningful(self):
        self.open()
        self.mode("Groups")
        # The global callback uses the same cards as the area page; if a caller
        # deliberately omits it, the shared component has a grouped-table fallback.
        cards = self.page.locator('section[aria-label="Lights"]')
        expect(cards).to_be_visible()
        self.page.get_by_role("textbox", name="Find a device or an entity").fill("kitchen_main")
        expect(cards).to_contain_text("Kitchen")
        self.mode("Entities")
        rows = self.page.locator('tr[data-entity-id]')
        self.assertGreater(rows.count(), 0)
        self.assertTrue(all("kitchen_main" in value for value in rows.evaluate_all("rows => rows.map(row => row.dataset.entityId)")))
        self.page.reload(wait_until="networkidle")
        expect(self.page.get_by_role("group", name="Entity view").get_by_role("button", name="Entities", exact=True)).to_have_attribute("aria-pressed", "true")

    def test_area_has_all_three_modes(self):
        self.open("area/living_room/devices-entities")
        for name in ["Groups", "Devices", "Entities"]:
            self.mode(name)
            if name == "Groups":
                expect(self.page.locator('section[aria-label="Lights"]')).to_be_visible()
            elif name == "Devices":
                self.assertGreater(self.page.locator('tr[data-branch]').count(), 0)
                self.page.get_by_role("button", name=re.compile("^Show the entities of ")).first.click()
            else:
                self.assertGreater(self.page.locator('tr[data-entity-id]').count(), 0)
                expect(self.page.locator('tr[data-branch]')).to_have_count(0)
            output = screenshot_dir()
            output.mkdir(parents=True, exist_ok=True)
            self.page.screenshot(path=str(output / ("view-mode-" + name.lower() + ".png")))

    def test_legacy_preferences_migrate(self):
        for legacy, expected in [({"taxis:devices-entities-view": "groups"}, "Groups"), ({"taxis:devices-entities-view": "devices", "taxis:group-by-type:devices-entities": "1"}, "Entities"), ({"taxis:devices-entities-view": "devices", "taxis:devices-entities:show:devices": "1"}, "Entities"), ({"taxis:devices-entities-view": "devices", "taxis:devices-entities:show:devices": "0"}, "Devices")]:
            self.page.goto(BASE + "/", wait_until="networkidle")
            self.page.evaluate("values => { localStorage.clear(); localStorage.setItem('taxis:organize-view:devices', 'table'); for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value); }", legacy)
            self.open()
            expect(self.modes.get_by_role("button", name=expected, exact=True)).to_have_attribute("aria-pressed", "true")


if __name__ == "__main__":
    unittest.main(verbosity=2)
