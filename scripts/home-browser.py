"""Room-first Home regressions against the isolated Home Assistant mock."""

import copy
import json
import re
import unittest
import urllib.request
from playwright.sync_api import expect, sync_playwright
from browser_common import BASE, launch, screenshot_dir


def read_json(path):
    with urllib.request.urlopen(BASE + path, timeout=20) as response:
        return json.load(response)


class HomeRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = read_json("/api/hierarchy")
        if cls.original.get("hierarchy", {}).get("home", {}).get("name") != "Demo House":
            raise RuntimeError("Run this scenario against the documented mock Home Assistant.")
        cls.health = read_json("/api/health/report")
        cls.pw = sync_playwright().start()
        cls.browser = launch(cls.pw)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.body = copy.deepcopy(self.original)
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 1010}, color_scheme="dark")
        self.page = self.context.new_page()
        self.page.set_default_timeout(12000)
        self.writes = []
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

        def guard(route):
            if route.request.method in ("GET", "HEAD"):
                route.continue_()
            else:
                self.writes.append((route.request.method, route.request.url))
                route.fulfill(status=409, json={"ok": False, "error": "Unexpected write in Home browser test"})

        self.page.route("**/api/**", guard)
        self.stub_read("**/api/hierarchy*", lambda url: self.body)
        self.stub_read("**/api/settings/guide", lambda url: {"ok": True, "guide": {"areas": {}}, "revision": "0"})

    def stub_read(self, pattern, response):
        def handle(route):
            if route.request.method == "GET":
                route.fulfill(json=response(route.request.url))
            else:
                route.fallback()

        self.page.route(pattern, handle)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.writes, [])
        self.assertEqual(self.errors, [])

    def open_home(self):
        self.page.goto(BASE + "/")
        expect(self.page.get_by_role("heading", name="Home", exact=True)).to_be_visible()

    def test_home_shows_evidence_and_filters_health_without_writes(self):
        self.open_home()
        organize = self.page.get_by_role("region", name="Organize a room")
        expect(organize.get_by_role("button", name="Choose a room")).to_be_visible()
        expect(self.page.get_by_role("region", name="House inventory")).to_contain_text("Active entities")
        suggested = self.page.get_by_role("region", name="Suggested rooms")
        expect(suggested.get_by_text("Explore automatic lighting")).not_to_have_count(0)
        expect(suggested.get_by_text(re.compile(r"lights and a (motion|presence) sensor"))).not_to_have_count(0)
        health = self.page.get_by_role("region", name="Health priorities")
        references = health.get_by_role("button", name=re.compile("Missing references"))
        expect(references).to_be_visible()
        expect(health.get_by_role("button", name=re.compile("Lights without an area"))).to_have_count(0)
        expect(self.page.get_by_role("heading", name="How Taxis builds your home")).to_have_count(0)
        self.page.screenshot(path=screenshot_dir() / "home-desktop.png")
        references.click()
        expect(self.page).to_have_url(re.compile(r"#health/references$"))
        expect(self.page.get_by_role("combobox", name="Check", exact=True)).to_have_value("references")
        self.page.go_back()
        self.page.get_by_text("Whole-house guide", exact=True).click()
        expect(self.page.get_by_role("heading", name="How Taxis builds your home")).to_be_visible()
        expect(self.page.get_by_role("region", name="Automation ideas").get_by_role("link")).not_to_have_count(0)

    def test_phone_chooses_room_from_long_list_and_resumes_after_reload(self):
        h = self.body["hierarchy"]
        floor = {"id": "guest_floor", "name": "Όροφος δοκιμής", "level": 2, "icon": None, "areaIds": []}
        for number in range(1, 30):
            area_id = f"guest_{number}"
            h["areas"][area_id] = {
                "id": area_id, "name": f"Δωμάτιο {number}", "floorId": floor["id"], "icon": None, "labels": [],
                "temperatureEntityId": None, "humidityEntityId": None, "deviceIds": [], "entityIds": [],
            }
            floor["areaIds"].append(area_id)
        h["floors"].append(floor)
        h["counts"]["areas"] = len(h["areas"])
        h["counts"]["floors"] = len(h["floors"])
        self.page.set_viewport_size({"width": 360, "height": 800})
        self.open_home()
        expect(self.page.get_by_role("region", name="Resume work")).to_contain_text("The last room you open will appear here.")
        self.page.get_by_role("button", name="Choose a room", exact=True).click()
        expect(self.page.get_by_role("heading", name="Rooms", exact=True)).to_be_visible()
        floor_list = self.page.get_by_role("region", name="Όροφος δοκιμής", exact=True)
        expect(floor_list.get_by_role("button")).to_have_count(29)
        search = self.page.get_by_role("textbox", name="Search rooms")
        search.fill("zzz")
        expect(self.page.get_by_text("No rooms match your search.")).to_be_visible()
        search.fill("οροφοσ δοκιμησ δωματιο 29")
        floor_list.get_by_role("button", name=re.compile(r"^Δωμάτιο 29")).click()
        expect(self.page).to_have_url(re.compile(r"#guide/guest_29$"))
        expect(self.page.get_by_role("heading", name="Δωμάτιο 29", exact=True)).to_be_visible()
        self.page.get_by_role("navigation", name="Room navigation").get_by_role("button", name="Home", exact=True).click()
        resume = self.page.get_by_role("region", name="Resume work")
        expect(resume.get_by_role("button", name="Resume Δωμάτιο 29")).to_be_visible()
        self.page.reload()
        expect(resume.get_by_text("Confirm equipment", exact=True)).to_be_visible()
        self.assertEqual(self.page.evaluate("document.documentElement.scrollWidth"), 360)
        self.page.screenshot(path=screenshot_dir() / "home-mobile.png")
        resume.get_by_role("button", name="Resume Δωμάτιο 29").click()
        expect(self.page).to_have_url(re.compile(r"#guide/guest_29$"))

    def test_home_search_is_available_during_read_failure_and_health_can_retry(self):
        self.stub_read(
            "**/api/settings/guide",
            lambda url: {"ok": False, "error": "Could not load saved room decisions"},
        )

        def report(url):
            return self.health if "refresh=1" in url else {"ok": False, "error": "Mock Health read failed"}

        self.stub_read("**/api/health/report*", report)
        self.open_home()
        expect(self.page.get_by_role("button", name="Retry reading room decisions")).to_be_visible()
        health = self.page.get_by_role("region", name="Health priorities")
        expect(health.get_by_role("alert")).to_contain_text("Health checks could not be read.")
        health.get_by_role("button", name="Retry Health").click()
        expect(health.get_by_role("button", name=re.compile("Missing references"))).to_be_visible()
        search = self.page.get_by_role("textbox", name="Search rooms")
        search.fill("kitchen")
        self.page.get_by_role("region", name="Organize a room").get_by_role("button", name=re.compile("^Kitchen")).click()
        expect(self.page).to_have_url(re.compile(r"#guide/kitchen$"))

    def test_no_rooms_offers_area_organization_and_ignores_stale_resume(self):
        h = self.body["hierarchy"]
        h["areas"], h["looseAreaIds"], h["entities"], h["devices"] = {}, [], {}, {}
        for floor in h["floors"]:
            floor["areaIds"] = []
        h["counts"]["areas"] = 0
        self.page.add_init_script('localStorage.setItem("taxis:last-worked-room", "removed_room")')
        self.open_home()
        expect(self.page.get_by_text("No rooms yet.", exact=False)).to_be_visible()
        expect(self.page.get_by_role("button", name=re.compile("^Resume "))).to_have_count(0)
        self.page.get_by_role("button", name="Manage floors and areas").click()
        expect(self.page).to_have_url(re.compile(r"#organize/spaces$"))


if __name__ == "__main__":
    unittest.main()
