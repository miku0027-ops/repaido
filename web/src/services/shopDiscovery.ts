import {onIdTokenChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {apiAssetUrl,apiFetch} from './api';
import {operation} from './operations';
import {createReadCache} from './readCache.mjs';

export type ShopProduct={id:string;shop_id:string;name:string;category:string;price_paise:number;base_price_paise?:number;mrp_paise?:number;stock:number;image_url?:string;condition?:string;brand?:string;sku?:string;compatibility?:string;offer?:{source?:string;label?:string;discount_paise?:number;percent?:number};offer_source?:string;discount_paise?:number;offer_bps?:number;discount_bps?:number;valid_until?:number|null;received_units?:number;received_orders?:number;metrics_since?:number|null;recommendation_reason?:string;recommendation?:{reasons?:string[]};reasons?:string[];sales?:{units:number;orders:number};rating?:{mean:number|null;count:number}};
export type ShopSummary={id:string;name:string;city:string;address?:string;categories:string[];verified:boolean;activity?:{status:'online'|'offline'|'unknown';recently_active:boolean;last_active_at?:number;active_days_this_month:number|null;expires_at?:number|null};rating?:{mean:number|null;count:number;bayesian:number|null};quality?:{version:string;score:number;components:{id:string;label:string;points:number;maximum:number}[]};rank?:{position:number;cohort_size:number;category:string;city:string;sampled:boolean}|null;prime?:{active:boolean;label?:string}|null;reasons?:string[];reason?:string;recommendation?:{reasons?:string[]};distance_km?:number;observed_server_time?:number;observed_monotonic?:number};
export type ShopProfile={shop:ShopSummary;catalogue:ShopProduct[];rentals:{id:string;name:string;title?:string;image_url?:string;category?:string;daily_paise?:number;price_paise?:number;stock?:number}[];metrics:{received_orders:number;units_sold:number;verified_reviews:number;refunded_orders:number;cancelled_orders:number;stock_freshness:number;since?:number|null;coverage?:string};next_cursor:string|null;related_shops:ShopSummary[];server_time:number;reviews?:{id:string;rating:number;text:string;created_at:number;verified_purchase:boolean}[];catalogue_coverage?:{sampled:boolean;candidate_limit:number}};
export type ShopContext={query?:string;category?:string;city?:string;product_id?:string;cart_product_ids?:string[];location?:{lat:number;lng:number}};
export type ShopRecommendations={products:ShopProduct[];shops:ShopSummary[];bought_together:{label:'Frequently bought together'|'Related items';confidence:number;sample_orders:number;items:ShopProduct[]};personalised:boolean;version:string};
export type ShopCatalogue={items:ShopProduct[];shops:{id:string;name:string;address?:string;city?:string;location?:{lat:number;lng:number};verified?:boolean}[]};
export type ShopSort='relevance'|'bestselling'|'top_rated'|'price_low';
const publicReads=createReadCache({maxEntries:32}),personalReads=createReadCache({maxEntries:16});
let account='',revision=0;
const message=(data:any,fallback:string)=>data?.detail?.message||(typeof data?.detail==='string'?data.detail:fallback);
const validRating=(r:any)=>r===undefined||r===null||Number.isSafeInteger(r.count)&&r.count>=0&&(r.mean===null||Number.isFinite(r.mean)&&r.mean>=0&&r.mean<=5);
const validProduct=(p:any):p is ShopProduct=>p&&typeof p.id==='string'&&typeof p.shop_id==='string'&&typeof p.name==='string'&&typeof p.category==='string'&&Number.isSafeInteger(p.price_paise)&&p.price_paise>=0&&Number.isSafeInteger(p.stock)&&p.stock>=0&&(p.base_price_paise===undefined||Number.isSafeInteger(p.base_price_paise)&&p.base_price_paise>=p.price_paise)&&validRating(p.rating);
const validShop=(s:any):s is ShopSummary=>s&&typeof s.id==='string'&&typeof s.name==='string'&&Array.isArray(s.categories)&&s.categories.every((c:any)=>typeof c==='string')&&typeof s.verified==='boolean'&&validRating(s.rating)&&(!s.quality||Number.isFinite(s.quality.score)&&Array.isArray(s.quality.components)&&s.quality.components.every((c:any)=>typeof c.id==='string'&&typeof c.label==='string'&&Number.isFinite(c.points)&&Number.isFinite(c.maximum)))&&(!s.activity||['online','offline','unknown'].includes(s.activity.status));
function requireProducts(value:unknown){if(!Array.isArray(value)||!value.every(validProduct))throw Error('Product details could not be confirmed. Please retry.');return value as ShopProduct[];}
function observeShop(shop:ShopSummary,serverTime:number):ShopSummary{return {...shop,observed_server_time:serverTime,observed_monotonic:performance.now()};}
export function observedShopPresence(shop:ShopSummary){const a=shop.activity;if(!a||!shop.observed_server_time||shop.observed_monotonic===undefined||!a.expires_at)return {online:false,label:'Status unavailable'};const now=shop.observed_server_time+(performance.now()-shop.observed_monotonic)/1000;return a.expires_at<=now?{online:false,label:'Status unavailable'}:a.status==='online'?{online:true,label:'Online now'}:a.status==='offline'?{online:false,label:'Offline'}:{online:false,label:'Status unavailable'};}
function requireShops(value:unknown){if(!Array.isArray(value)||!value.every(validShop))throw Error('Shop details could not be confirmed. Please retry.');return value as ShopSummary[];}
export function shopImage(path=''){return path?apiAssetUrl(path):'';}
export function shopOffer(product:ShopProduct){
 const base=product.base_price_paise??product.price_paise;
 const discount=Number.isSafeInteger(base)&&base>product.price_paise?base-product.price_paise:0;
 const source=product.offer?.source||product.offer_source||'';
 return {base,discount,percent:discount?(typeof product.discount_bps==='number'&&Number.isSafeInteger(product.discount_bps)&&product.discount_bps>0?product.discount_bps/100:Math.round(discount/base*1000)/10):0,label:source==='trial_default'||source==='shop_trial'||source==='registration_trial'?(product.valid_until?'Shop trial offer':'Shop default offer'):source==='merchant'||source==='shop_owner'||source==='shop'?'Shop offer':product.offer?.label||'Offer'};
}
export function clearShopDiscovery(){revision++;publicReads.invalidate();personalReads.invalidate();}
onIdTokenChanged(auth,user=>{if(account!==(user?.uid||'')){account=user?.uid||'';revision++;personalReads.invalidate();}});
window.addEventListener('repaido:operations-updated',clearShopDiscovery);
window.addEventListener('repaido:interests',clearShopDiscovery);
function abortable<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T>{
 if(!signal)return promise;
 if(signal.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'));
 return new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('Cancelled','AbortError'));signal.addEventListener('abort',abort,{once:true});promise.then(value=>{signal.removeEventListener('abort',abort);if(!signal.aborted)resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});
}
async function publicRequest(path:string,body?:object){const response=await apiFetch('/api/operations'+path,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)},{background:true,feedback:false});const data=await response.json().catch(()=>null);if(!response.ok)throw Object.assign(Error(message(data,'Shop information could not load. Please retry.')),{status:response.status});return data;}
export function shopCatalogueSnapshot():ShopCatalogue|null{return publicReads.peek('catalogue',30000) as ShopCatalogue|null;}
export function readShopCatalogue(force=false,signal?:AbortSignal):Promise<ShopCatalogue>{
 if(force)publicReads.invalidate('catalogue');
 return abortable(publicReads.read('catalogue',async()=>{const data=await publicRequest('/products/catalog');const items=requireProducts(data?.items);if(!Array.isArray(data?.shops)||!data.shops.every((s:any)=>s&&typeof s.id==='string'&&typeof s.name==='string'))throw Error('Shop details could not be confirmed. Please retry.');return {...data,items};},{freshMs:30000}) as Promise<ShopCatalogue>,signal);
}
export function profileSnapshot(shopId:string,context:{category?:string;query?:string;sort?:ShopSort;cursor?:string}={}):ShopProfile|null{return publicReads.peek(profileKey(shopId,context),30000) as ShopProfile|null;}
function profileKey(shopId:string,context:{category?:string;query?:string;sort?:ShopSort;cursor?:string}){return 'profile:'+JSON.stringify([shopId,context.category||'',context.query||'',context.sort||'relevance',context.cursor||'']);}
export function readShopProfile(shopId:string,context:{category?:string;query?:string;sort?:ShopSort;cursor?:string}={},force=false,signal?:AbortSignal):Promise<ShopProfile>{
 const key=profileKey(shopId,context);if(force)publicReads.invalidate(key);
 const query=new URLSearchParams(Object.entries(context).filter(([,v])=>v));
 return abortable(publicReads.read(key,async()=>{const data=await publicRequest('/shops/'+encodeURIComponent(shopId)+'/profile?'+query);if(!validShop(data?.shop)||!Array.isArray(data?.rentals)||!data?.metrics||!['received_orders','units_sold','verified_reviews','refunded_orders','cancelled_orders','stock_freshness'].every(k=>Number.isFinite(data.metrics[k]))||!Number.isFinite(data?.server_time)||data.reviews&&(!Array.isArray(data.reviews)||!data.reviews.every((r:any)=>r&&typeof r.id==='string'&&typeof r.text==='string'&&Number.isFinite(r.rating)&&Number.isFinite(r.created_at))))throw Error('This shop profile could not be confirmed. Please retry.');return {...data,shop:observeShop(data.shop,data.server_time),catalogue:requireProducts(data.catalogue),related_shops:requireShops(data.related_shops||[]).map(s=>observeShop(s,data.server_time))};},{freshMs:30000}) as Promise<ShopProfile>,signal);
}
export function readShopRecommendations(context:ShopContext={},personal=false,force=false,signal?:AbortSignal):Promise<ShopRecommendations>{
 context={...context,query:context.query?.slice(0,150),category:context.category?.slice(0,80),city:context.city?.slice(0,80),cart_product_ids:context.cart_product_ids?[...new Set(context.cart_product_ids)].slice(0,20):undefined};
 const actor=auth.currentUser?.uid||'',epoch=revision;
 const key=(personal?actor+':':'public:')+JSON.stringify([context.query||'',context.category||'',context.city||'',context.product_id||'',context.cart_product_ids||[],context.location||null]);
 const cache=personal?personalReads:publicReads;if(force)cache.invalidate(key);
 return abortable(cache.read(key,async()=>{
  const data=personal?await operation<ShopRecommendations>('/shop-discovery/recommendations/personal',{method:'POST',body:JSON.stringify(context)},{background:true,feedback:false}):await publicRequest('/shop-discovery/recommendations',context);
  if(personal&&(!actor||auth.currentUser?.uid!==actor||epoch!==revision))throw Error('Your account or interests changed. Refresh suggestions.');
  if(!data?.bought_together||!['Frequently bought together','Related items'].includes(data.bought_together.label)||!Number.isFinite(data.server_time))throw Error('Suggestions could not be confirmed. Please retry.');
  return {...data,products:requireProducts(data.products),shops:requireShops(data.shops).map(s=>observeShop(s,data.server_time)),bought_together:{...data.bought_together,items:requireProducts(data.bought_together.items)}};
 },{freshMs:30000}) as Promise<ShopRecommendations>,signal);
}
export const shopPreferences=()=>operation<{enabled:boolean;market_enabled:boolean}>('/discovery/preferences',{}, {background:true,feedback:false});
export async function setShopPersonalisation(enabled:boolean){const value=await operation<{enabled:boolean;market_enabled:boolean}>('/discovery/preferences',{method:'PUT',body:JSON.stringify({enabled,consent_version:3})},{background:true,feedback:false});clearShopDiscovery();window.dispatchEvent(new Event('repaido:interests'));return value;}

export async function recordShopActivity(event:'search'|'view_product'|'view_shop'|'add_to_cart',context:{category?:string;product_id?:string;shop_id?:string}){
 if(!auth.currentUser)return;
 const prefs=await shopPreferences();if(!prefs.market_enabled)return;
 await operation('/shop-discovery/events',{method:'POST',body:JSON.stringify({event,...context,request_id:crypto.randomUUID()})},{background:true,feedback:false});
 personalReads.invalidate();
}
