import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { buttonInputLoop, validButtonAction, validButtonMap, type ButtonAssignment, type ButtonMap } from '../../shared/buttons.ts';
import { validateInput } from '../../shared/changes.ts';
import type { Change } from '../../shared/types.ts';
import { DEFAULT_AI } from '../../shared/ai.ts';
import { buttonFixture } from './fixture.ts';
import { buttonAutomationId } from './discovery.ts';
import { buttonConfig, buttonInventoryFingerprint, planButtonAssignment } from './mapping.ts';
import { applyButtonChanges } from './apply.ts';
import { changeStore } from '../changes/store.ts';
import { testStore } from '../ai/test-store.ts';
import { settingsStore } from '../settings.ts';
import { aiLedger } from '../ai/ledger.ts';
import { aiService } from '../ai/service.ts';
import { fakeFetch, anthropicMessage, TEST_KEY } from '../ai/fake-fetch.ts';
import { requireTaxisHeader } from '../guard.ts';
import { buttonRoutes } from './routes.ts';

const closers:(()=>void)[]=[];
afterEach(()=>{while(closers.length)closers.pop()!();});
function assignment(read:Awaited<ReturnType<ReturnType<typeof buttonFixture>['read']>>,remote='remote1',service='light.toggle'):ButtonAssignment {
  return {controlId:`device:${remote}`,gestureKey:read.inventory.controls.find(c=>c.id===`device:${remote}`)!.gestures[0].key,
    action:{entityId:'light.bedroom_main',service,data:{}},enabled:true,allowExisting:false,fingerprint:buttonInventoryFingerprint(read.inventory),changesVersion:'0'.repeat(16)};
}
function asChange(input:ReturnType<typeof planButtonAssignment>,id=1):Change {return {id,kind:'automation',op:input.op,targetId:String(input.fields?.automation_id),scope:null,before:{},after:input.fields!,createdAt:'2026-10-28T00:00:00Z'};}

