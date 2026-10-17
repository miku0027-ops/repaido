import {apiFetch} from './api';

// Only public directory data lives here. Initial city cards can remain visible
// during revalidation; availability and hire actions always recheck the server.
const FRESH_MS=20_000;
const STALE_MS=120_000;
const MAX_ENTRIES=80;
type Entry={at:number;value:unknown;order:number};
export type HireProfilesSnapshot<T>={value:T;updatedAt:number};
const recent=new Map<string,Entry>();
// Every directory response already contains the complete category overview for
// its exact filters. Reuse that small projection when switching back to All
// services instead of downloading another page of rich professional records.
const leaderRecent=new Map<string,Entry>();
const inFlight=new Map<string,Promise<unknown>>();
let requestOrder=0;

function key(body:Record<string,unknown>):string {
  const defaults:Record<string,unknown>={location:null,radius_km:20,category:'',role:'all',strict_nearby:false,
    query:'',sort:'recommended',min_rating:0,min_experience:0,min_completed:0,language:'',available_only:false,allow_buffer:false,summary_only:false};
  const normalized={...defaults,...body};
  // Radius affects coverage only with a location. Retain invalid radii as
  // distinct keys so a cached valid browse cannot bypass API validation.
  if(!normalized.location&&!normalized.strict_nearby&&typeof normalized.radius_km==='number'&&normalized.radius_km>0&&normalized.radius_km<=50)normalized.radius_km=20;
  return JSON.stringify(Object.keys(normalized).sort().map(field=>[field,normalized[field]]));
}

function read<T>(cache:Map<string,Entry>,body:Record<string,unknown>):HireProfilesSnapshot<T>|null {
  const id=key(body),entry=cache.get(id);
  if(!entry)return null;
  const live=Boolean(body.location||body.available_only||body.strict_nearby);
  if(Date.now()-entry.at>=(live?FRESH_MS:STALE_MS)){cache.delete(id);return null;}
  cache.delete(id);cache.set(id,entry);
  return {value:entry.value as T,updatedAt:entry.at};
}

export function cachedHireProfilesSnapshot<T>(body:Record<string,unknown>):HireProfilesSnapshot<T>|null {
  return read<T>(recent,body);
}

export function cachedHireProfiles<T>(body:Record<string,unknown>):T|null {
  return cachedHireProfilesSnapshot<T>(body)?.value??null;
}

export function cachedCategoryLeaders<T>(body:Record<string,unknown>):HireProfilesSnapshot<T>|null {
  return read<T>(leaderRecent,{...body,category:'',summary_only:true});
}

function save(cache:Map<string,Entry>,id:string,value:unknown,at:number,order:number) {
  // A slower category request may finish after a newer overview request.
  // Its older category snapshot must not replace the newer public ranks.
  if((cache.get(id)?.order??-1)>order)return;
  cache.delete(id);cache.set(id,{at,value,order});
  while(cache.size>MAX_ENTRIES)cache.delete(cache.keys().next().value!);
}

function categoryProjection(data:{categories?:unknown;total?:unknown},filteredCategory=false) {
  if(!Array.isArray(data.categories)||data.categories.length>200)return null;
  const categories=[];
  for(const category of data.categories){
    if(!category||typeof category.id!=='string'||typeof category.name!=='string'||!Number.isInteger(category.count)||category.count<0)return null;
    const leader=category.leader;
    if(leader!==null&&(!leader||typeof leader.id!=='string'||typeof leader.name!=='string'))return null;
    // Keep only the public preview fields: no work history, contact details,
    // private interests or precise professional positions enter this cache.
    categories.push({id:category.id,name:category.name,count:category.count,leader:leader?{
      id:leader.id,name:leader.name,role:leader.role,portrait_url:leader.portrait_url,repaidianBadge:leader.repaidianBadge
    }:null});
  }
  // A category-specific directory total cannot describe the whole overview;
  // the overview does not display a profile total, so never infer one by
  // summing overlapping category counts or a forty-profile page.
  return {professionals:[],total:!filteredCategory&&Number.isInteger(data.total)&&Number(data.total)>=0?Number(data.total):0,categories};
}

/** May be started alongside catalogue loading; mounting readers share the request. */
export async function categoryLeaders<T>(body:Record<string,unknown>,force=false):Promise<T> {
  const scope={...body,category:'',summary_only:true};
  const cached=cachedCategoryLeaders<T>(scope);
  if(!force&&cached&&Date.now()-cached.updatedAt<FRESH_MS&&!body.available_only)return cached.value;
  const data=await hireProfiles<{categories?:unknown;total?:unknown}>(scope,force);
  const projection=categoryProjection(data);
  if(!projection)throw new Error('Category leaders could not be confirmed. Please retry.');
  return cachedCategoryLeaders<T>(scope)?.value??projection as T;
}

export async function hireProfiles<T>(body:Record<string,unknown>,force=false):Promise<T> {
  const id=key(body);
  if(!force){
    const entry=recent.get(id);
    if(entry&&Date.now()-entry.at<FRESH_MS&&!body.available_only)return entry.value as T;
  }
  const running=inFlight.get(id);
  if(running)return running as Promise<T>;
  const order=++requestOrder;
  const request=(async()=>{
    const signal=AbortSignal.timeout(15000);
    const send=(query:Record<string,unknown>)=>apiFetch('/api/operations/hiring/leaderboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(query),signal},{background:true});
    let response=await send(body);
    let data=await response.json().catch(()=>({}));
    // During a mixed website/API rollout, only the older endpoint's explicit
    // unknown-field response permits a retry without the new projection flag.
    // Other validation, availability and server failures must remain visible.
    if(body.summary_only===true&&response.status===422&&Array.isArray(data?.detail)&&data.detail.length===1&&data.detail[0]?.type==='extra_forbidden'&&JSON.stringify(data.detail[0]?.loc)==='["body","summary_only"]'){
      const legacy={...body};delete legacy.summary_only;
      response=await send(legacy);data=await response.json().catch(()=>({}));
    }
    if(!response.ok)throw new Error(data.detail?.message||'Profiles could not load. Please retry.');
    // Do not retain a malformed success response: warm readers apply cached
    // profiles synchronously and cannot recover from an invalid collection.
    if(!data||!Array.isArray(data.professionals)||data.professionals.some((profile:unknown)=>!profile||typeof profile!=='object'||typeof (profile as {id?:unknown}).id!=='string'||typeof (profile as {name?:unknown}).name!=='string')||(data.categories!==undefined&&!Array.isArray(data.categories)))throw new Error('Profiles could not be confirmed. Please retry.');
    const at=Date.now();
    const projection=categoryProjection(data,Boolean(body.category));
    save(recent,id,body.summary_only&&projection?projection:data,at,order);
    if(projection)save(leaderRecent,key({...body,category:'',summary_only:true}),projection,at,order);
    return (body.summary_only&&projection?projection:data) as T;
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
