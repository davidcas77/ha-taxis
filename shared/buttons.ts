// Button inputs are supplied by HA integrations, never inferred from a brand's
// advertised button count. One managed automation groups mappings by output.
export type ButtonAction = { service: string; entityId: string | null; data: Record<string, unknown> };
export type ButtonGesture = { key: string; button: string; gesture: string; source: string; trigger: Record<string, unknown>; eventEntity?: string; eventType?: string };
export type ButtonMapping = { key: string; controlId: string; gestureKey: string; button: string; gesture: string; trigger: Record<string, unknown>; eventEntity?: string; eventType?: string; action: ButtonAction; enabled: boolean };
export type ButtonMap = { version: 1; output: string; bindings: ButtonMapping[]; expected: string | null; allowExisting: boolean };
export type ButtonExisting = { id: string; entityId: string | null; name: string; enabled: boolean | null; match: "exact" | "possible"; services: string[]; targets: string[]; managed: boolean };
export type ButtonControl = { id: string; deviceId: string | null; name: string; areaId: string | null; manufacturer: string | null; model: string | null; integrations: string[]; gestures: ButtonGesture[]; notes: string[]; existing: Record<string, ButtonExisting[]>; related?: ButtonExisting[] };
export type ButtonManaged = { id: string; alias: string; entityId: string | null; enabled: boolean | null; map: ButtonMap; fingerprint: string };
export type ButtonInventory = { controls: ButtonControl[]; managed: ButtonManaged[]; services: string[]; targetServices: string[]; notes: string[]; coverage: { automations: number; readable: number; unreadable: number }; fetchedAt: string };
export type ButtonInventoryResponse = { ok: true; inventory: ButtonInventory; fingerprint: string } | { ok: false; error: string };
export type ButtonAssignment = { controlId: string; gestureKey: string; action: ButtonAction; enabled: boolean; allowExisting: boolean; fingerprint: string; changesVersion: string };
export type ButtonAiPreview = { content: string; fingerprint: string; count: number };
export type ButtonAiResponse = { ok: true; text: string; model: string; truncated: boolean } | { ok: false; error: string };

export const BUTTON_AUTOMATION_ID = /^taxis_buttons_[a-f0-9]{20}$/;
const ENTITY = /^[a-z0-9]+[a-z0-9_]*\.[a-z0-9_]+$/;
export const BUTTON_SERVICE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
export const buttonRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max=255): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
function plainJson(v: unknown, depth=0): boolean {
  if (depth>6) return false;
  if (v===null || typeof v==="boolean" || typeof v==="number" && Number.isFinite(v)) return true;
  if (typeof v==="string") return v.length<=2000 && !v.includes("{{") && !v.includes("{%");
  if (Array.isArray(v)) return v.length<=50 && v.every(x=>plainJson(x,depth+1));
  return buttonRecord(v) && Object.keys(v).length<=40 && Object.entries(v).every(([k,x])=>!['__proto__','constructor','prototype'].includes(k) && plainJson(x,depth+1));
}
export function validButtonAction(v: unknown): v is ButtonAction {
  return buttonRecord(v) && Object.keys(v).every(k=>['service','entityId','data'].includes(k)) &&
    typeof v.service==='string' && BUTTON_SERVICE.test(v.service) && (v.entityId===null || text(v.entityId) && ENTITY.test(v.entityId)) &&
    buttonRecord(v.data) && JSON.stringify(v.data).length<=8000 && plainJson(v.data) &&
    !Object.keys(v.data).some(k=>['entity_id','device_id','area_id','floor_id','label_id','target'].includes(k));
}
export function validButtonMap(v: unknown): v is ButtonMap {
  if (!buttonRecord(v) || v.version!==1 || !text(v.output) || !Array.isArray(v.bindings) || v.bindings.length>100 ||
      !(v.expected===null || typeof v.expected==='string' && /^[a-f0-9]{64}$/.test(v.expected)) || typeof v.allowExisting!=='boolean' || JSON.stringify(v).length>96000 ||
      Object.keys(v).some(k=>!['version','output','bindings','expected','allowExisting'].includes(k))) return false;
  const keys = new Set<string>();
  return v.bindings.every(b=> {
    if (!buttonRecord(b) || !text(b.key) || keys.has(b.key) || !text(b.controlId) || !text(b.gestureKey) || !text(b.button) || !text(b.gesture) ||
        !buttonRecord(b.trigger) || !plainJson(b.trigger) || !validButtonAction(b.action) || typeof b.enabled!=='boolean' ||
        !(b.eventEntity===undefined || text(b.eventEntity) && ENTITY.test(b.eventEntity)) || !(b.eventType===undefined || text(b.eventType)) ||
        Object.keys(b).some(k=>!['key','controlId','gestureKey','button','gesture','trigger','eventEntity','eventType','action','enabled'].includes(k))) return false;
    keys.add(b.key); return true;
  });
}
export function buttonOutput(a: ButtonAction): string { return a.entityId ?? `service:${a.service}`; }
// Timestamp button inputs can also be service targets. Refuse generated
// feedback loops, including cycles across separate output automations.
export function buttonInputLoop(maps: readonly ButtonMap[]): boolean {
  const edges=new Map<string,Set<string>>();
  for(const map of maps) for(const b of map.bindings) if(b.enabled && b.eventEntity && b.action.entityId && ['button.press','input_button.press'].includes(b.action.service)) {
    const next=edges.get(b.eventEntity)??new Set<string>();next.add(b.action.entityId);edges.set(b.eventEntity,next);
  }
  const visiting=new Set<string>(),done=new Set<string>();
  const walk=(id:string):boolean=>{if(visiting.has(id))return true;if(done.has(id))return false;visiting.add(id);for(const next of edges.get(id)??[])if(walk(next))return true;visiting.delete(id);done.add(id);return false;};
  return [...edges.keys()].some(walk);
}
export function validButtonAssignment(v: unknown): v is ButtonAssignment {
  return buttonRecord(v) && text(v.controlId) && text(v.gestureKey) && validButtonAction(v.action) &&
    typeof v.enabled==='boolean' && typeof v.allowExisting==='boolean' && typeof v.fingerprint==='string' && /^[a-f0-9]{64}$/.test(v.fingerprint) &&
    typeof v.changesVersion==='string' && /^[a-f0-9]{16}$/.test(v.changesVersion) &&
    Object.keys(v).every(k=>['controlId','gestureKey','action','enabled','allowExisting','fingerprint','changesVersion'].includes(k));
}
