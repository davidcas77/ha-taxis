"""Verify recipe Active defaults and saved overrides against isolated mock Taxis."""
import copy
import json
import unittest
import urllib.request
from playwright.sync_api import expect, sync_playwright
from browser_common import BASE, launch

class RecipeDefaults(unittest.TestCase):
    def test_defaults_and_persisted_overrides(self):
        with urllib.request.urlopen(BASE + '/api/hierarchy') as response:
            h = json.load(response)
        tree = h['hierarchy']
        tree['labels']['fixture_exterior'] = {'id':'fixture_exterior','name':'Exterior'}
        tree['labels']['fixture_bathroom'] = {'id':'fixture_bathroom','name':'Bathroom'}
        tree['labels']['fixture_staircase'] = {'id':'fixture_staircase','name':'Staircase'}
        tree['areas']['kitchen']['labels'] = ['fixture_exterior','fixture_staircase']
        tree['areas']['bathroom']['labels'] = ['fixture_bathroom']
        pw = sync_playwright().start()
        browser = launch(pw)
        context = browser.new_context()
        page = context.new_page()
        def guard(route):
            if route.request.method not in ('GET','HEAD') and not (route.request.method == 'PUT' and route.request.url.endswith('/api/settings/inventory')):
                self.fail('Unexpected mutation: ' + route.request.url)
            route.continue_()
        page.route('**/api/**',guard)
        page.route('**/api/hierarchy*',lambda r:r.fulfill(json=h))
        def recipe(name):
            page.goto(BASE + '/#automations/recipes',wait_until='networkidle')
            page.get_by_role('table',name='Recipe types').get_by_role('button',name=name,exact=True).click()
            page.get_by_role('tab',name='Availability',exact=True).click()
        try:
            recipe('Exterior lights')
            expect(page.get_by_role('checkbox',name='Active: Kitchen',exact=True)).to_be_checked()
            expect(page.get_by_role('checkbox',name='Active: Bathroom',exact=True)).not_to_be_checked()
            recipe('Media off')
            expect(page.get_by_role('checkbox',name='Active: Kitchen',exact=True)).not_to_be_checked()
            recipe('Occupancy')
            expect(page.get_by_role('checkbox',name='Active: Kitchen',exact=True)).to_be_checked()
            recipe('Area climate')
            kitchen = page.get_by_role('checkbox',name='Active: Kitchen',exact=True)
            expect(kitchen).not_to_be_checked()
            expect(kitchen).to_have_attribute('title', 'Default: Needs an Interior area and a climate device.')
            kitchen.check()
            expect(kitchen).to_be_checked()
            recipe('Ventilation')
            kitchen = page.get_by_role('checkbox',name='Active: Kitchen',exact=True)
            bathroom = page.get_by_role('checkbox',name='Active: Bathroom',exact=True)
            expect(kitchen).not_to_be_checked()
            expect(bathroom).to_be_checked()
            bathroom.uncheck()
            expect(bathroom).not_to_be_checked()
            kitchen.check()
            expect(kitchen).to_be_checked()
            page.reload(wait_until='networkidle')
            recipe('Ventilation')
            expect(page.get_by_role('checkbox',name='Active: Kitchen',exact=True)).to_be_checked()
            expect(page.get_by_role('checkbox',name='Active: Kitchen',exact=True)).to_have_attribute('aria-description', 'Manual override. Default: Active by default for an area explicitly marked Bathroom.')
            expect(page.get_by_role('checkbox',name='Active: Bathroom',exact=True)).not_to_be_checked()
            recipe('Area climate')
            expect(page.get_by_role('checkbox',name='Active: Kitchen',exact=True)).to_be_checked()
            with urllib.request.urlopen(BASE + '/api/settings/inventory') as response:
                inv = json.load(response)['inventory']
            self.assertEqual(inv['areas']['kitchen']['recipePreferences']['area_climate'], True)
            self.assertEqual(inv['areas']['kitchen']['recipePreferences']['bathroom_fan'], True)
            self.assertEqual(inv['areas']['bathroom']['recipePreferences']['bathroom_fan'], False)
        finally:
            context.close()
            browser.close()
            pw.stop()
if __name__ == '__main__': unittest.main(verbosity=2)
