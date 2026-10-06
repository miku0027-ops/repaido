import {apiFetch} from './api';

// Only public directory data lives here. Availability and hire actions always recheck the server.
const FRESH_MS=20_000;
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
  if(Date.now()-entry.at>=FRESH_MS){recent.delete(id);return null;}
  recent.delete(id);recent.set(id,entry);
  return entry.value as T;
}

export async function hireProfiles<T>(body:Record<string,unknown>,force=false):Promise<T> {
  const id=key(body);
  if(!force){
    const cached=cachedHireProfiles<T>(body);
    if(cached)return cached;
  }
  const running=inFlight.get(id);
  if(running)return running as Promise<T>;
  const request=(async()=>{
    const response=await apiFetch('/api/operations/hiring/leaderboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)},{background:true});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.detail?.message||'Profiles could not load. Please retry.');
    recent.delete(id);recent.set(id,{at:Date.now(),value:data});
    while(recent.size>MAX_ENTRIES)recent.delete(recent.keys().next().value!);
    return data as T;
  })();
  inFlight.set(id,request);
  try{return await request;}finally{if(inFlight.get(id)===request)inFlight.delete(id);}
}
