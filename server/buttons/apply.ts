import { buttonInputLoop, buttonOutput, validButtonMap } from "../../shared/buttons.ts";
import type { Change } from "../../shared/types.ts";
import { buildHierarchy } from "../model/hierarchy.ts";
import type { Outcome } from "../changes/apply.ts";
import type { RecipeIO } from "../changes/recipes.ts";
import { buttonAutomationId, buttonHash, discoverButtons } from "./discovery.ts";
import { buttonConfig } from "./mapping.ts";

export async function applyButtonChanges(changes:Change[],io:RecipeIO):Promise<Outcome[]> {
  if(!changes.length) return [];
  let read:Awaited<ReturnType<typeof discoverButtons>>;
  let raw:Awaited<ReturnType<typeof io.readFresh>>;
  try {raw=await io.readFresh();read=await discoverButtons(io.ha,io.rest,raw,buildHierarchy(raw,new Date().toISOString()));}
  catch {return changes.map(c=>({changeId:c.id,ok:false,message:'Could not read button triggers and automations before Apply; nothing sent.'}));}
  const outcomes:Outcome[]=[];
  const entities=new Set([...raw.entities.map(e=>e.entity_id),...raw.states.map(s=>s.entity_id)]);
  const disabled=new Set(raw.entities.filter(e=>e.disabled_by).map(e=>e.entity_id));
  const maps=new Map(read.inventory.managed.map(m=>[m.id,m.map]));
  for(const c of changes) if(validButtonMap(c.after.button_map)) maps.set(c.targetId,c.after.button_map);
  if(buttonInputLoop([...maps.values()])) return changes.map(c=>({changeId:c.id,ok:false,message:'Button inputs form a repeated-press cycle. Review their assignments before applying.'}));
  for(const c of changes) {
    try {
      const map=c.after.button_map;
      if(!validButtonMap(map) || c.targetId!==buttonAutomationId(map.output)) throw new Error('Invalid button map identity.');
      if(!map.bindings.length) throw new Error('A button map must retain at least one known gesture, even when disabled.');
      for(const b of map.bindings) {
        if(buttonOutput(b.action)!==map.output) throw new Error('All bindings in an automation must control the same output.');
        const source=read.inventory.controls.find(s=>s.id===b.controlId);
        const gesture=source?.gestures.find(g=>g.key===b.gestureKey);
        if(!source || !gesture || buttonHash(gesture.trigger)!==buttonHash(b.trigger) || gesture.eventEntity!==b.eventEntity || gesture.eventType!==b.eventType || b.key!==buttonHash([source.id,gesture.key]).slice(0,24)) throw new Error('A button gesture changed or is no longer exposed. Refresh its mapping.');
        if(b.action.entityId && !entities.has(b.action.entityId)) throw new Error(`The target ${b.action.entityId} is no longer available. Refresh before applying.`);
        if(b.action.entityId && disabled.has(b.action.entityId)) throw new Error(`The target ${b.action.entityId} is disabled. Refresh before applying.`);
        if(!read.inventory.services.includes(b.action.service)) throw new Error('An assigned action service is no longer available.');
        if(!b.action.entityId && read.inventory.targetServices.includes(b.action.service)) throw new Error('An action needs an explicit entity target.');
        if(b.action.entityId && b.action.service.split('.')[0]!==b.action.entityId.split('.')[0] && !b.action.service.startsWith('homeassistant.')) throw new Error('The service and target entity domains do not match.');
        if(b.action.entityId && read.inventory.managed.some(m=>m.entityId===b.action.entityId)) throw new Error('A button-map automation cannot trigger another button-map automation.');
        const conflicts=(source.existing[gesture.key]??[]).filter(a=>a.id!==c.targetId && !a.managed && a.enabled!==false);
        if(b.enabled && !map.allowExisting && (conflicts.length || read.inventory.coverage.unreadable>0)) throw new Error('Existing or unreadable automations may also handle this button. Review coexistence first.');
      }
      const desired=buttonConfig(c.targetId,String(c.after.alias),map);
      const current=await io.rest.get('automation',c.targetId);
      const already=!!current && buttonHash(current)===buttonHash(desired);
      if(!already && (map.expected===null ? current!==null : current===null || buttonHash(current)!==map.expected)) throw new Error('This managed automation changed since it was reviewed, or its id is occupied. Refresh before replacing it.');
      if(!already) await io.rest.post('automation',c.targetId,desired);
      let checked=false;
      for(let attempt=0;attempt<4;attempt++) {
        const stored=await io.rest.get('automation',c.targetId);
        const fresh=await io.readFresh();
        const state=fresh.states.find(s=>s.entity_id.startsWith('automation.') && s.attributes?.id===c.targetId);
        const want=map.bindings.some(b=>b.enabled)?'on':'off';
        if(stored && buttonHash(stored)===buttonHash(desired) && state?.state===want) {checked=true;break;}
        if(attempt<3) await (io.sleep??(ms=>new Promise(r=>setTimeout(r,ms))))(500);
      }
      if(!checked) throw new Error('Saved, but the button automation could not be read back as loaded with the expected enabled state. Check HA before retrying.');
      outcomes.push({changeId:c.id,ok:true,message:'Button automation saved and its enabled state verified.'});
    } catch(e) {outcomes.push({changeId:c.id,ok:false,message:e instanceof Error?e.message:'Could not apply button mapping.'});}
  }
  return outcomes;
}
