import { vi } from 'vitest';
import { buildHierarchy, type RawRegistry } from '../model/hierarchy.ts';
import type { HaConfig } from '../ha/rest.ts';
import { discoverButtons } from './discovery.ts';
import type { RecipeWs } from '../changes/recipes.ts';

export function buttonFixture() {
  const raw:RawRegistry={config:{location_name:'Button fixture'},floors:[],areas:[{area_id:'bedroom',name:'Bedroom'}],devices:[],entities:[],states:[],labels:[]};
  const triggers:Record<string,Record<string,unknown>[]>={};
  for(let n=1;n<=4;n++) {
    const id=`remote${n}`;
    raw.devices.push({id,name:`Remote ${n}`,area_id:'bedroom',manufacturer:'Fixture',model:`${n===1?'Aqara LAN':'Remote'} two-button`});
    triggers[id]=['button_1','button_2',...(n===1?['both']:[])].flatMap(subtype=>['short_press','double_press','long_press'].map(type=>({platform:'device',device_id:id,domain:n===2?'mqtt':n===3?'zha':'aqara',type:`remote_button_${type}`,subtype,metadata:{secondary:false}})));
  }
  raw.entities.push({entity_id:'light.bedroom_main',platform:'demo',area_id:'bedroom',unique_id:'lamp'});
  raw.states.push({entity_id:'light.bedroom_main',state:'off',attributes:{friendly_name:'Bedroom main'}});
  raw.entities.push({entity_id:'script.goodnight',platform:'script',unique_id:'goodnight'});
  raw.states.push({entity_id:'script.goodnight',state:'off',attributes:{friendly_name:'Good night'}});
  raw.entities.push({entity_id:'event.remote_button',platform:'matter',device_id:'remote4',unique_id:'event'});
  raw.states.push({entity_id:'event.remote_button',state:'2026-10-28T00:00:00Z',attributes:{friendly_name:'Matter button',device_class:'button',event_types:['single_press','double_press','long_press']} as never});
  raw.entities.push({entity_id:'input_button.desk',platform:'input_button',unique_id:'desk'});
  raw.states.push({entity_id:'input_button.desk',state:'2026-10-28T00:00:00Z',attributes:{friendly_name:'Desk virtual button'}});
  const configs:Record<string,HaConfig>={};
  const services={light:{turn_on:{target:{}},turn_off:{target:{}},toggle:{target:{}}},script:{turn_on:{target:{}},turn_off:{target:{}},goodnight:{}},automation:{trigger:{target:{}},turn_on:{target:{}},turn_off:{target:{}}},persistent_notification:{create:{fields:{message:{}}}}};
  const ha={command:vi.fn(async<T>(type:string,payload?:Record<string,unknown>):Promise<T>=>{
    if(type==='device_automation/trigger/list') return structuredClone(triggers[String(payload?.device_id)]??[]) as T;
    if(type==='get_services') return structuredClone(services) as T;
    throw new Error(`Unexpected read ${type}`);
  }),write:vi.fn(async<T>():Promise<T>=>{throw new Error('No live service or WS write is allowed.');})} as unknown as RecipeWs;
  const addAutomation=(id:string,config:HaConfig|null,state='on')=>{
    const entity=`automation.${id}`;
    if(config) configs[id]=structuredClone(config);
    if(!raw.entities.some(e=>e.entity_id===entity)) raw.entities.push({entity_id:entity,platform:'automation',unique_id:id});
    raw.states=raw.states.filter(s=>s.entity_id!==entity);
    raw.states.push({entity_id:entity,state,attributes:{id,friendly_name:typeof config?.alias==='string'?config.alias:id}});
  };
  const rest={get:vi.fn(async(_kind:string,id:string)=>structuredClone(configs[id]??null)),post:vi.fn(async(_kind:string,id:string,config:HaConfig)=>{addAutomation(id,config,config.initial_state===false?'off':'on');})};
  const hierarchy=()=>buildHierarchy(raw,'2026-10-28T00:00:00Z');
  const read=async()=>({...await discoverButtons(ha,rest,raw,hierarchy()),h:hierarchy()});
  return {raw,triggers,configs,services,ha,rest,addAutomation,hierarchy,read,readFresh:async()=>raw};
}
