"""Review-only Changes page checks. Every mutation is blocked."""
import json
import unittest
import urllib.request

from playwright.sync_api import expect, sync_playwright
from browser_common import BASE, launch


class ChangesDetails(unittest.TestCase):
    def test_planned_details_and_controls(self):
        with urllib.request.urlopen(BASE + "/api/hierarchy", timeout=30) as response:
            hierarchy = json.load(response)
        hierarchy["hierarchy"]["entities"]["light.mock_group"] = {**next(iter(hierarchy["hierarchy"]["entities"].values())), "entityId": "light.mock_group", "name": "Mock group", "platform": "group"}
        def change(id, kind, op, target, before, after):
            return {"id": id, "kind": kind, "op": op, "targetId": target, "scope": None, "before": before, "after": after, "createdAt": ""}
        changes = [
            change(1, "helper", "update", "light.mock_group", {"entities": ["light.old", "light.kept"]}, {"entities": ["light.kept", "light.new"]}),
            change(2, "helper", "update", "light.unknown", {}, {"entities": ["light.new"]}),
            change(3, "entity", "update", "light.old", {}, {"new_entity_id": "light.renamed"}),
            change(4, "automation", "update", "taxis_mock", {"use_blueprint": {"input": {"lights": ["light.old"]}}}, {"alias": "Mock", "recipe": "motion_lights", "area_id": "kitchen", "use_blueprint": {"path": "taxis/mock.yaml", "input": {"lights": ["light.new"]}}}),
            change(5, "label", "create", "new:label:5", {}, {"name": "Example label"}),
            change(6, "script", "create", "taxis_announce", {}, {"alias": "Announcement", "use_blueprint": {"path": "taxis/announce.yaml", "input": {}}}),
        ]
        with sync_playwright() as pw:
            browser = launch(pw)
            context = browser.new_context(viewport={"width": 1500, "height": 1000})
            page = context.new_page()
            def guard(route):
                if route.request.method not in ("GET", "HEAD"):
                    self.fail("Unexpected real mutation: " + route.request.url)
                route.continue_()
            page.route("**/api/**", guard)
            page.route("**/api/hierarchy*", lambda route: route.fulfill(json=hierarchy))
            page.route("**/api/changes", lambda route: route.fulfill(json={"ok": True, "changes": changes, "version": "mock"}) if route.request.method == "GET" else guard(route))
            page.route("**/api/references*", lambda route: route.fulfill(json={"ok": True, "renames": [{"changeId": 3, "sites": [], "manual": []}]}))
            page.goto(BASE + "/#changes", wait_until="networkidle")
            cards = page.locator("li").filter(has=page.get_by_text("Show planned details", exact=True))
            self.assertEqual(cards.count(), 6)
            for index in range(6): cards.nth(index).get_by_text("Show planned details", exact=True).click()
            expect(cards.nth(0)).to_contain_text("Target: Mock group (light.mock_group)")
            expect(cards.nth(0)).to_contain_text("Home Assistant group helper combines")
            expect(cards.nth(0)).to_contain_text("Added: light.new")
            expect(cards.nth(0)).to_contain_text("Removed: light.old")
            expect(cards.nth(1)).to_contain_text("Previous value unavailable")
            expect(cards.nth(1)).not_to_contain_text("Added: light.new")
            expect(cards.nth(2)).to_contain_text("light.old")
            expect(cards.nth(2)).to_contain_text("light.renamed")
            expect(cards.nth(3)).to_contain_text("taxis/mock.yaml")
            expect(cards.nth(3)).to_contain_text("Removed: light.old")
            expect(cards.nth(3)).to_contain_text("may run when its triggers occur")
            expect(cards.nth(4)).to_contain_text("Not applicable (new)")
            expect(cards.nth(5)).to_contain_text("script runs when invoked")
            expect(page.get_by_role("button", name="Apply 6 changes to Home Assistant")).to_be_visible()
            expect(page.get_by_role("button", name="Discard all")).to_be_visible()
            expect(page.get_by_role("button", name="Discard:", exact=False)).to_have_count(6)
            context.close()
            browser.close()


if __name__ == "__main__": unittest.main(verbosity=2)