describe('button discovery across integrations',()=>{
  it('reads integration metadata, including both buttons, event entities and standalone HA buttons',async()=>{
    const f=buttonFixture(),r=await f.read();
    expect(r.inventory.controls.find(c=>c.id==='device:remote1')?.gestures).toHaveLength(9);
    expect(r.inventory.controls.find(c=>c.id==='device:remote1')?.gestures.some(g=>g.button==='Both')).toBe(true);
    expect(r.inventory.controls.find(c=>c.id==='device:remote2')?.integrations).toContain('mqtt');
    expect(r.inventory.controls.find(c=>c.id==='device:remote4')?.gestures.filter(g=>g.eventType)).toHaveLength(3);
    expect(r.inventory.controls.find(c=>c.id==='entity:input_button.desk')?.gestures).toHaveLength(1);
    expect(f.ha.write).not.toHaveBeenCalled();expect(f.rest.post).not.toHaveBeenCalled();
  });
  it('does not invent missing gestures or hide incomplete reads',async()=>{
    const f=buttonFixture();f.triggers.remote1=[];f.addAutomation('yaml',null);
    const r=await f.read();expect(r.inventory.controls.find(c=>c.id==='device:remote1')?.gestures).toHaveLength(0);
    expect(r.inventory.coverage).toEqual({automations:1,readable:0,unreadable:1});expect(r.inventory.notes.join()).toContain('incomplete');
  });
  it('matches exact button triggers without assigning other gestures from the same remote',async()=>{
    const f=buttonFixture();const trigger=f.triggers.remote1[0];f.addAutomation('old',{alias:'Old button handler',trigger:[trigger],action:[{service:'light.turn_on',target:{entity_id:'light.bedroom_main'}}]});
    const r=await f.read(),c=r.inventory.controls.find(c=>c.id==='device:remote1')!;
    const same=c.gestures.find(g=>g.trigger.type===trigger.type && g.trigger.subtype===trigger.subtype)!;
    expect(c.existing[same.key][0]).toMatchObject({match:'exact',enabled:true,services:['light.turn_on'],targets:['light.bedroom_main']});
    const other=c.gestures.find(g=>g.trigger.type!==trigger.type)!;expect(c.existing[other.key]).toHaveLength(0);
  });
  it('shows opaque blueprint references as possible, not proven per-gesture actions',async()=>{
    const f=buttonFixture();f.addAutomation('blue',{use_blueprint:{path:'user/remote.yaml',input:{remote:'remote1'}},alias:'Remote blueprint'});
    const c=(await f.read()).inventory.controls.find(c=>c.id==='device:remote1')!;
    expect(c.existing[c.gestures[0].key][0].match).toBe('possible');
  });
  it('retains legacy source-entity handlers even when the integration exposes no gestures',async()=>{
    const f=buttonFixture();f.triggers.remote1=[];
    f.raw.entities.push({entity_id:'binary_sensor.legacy_wall_switch',platform:'xiaomi_aqara',device_id:'remote1',unique_id:'legacy'});
    f.addAutomation('legacy',{trigger:[{platform:'event',event_type:'xiaomi_aqara.click',event_data:{entity_id:'binary_sensor.legacy_wall_switch',click_type:'both'}}],action:[{service:'light.toggle',target:{entity_id:'light.bedroom_main'}}]});
    const c=(await f.read()).inventory.controls.find(v=>v.id==='device:remote1')!;
    expect(c.gestures).toHaveLength(0);expect(c.related).toMatchObject([{id:'legacy',match:'possible',targets:['light.bedroom_main']}]);
  });
  it('does not confuse output-device actions with input-button references',async()=>{
    const f=buttonFixture();f.addAutomation('unrelated',{trigger:[{platform:'time',at:'10:00:00'}],action:[{device_id:'remote1',domain:'light',type:'turn_on'}]});
    const c=(await f.read()).inventory.controls.find(c=>c.id==='device:remote1')!;expect(Object.values(c.existing).flat()).toHaveLength(0);
  });
  it('does not trust ownership metadata if the actual automation was customized',async()=>{
    const f=buttonFixture(),r=await f.read(),c=asChange(planButtonAssignment(r.inventory,assignment(r),[]));
    const config=buttonConfig(c.targetId,String(c.after.alias),c.after.button_map as ButtonMap);config.action=[{service:'light.turn_off'}];f.addAutomation(c.targetId,config);
    const next=await f.read();expect(next.inventory.managed).toHaveLength(0);
  });
});

type Fixture=ReturnType<typeof buttonFixture>;
function addEvent(f:Fixture,entityId:string,deviceId:string,name:string,attributes:Record<string,unknown>={}) {
  f.raw.entities.push({entity_id:entityId,platform:'matter',device_id:deviceId,unique_id:entityId});
  f.raw.states.push({entity_id:entityId,state:'2026-10-28T00:00:00Z',attributes:{friendly_name:name,event_types:['Single press','Double press','Long press'],...attributes} as never});
}
function addEnumSensor(f:Fixture,entityId:string,deviceId:string,name:string) {
  f.raw.entities.push({entity_id:entityId,platform:'matter',device_id:deviceId,unique_id:entityId});
  f.raw.states.push({entity_id:entityId,state:'Single press',attributes:{friendly_name:name,device_class:'enum',options:['Single press','Double press','Long press']} as never});
}
const matches=(c:{gestures:{key:string;eventEntity?:string;enumSensor?:string;eventType?:string;gesture:string}[];existing:Record<string,{id:string;match:string}[]>},source:string,id:string)=>
  Object.fromEntries(c.gestures.filter(g=>(g.eventEntity??g.enumSensor)===source).map(g=>[g.eventType??g.gesture,c.existing[g.key].find(a=>a.id===id)?.match??null]));

