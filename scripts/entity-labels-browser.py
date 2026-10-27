"""Entity label workflow regressions. All writes intercepted; run against mock Taxis."""
import copy
import json
import os
import unittest
import urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get("TAXIS_TEST_URL", "http://localhost:8099")


class EntityLabelsRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urllib.request.urlopen(BASE + "/api/hierarchy", timeout=30) as response:
            cls.fixture = json.load(response)
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
        self.body = copy.deepcopy(self.fixture)
        h = self.body["hierarchy"]
        self.area = next(iter(h["areas"]))
        prototype = next(iter(h["entities"].values()))
        h["entities"] = {}
        h["labels"] = {"existing": {"id": "existing", "name": "Existing", "color": "blue", "icon": None, "description": None}, "addition": {"id": "addition", "name": "Additional", "color": "red", "icon": None, "description": None}}
        for i in range(401):
            entity_id = f"sensor.labels_{i:03}"
            h["entities"][entity_id] = {**prototype, "entityId": entity_id, "name": f"Label fixture {i:03}", "deviceId": None, "areaId": self.area, "ownAreaId": self.area, "members": [], "labels": ["existing", "addition"] if i == 0 else ["existing"], "inRegistry": i != 2, "disabled": i == 3, "hidden": False, "maintenance": False}
        h["areas"][self.area]["entityIds"] = list(h["entities"])
        h["unassignedEntityIds"] = []
        self.posts = []
        self.queue = []
        self.page.route("**/api/hierarchy*", lambda route: route.fulfill(json=self.body))
        def changes(route):
            if route.request.method == "POST":
                item = route.request.post_data_json
                self.posts.append(item)
                change_id = len(self.queue) + 1
                target = item.get("targetId") or f"new:{item['kind']}:{change_id}"
                self.queue.append({"id": change_id, "kind": item["kind"], "op": item["op"], "targetId": target, "scope": None, "before": {}, "after": item["fields"], "createdAt": "2026-10-27T00:00:00Z"})
                if item["kind"] == "label":
                    h["labels"][target] = {"id": target, "name": item["fields"]["name"], "color": item["fields"].get("color"), "icon": None, "description": None}
                elif item["kind"] == "entity":
                    h["entities"][target]["labels"] = item["fields"]["labels"]
            route.fulfill(json={"ok": True, "changes": self.queue, "version": str(len(self.queue))})
        self.page.route("**/api/changes", changes)

    def tearDown(self):
        self.context.close()

    def open(self, global_label=False):
        self.page.goto(BASE + ("/#organize/labels/addition" if global_label else f"/#area/{self.area}/labels"), wait_until="domcontentloaded")
        self.section = self.page.get_by_role("region", name="Entity label assignment", exact=True)
        self.section.get_by_role("textbox", name="Search label entities").wait_for()
        self.table = self.section.get_by_role("table", name="Entities and labels", exact=True)

    def test_area_multi_add_preserves_labels_and_readonly_entities(self):
        self.open()
        self.assertEqual(self.table.locator("tbody tr").count(), 100)
        self.table.locator("tbody tr").nth(0).get_by_text("Existing", exact=True).wait_for()
        self.table.locator("tbody tr").nth(0).get_by_text("Additional", exact=True).wait_for()
        self.assertEqual(self.table.locator("tbody tr").nth(2).get_by_role("checkbox").count(), 0)
        self.section.get_by_role("checkbox", name="Select Label fixture 000", exact=True).check()
        self.section.get_by_role("checkbox", name="Select Label fixture 001", exact=True).check()
        self.section.get_by_label("Label to add", exact=True).select_option("addition")
        self.section.get_by_role("button", name="Add label", exact=True).click()
        self.page.get_by_role("status").filter(has_text="Added to the list of changes").wait_for()
        self.assertEqual(self.posts, [{"kind": "entity", "op": "update", "targetId": "sensor.labels_001", "fields": {"labels": ["existing", "addition"]}}])
        self.assertTrue(self.section.get_by_role("button", name="Add label", exact=True).is_disabled())

    def test_inline_new_label_retains_selection_and_uses_preview_id(self):
        self.open()
        self.section.get_by_role("checkbox", name="Select Label fixture 000", exact=True).check()
        self.section.get_by_role("checkbox", name="Select Label fixture 001", exact=True).check()
        self.section.get_by_role("button", name="+ Add new label", exact=True).click()
        self.section.get_by_role("textbox", name="New label name", exact=True).fill("Existing")
        self.section.get_by_role("button", name="Add", exact=True).click()
        self.section.get_by_role("alert").filter(has_text="already exists").wait_for()
        self.assertEqual(len(self.posts), 0)
        self.section.get_by_role("textbox", name="New label name", exact=True).fill("Brand new label")
        self.section.get_by_role("combobox", name="Color", exact=True).select_option("green")
        self.section.get_by_role("button", name="Add", exact=True).click()
        picker = self.section.get_by_label("Label to add", exact=True)
        self.page.wait_for_function("document.querySelector('select[aria-label=\"Label to add\"]').value === 'new:label:1'")
        self.assertEqual(picker.input_value(), "new:label:1")
        self.assertTrue(self.section.get_by_role("checkbox", name="Select Label fixture 000", exact=True).is_checked())
        self.section.get_by_role("button", name="Add label", exact=True).click()
        self.page.get_by_role("status").filter(has_text="2 changes added").wait_for()
        self.assertEqual(len(self.posts), 3)
        self.assertEqual(self.posts[0], {"kind": "label", "op": "create", "fields": {"name": "Brand new label", "color": "green"}})
        self.assertTrue(all("new:label:1" in item["fields"]["labels"] for item in self.posts[1:]))

    def test_global_label_prefills_action_and_reaches_all_entities(self):
        self.open(global_label=True)
        self.assertEqual(self.section.get_by_label("Label to add", exact=True).input_value(), "addition")
        self.assertEqual(self.table.locator("tbody tr").count(), 100)
        for _ in range(4):
            self.section.get_by_role("button", name="Next page", exact=True).click()
        self.table.get_by_text("sensor.labels_400", exact=True).wait_for()
        self.assertEqual(self.table.locator("tbody tr").count(), 1)
        self.section.get_by_role("checkbox", name="Select all shown label entities", exact=True).check()
        search = self.section.get_by_role("textbox", name="Search label entities")
        search.fill("labels_001")
        self.table.get_by_text("sensor.labels_001", exact=True).wait_for()
        self.assertTrue(self.section.get_by_role("button", name="Add label", exact=True).is_disabled())
        search.fill("not-a-real-entity")
        self.section.get_by_role("status").filter(has_text="No entities match").wait_for()
        self.assertTrue(search.is_visible())
        self.section.get_by_role("button", name="Reset filters", exact=True).click()
        self.assertEqual(self.table.locator("tbody tr").count(), 100)
        self.assertEqual(len(self.posts), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
