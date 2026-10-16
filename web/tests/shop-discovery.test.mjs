import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createReadCache} from '../src/services/readCache.mjs';
let identityListener=()=>{},publicCalls=0,privateCalls=0;
const events=new Map(),actor={currentUser:null};
const product={id:'part',shop_id:'shop',name:'Compressor relay',category:'ac',price_paise:9500,base_price_paise:10000,stock:4,offer_source:'trial_default',valid_until:2000};
const shop={id:'shop',name:'Neighbourhood Parts',city:'Balasore',categories:['ac'],verified:true};
const recommendations=()=>({products:[product],shops:[shop],bought_together:{label:'Related items',confidence:null,sample_orders:0,items:[]},personalised:false,version:'v1',server_time:1000});
let publicHandler=async()=>({items:[product],shops:[shop]}),privateHandler=async()=>({...recommendations(),personalised:true});
globalThis.window={addEventListener:(name,fn)=>events.set(name,fn),dispatchEvent:event=>events.get(event.type)?.()};
globalThis.__shopMocks={auth:actor,onIdTokenChanged:(_auth,fn)=>{identityListener=fn;return()=>{};},apiAssetUrl:p=>p,apiFetch:async(...args)=>{publicCalls++;const value=await publicHandler(...args);return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});},operation:async(...args)=>{privateCalls++;return privateHandler(...args);},createReadCache};
let source=await readFile(new URL('../src/services/shopDiscovery.ts',import.meta.url),'utf8');
source=source.replace(/^import .*;\n/gm,'');
const injected='const {onIdTokenChanged,auth,apiAssetUrl,apiFetch,operation,createReadCache}=globalThis.__shopMocks;\n'+source;
const code=ts.transpileModule(injected,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const api=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
beforeEach(()=>{api.clearShopDiscovery();publicCalls=0;privateCalls=0;actor.currentUser=null;identityListener(null);publicHandler=async()=>({items:[product],shops:[shop]});privateHandler=async()=>({...recommendations(),personalised:true});});
test('offer display uses canonical effective prices and never invents an MRP discount',()=>{
 assert.deepEqual(api.shopOffer(product),{base:10000,discount:500,percent:5,label:'Shop trial offer'});
 assert.equal(api.shopOffer({...product,offer_source:'shop'}).label,'Shop offer');
 assert.equal(api.shopOffer({...product,valid_until:null}).label,'Shop default offer');
 assert.equal(api.shopOffer({...product,discount_bps:1250,price_paise:8750}).percent,12.5);
 assert.equal(api.shopOffer({...product,base_price_paise:undefined,mrp_paise:20000}).discount,0);
 assert.equal(api.shopOffer({...product,base_price_paise:9000}).discount,0);
});
test('aborting one catalogue consumer does not cancel another; warm views reuse only validated public data',async()=>{
 let finish;publicHandler=()=>new Promise(resolve=>finish=resolve);
 const controller=new AbortController(),first=api.readShopCatalogue(false,controller.signal),second=api.readShopCatalogue();await tick();assert.equal(publicCalls,1);
 controller.abort();await assert.rejects(first,e=>e.name==='AbortError');finish({items:[product],shops:[shop]});assert.equal((await second).items[0].id,'part');
 assert.equal((await api.readShopCatalogue()).items[0].price_paise,9500);assert.equal(publicCalls,1);
});
test('malformed price or list responses never poison the catalogue cache',async()=>{
 publicHandler=async()=>({items:[{...product,price_paise:'9500'}],shops:[shop]});await assert.rejects(api.readShopCatalogue(),/could not be confirmed/);assert.equal(api.shopCatalogueSnapshot(),null);
 publicHandler=async()=>({items:[product],shops:[shop]});await api.readShopCatalogue();assert.equal(publicCalls,2);
});
test('a switched account cannot receive or cache a late personal recommendation',async()=>{
 actor.currentUser={uid:'alice'};identityListener(actor.currentUser);let finish;privateHandler=()=>new Promise(resolve=>finish=resolve);
 const old=api.readShopRecommendations({category:'ac'},true);await tick();actor.currentUser={uid:'bob'};identityListener(actor.currentUser);finish({...recommendations(),personalised:true});await assert.rejects(old,/account or interests changed/);
 privateHandler=async()=>({...recommendations(),personalised:true,products:[{...product,id:'bob-item'}]});const next=await api.readShopRecommendations({category:'ac'},true);assert.equal(next.products[0].id,'bob-item');assert.equal(privateCalls,2);
});
test('a preference reset rejects pending personal results and performs a fresh read',async()=>{
 actor.currentUser={uid:'alice'};identityListener(actor.currentUser);let finish;privateHandler=()=>new Promise(resolve=>finish=resolve);
 const old=api.readShopRecommendations({category:'ac'},true);await tick();events.get('repaido:interests')();finish({...recommendations(),personalised:true});await assert.rejects(old,/account or interests changed/);
 privateHandler=async()=>({...recommendations(),personalised:true});await api.readShopRecommendations({category:'ac'},true);assert.equal(privateCalls,2);
});
test('presence expires against observed server time and never converts missing evidence into offline',()=>{
 const now=performance.now(),online={...shop,observed_server_time:1000,observed_monotonic:now,activity:{status:'online',expires_at:1090}};
 assert.deepEqual(api.observedShopPresence(online),{online:true,label:'Online now'});
 assert.deepEqual(api.observedShopPresence({...online,observed_monotonic:now-100000}),{online:false,label:'Status unavailable'});
 assert.deepEqual(api.observedShopPresence({...online,activity:{status:'offline',expires_at:1090}}),{online:false,label:'Offline'});
 assert.deepEqual(api.observedShopPresence(shop),{online:false,label:'Status unavailable'});
});
test('malformed ranking components produce a recoverable profile error instead of cached UI data',async()=>{
 publicHandler=async()=>({shop:{...shop,quality:{score:20,version:'v1',components:{unsafe:20}}},catalogue:[product],rentals:[],metrics:{received_orders:0,units_sold:0,verified_reviews:0,refunded_orders:0,cancelled_orders:0,stock_freshness:0},server_time:1000,related_shops:[]});
 await assert.rejects(api.readShopProfile('shop'),/could not be confirmed/);assert.equal(api.profileSnapshot('shop'),null);
});
