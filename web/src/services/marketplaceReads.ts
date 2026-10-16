import {auth} from '../firebase';
import {apiFetch} from './api';
import {operation} from './operations';
import {createReadCache} from './readCache.mjs';
import type {Item,Mode} from '../components/Marketplace';

export type MarketSearch={mode:Mode;location:{lat:number;lng:number};radius_km:number;query:string};
const publicCache=createReadCache({maxEntries:32}),privateCache=createReadCache({maxEntries:8});
let account='';
function privateScope(){const current=auth.currentUser?.uid||'';if(current!==account){privateCache.invalidate();account=current;}return current;}
const searchKey=(body:MarketSearch)=>JSON.stringify([body.mode,body.location.lat,body.location.lng,body.radius_km,body.query]);
function listings(value:unknown):Item[]{
 if(!Array.isArray(value)||!value.every(item=>item&&typeof item.id==='string'&&typeof item.name==='string'&&typeof item.status==='string'&&['exchange','second_hand'].includes(item.mode)&&Number.isFinite(item.value_paise)))throw Error('The listing response could not be confirmed. Please retry.');
 return value;
}
export function invalidateMarketplaceReads(){publicCache.invalidate();privateCache.invalidate();}
window.addEventListener('repaido:operations-updated',invalidateMarketplaceReads);

export function marketSearchSnapshot(body:MarketSearch):Item[]|null{return publicCache.peek(searchKey(body),30000) as Item[]|null;}
export async function readMarketSearch(body:MarketSearch,force=false):Promise<Item[]>{
 return publicCache.read(searchKey(body),async()=>{
  const response=await apiFetch('/api/operations/market/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)},{background:true,feedback:false});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(Error(data.detail?.message||'Listings could not load. Please retry.'),{status:response.status});
  return listings(data.items);
 },{freshMs:30000,force}) as Promise<Item[]>;
}
export function marketMineSnapshot():Item[]|null{const uid=privateScope();return uid?privateCache.peek(uid,15000) as Item[]|null:null;}
export async function readMarketMine(force=false):Promise<Item[]>{
 await auth.authStateReady();const uid=privateScope();if(!uid)throw Error('Sign in to view your listings.');
 return privateCache.read(uid,async()=>{
  const data=await operation<{listings:Item[]}>('/market/mine',{},{background:true,feedback:false,force});
  if(privateScope()!==uid)throw Error('Your account changed. Reopen your listings.');
  return listings(data.listings);
 },{freshMs:15000,force}) as Promise<Item[]>;
}