describe('matching existing automations to the gesture they handle',()=>{
  const DESK1='event.desk_remote_button_event_1',DESK2='event.desk_remote_button_event_2';
  const deskRemote=(f:Fixture)=>{addEvent(f,DESK1,'remote3','Desk remote button 1');addEvent(f,DESK2,'remote3','Desk remote button 2');};

  it('matches an event entity trigger plus event_type condition to that press only',async()=>{
    const f=buttonFixture();deskRemote(f);
    f.addAutomation('desk_single',{alias:'Desk single',triggers:[{trigger:'state',entity_id:DESK1,not_from:['unavailable','unknown'],id:'a'}],
      conditions:[{condition:'state',entity_id:DESK1,attribute:'event_type',state:'Single press'}],actions:[{action:'light.toggle',target:{entity_id:'light.bedroom_main'}}]});
    const c=(await f.read()).inventory.controls.find(c=>c.id==='device:remote3')!;
    expect(matches(c,DESK1,'desk_single')).toEqual({'Single press':'exact','Double press':null,'Long press':null});
    expect(matches(c,DESK2,'desk_single')).toEqual({'Single press':null,'Double press':null,'Long press':null});
    expect(c.related ?? []).toHaveLength(0);
  });
  it('matches nested or/and conditions across two event entities',async()=>{
    const f=buttonFixture();deskRemote(f);
    const press=(entity:string,id:string)=>({condition:'and',conditions:[{condition:'trigger',id},{condition:'state',entity_id:entity,attribute:'event_type',state:'Double press'}]});
    f.addAutomation('desk_double',{alias:'Desk double',triggers:[{trigger:'state',entity_id:DESK1,id:'a'},{trigger:'state',entity_id:DESK2,id:'b'}],
      conditions:[{condition:'or',conditions:[press(DESK1,'a'),press(DESK2,'b')]}],actions:[]});
    const c=(await f.read()).inventory.controls.find(c=>c.id==='device:remote3')!;
    for(const e of [DESK1,DESK2]) expect(matches(c,e,'desk_double')).toEqual({'Single press':null,'Double press':'exact','Long press':null});
  });
  it('lists an unfiltered event trigger as possible for its own entity only',async()=>{
    const f=buttonFixture();deskRemote(f);
    f.addAutomation('any_press',{alias:'Any press',triggers:[{trigger:'state',entity_id:DESK1}],actions:[]});
    const c=(await f.read()).inventory.controls.find(c=>c.id==='device:remote3')!;
    expect(matches(c,DESK1,'any_press')).toEqual({'Single press':'possible','Double press':'possible','Long press':'possible'});
    expect(Object.values(matches(c,DESK2,'any_press')).every(m=>m===null)).toBe(true);
    expect(c.gestures.filter(g=>!g.eventEntity).every(g=>!c.existing[g.key].length)).toBe(true);
  });
  it('reads a template on event_type as an exact filter',async()=>{
    const f=buttonFixture();deskRemote(f);
    f.addAutomation('tpl',{alias:'Template',triggers:[{trigger:'state',entity_id:DESK1}],conditions:[{condition:'template',value_template:"{{ trigger.to_state.attributes.event_type == 'Double press' }}"}],actions:[]});
    const c=(await f.read()).inventory.controls.find(c=>c.id==='device:remote3')!;
    expect(matches(c,DESK1,'tpl')).toEqual({'Single press':null,'Double press':'exact','Long press':null});
  });
  it('matches a UI-saved MQTT device trigger against the list entry with discovery_id and metadata',async()=>{
    const f=buttonFixture(),listed=f.triggers.remote2[0];
    f.triggers.remote2=f.triggers.remote2.map(t=>({...t,discovery_id:`0xabc ${t.type}_${t.subtype}`}));
    const {platform:_p,metadata:_m,...fields}=listed;
    f.addAutomation('mqtt_ui',{alias:'Saved by the UI',triggers:[{trigger:'device',...fields}],actions:[]});
    const c=(await f.read()).inventory.controls.find(c=>c.id==='device:remote2')!;
    const hits=c.gestures.filter(g=>c.existing[g.key].some(a=>a.id==='mqtt_ui'));
    expect(hits).toHaveLength(1);
    expect(hits[0].trigger).toMatchObject({type:listed.type,subtype:listed.subtype});
    expect(c.existing[hits[0].key][0].match).toBe('exact');
  });
  it('matches a blueprint per button through its per-press inputs',async()=>{
    const f=buttonFixture();
    const door=(n:number)=>`event.door_switch_button_event_${n}`;
    for(const n of [1,2,3,4]) addEvent(f,door(n),'remote3',`Door switch ${n}`);
    f.addAutomation('door_bp',{alias:'Door switch',use_blueprint:{path:'user/switch_buttons.yaml',input:{button3_event:door(3),button4_event:door(4),
      b3_single:[{action:'light.toggle'}],b3_double:[{action:'light.turn_on'}],b4_single:[{action:'light.turn_off'}]}}});
    const c=(await f.read()).inventory.controls.find(c=>c.id==='device:remote3')!;
    expect(matches(c,door(3),'door_bp')).toEqual({'Single press':'exact','Double press':'exact','Long press':null});
    expect(matches(c,door(4),'door_bp')).toEqual({'Single press':'exact','Double press':null,'Long press':null});
    for(const n of [1,2]) expect(Object.values(matches(c,door(n),'door_bp')).every(m=>m===null)).toBe(true);
  });
  it('treats enum sensors that report presses as gestures with a warning, and matches a `to` trigger',async()=>{
    const f=buttonFixture(),sensor='sensor.door_switch_button_event_1';
    addEnumSensor(f,sensor,'remote3','Door switch button 1');
    f.raw.entities.push({entity_id:'sensor.remote_battery',platform:'matter',device_id:'remote3',unique_id:'bat'});
    f.raw.states.push({entity_id:'sensor.remote_battery',state:'90',attributes:{friendly_name:'Battery',device_class:'enum',options:['Low','Normal']} as never});
    f.addAutomation('enum_single',{alias:'Enum single',triggers:[{trigger:'state',entity_id:sensor,to:'Single press'}],actions:[{action:'light.toggle',target:{entity_id:'light.bedroom_main'}}]});
    const r=await f.read(),c=r.inventory.controls.find(c=>c.id==='device:remote3')!;
    const gestures=c.gestures.filter(g=>g.enumSensor===sensor);
    expect(gestures.map(g=>g.gesture).sort()).toEqual(['Double press','Long press','Single press']);
    expect(gestures.every(g=>g.source==='HA enum sensor' && !g.eventEntity && g.trigger.entity_id===sensor && typeof g.trigger.to==='string')).toBe(true);
    expect(c.notes.filter(n=>n.includes("doesn't change the value"))).toHaveLength(1);
    expect(c.gestures.some(g=>g.enumSensor==='sensor.remote_battery')).toBe(false);
    expect(matches(c,sensor,'enum_single')).toEqual({'Single press':'exact','Double press':null,'Long press':null});
    // The generated automation uses the plain state trigger and none of the event-entity timestamp logic.
    const a={...assignment(r,'remote3'),gestureKey:gestures.find(g=>g.gesture==='Double press')!.key};
    const change=asChange(planButtonAssignment(r.inventory,{...a,allowExisting:true},[]));
    const map=change.after.button_map as ButtonMap;
    expect(map.bindings[0].eventEntity).toBeUndefined();expect(validButtonMap(map)).toBe(true);
    const config=buttonConfig(change.targetId,'Enum',map);
    expect((config.trigger as Record<string,unknown>[])[0]).toMatchObject({platform:'state',entity_id:sensor,to:'Double press'});
    expect(JSON.stringify(config.condition)).toContain('trigger.id not in []');
  });
  it('shows one generic-event note per control',async()=>{
    const f=buttonFixture();deskRemote(f);
    const c=(await f.read()).inventory.controls.find(c=>c.id==='device:remote3')!;
    expect(c.notes.filter(n=>n.includes('no button device class'))).toHaveLength(1);
  });
  it('names device and area targets in the action summary',async()=>{
    const f=buttonFixture(),trigger=f.triggers.remote1[0];
    f.addAutomation('to_device',{alias:'Device action',triggers:[trigger],actions:[{action:'homeassistant.turn_on',target:{device_id:'remote2',area_id:'bedroom'}}]});
    const c=(await f.read()).inventory.controls.find(c=>c.id==='device:remote1')!;
    const hit=Object.values(c.existing).flat().find(a=>a.id==='to_device')!;
    expect(hit.targets).toEqual(['device:Remote 2','area:Bedroom']);
  });
  it('keeps legacy event handlers under the control, not on every gesture',async()=>{
    const f=buttonFixture();
    f.raw.entities.push({entity_id:'binary_sensor.legacy_wall_switch',platform:'xiaomi_aqara',device_id:'remote1',unique_id:'legacy'});
    f.addAutomation('legacy',{trigger:[{platform:'event',event_type:'xiaomi_aqara.click',event_data:{entity_id:'binary_sensor.legacy_wall_switch'}}],action:[{service:'light.toggle',target:{entity_id:'light.bedroom_main'}}]});
    const c=(await f.read()).inventory.controls.find(v=>v.id==='device:remote1')!;
    expect(c.gestures.length).toBeGreaterThan(0);
    expect(Object.values(c.existing).flat()).toHaveLength(0);
    expect(c.related).toMatchObject([{id:'legacy',match:'possible'}]);
  });
});

