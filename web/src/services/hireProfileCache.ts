import {apiFetch} from './api';

// Only public directory data lives here. Initial city cards can remain visible
// during revalidation; availability and hire actions always recheck the server.
const FRESH_MS=20_000;
const STALE_MS=120_000;
const MAX_ENTRIES=80;
type Entry={at:number;value:unknown};
const recent=new Map<string,Entry>();
const inFlight=new Map<string,Promise<unknown>>();

function key(body:Record<string,unknown>):string {
  const defaults:Record<string,unknown>={location:null,radius_km:20,category:'',role:'all',strict_nearby:false,
    query:'',sort:'recommended',min_rating:0,min_experience:0,min_completed:0,language:'',available_only:false,allow_buffer:false};
  const normalized={...defaults,...body};
  return JSON.stringify(Object.keys(normalized).sort().map(field=>[field,normalized[field]]));
}

export function cachedHireProfiles<T>(body:Record<string,unknown>):T|null {
  const id=key(body),entry=recent.get(id);
  if(!entry)return null;
  const live=Boolean(body.location||body.available_only||body.strict_nearby);
  if(Date.now()-entry.at>=(live?FRESH_MS:STALE_MS)){recent.delete(id);return null;}
  recent.delete(id);recent.set(id,entry);
  return entry.value as T;
}

export async function hireProfiles<T>(body:Record<string,unknown>,force=false):Promise<T> {
  const id=key(body);
  if(!force){
    const entry=recent.get(id);
    if(entry&&Date.now()-entry.at<FRESH_MS&&!body.available_only)return entry.value as T;
  }
  const running=inFlight.get(id);
  if(running)return running as Promise<T>;
  const request=(async()=>{
    const response=await apiFetch('/api/operations/hiring/leaderboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)},{background:true});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.detail?.message||'Profiles could not load. Please retry.');
    // Do not retain a malformed success response: warm readers apply cached
    // profiles synchronously and cannot recover from an invalid collection.
    if(!data||!Array.isArray(data.professionals)||data.professionals.some((profile:unknown)=>!profile||typeof profile!=='object'||typeof (profile as {id?:unknown}).id!=='string'||typeof (profile as {name?:unknown}).name!=='string')||(data.categories!==undefined&&!Array.isArray(data.categories)))throw new Error('Profiles could not be confirmed. Please retry.');
    recent.delete(id);recent.set(id,{at:Date.now(),value:data});
    while(recent.size>MAX_ENTRIES)recent.delete(recent.keys().next().value!);
    return data as T;
  })();
  inFlight.set(id,request);
  try{return await request;}finally{if(inFlight.get(id)===request)inFlight.delete(id);}
}

// Rich public background is read only after opening one profile, never for a directory page.
export async function publicProfessionalDetails<T extends {id:string}>(id:string,signal:AbortSignal,category=''):Promise<T> {
  const response=await apiFetch('/api/operations/professionals/'+encodeURIComponent(id)+(category?'?category='+encodeURIComponent(category):''),
    {signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])},{background:true});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.detail?.message||'Professional background could not load. Please retry.');
  if(data.id!==id)throw new Error('This profile could not be confirmed. Please retry.');
  return data as T;
}
