import { buttonRecord, validButtonMap, type ButtonControl, type ButtonGesture, type ButtonInventory, type ButtonManaged, type ButtonMap } from "../../shared/buttons.ts";
import type { Hierarchy } from "../../shared/types.ts";
import type { RawRegistry } from "../model/hierarchy.ts";
import type { RestApi } from "../ha/rest.ts";
import { mapLimit } from "../references/snapshot.ts";
import { buttonConfig } from "./mapping.ts";
import { BUTTON_MARKER, buttonHash, buttonAutomationId } from './identity.ts';
export { BUTTON_MARKER, buttonHash, buttonAutomationId } from './identity.ts';

export type ButtonHa = { command<T>(type: string, payload?: Record<string, unknown>): Promise<T> };
export type ButtonEvidence = { id: string; entityId: string; name: string; enabled: boolean | null; config: Record<string, unknown> | null };
export type ButtonRead = { inventory: ButtonInventory; evidence: ButtonEvidence[] };
export function storedButtonMap(config: unknown): ButtonMap | null {
  if (!buttonRecord(config) || typeof config.description!=="string" || !config.description.startsWith(BUTTON_MARKER)) return null;
  try { const value: unknown=JSON.parse(config.description.slice(BUTTON_MARKER.length)); return validButtonMap(value) ? value : null; } catch { return null; }
}
export function normalizedTrigger(v: unknown): Record<string, unknown> | null {
  if (!buttonRecord(v)) return null;
  const out = { ...v }; delete out.id; delete out.metadata; delete out.alias; delete out.enabled;
  if (typeof out.trigger==='string') { out.platform=out.trigger; delete out.trigger; }
  return out;
}
const readable = (s: string) => s.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
function nativeLabels(t: Record<string, unknown>) {
  const type=String(t.type??"Press"), sub=String(t.subtype??"Button");
  const split=/^(.*?)[_ -](single|double|triple|hold|release|long|short|press|quadruple)(?:_press)?$/.exec(sub);
  const prefix=/^(single|double|triple|hold|release|long|short|press|quadruple)[_ -](.+)$/.exec(sub);
  if(split) return {button:readable(split[1] || 'Button'),gesture:readable(split[2])};
  if(prefix) return {button:readable(prefix[2]),gesture:readable(prefix[1])};
  if(type==='action') return {button:'Button / control',gesture:readable(sub)};
  return { button:readable(sub), gesture:readable(type.replace(/^remote_button_/,"")) };
}
function actionSummary(config: unknown): { services: string[]; targets: string[] } {
  const services=new Set<string>(), targets=new Set<string>();
  const walk=(v:unknown,depth=0) => {
    if(depth>16) return;
    if(Array.isArray(v)) { v.slice(0,100).forEach(x=>walk(x,depth+1)); return; }
    if(!buttonRecord(v)) return;
    const service=v.action??v.service;
    if(typeof service==='string' && /^[a-z_]+\.[a-z_]+$/.test(service)) services.add(service);
    const ids=buttonRecord(v.target)?v.target.entity_id:buttonRecord(v.data)?v.data.entity_id:null;
    for(const id of Array.isArray(ids)?ids:[ids]) if(typeof id==='string' && /^[a-z_]+\.[a-z0-9_]+$/.test(id)) targets.add(id);
    Object.values(v).forEach(x=>walk(x,depth+1));
  }; walk(config); return {services:[...services].slice(0,30),targets:[...targets].slice(0,50)};
}
function containsValue(v:unknown, values:Set<string>,depth=0): boolean {
  if(depth>20) return false;
  if(typeof v==='string') return values.has(v) || [...values].some(id=>v.includes(id) && id.includes('.'));
  if(Array.isArray(v)) return v.some(x=>containsValue(x,values,depth+1));
  return buttonRecord(v) && Object.values(v).some(x=>containsValue(x,values,depth+1));
}
export async function discoverButtons(ha:ButtonHa, rest:Pick<RestApi,'get'>, raw:RawRegistry, h:Hierarchy):Promise<ButtonRead> {
  const controls=new Map<string,ButtonControl>();
  for(const d of Object.values(h.devices)) controls.set(`device:${d.id}`, { id:`device:${d.id}`,deviceId:d.id,name:d.name,areaId:d.areaId,manufacturer:d.manufacturer,model:d.model,integrations:[...new Set(d.entityIds.map(id=>h.entities[id]?.platform).filter((p):p is string=>!!p))],gestures:[],notes:[],existing:{} });
  const forEntity=(entityId:string) => {
    const e=h.entities[entityId]; if(!e) return null;
    if(e.deviceId && controls.has(`device:${e.deviceId}`)) return controls.get(`device:${e.deviceId}`)!;
    const id=`entity:${entityId}`;
    if(!controls.has(id)) controls.set(id,{id,deviceId:null,name:e.name,areaId:e.areaId,manufacturer:null,model:null,integrations:[e.platform],gestures:[],notes:[],existing:{}});
    return controls.get(id)!;
  };
  const add=(c:ButtonControl,g:Omit<ButtonGesture,'key'>) => { const key=buttonHash({trigger:g.trigger,eventEntity:g.eventEntity??null,eventType:g.eventType??null}).slice(0,24); if(!c.gestures.some(x=>x.key===key)) c.gestures.push({...g,key}); };
  await mapLimit([...controls.values()],6,async c=> {
    try {
      const list=await ha.command<unknown>('device_automation/trigger/list',{device_id:c.deviceId});
      if(!Array.isArray(list)) {c.notes.push('Device trigger metadata was not readable.');return;}
      if(list.length>200) c.notes.push('Only the first 200 device triggers are listed. Discovery is incomplete for this control.');
      for(const value of list.slice(0,200)) {
        const trigger=normalizedTrigger(value);
        if(!trigger || trigger.platform!=='device' || trigger.device_id!==c.deviceId || !/press|click|hold|release|button|key|action|double|single|triple|remote|rotate|step|command/i.test(`${trigger.type??''} ${trigger.subtype??''}`)) continue;
        if(typeof trigger.domain!=='string') continue;
        if(!c.integrations.includes(trigger.domain)) c.integrations.push(trigger.domain);
        add(c,{...nativeLabels(trigger),source:`${trigger.domain} device trigger`,trigger});
      }
    } catch { c.notes.push('This integration did not return device triggers. Entity events or existing automations may still identify its buttons.'); }
  });
  for(const s of raw.states) {
    const e=h.entities[s.entity_id]; if(!e) continue;
    const attrs=s.attributes as Record<string,unknown>|undefined;
    if(e.domain==='event' && attrs?.device_class!=='motion') {
      const c=forEntity(e.entityId); if(!c) continue;
      const types=Array.isArray(attrs?.event_types)?attrs.event_types.filter((t):t is string=>typeof t==='string' && t.length>0 && t.length<=255).slice(0,100):[];
      for(const type of types) add(c,{button:e.name,gesture:readable(type),source:'HA event types',trigger:{platform:'state',entity_id:e.entityId},eventEntity:e.entityId,eventType:type});
      if(!types.length) c.notes.push(`${e.name}: no supported event types were exposed.`);
      if(!['button','doorbell'].includes(String(attrs?.device_class))) c.notes.push(`${e.name} is a generic HA event; verify that its events represent the button you intend to assign.`);
    }
    if(e.domain==='button' || e.domain==='input_button') {
      const c=forEntity(e.entityId); if(c) add(c,{button:e.name,gesture:'Press',source:'HA button state',trigger:{platform:'state',entity_id:e.entityId},eventEntity:e.entityId});
    }
  }
  const notes:string[]=[];
  const evidence:ButtonEvidence[]=raw.states.filter(s=>s.entity_id.startsWith('automation.')).map(s=>({id:typeof s.attributes?.id==='string'?s.attributes.id:s.entity_id,entityId:s.entity_id,name:s.attributes?.friendly_name??s.entity_id,enabled:s.state==='on'?true:s.state==='off'?false:null,config:null}));
  await mapLimit(evidence,6,async a=>{ if(a.id.startsWith('automation.')) return; try {a.config=await rest.get('automation',a.id); if(a.config && typeof a.config.alias==='string') a.name=a.config.alias;} catch { /* Coverage stays explicit; no guessed empty mappings. */ } });
  const managed:ButtonManaged[]=[];
  for(const a of evidence) {
    const map=storedButtonMap(a.config);
    if(map && a.id===buttonAutomationId(map.output) && buttonHash(a.config)===buttonHash(buttonConfig(a.id,a.name,map))) managed.push({id:a.id,alias:a.name,entityId:a.entityId,enabled:a.enabled,map,fingerprint:buttonHash(a.config)});
  }
  for(const c of controls.values()) {
    const rawDevice=raw.devices.find(d=>d.id===c.deviceId) as {identifiers?:unknown;connections?:unknown}|undefined;
    const hardware=[rawDevice?.identifiers,rawDevice?.connections].flatMap(values=>Array.isArray(values)?values.flatMap(pair=>Array.isArray(pair)&&typeof pair[1]==='string'&&pair[1].length>=8?[pair[1]]:[]):[]);
    // Legacy event handlers (including Aqara clicks) can reference any entity
    // on the input device. Only trigger/blueprint references are examined.
    const sourceEntities=c.deviceId?(h.devices[c.deviceId]?.entityIds??[]):[c.id.replace(/^entity:/,'')];
    const refs=new Set<string>([...(c.deviceId?[c.deviceId]:[]),...hardware,...sourceEntities,...c.gestures.flatMap(g=>g.eventEntity?[g.eventEntity]:[])]);
    if(!c.gestures.length) c.related=evidence.filter(a=>a.config && containsValue([a.config.triggers??a.config.trigger,a.config.use_blueprint],refs)).map(a=>({id:a.id,entityId:a.entityId,name:a.name,enabled:a.enabled,match:'possible',...actionSummary(a.config),managed:false}));
    for(const g of c.gestures) {
      c.existing[g.key]=[];
      for(const a of evidence) {
        if(!a.config) continue;
        const map=managed.find(m=>m.id===a.id)?.map;
        const own=map?.bindings.filter(b=>b.controlId===c.id && b.gestureKey===g.key)??[];
        const triggers=a.config.triggers??a.config.trigger;
        const listed=(Array.isArray(triggers)?triggers:[triggers]).map(normalizedTrigger);
        const exact=own.length>0 || listed.some(t=>buttonHash(t)===buttonHash(g.trigger) && !g.eventEntity);
        const ambiguous=listed.filter(t=>!(t?.platform==='device' && t.device_id===c.deviceId && g.trigger.platform==='device' && t.domain===g.trigger.domain && t.type!==undefined && t.subtype!==undefined && (t.type!==g.trigger.type || t.subtype!==g.trigger.subtype)));
        if(!exact && !containsValue([ambiguous,a.config.use_blueprint],refs)) continue;
        const summary=own.length?{services:own.map(b=>b.action.service),targets:own.flatMap(b=>b.action.entityId?[b.action.entityId]:[])}:actionSummary(a.config);
        c.existing[g.key].push({id:a.id,entityId:a.entityId,name:a.name,enabled:a.enabled,match:exact?'exact':'possible',...summary,managed:!!map});
      }
    }
    c.gestures.sort((a,b)=>a.button.localeCompare(b.button,undefined,{numeric:true}) || a.gesture.localeCompare(b.gesture));
  }
  let services:string[]=[],targetServices:string[]=[];
  try {const result=await ha.command<unknown>('get_services'); if(buttonRecord(result)) {
    services=Object.entries(result).flatMap(([domain,items])=>buttonRecord(items)?Object.keys(items).map(s=>`${domain}.${s}`):[]).sort();
    targetServices=Object.entries(result).flatMap(([domain,items])=>buttonRecord(items)?Object.entries(items).filter(([,spec])=>buttonRecord(spec) && 'target' in spec).map(([s])=>`${domain}.${s}`):[]).sort();
  }} catch {notes.push('Action services could not be read; assignments cannot be queued until this read succeeds.');}
  const missing=evidence.filter(a=>!a.config).length;
  if(missing) notes.push(`${missing} automation configs could not be read (including YAML-only or unavailable configurations); mapping coverage is incomplete.`);
  notes.push('Only gestures exposed by HA integrations are listed. Device triggers can be incomplete until an integration discovers them; unknown gestures are never invented.');
  notes.push('Possible references are conservative. Arbitrary MQTT topics, templates, scripts and external controllers cannot always be linked to a device; absence of a match is not proof that no other handler exists.');
  return {inventory:{controls:[...controls.values()].sort((a,b)=>a.name.localeCompare(b.name)),managed,services,targetServices,notes,coverage:{automations:evidence.length,readable:evidence.length-missing,unreadable:missing},fetchedAt:new Date().toISOString()},evidence};
}