describe('one automation per output',()=>{
  it('combines four remotes into one light automation with independent actions',async()=>{
    const f=buttonFixture(),r=await f.read();let c:Change|null=null;
    for(const [n,service] of ['light.turn_on','light.turn_off','light.toggle','light.turn_on'].entries()) c=asChange(planButtonAssignment(r.inventory,assignment(r,`remote${n+1}`,service),c?[c]:[]));
    expect(c!.targetId).toBe(buttonAutomationId('light.bedroom_main'));
    const map=c!.after.button_map as ButtonMap;expect(map.bindings).toHaveLength(4);
    expect(validateInput({kind:'automation',op:'create',fields:c!.after})).toBeNull();
    const config=buttonConfig(c!.targetId,'Bedroom',map);
    expect(config.trigger).toHaveLength(4);expect((config.action as {choose:unknown[]}[])[0].choose).toHaveLength(4);
  });
  it('replaces an assignment rather than adding a duplicate and keeps a second output separate',async()=>{
    const f=buttonFixture(),r=await f.read();const first=asChange(planButtonAssignment(r.inventory,assignment(r),[]));
    const updated=asChange(planButtonAssignment(r.inventory,assignment(r,'remote1','light.turn_on'),[first]));
    expect((updated.after.button_map as ButtonMap).bindings).toHaveLength(1);
    const second=planButtonAssignment(r.inventory,{...assignment(r),action:{entityId:'script.goodnight',service:'script.turn_on',data:{}}},[updated]);
    expect(second.fields!.automation_id).not.toBe(updated.targetId);
  });
  it('blocks stale metadata and unacknowledged existing handlers or coverage gaps',async()=>{
    const f=buttonFixture(),r=await f.read();expect(()=>planButtonAssignment(r.inventory,{...assignment(r),fingerprint:'a'.repeat(64)},[])).toThrow('changed');
    f.addAutomation('old',{trigger:[f.triggers.remote1[0]]});const next=await f.read();
    const a=assignment(next);a.gestureKey=next.inventory.controls.find(c=>c.id===a.controlId)!.gestures.find(g=>g.trigger.type===f.triggers.remote1[0].type && g.trigger.subtype===f.triggers.remote1[0].subtype)!.key;
    expect(()=>planButtonAssignment(next.inventory,a,[])).toThrow('Existing');expect(()=>planButtonAssignment(next.inventory,{...a,allowExisting:true},[])).not.toThrow();
    f.addAutomation('yaml',null);const gap=await f.read();expect(()=>planButtonAssignment(gap.inventory,assignment(gap,'remote2'),[])).toThrow('unreadable');
  });
  it('rejects targeting data and template injection while supporting light/group modes and script variables',()=>{
    for(const service of ['light.turn_on','light.turn_off','light.toggle']) expect(validButtonAction({service,entityId:'light.bedroom_all',data:{}})).toBe(true);
    expect(validButtonAction({service:'script.turn_on',entityId:'script.goodnight',data:{variables:{bedroom:true}}})).toBe(true);
    for(const data of [{entity_id:'all'},{area_id:'bedroom'},{brightness:'{{ 1 }}'},JSON.parse('{"__proto__":{"x":1}}')]) expect(validButtonAction({service:'light.turn_on',entityId:'light.bedroom_main',data})).toBe(false);
    expect(validButtonMap({version:1,output:'x',bindings:[],expected:null,allowExisting:false,extra:1})).toBe(false);
  });
  it('uses captured event types and timestamp guards, and respects automation conditions by default',async()=>{
    const f=buttonFixture(),r=await f.read(),a=assignment(r,'remote4');a.gestureKey=r.inventory.controls.find(c=>c.id===a.controlId)!.gestures.find(g=>g.eventType==='single_press')!.key;
    a.action={entityId:'automation.goodnight',service:'automation.trigger',data:{}};
    const c=asChange(planButtonAssignment(r.inventory,a,[])),cfg=buttonConfig(c.targetId,'Events',c.after.button_map as ButtonMap);
    expect(JSON.stringify(cfg.condition)).toContain('as_timestamp');expect(JSON.stringify(cfg.condition)).toContain('trigger.to_state.attributes');
    expect((cfg.trigger as Record<string,unknown>[])[0].variables).toEqual({taxis_button_event_type:'single_press'});
    expect(JSON.stringify(cfg.action)).toContain('"skip_condition":false');
  });
  it('requires an explicit entity for target-based services',async()=>{const r=await buttonFixture().read();expect(()=>planButtonAssignment(r.inventory,{...assignment(r),action:{entityId:null,service:'light.turn_on',data:{}}},[])).toThrow('explicit entity');});
  it('refuses self-triggering virtual buttons and cycles across separate maps',async()=>{
    const f=buttonFixture();(f.services as Record<string,unknown>).input_button={press:{target:{}}};const r=await f.read();
    const control=r.inventory.controls.find(c=>c.id==='entity:input_button.desk')!;
    const a={...assignment(r),controlId:control.id,gestureKey:control.gestures[0].key,action:{entityId:'input_button.desk',service:'input_button.press',data:{}}};
    expect(()=>planButtonAssignment(r.inventory,a,[])).toThrow('cycle');
    const c=asChange(planButtonAssignment(r.inventory,assignment(r),[])),base=c.after.button_map as ButtonMap;
    const first={...base,bindings:[{...base.bindings[0],eventEntity:'input_button.a',action:{service:'input_button.press',entityId:'input_button.b',data:{}}}]};
    const second={...base,bindings:[{...base.bindings[0],eventEntity:'input_button.b',action:{service:'input_button.press',entityId:'input_button.a',data:{}}}]};
    expect(buttonInputLoop([first])).toBe(false);expect(buttonInputLoop([first,second])).toBe(true);
    second.bindings[0].enabled=false;expect(buttonInputLoop([first,second])).toBe(false);
  });
});

