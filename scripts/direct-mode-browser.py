"""Direct/review UI regressions with every mutating request intercepted."""
import copy
import json
import os
import unittest
import urllib.request
from playwright.sync_api import sync_playwright
from browser_common import BASE, launch

class DirectModeUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urllib.request.urlopen(BASE + '/api/hierarchy', timeout=30) as response:
            cls.fixture = json.load(response)
        cls.pw = sync_playwright().start()
        cls.browser = launch(cls.pw)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1600, 'height': 1100})
        self.page = self.context.new_page()
        self.page.set_default_timeout(15000)
        self.h = copy.deepcopy(self.fixture)
        self.review = True
        self.direct_available = True
        self.fail_save = False
        self.fail_direct = False
        self.stale_direct = False
        self.require_backup_confirmation = False
        self.fail_hierarchy = False
        self.requests = []
        self.page.route('**/api/hierarchy*', lambda route: route.fulfill(json={'ok': False, 'error': 'Mock refresh failed'} if self.fail_hierarchy else self.h))
        def general(route):
            if route.request.method == 'PUT':
                self.requests.append(('setting', route.request.post_data_json))
                if self.fail_save:
                    return route.fulfill(status=409, json={'ok': False, 'error': 'Pending changes must be resolved first.'})
                self.review = route.request.post_data_json['reviewChangesBeforeApplying']
            route.fulfill(json={'ok': True, 'general': {'reviewChangesBeforeApplying': self.review}, 'revision': 'revision-1', 'directEditingAvailable': self.direct_available})
        def changes(route):
            if route.request.method != 'GET': self.requests.append(('review', route.request.post_data_json))
            route.fulfill(json={'ok': True, 'changes': [], 'version': 'empty'})
        def preview(route):
            body = route.request.post_data_json
            self.requests.append(('preview', body))
            changes = [{'id': i + 1, 'kind': item['kind'], 'op': item['op'], 'targetId': item.get('targetId', 'new:label:1'), 'scope': None, 'before': {}, 'after': item.get('fields', {}), 'createdAt': ''} for i, item in enumerate(body['changes'])]
            route.fulfill(json={'ok': True, 'changes': changes, 'previewVersion': 'exact-preview', 'requiresNoBackupConfirmation': self.require_backup_confirmation})
        def direct(route):
            body = route.request.post_data_json
            self.requests.append(('direct', body))
            if self.stale_direct:
                return route.fulfill(status=409, json={'ok': False, 'error': 'Preview changed. Refresh and try again.'})
            if self.require_backup_confirmation and not body.get('allowWithoutBackup'):
                return route.fulfill(status=409, json={'ok': False, 'error': "Outside Home Assistant, Taxis can't make a backup. Confirm to apply without one."})
            if not self.fail_direct:
                h = self.h['hierarchy']
                for item in body['changes']:
                    if item['kind'] == 'label' and item['op'] == 'create':
                        h['labels']['real-label-id'] = {'id': 'real-label-id', 'name': item['fields']['name'], 'color': item['fields'].get('color'), 'icon': None, 'description': None}
                    if item['kind'] == 'entity' and 'labels' in item['fields']:
                        h['entities'][item['targetId']]['labels'] = item['fields']['labels']
            results = [{'changeId': i + 1, 'ok': not self.fail_direct, 'message': 'Mock failure' if self.fail_direct else 'Applied', 'status': 'failed' if self.fail_direct else 'verified'} for i, _ in enumerate(body['changes'])]
            route.fulfill(json={'ok': True, 'backup': {'made': True}, 'results': results})
        self.page.route('**/api/settings/general', general)
        self.page.route('**/api/changes', changes)
        self.page.route('**/api/changes/batch', changes)
        self.page.route('**/api/direct-changes', direct)
        self.page.route('**/api/direct-preview', preview)
        def block_writes(route):
            if route.request.method not in ('GET', 'HEAD'):
                self.fail('Unexpected real mutation: ' + route.request.url)
            route.continue_()
        self.page.route('**/api/**', block_writes)
        # Last matching route wins, so reinstall mocks after the guard.
        self.page.route('**/api/hierarchy*', lambda route: route.fulfill(json={'ok': False, 'error': 'Mock refresh failed'} if self.fail_hierarchy else self.h))
        self.page.route('**/api/settings/general', general)
        self.page.route('**/api/changes', changes)
        self.page.route('**/api/changes/batch', changes)
        self.page.route('**/api/direct-changes', direct)
        self.page.route('**/api/direct-preview', preview)

    def tearDown(self): self.context.close()
    def settings(self):
        self.page.goto(BASE + '/#settings', wait_until='domcontentloaded')
        box = self.page.get_by_role('checkbox', name='Review changes before applying')
        box.wait_for()
        return box
    def create(self, name):
        self.page.goto(BASE + '/#organize/labels', wait_until='domcontentloaded')
        field = self.page.get_by_role('textbox', name='New label name')
        field.fill(name)
        self.page.get_by_role('button', name='Add', exact=True).click()
    def confirm(self):
        dialog = self.page.get_by_role('dialog', name='Review before applying')
        dialog.get_by_role('button', name='Confirm and apply').click()

    def test_persistence_failure_and_direct_single(self):
        box = self.settings()
        self.assertTrue(box.is_checked())
        self.fail_save = True
        box.click()
        self.page.get_by_text('Pending changes must be resolved first.').wait_for()
        self.assertTrue(box.is_checked())
        self.fail_save = False
        box.click()
        self.page.get_by_text('Direct mode: edits apply to Home Assistant immediately.').wait_for()
        self.create('Mock direct label')
        dialog = self.page.get_by_role('dialog', name='Review before applying')
        self.assertIn('Mock direct label', dialog.inner_text())
        self.assertIn('Home Assistant assigns the ID when created', dialog.inner_text())
        self.assertNotIn('new:label:1', dialog.inner_text())
        self.confirm()
        self.page.get_by_text('Applied to Home Assistant').wait_for()
        req = next(body for kind, body in self.requests if kind == 'direct')
        self.assertEqual(req['settingsRevision'], 'revision-1')
        self.assertEqual(req['changes'][0]['fields']['name'], 'Mock direct label')
        self.assertFalse(any(kind == 'review' for kind, _ in self.requests))
    def test_entity_editor_labels_follow_mode_and_submit_before_close(self):
        entity = next(e for e in self.h['hierarchy']['entities'].values() if e['inRegistry'])
        from urllib.parse import quote
        url = BASE + '/#organize/entities/' + quote(entity['entityId'], safe='')
        self.page.goto(url, wait_until='domcontentloaded')
        self.page.locator('#ent-name').fill('Review editor fixture')
        self.page.get_by_role('button', name='Add to changes', exact=True).click()
        self.page.locator('#ent-name').wait_for(state='detached')
        self.assertTrue(any(kind == 'review' for kind, _ in self.requests))
        box = self.settings()
        box.click()
        self.page.get_by_text('Direct mode: edits apply to Home Assistant immediately.').wait_for()
        self.page.goto(url, wait_until='domcontentloaded')
        self.page.locator('#ent-name').fill('Direct editor fixture')
        self.assertEqual(self.page.get_by_role('button', name='Add to changes', exact=True).count(), 0)
        self.page.get_by_role('button', name='Save to Home Assistant', exact=True).click()
        self.confirm()
        self.page.locator('#ent-name').wait_for(state='detached')
        direct = [body for kind, body in self.requests if kind == 'direct']
        self.assertEqual(direct[-1]['changes'][0]['fields']['name'], 'Direct editor fixture')

    def test_local_preview_disables_direct_setting_but_keeps_drafts(self):
        self.direct_available = False
        box = self.settings()
        self.assertTrue(box.is_checked())
        self.assertTrue(box.is_disabled())
        self.page.get_by_text('Direct editing is unavailable in this local preview.').wait_for()
        self.assertFalse(any(kind == 'setting' for kind, _ in self.requests))
        self.create('Local review draft')
        self.page.get_by_text('Added to the list of changes').wait_for()
        self.assertTrue(any(kind == 'review' for kind, _ in self.requests))
        self.assertFalse(any(kind == 'direct' for kind, _ in self.requests))

    def test_setting_available_when_home_assistant_is_offline(self):
        self.fail_hierarchy = True
        box = self.settings()
        self.page.get_by_text("The naming settings need Home Assistant's areas.", exact=False).wait_for()
        self.assertTrue(box.is_enabled())
        box.click()
        self.page.get_by_text('Direct mode: edits apply to Home Assistant immediately.').wait_for()
        self.assertEqual(self.requests[-1], ('setting', {'reviewChangesBeforeApplying': False}))

    def test_refresh_recovers_mode_and_blocks_stale_edits(self):
        box = self.settings()
        self.review = False
        self.page.get_by_role('button', name='Refresh', exact=True).click()
        self.page.get_by_text('Direct mode: edits apply to Home Assistant immediately.').wait_for()
        self.fail_hierarchy = True
        self.create('Applied before failed refresh')
        self.confirm()
        self.page.get_by_text('Applied to Home Assistant, but the view could not be refreshed.', exact=False).wait_for()
        self.assertTrue(self.page.get_by_role('button', name='Add', exact=True).is_disabled())
        self.fail_hierarchy = False
        self.page.get_by_role('button', name='Refresh', exact=True).click()
        self.page.get_by_role('button', name='Add', exact=True).wait_for(state='visible')
        self.page.wait_for_function("!document.querySelector('form button[type=submit]').disabled")

    def test_no_backup_requires_confirmation_on_each_write(self):
        box = self.settings()
        box.click()
        self.page.get_by_text('Direct mode: edits apply to Home Assistant immediately.').wait_for()
        self.require_backup_confirmation = True
        self.create('No backup first')
        dialog = self.page.get_by_role('dialog', name='Review before applying')
        self.assertIn('No backup first', dialog.inner_text())
        dialog.get_by_role('button', name='Cancel').click()
        self.assertEqual(len([1 for kind, _ in self.requests if kind == 'direct']), 0)
        self.page.get_by_role('button', name='Add', exact=True).click()
        dialog.get_by_role('checkbox').check()
        dialog.get_by_role('button', name='Confirm and apply').click()
        self.page.get_by_text('Applied to Home Assistant').wait_for()
        direct = [body for kind, body in self.requests if kind == 'direct']
        self.assertEqual([body['allowWithoutBackup'] for body in direct], [True])
        self.assertEqual(direct[0]['previewVersion'], 'exact-preview')

    def test_direct_create_then_batch_uses_real_label_id(self):
        h = self.h['hierarchy']
        area = next(iter(h['areas']))
        proto = next(iter(h['entities'].values()))
        h['entities'] = {}
        h['labels'] = {}
        for i in range(2):
            entity_id = f'sensor.direct_fixture_{i}'
            h['entities'][entity_id] = {**copy.deepcopy(proto), 'entityId': entity_id, 'name': f'Direct fixture {i}', 'deviceId': None, 'areaId': area, 'ownAreaId': area, 'members': [], 'labels': [], 'inRegistry': True, 'disabled': False, 'hidden': False, 'maintenance': False}
        h['areas'][area]['entityIds'] = list(h['entities'])
        box = self.settings()
        box.click()
        self.page.get_by_text('Direct mode: edits apply to Home Assistant immediately.').wait_for()
        self.page.goto(BASE + f'/#area/{area}/labels', wait_until='domcontentloaded')
        section = self.page.get_by_role('region', name='Entity label assignment')
        section.get_by_role('checkbox', name='Select Direct fixture 0').check()
        section.get_by_role('checkbox', name='Select Direct fixture 1').check()
        section.get_by_role('button', name='+ Add new label').click()
        section.get_by_role('textbox', name='New label name').fill('Created in direct mode')
        section.get_by_role('button', name='Add', exact=True).click()
        self.confirm()
        self.page.wait_for_function("document.querySelector('select[aria-label=\"Label to add\"]').value === 'real-label-id'")
        section.get_by_role('button', name='Add label', exact=True).click()
        self.confirm()
        self.page.wait_for_function("document.querySelector('[role=status]')?.textContent?.includes('Applied to Home Assistant')")
        direct = [body for kind, body in self.requests if kind == 'direct']
        self.assertEqual(len(direct), 2)
        self.assertEqual(len(direct[1]['changes']), 2)
        self.assertTrue(all(item['fields']['labels'] == ['real-label-id'] for item in direct[1]['changes']))

    def test_selection_preview_cancel_and_partial_result_preserves_server_value(self):
        selection = {'entities': {}, 'areas': {}}
        calls = []
        entity = self.h['hierarchy']['entities']['binary_sensor.living_presence']
        area = entity['areaId']
        self.page.route('**/api/settings/inventory', lambda route: route.fulfill(json={'ok': True, 'inventory': selection, 'revision': 'inventory-rev'}))
        def selection_preview(route):
            calls.append(('preview', route.request.post_data_json))
            changes = [{'id': 1, 'kind': 'helper', 'op': 'update', 'targetId': 'binary_sensor.room_motion', 'scope': None, 'before': {'entities': ['binary_sensor.old']}, 'after': {'entities': ['binary_sensor.new']}, 'createdAt': '', 'disclosures': ['This replacement removes an unsupported input named legacy_option.']}]
            route.fulfill(json={'ok': True, 'changes': changes, 'previewVersion': 'selection-plan', 'requiresNoBackupConfirmation': False, 'localOnly': False, 'notes': ['Taxis living_room binary_sensor.living_presence: starts → holds']})
        def selection_commit(route):
            body = route.request.post_data_json
            calls.append(('commit', body))
            route.fulfill(json={'ok': True, 'saved': {'kind': 'inventory', 'value': body['value'], 'revision': 'inventory-next'}, 'apply': {'ok': True, 'backup': {'made': True}, 'results': [{'changeId': 1, 'ok': True, 'status': 'partial', 'message': 'Some updates need attention', 'details': ['Sensor needs repair']}]}})
        self.page.route('**/api/direct-settings-preview', selection_preview)
        self.page.route('**/api/direct-settings', selection_commit)
        box = self.settings()
        box.click()
        self.page.get_by_text('Direct mode: edits apply to Home Assistant immediately.').wait_for()
        self.page.goto(BASE + f'/#area/{area}/capabilities', wait_until='domcontentloaded')
        starts = self.page.get_by_role('button', name='Starts: Living presence')
        holds = self.page.get_by_role('button', name='Holds: Living presence')
        starts.wait_for()
        self.assertEqual(starts.get_attribute('aria-pressed'), 'true')
        holds.click()
        dialog = self.page.get_by_role('dialog', name='Review before applying')
        self.assertIn('binary_sensor.room_motion', dialog.inner_text())
        self.assertIn('binary_sensor.old', dialog.inner_text())
        self.assertIn('binary_sensor.new', dialog.inner_text())
        self.assertIn('removes an unsupported input named legacy_option', dialog.inner_text())
        self.assertIn('binary_sensor.living_presence: starts → holds', dialog.inner_text())
        if os.environ.get('TAXIS_DIRECT_PREVIEW_SCREENSHOT'):
            self.page.screenshot(path=os.environ['TAXIS_DIRECT_PREVIEW_SCREENSHOT'])
        dialog.get_by_role('button', name='Cancel').click()
        starts.wait_for()
        self.assertEqual(starts.get_attribute('aria-pressed'), 'true')
        self.assertEqual([kind for kind, _ in calls], ['preview'])
        holds.click()
        dialog.get_by_role('button', name='Confirm and apply').click()
        self.page.get_by_role('alert').filter(has_text='Sensor needs repair').wait_for()
        self.assertEqual(holds.get_attribute('aria-pressed'), 'true')
        self.assertEqual(calls[-1][1]['previewVersion'], 'selection-plan')
        self.assertEqual(calls[-1][1]['revision'], 'inventory-rev')

    def test_selection_local_only_preview_is_honest(self):
        self.page.route('**/api/settings/inventory', lambda route: route.fulfill(json={'ok': True, 'inventory': {'entities': {}, 'areas': {}}, 'revision': 'inventory-rev'}))
        self.page.route('**/api/direct-settings-preview', lambda route: route.fulfill(json={'ok': True, 'changes': [], 'previewVersion': 'local-plan', 'requiresNoBackupConfirmation': False, 'localOnly': True, 'notes': []}))
        self.page.route('**/api/direct-settings', lambda route: route.fulfill(json={'ok': True, 'saved': {'kind': 'inventory', 'value': route.request.post_data_json['value'], 'revision': 'next'}, 'apply': None}))
        box = self.settings()
        box.click()
        self.page.get_by_text('Direct mode: edits apply to Home Assistant immediately.').wait_for()
        area = self.h['hierarchy']['entities']['binary_sensor.living_presence']['areaId']
        self.page.goto(BASE + f'/#area/{area}/capabilities', wait_until='domcontentloaded')
        self.page.get_by_role('button', name='Holds: Living presence').click()
        dialog = self.page.get_by_role('dialog', name='Review before applying')
        dialog.get_by_text('No Home Assistant objects will be changed.').wait_for()
        dialog.get_by_role('button', name='Save in Taxis').click()
        self.page.get_by_role('status').filter(has_text='Selection saved in Taxis.').wait_for()

    def test_stale_preview_error_does_not_reapply(self):
        box = self.settings()
        box.click()
        self.page.get_by_text('Direct mode: edits apply to Home Assistant immediately.').wait_for()
        self.stale_direct = True
        self.create('Stale preview')
        self.confirm()
        self.page.get_by_role('alert').filter(has_text='Preview changed').first.wait_for()
        self.assertEqual(len([1 for kind, _ in self.requests if kind == 'direct']), 1)

    def test_review_and_direct_failure(self):
        self.settings()
        self.create('Mock review label')
        self.page.get_by_text('Added to the list of changes').wait_for()
        self.assertTrue(any(kind == 'review' for kind, _ in self.requests))
        box = self.settings()
        box.click()
        self.page.get_by_text('Direct mode: edits apply to Home Assistant immediately.').wait_for()
        self.fail_direct = True
        self.create('Mock failed label')
        self.confirm()
        self.page.get_by_role('alert').filter(has_text='Mock failure').first.wait_for()
        self.assertEqual(self.page.get_by_role('textbox', name='New label name').input_value(), 'Mock failed label')

if __name__ == '__main__': unittest.main(verbosity=2)
