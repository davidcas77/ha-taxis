"""Area type feedback under delayed, fully mocked writes; never writes to HA."""
import copy
import json
import unittest
import urllib.request

from playwright.sync_api import expect, sync_playwright
from browser_common import BASE, launch


class AreaFeedback(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urllib.request.urlopen(BASE + "/api/hierarchy", timeout=30) as response:
            cls.fixture = json.load(response)
        cls.pw = sync_playwright().start()
        cls.browser = launch(cls.pw)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def run_case(self, review, failure, mobile=False, refresh_failure=False, navigate=False):
        context = self.browser.new_context(viewport={"width": 390 if mobile else 1500, "height": 950})
        page = context.new_page()
        h = copy.deepcopy(self.fixture)
        hierarchy = h["hierarchy"]
        area = hierarchy["areas"]["kitchen"]
        hierarchy["labels"] = {key: label for key, label in hierarchy["labels"].items() if label["name"].lower() != "storage"}
        hierarchy["labels"]["unrelated"] = {"id": "unrelated", "name": "Unrelated"}
        area["labels"] = ["unrelated"]
        requests = []
        changes = []
        refresh_unavailable = [False]
        # Delay delivery to React without blocking Playwright's event loop.
        page.add_init_script("""(() => {
          const original = window.fetch;
          window.fetch = async (...args) => {
            const response = await original(...args);
            const url = String(args[0]);
            const method = (args[1]?.method || 'GET').toUpperCase();
            if (method === 'POST' && /(?:^|\\/)api\\/(changes|direct-changes)/.test(url))
              await new Promise(resolve => setTimeout(resolve, 1500));
            return response;
          };
        })();""")

        def guard(route):
            if route.request.method not in ("GET", "HEAD"):
                self.fail("Unexpected real mutation: " + route.request.url)
            route.continue_()

        def mutate(route):
            body = route.request.post_data_json
            items = body["changes"] if "changes" in body else [body]
            requests.extend(copy.deepcopy(items))
            item = items[0]
            fail = item["kind"] == failure
            if not fail:
                if item["kind"] == "label":
                    hierarchy["labels"]["storage_mock"] = {"id": "storage_mock", "name": "Storage"}
                else:
                    area["labels"] = item["fields"]["labels"]
                    changes.append({"id": 1, "kind": "area", "targetId": "kitchen", "after": {"labels": area["labels"]}})
                    refresh_unavailable[0] = refresh_failure
            if review:
                route.fulfill(status=400 if fail else 200, json={"ok": False, "error": "Mock failure"} if fail else {"ok": True, "changes": changes, "version": "mock"})
            else:
                route.fulfill(json={"ok": True, "backup": {"made": True}, "results": [{"changeId": 1, "ok": not fail, "status": "failed" if fail else "verified", "message": "Mock failure" if fail else "Applied"}]})

        def preview(route):
            items = route.request.post_data_json["changes"]
            planned = [{"id": i + 1, "kind": item["kind"], "op": item["op"], "targetId": item.get("targetId", "new:label:1"),
                        "scope": None, "before": {}, "after": item.get("fields", {}), "createdAt": ""} for i, item in enumerate(items)]
            route.fulfill(json={"ok": True, "changes": planned, "previewVersion": "mock-preview", "requiresNoBackupConfirmation": False})

        page.route("**/api/**", guard)
        page.route("**/api/hierarchy*", lambda route: route.fulfill(json={"ok": False, "error": "Mock refresh unavailable"} if refresh_unavailable[0] else h))
        page.route("**/api/settings/general", lambda route: route.fulfill(json={"ok": True, "general": {"reviewChangesBeforeApplying": review}, "revision": "mock"}))
        page.route("**/api/changes", lambda route: route.fulfill(json={"ok": True, "changes": changes, "version": "mock"}) if route.request.method == "GET" else mutate(route))
        page.route("**/api/changes/batch", mutate)
        page.route("**/api/direct-preview", preview)
        page.route("**/api/direct-changes", mutate)
        try:
            page.goto(BASE + "/#area/kitchen", wait_until="networkidle")
            region = page.get_by_role("region", name="Area classification")
            checkbox = region.get_by_role("checkbox", name="Storage", exact=True)
            expect(checkbox).to_be_visible()
            self.assertEqual(region.locator("details").count(), 0)
            self.assertEqual(region.get_by_role("checkbox").count(), 14)
            expect(region.get_by_text("These labels are assigned to the area in Home Assistant, not to its entities.")).to_be_visible()
            checkbox.click()
            expect(checkbox).to_be_checked(timeout=500)
            expect(checkbox).to_be_disabled(timeout=500)
            expect(region.get_by_role("status")).to_be_visible(timeout=500)
            if not review:
                dialog = page.get_by_role("dialog", name="Review before applying")
                dialog.get_by_role("button", name="Confirm and apply").click()
                expect(dialog).to_be_hidden()
            if navigate:
                page.goto(BASE + "/#area/bathroom", wait_until="domcontentloaded")
                other = page.get_by_role("region", name="Area classification").get_by_role("checkbox", name="Storage", exact=True)
                expect(other).not_to_be_checked()
                page.wait_for_timeout(3500)
                expect(other).not_to_be_checked()
                return
            if failure == "label":
                expect(region.get_by_role("alert")).to_contain_text("Could not create", timeout=12000)
                expect(checkbox).not_to_be_checked()
            else:
                page.wait_for_function("() => performance.now() > 0")
                # Both requests are delayed; selection remains visible while the second runs.
                if not review:
                    dialog = page.get_by_role("dialog", name="Review before applying")
                    dialog.get_by_role("button", name="Confirm and apply").click(timeout=12000)
                    page.wait_for_timeout(300)
                else:
                    page.wait_for_timeout(1900)
                expect(checkbox).to_be_checked()
                expect(checkbox).to_be_disabled()
                if failure == "area":
                    expect(region.get_by_role("alert")).to_contain_text("area assignment failed", timeout=12000)
                    expect(checkbox).not_to_be_checked()
                elif refresh_failure:
                    expect(region.get_by_role("alert")).to_contain_text("latest area could not be refreshed", timeout=12000)
                    expect(checkbox).to_be_checked()
                    expect(checkbox).to_be_disabled()
                    refresh_unavailable[0] = False
                    region.get_by_role("button", name="Retry refresh").click()
                    expect(checkbox).to_be_enabled(timeout=12000)
                    expect(checkbox).to_be_checked()
                else:
                    expect(checkbox).to_be_enabled(timeout=12000)
                    expect(checkbox).to_be_checked()
                    self.assertIn("unrelated", requests[-1]["fields"]["labels"])
                self.assertEqual([item["kind"] for item in requests], ["label", "area"])
            self.assertTrue(all(item["kind"] in ("label", "area") for item in requests))
            if mobile:
                self.assertLessEqual(region.evaluate("e => e.scrollWidth"), region.evaluate("e => e.clientWidth") + 1)
        finally:
            context.close()

    def test_delayed_success_both_modes(self):
        for review in (True, False):
            with self.subTest(review=review): self.run_case(review, None, mobile=not review)

    def test_delayed_failure_both_stages_and_modes(self):
        for review in (True, False):
            for failure in ("label", "area"):
                with self.subTest(review=review, failure=failure): self.run_case(review, failure)

    def test_confirmed_assignment_with_refresh_failure(self):
        for review in (True, False):
            with self.subTest(review=review): self.run_case(review, None, refresh_failure=True)

    def test_pending_selection_does_not_leak_to_another_area(self):
        self.run_case(False, None, navigate=True)


if __name__ == "__main__": unittest.main(verbosity=2)