describe('button Apply readback and collision checks',()=>{
  it('writes only one automation for four remotes, verifies on, then updates that same automation',async()=>{
    const f=buttonFixture();let r=await f.read(),c:Change|null=null;
    for(let n=1;n<=4;n++) c=asChange(planButtonAssignment(r.inventory,assignment(r,`remote${n}`),c?[c]:[]));
    expect((await applyButtonChanges([c!],{...f,sleep:async()=>{}}))[0].ok).toBe(true);expect(f.rest.post).toHaveBeenCalledTimes(1);expect(f.ha.write).not.toHaveBeenCalled();
    r=await f.read();expect(r.inventory.managed).toHaveLength(1);
    const update=asChange(planButtonAssignment(r.inventory,assignment(r,'remote1','light.turn_off'),[]));
    expect((update.after.button_map as ButtonMap).bindings).toHaveLength(4);
    expect((await applyButtonChanges([update],{...f,sleep:async()=>{}}))[0].ok).toBe(true);expect(Object.keys(f.configs)).toHaveLength(1);
  });
  it('refuses an occupied id, stale config, vanished trigger, or mismatched output without writing',async()=>{
    for(const cause of ['occupied','trigger','output']) {
      const f=buttonFixture(),r=await f.read(),c=asChange(planButtonAssignment(r.inventory,assignment(r),[]));
      if(cause==='occupied') f.addAutomation(c.targetId,{alias:'Foreign'});
      if(cause==='trigger') f.triggers.remote1=[];
      if(cause==='output') (c.after.button_map as ButtonMap).output='light.other';
      expect((await applyButtonChanges([c],{...f,sleep:async()=>{}}))[0].ok).toBe(false);expect(f.rest.post).not.toHaveBeenCalled();
    }
  });
  it('does not overwrite a managed automation changed since review',async()=>{
    const f=buttonFixture();let r=await f.read();const c=asChange(planButtonAssignment(r.inventory,assignment(r),[]));await applyButtonChanges([c],{...f,sleep:async()=>{}});
    r=await f.read();const update=asChange(planButtonAssignment(r.inventory,assignment(r,'remote2'),[]));f.configs[c.targetId].alias='Changed externally';f.rest.post.mockClear();
    expect((await applyButtonChanges([update],{...f,sleep:async()=>{}}))[0].message).toContain('changed');expect(f.rest.post).not.toHaveBeenCalled();
  });
  it('retries readback idempotently and disables a map without deleting anything',async()=>{
    const f=buttonFixture(),r=await f.read(),c=asChange(planButtonAssignment(r.inventory,{...assignment(r),enabled:false},[]));
    expect((await applyButtonChanges([c],{...f,sleep:async()=>{}}))[0].ok).toBe(true);expect(Object.values(f.configs)[0].initial_state).toBe(false);
    expect((await applyButtonChanges([c],{...f,sleep:async()=>{}}))[0].ok).toBe(true);expect(f.rest.post).toHaveBeenCalledTimes(1);
  });
  it('does not claim success when storage or loaded enabled state cannot be verified',async()=>{
    const f=buttonFixture(),r=await f.read(),c=asChange(planButtonAssignment(r.inventory,assignment(r),[]));
    f.rest.post.mockImplementation(async(_kind,id,config)=>{f.configs[id]=config;});
    expect((await applyButtonChanges([c],{...f,sleep:async()=>{}}))[0]).toMatchObject({ok:false,message:expect.stringContaining('read back')});
  });
  it('rechecks a newly added handler, a disabled target and vanished services before writing',async()=>{
    for(const cause of ['handler','disabled','service']) {
      const f=buttonFixture(),r=await f.read(),a=assignment(r),c=asChange(planButtonAssignment(r.inventory,a,[]));
      if(cause==='handler') f.addAutomation('new_external',{trigger:[r.inventory.controls.find(v=>v.id===a.controlId)!.gestures.find(g=>g.key===a.gestureKey)!.trigger]});
      if(cause==='disabled') f.raw.entities.find(e=>e.entity_id===a.action.entityId)!.disabled_by='user';
      if(cause==='service') delete (f.services.light as Record<string,unknown>).toggle;
      expect((await applyButtonChanges([c],{...f,sleep:async()=>{}}))[0].ok).toBe(false);
      expect(f.rest.post).not.toHaveBeenCalled();
    }
  });
});

