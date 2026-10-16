import {auth} from '../firebase';
import {apiFetch} from './api';
import {operation} from './operations';
import {createReadCache} from './readCache.mjs';

export type SellerProfileMode='all'|'second_hand'|'exchange'|'rentals';
export type SellerProfileItem={id:string;mode:Exclude<SellerProfileMode,'all'>;name:string;image_url:string;city:string;value_paise?:number;shop_id?:string;daily_paise?:number;weekly_paise?:number;monthly_paise?:number};
export type PublicSeller={key:string;name:string;label:string;first_listed_at:number|null;counts:{second_hand:number;exchange:number;rentals:number};counts_complete:boolean;shops:{id:string;name:string;city:string;verified:boolean}[];shops_complete:boolean;items:SellerProfileItem[];next_cursor:string|null;mode:SellerProfileMode};
export type ProfileReference={listingId?:string;chatId?:string};
const cache=createReadCache({maxEntries:20});
let cacheActor='';
const actor=()=>auth.currentUser?.uid||'';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
function validItem(v:unknown):v is SellerProfileItem {return object(v)&&typeof v.id==='string'&&typeof v.name==='string'&&typeof v.image_url==='string'&&typeof v.city==='string'&&(['exchange','second_hand'].includes(String(v.mode))?integer(v.value_paise):v.mode==='rentals'&&typeof v.shop_id==='string'&&[v.daily_paise,v.weekly_paise,v.monthly_paise].every(integer));}
function validate(value:unknown):PublicSeller {
 if(!object(value)||!object(value.profile))throw new Error('This profile could not be confirmed. Please retry.');
 const p=value.profile;
 if(typeof p.key!=='string'||typeof p.name!=='string'||typeof p.label!=='string'||!(p.first_listed_at===null||typeof p.first_listed_at==='number'&&Number.isFinite(p.first_listed_at)&&p.first_listed_at>=0&&p.first_listed_at<=8640000000000)||!object(p.counts)||![p.counts.second_hand,p.counts.exchange,p.counts.rentals].every(integer)||typeof p.counts_complete!=='boolean'||typeof p.shops_complete!=='boolean'||!Array.isArray(p.shops)||!p.shops.every(s=>object(s)&&typeof s.id==='string'&&typeof s.name==='string'&&typeof s.city==='string'&&typeof s.verified==='boolean')||!Array.isArray(p.items)||!p.items.every(validItem)||!(p.next_cursor===null||typeof p.next_cursor==='string')||!['all','second_hand','exchange','rentals'].includes(String(p.mode)))throw new Error('This profile could not be confirmed. Please retry.');
 return p as PublicSeller;
}
function key(ref:ProfileReference,mode:SellerProfileMode,cursor?:string){const uid=actor();if(cacheActor!==uid){cache.invalidate();cacheActor=uid;}return JSON.stringify([ref.chatId?uid:'public',ref.chatId||'',ref.listingId||'',mode,cursor||'']);}
export function sellerProfileSnapshot(ref:ProfileReference,mode:SellerProfileMode='all'){if(ref.chatId&&!actor())return null;return cache.peek(key(ref,mode),15000) as PublicSeller|null;}
export function invalidateSellerProfiles(){cache.invalidate();}
export async function readSellerProfile(ref:ProfileReference,options:{mode?:SellerProfileMode;cursor?:string;signal?:AbortSignal;force?:boolean}={}):Promise<PublicSeller>{
 if(!ref.chatId&&!ref.listingId)throw new Error('Choose a listing to view its seller.');
 const uid=actor(),mode=options.mode||'all',params=new URLSearchParams({mode,limit:'12'});if(options.cursor)params.set('cursor',options.cursor);
 const cacheKey=key(ref,mode,options.cursor);if(options.force)cache.invalidate(cacheKey);
 const load=async()=>{
  let value:unknown;
  if(ref.chatId){if(!uid)throw Object.assign(new Error('Sign in to view this conversation’s profile.'),{status:401});value=await operation(`/market/chats/${encodeURIComponent(ref.chatId)}/peer-profile?${params}`,{signal:options.signal},{background:true,feedback:false});if(actor()!==uid)throw new Error('Your account changed. Reopen this profile.');}
  else {const response=await apiFetch(`/api/operations/market/profiles/by-listing/${encodeURIComponent(ref.listingId!)}?${params}`,{signal:options.signal},{background:true,feedback:false});value=await response.json().catch(()=>null);if(!response.ok){const body=value as {detail?:{message?:string}}|null;throw Object.assign(new Error(body?.detail?.message||'This seller profile is unavailable. Please retry.'),{status:response.status});}}
  return validate(value);
 };
 try{return await cache.read(cacheKey,load,{freshMs:15000,force:options.force}) as PublicSeller;}catch(error){cache.invalidate(cacheKey);throw error;}
}
if(typeof window!=='undefined')window.addEventListener('repaido:operations-updated',invalidateSellerProfiles);
