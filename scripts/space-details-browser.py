"""Space details against isolated fixtures. Every mutation is intercepted."""
import copy, json, os, unittest, urllib.request
from playwright.sync_api import sync_playwright, expect
from browser_common import BASE, launch, screenshot_dir

FIXTURE = os.environ.get('TAXIS_FIXTURE_URL', BASE)

class SpaceDetails(unittest.TestCase):
    def test_details_and_rename(self):
        with urllib.request.urlopen(FIXTURE + '/api/hierarchy', timeout=10) as response: body = json.load(response)
        h = body['hierarchy']
        area = copy.deepcopy(next(iter(h['areas'].values())))
        label = copy.deepcopy(next(iter(h['labels'].values())))
        h['labels'] = {'office': {**label, 'id':'office', 'name':'Space: Office', 'description':'Taxis Space floor: "first"'}, 'studio': {**label, 'id':'studio', 'name':'Space: Studio'}, 'new:label:1': {**label, 'id':'new:label:1', 'name':'Space: Pending'}}
        h['areas'] = {key:{**area,'id':key,'name':name,'floorId':floor,'labels':['office'],'entityIds':[],'deviceIds':[]} for key,name,floor in [('coffee','Coffee','first'),('remote','Remote','second')]}
        h['floors'] = [{'id':'first','name':'First','level':0,'areaIds':['coffee']},{'id':'second','name':'Second','level':1,'areaIds':['remote']}]
        h['looseAreaIds']=[]; h['entities']={}; h['devices']={}; h['unassignedEntityIds']=[]
        h['labels']['new:label:1']['description']='Taxis Space floor: "first"'
        changes=[{'id':2,'kind':'label','op':'create','targetId':'new:label:1','scope':None,'before':{},'after':{'name':'Space: Pending','description':'Taxis Space floor: "first"'},'createdAt':''}]; submissions=[]; previews=[]; direct=[]; review=[True]
        with sync_playwright() as p:
            browser=launch(p); context=browser.new_context(viewport={'width':1600,'height':1000}); page=context.new_page()
            def fallback(route):
                if route.request.method not in ('GET','HEAD','OPTIONS'): self.fail('Unexpected write: '+route.request.url)
                route.fulfill(response=route.fetch(url=route.request.url.replace(BASE, FIXTURE)))
            page.route('**/api/**', fallback)
            page.route('**/api/hierarchy*', lambda route: route.fulfill(json=body))
            page.route('**/api/settings/general', lambda route: route.fulfill(json={'ok':True,'general':{'reviewChangesBeforeApplying':review[0]},'revision':'mock','directEditingAvailable':True}))
            def queue(route):
                if route.request.method == 'POST':
                    item=route.request.post_data_json; submissions.append(item)
                    target=item['targetId']
                    existing=next((c for c in changes if c['targetId']==target),None)
                    if existing: existing['after'].update(item['fields'])
                    else: changes.append({'id':1,'kind':'label','op':'update','targetId':target,'scope':None,'before':{'name':h['labels'][target]['name'],'description':h['labels'][target]['description']},'after':item['fields'],'createdAt':''})
                    h['labels'][target]['name']=item['fields']['name']
                route.fulfill(json={'ok':True,'changes':changes,'version':'mock'})
            page.route('**/api/changes',queue)
            def preview(route):
                items=route.request.post_data_json['changes']; previews.extend(items)
                route.fulfill(json={'ok':True,'changes':[{'id':1,'kind':'label','op':'update','targetId':'office','scope':None,'before':{'name':'Space: Office'},'after':items[0]['fields'],'createdAt':''}],'previewVersion':'mock','requiresNoBackupConfirmation':False})
            page.route('**/api/direct-preview',preview)
            page.route('**/api/direct-changes',lambda route: (direct.append(route.request.post_data_json), route.fulfill(json={'ok':True,'results':[]})))
            page.goto(BASE+'/#home',wait_until='networkidle')
            nav=page.get_by_role('navigation',name='Floors and areas')
            nav.get_by_role('button',name='Office',exact=True).first.click()
            expect(page).to_have_url(__import__('re').compile(r'#space/office$'))
            expect(page.get_by_role('heading',name='Office',exact=True)).to_be_visible()
            for name in ['First','Second']: expect(page.get_by_role('link',name=name,exact=True)).to_be_visible()
            for area_id in ['coffee','remote']: expect(page.locator('main a[href="#area/'+area_id+'"]')).to_be_visible()
            page.screenshot(path=str(screenshot_dir() / 'space-details.png'))
            page.reload(wait_until='networkidle'); expect(page.get_by_role('heading',name='Office',exact=True)).to_be_visible()
            page.goto(BASE+'/#space/new%3Alabel%3A1',wait_until='networkidle')
            expect(page.get_by_role('button',name='Rename',exact=True)).to_be_enabled()
            page.get_by_role('button',name='Rename',exact=True).click(); page.get_by_label('Space name').fill('Pending renamed')
            page.get_by_role('button',name='Add rename to Changes').click()
            expect(page.get_by_role('heading',name='Pending renamed',exact=True)).to_be_visible()
            self.assertEqual(submissions[-1], {'kind':'label','op':'update','targetId':'new:label:1','fields':{'name':'Space: Pending renamed'}})
            self.assertEqual(changes[0]['after'], {'name':'Space: Pending renamed','description':'Taxis Space floor: "first"'})
            self.assertEqual(changes[0]['targetId'], 'new:label:1')
            page.goto(BASE+'/#space/office',wait_until='networkidle')
            page.get_by_role('button',name='Rename',exact=True).click(); page.get_by_label('Space name').fill('Unsaved')
            page.once('dialog',lambda dialog:dialog.dismiss()); page.get_by_role('button',name='Cancel',exact=True).click()
            expect(page.get_by_label('Space name')).to_have_value('Unsaved')
            page.once('dialog',lambda dialog:dialog.accept()); page.get_by_role('button',name='Cancel',exact=True).click()
            page.get_by_role('button',name='Rename',exact=True).click(); page.get_by_label('Space name').fill('studio')
            page.get_by_role('button',name='Add rename to Changes').click(); expect(page.get_by_role('alert')).to_contain_text('already exists')
            page.get_by_label('Space name').fill('  Study  '); page.get_by_role('button',name='Add rename to Changes').click()
            expect(page.get_by_role('heading',name='Study',exact=True)).to_be_visible()
            self.assertEqual(submissions[-1], {'kind':'label','op':'update','targetId':'office','fields':{'name':'Space: Study'}})
            self.assertEqual(h['labels']['office']['description'], 'Taxis Space floor: "first"')
            changes[:]=changes[:1]; h['labels']['office']['name']='Space: Office'; review[0]=False
            page.reload(wait_until='networkidle'); page.get_by_role('button',name='Rename',exact=True).click(); page.get_by_label('Space name').fill('Direct name')
            page.get_by_role('button',name='Preview rename').click()
            dialog=page.get_by_role('dialog',name='Review before applying'); expect(dialog).to_be_visible()
            self.assertEqual(previews[-1], {'kind':'label','op':'update','targetId':'office','fields':{'name':'Space: Direct name'}})
            dialog.get_by_role('button',name='Cancel').click(); self.assertEqual(direct, []); self.assertEqual(h['labels']['office']['name'], 'Space: Office')
            page.once('dialog',lambda dialog:dialog.accept()); page.goto(BASE+'/#space/new%3Alabel%3A1',wait_until='networkidle')
            expect(page.get_by_role('heading',name='Pending renamed',exact=True)).to_be_visible()
            expect(page.get_by_role('button',name='Rename',exact=True)).to_be_disabled()
            expect(page.get_by_text('Apply or discard the pending Space label change before renaming in direct mode.')).to_be_visible()
            page.once('dialog',lambda dialog:dialog.accept()); page.goto(BASE+'/#space/missing',wait_until='networkidle')
            expect(page.get_by_role('heading',name='Space unavailable')).to_be_visible(); expect(page.get_by_role('link',name='Back to Areas')).to_be_visible()
            context.close(); browser.close()

if __name__ == '__main__': unittest.main()