async function apiSetup() {
  const f=buttonFixture(),t=testStore();closers.push(t.close);const changes=changeStore(t.store.db),settings=settingsStore(t.store.db);
  settings.saveAi({...structuredClone(DEFAULT_AI),enabled:true,models:{low:'small',medium:'middle',strong:'large'}});settings.saveAiKey('anthropic',TEST_KEY);
  const provider=fakeFetch({body:anthropicMessage({content:[{type:'text',text:'Review the exact trigger and the possible blueprint reference.'}]})});
  const app=new Hono();app.use('/api/*',requireTaxisHeader);let applying=false;
  app.route('/api',buttonRoutes({read:async()=>f.read(),changes,applying:()=>applying,ai:aiService({settings,ledger:aiLedger(t.store.db),fetch:provider.fetch}),redact:s=>s.split(TEST_KEY).join('[redacted]')}));
  const req=(path:string,body?:unknown,guard=true)=>app.request(`/api/buttons${path}`,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(guard?{'x-taxis-request':'1'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const a=assignment(await f.read());a.changesVersion=changes.version();
  return {...f,t,changes,settings,provider,req,a,setApplying:(value:boolean)=>{applying=value;}};
}
describe('button API and bounded AI review',()=>{
  it('queues two remotes into one reviewable change and never writes to HA',async()=>{
    const s=await apiSetup();expect((await s.req('/assign',s.a)).status).toBe(200);
    const second={...s.a,controlId:'device:remote2',gestureKey:(await s.read()).inventory.controls.find(c=>c.id==='device:remote2')!.gestures[0].key,changesVersion:s.changes.version()};
    expect((await s.req('/assign',second)).status).toBe(200);expect(s.changes.list()).toHaveLength(1);expect((s.changes.list()[0].after.button_map as ButtonMap).bindings).toHaveLength(2);
    expect(s.rest.post).not.toHaveBeenCalled();expect(s.ha.write).not.toHaveBeenCalled();
  });
  it('rejects missing guard, stale queued edits, oversized bodies and Apply overlap',async()=>{
    const s=await apiSetup();expect((await s.req('/assign',s.a,false)).status).toBe(400);
    expect((await s.req('/assign',{...s.a,changesVersion:'f'.repeat(16)})).status).toBe(409);
    expect((await s.req('/assign',{padding:'x'.repeat(20000)})).status).toBe(413);
    s.setApplying(true);expect((await s.req('/assign',s.a)).status).toBe(409);expect(s.changes.list()).toHaveLength(0);
  });
  it('builds a redacted local preview and only sends reviewed summaries, without tools or mutations',async()=>{
    const s=await apiSetup();s.addAutomation('external',{alias:`Test ${TEST_KEY}`,trigger:[s.triggers.remote1[0]],action:[{service:'light.turn_on',target:{entity_id:'light.bedroom_main'},data:{password:'PRIVATE_CONFIG'}}]});
    const preview=await(await s.req('/device%3Aremote1/ai-preview')).json();expect(preview.ok).toBe(true);expect(preview.preview.content).not.toContain(TEST_KEY);expect(preview.preview.content).not.toContain('PRIVATE_CONFIG');expect(s.provider.calls).toHaveLength(0);
    const response=await(await s.req('/device%3Aremote1/ai-review',{fingerprint:preview.preview.fingerprint})).json();expect(response.ok).toBe(true);expect(s.provider.calls[0].body).toMatchObject({model:'middle'});expect(s.provider.calls[0].body).not.toHaveProperty('tools');expect(s.changes.list()).toHaveLength(0);expect(s.rest.post).not.toHaveBeenCalled();
  });
  it('rejects stale evidence, AI being off and arbitrary prompts',async()=>{
    const s=await apiSetup();expect((await s.req('/device%3Aremote1/ai-review',{fingerprint:'x',prompt:'bypass'})).status).toBe(400);
    expect((await s.req('/device%3Aremote1/ai-review',{fingerprint:'f'.repeat(64)})).status).toBe(409);
    const preview=await(await s.req('/device%3Aremote1/ai-preview')).json();s.settings.saveAi({...s.settings.ai(),enabled:false});
    expect((await s.req('/device%3Aremote1/ai-review',{fingerprint:preview.preview.fingerprint})).status).toBe(502);expect(s.provider.calls).toHaveLength(0);
  });
});
