"""Location toggles using an isolated mock server and intercepted mutations."""
import copy
import json
import os
import unittest
import urllib.request
from playwright.sync_api import expect, sync_playwright
from browser_common import BASE, launch

class LocationFeedback(unittest.TestCase):
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
    def test_toggle_success_and_failure(self):
        for review in (True, False):
            for fail in (True, False):
                with self.subTest(review=review, fail=fail): self.run_case(review, fail)
    def test_legacy_clear_and_failure(self):
        for fail in (False, True):
            with self.subTest(fail=fail): self.run_legacy(fail)
    def run_legacy(self, fail):
        context = self.browser.new_context()
        page = context.new_page()
        h = copy.deepcopy(self.fixture)
        tree = h['hierarchy']
        tree['labels']['mock_out'] = {'id':'mock_out','name':'Exterior'}
        tree['labels']['mock_keep'] = {'id':'mock_keep','name':'Bedroom'}
        area = tree['areas']['kitchen']
        area['labels'] = ['mock_keep','mock_out']
        inventory = {'entities':{},'areas':{'kitchen':{'type':'exterior'}},'ignored':[]}
        with urllib.request.urlopen(BASE + '/api/settings/inventory', timeout=30) as response:
            inventory = json.load(response)['inventory']
        inventory.setdefault('areas',{}).setdefault('kitchen',{})['type'] = 'exterior'
        calls = []
        def guard(route):
            if route.request.method not in ('GET','HEAD'): self.fail('Unexpected mutation: ' + route.request.url)
            route.continue_()
        def settings(route):
            nonlocal inventory
            if route.request.method == 'GET': route.fulfill(json={'ok':True,'inventory':inventory})
            else:
                calls.append('settings')
                if fail: route.fulfill(status=400,json={'ok':False,'error':'Mock settings failure'})
                else:
                    inventory = route.request.post_data_json
                    route.fulfill(json={'ok':True,'inventory':inventory})
        def changes(route):
            if route.request.method == 'GET': route.fulfill(json={'ok':True,'changes':[],'version':'mock'}); return
            calls.append('area')
            area['labels'] = route.request.post_data_json['fields']['labels']
            route.fulfill(json={'ok':True,'changes':[],'version':'mock'})
        page.route('**/api/**',guard)
        page.route('**/api/hierarchy*',lambda r:r.fulfill(json=h))
        page.route('**/api/settings/general',lambda r:r.fulfill(json={'ok':True,'general':{'reviewChangesBeforeApplying':True},'revision':'mock'}))
        page.route('**/api/settings/inventory',settings)
        page.route('**/api/changes',changes)
        try:
            page.goto(BASE + '/#area/kitchen',wait_until='networkidle')
            region=page.get_by_role('region',name='Area classification')
            outside=region.get_by_role('button',name='Exterior',exact=True)
            expect(outside).to_have_attribute('aria-pressed','true')
            outside.click()
            if fail:
                expect(region.get_by_role('alert')).to_contain_text('Could not clear the saved location')
                expect(outside).to_have_attribute('aria-pressed','true')
                self.assertEqual(calls,['settings'])
            else:
                expect(outside).to_be_enabled(timeout=10000)
                expect(outside).to_have_attribute('aria-pressed','false')
                self.assertEqual(calls,['settings','area'])
                self.assertEqual(area['labels'],['mock_keep'])
                self.assertNotIn('type',inventory.get('areas',{}).get('kitchen',{}))
        finally: context.close()
    def run_case(self, review, fail):
        context = self.browser.new_context()
        page = context.new_page()
        h = copy.deepcopy(self.fixture)
        tree = h['hierarchy']
        tree['labels']['mock_in'] = {'id':'mock_in','name':'Interior'}
        tree['labels']['mock_out'] = {'id':'mock_out','name':'EXTERIOR'}
        tree['labels']['mock_keep'] = {'id':'mock_keep','name':'Bedroom'}
        tree['labels']['mock_stair'] = {'id':'mock_stair','name':'Staircase'}
        area = tree['areas']['kitchen']
        area['labels'] = ['mock_keep']
        changes = [{'id': 13, 'kind': 'entity', 'op': 'update', 'targetId': 'light.existing', 'scope': None, 'before': {}, 'after': {'name':'Existing'}, 'createdAt': ''}] if review else []
        calls = []
        page.add_init_script("""(() => { const orig = window.fetch; window.fetch = async (...args) => { const response = await orig(...args); if ((args[1]?.method || '').toUpperCase() === 'POST' && /api\\/(changes|direct-changes)/.test(String(args[0]))) await new Promise(r => setTimeout(r, 1200)); return response; }; })();""")
        def guard(route):
            if route.request.method not in ('GET','HEAD'): self.fail('Unexpected mutation: ' + route.request.url)
            route.continue_()
        def apply(route):
            body = route.request.post_data_json
            items = body.get('changes', [body])
            calls.extend(copy.deepcopy(items))
            if not fail:
                area['labels'] = items[0]['fields']['labels']
                if review: changes.append({'id':14,'kind':'area','op':'update','targetId':'kitchen','scope':None,'before':{},'after':{'labels':area['labels']},'createdAt':''})
            if review: route.fulfill(status=400 if fail else 200, json={'ok':False,'error':'Mock failure'} if fail else {'ok':True,'changes':changes,'version':'mock'})
            else: route.fulfill(json={'ok':True,'backup':{'made':True},'results':[{'changeId':1,'ok':not fail,'status':'failed' if fail else 'verified','message':'mock'}]})
        def preview(route):
            items=route.request.post_data_json['changes']
            planned=[{'id':i+1,'kind':x['kind'],'op':x['op'],'targetId':x.get('targetId','new:label:1'),'scope':None,'before':{},'after':x.get('fields',{}),'createdAt':''} for i,x in enumerate(items)]
            route.fulfill(json={'ok':True,'changes':planned,'previewVersion':'mock','requiresNoBackupConfirmation':False})
        page.route('**/api/**', guard)
        page.route('**/api/hierarchy*', lambda r:r.fulfill(json=h))
        page.route('**/api/settings/general',lambda r:r.fulfill(json={'ok':True,'general':{'reviewChangesBeforeApplying':review},'revision':'mock'}))
        page.route('**/api/changes', lambda r:r.fulfill(json={'ok':True,'changes':changes,'version':'mock'}) if r.request.method == 'GET' else apply(r))
        page.route('**/api/changes/batch',apply)
        page.route('**/api/direct-preview',preview)
        page.route('**/api/direct-changes',apply)
        try:
            page.goto(BASE + '/#area/kitchen',wait_until='networkidle')
            region=page.get_by_role('region',name='Area classification')
            inside=region.get_by_role('button',name='Interior',exact=True)
            outside=region.get_by_role('button',name='Exterior',exact=True)
            labels=region.get_by_role('checkbox').evaluate_all('(els) => els.map(e => e.parentElement.textContent.trim())')
            self.assertEqual(labels, sorted(labels))
            expect(inside).to_have_attribute('aria-pressed','false')
            outside.click()
            expect(outside).to_have_attribute('aria-pressed','true',timeout=500)
            if not review: page.get_by_role('dialog',name='Review before applying').get_by_role('button',name='Confirm and apply').click()
            if fail:
                expect(region.get_by_role('alert')).to_contain_text('Could not save',timeout=10000)
                expect(outside).to_have_attribute('aria-pressed','false')
            else:
                expect(outside).to_be_enabled(timeout=10000)
                expect(outside).to_have_attribute('aria-pressed','true')
                self.assertEqual(calls[-1]['fields']['labels'],['mock_keep','mock_out'])
                stairs=region.get_by_role('button',name='Staircase',exact=True)
                stairs.click()
                expect(stairs).to_have_attribute('aria-pressed','true',timeout=500)
                if not review: page.get_by_role('dialog',name='Review before applying').get_by_role('button',name='Confirm and apply').click()
                expect(stairs).to_be_enabled(timeout=10000)
                self.assertEqual(calls[-1]['fields']['labels'],['mock_keep','mock_out','mock_stair'])
                outside.click()
                expect(outside).to_have_attribute('aria-pressed','false',timeout=500)
                if not review: page.get_by_role('dialog',name='Review before applying').get_by_role('button',name='Confirm and apply').click()
                expect(outside).to_be_enabled(timeout=10000)
                self.assertEqual(calls[-1]['fields']['labels'],['mock_keep','mock_stair'])
                expect(stairs).to_have_attribute('aria-pressed','true')
                stairs.click()
                if not review: page.get_by_role('dialog',name='Review before applying').get_by_role('button',name='Confirm and apply').click()
                expect(stairs).to_be_enabled(timeout=10000)
                self.assertEqual(calls[-1]['fields']['labels'],['mock_keep'])
                self.assertEqual(changes[0]['id'],13) if review else None
        finally: context.close()
if __name__ == '__main__': unittest.main(verbosity=2)
