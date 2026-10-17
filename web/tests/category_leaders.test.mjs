import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

// Exercise the live directory cache used by Category Leaders, Hiring and Home.
// Layout, profile navigation and verified-review labels are covered by discovery.browser.mjs.
const source=await readFile(new URL('../src/services/hireProfileCache.ts',import.meta.url),'utf8');
let generation=0;
async function directory(fetcher){
 const slot='__leaderCacheTest'+(++generation);globalThis[slot]=fetcher;
 const code=ts.transpileModule(source.replace("import {apiFetch} from './api';",`const apiFetch=globalThis.${slot};`),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const module=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 delete globalThis[slot];return module;
}
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const listed={professionals:[{id:'approved-worker',name:'Server supplied profile',categories:['cleaning']}],total:1,categories:[{id:'cleaning',name:'Cleaning',count:1,leader:null}]};

test('category leaders use server profiles and share equivalent public directory reads',async()=>{
 const requests=[];let finish;
 const api=await directory(async(...args)=>{requests.push(args);return new Promise(resolve=>finish=resolve);});
 const first=api.hireProfiles({city:'Balasore',category:'cleaning'});
 const equivalent=api.hireProfiles({category:'cleaning',city:'Balasore',role:'all',location:null,radius_km:20});
 assert.equal(requests.length,1);assert.equal(requests[0][0],'/api/operations/hiring/leaderboard');
 assert.deepEqual(JSON.parse(requests[0][1].body),{city:'Balasore',category:'cleaning'});
 finish(response(listed));assert.deepEqual(await first,listed);assert.deepEqual(await equivalent,listed);
 assert.deepEqual(api.cachedHireProfiles({city:'Balasore',category:'cleaning'}),listed);
 assert.equal(api.cachedHireProfiles({city:'Other city',category:'cleaning'}),null);
 assert.equal(api.cachedHireProfiles({city:'Balasore',category:'electrician'}),null);
});

test('failed leader refresh retains real prior records and the next retry recovers',async()=>{
 let calls=0;const api=await directory(async()=>++calls===2?response({detail:{message:'Directory temporarily unavailable'}},503):response({...listed,total:calls}));
 const query={city:'Balasore',category:'cleaning'};await api.hireProfiles(query);
 await assert.rejects(api.hireProfiles(query,true),/Directory temporarily unavailable/);
 assert.deepEqual(api.cachedHireProfiles(query),listed);
 assert.equal((await api.hireProfiles(query,true)).total,3);
});

test('malformed successful directory responses are rejected and never poison the cache',async()=>{
 for(const malformed of [{},null,{professionals:null},{professionals:[null]},{professionals:[],categories:{}}]){
  let calls=0;const api=await directory(async()=>response(++calls===1?malformed:listed));const query={city:'Balasore',category:'cleaning'};
  await assert.rejects(api.hireProfiles(query),/could not be confirmed/);assert.equal(api.cachedHireProfiles(query),null);
  assert.deepEqual(await api.hireProfiles(query),listed);assert.equal(calls,2);
 }
});

test('professional details are encoded and reject a mismatched public identity',async()=>{
 const calls=[];const api=await directory(async(...args)=>{calls.push(args);return response({id:'someone-else'});});
 await assert.rejects(api.publicProfessionalDetails('worker/id',new AbortController().signal,'home:maid'),/could not be confirmed/);
 assert.equal(calls[0][0],'/api/operations/professionals/worker%2Fid?category=home%3Amaid');
});

test('overview requests only summaries and reuses category metadata from an equivalent directory read',async()=>{
 const calls=[];const withLeader={...listed,categories:[{id:'cleaning',name:'Cleaning',count:1,leader:{id:'approved-worker',name:'Server supplied profile',role:'technician',phone:'not-a-preview-field'}}]};
 const api=await directory(async(...args)=>{calls.push(JSON.parse(args[1].body));return response(withLeader);});
 const query={city:'Balasore',category:'cleaning',radius_km:6};
 await api.hireProfiles(query);
 const overview=await api.categoryLeaders({...query,category:''});
 assert.equal(calls.length,1,'Switching to an overview must reuse the matching server-supplied categories');
 assert.deepEqual(overview.professionals,[],'The overview cache must not retain rich profile histories');
 assert.equal(overview.total,0,'A filtered profile-page count must not be presented as the whole-city total');
 assert.equal(overview.categories[0].leader.id,'approved-worker');
 assert.equal('phone' in overview.categories[0].leader,false);
 await api.categoryLeaders(query,true);
 assert.equal(calls.length,2);assert.equal(calls[1].category,'');assert.equal(calls[1].summary_only,true);
 assert.deepEqual(api.cachedCategoryLeaders(query).value.categories,overview.categories);
 assert.equal(api.cachedCategoryLeaders(query).value.total,1,'An actual overview response retains its true matching total');
});

test('leader snapshots preserve reception time and never cross city, radius, role or GPS filters',async()=>{
 const api=await directory(async()=>response(listed));
 const query={city:'Balasore',category:'cleaning',radius_km:6};
 await api.hireProfiles(query);
 const first=api.cachedCategoryLeaders(query);assert(first.updatedAt>0);
 assert.equal(api.cachedCategoryLeaders(query).updatedAt,first.updatedAt,'A warm read must not present old ranks as newly received');
 for(const changes of [{city:'Bhadrak'},{radius_km:0},{role:'specialist'},{location:{lat:21,lng:86}},{min_rating:4},{available_only:true},{query:'AC'}]){
  assert.equal(api.cachedCategoryLeaders({...query,...changes}),null,JSON.stringify(changes));
 }
 assert(api.cachedCategoryLeaders({...query,radius_km:10}),'A valid radius has no filtering effect on city-only browsing');
 const nearby={...query,location:{lat:21,lng:86}};await api.categoryLeaders(nearby);
 assert.equal(api.cachedCategoryLeaders({...nearby,radius_km:10}),null,'GPS radius must remain isolated');
});

test('summary cache is brief, live searches recheck and malformed category metadata never becomes a preview',async()=>{
 let calls=0;const nativeNow=Date.now;let now=nativeNow();Date.now=()=>now;
 try{
  const api=await directory(async()=>{calls++;return response(listed);});const query={city:'Balasore',radius_km:6};
  await api.categoryLeaders(query);await api.categoryLeaders(query);assert.equal(calls,1);
  now+=20_001;assert(api.cachedCategoryLeaders(query),'Last real city results may remain visible during revalidation');
  await api.categoryLeaders(query);assert.equal(calls,2);
  await api.categoryLeaders({...query,available_only:true});await api.categoryLeaders({...query,available_only:true});assert.equal(calls,4,'Live availability always reads current records');
  now+=120_001;assert.equal(api.cachedCategoryLeaders(query),null);
 }finally{Date.now=nativeNow;}
 for(const categories of [[null],[{id:'cleaning',name:'Cleaning',count:-1,leader:null}],[{id:'cleaning',name:'Cleaning',count:1,leader:{name:'Missing identity'}}]]){
  const api=await directory(async()=>response({...listed,categories}));
  await assert.rejects(api.categoryLeaders({city:'Balasore'}),/could not be confirmed/);
  assert.equal(api.cachedCategoryLeaders({city:'Balasore'}),null);
 }
});

test('older API fallback is limited to its explicit unknown summary flag response',async()=>{
 const calls=[];
 const api=await directory(async(...args)=>{
  const body=JSON.parse(args[1].body);calls.push(body);
  return calls.length===1?response({detail:[{type:'extra_forbidden',loc:['body','summary_only'],msg:'Extra inputs are not permitted',input:true}]},422):response(listed);
 });
 const query={city:'Balasore',role:'specialist',radius_km:6};
 const result=await api.categoryLeaders(query);
 assert.equal(calls.length,2);assert.deepEqual(calls[0],{...query,category:'',summary_only:true});assert.deepEqual(calls[1],{...query,category:''});
 assert.deepEqual(result.professionals,[]);assert.deepEqual(result.categories,listed.categories);
 assert.deepEqual(api.cachedHireProfiles({...query,category:'',summary_only:true}).professionals,[],'Mixed-release fallback retains only the small preview');
 for(const [status,detail] of [[503,{message:'Unavailable'}],[422,[{type:'greater_than',loc:['body','radius_km']}]],
  [422,[{type:'extra_forbidden',loc:['body','unexpected']}]],
  [422,[{type:'extra_forbidden',loc:['body','summary_only']},{type:'missing',loc:['body','city']}]]]){
  let attempts=0;const failing=await directory(async()=>{attempts++;return response({detail},status);});
  await assert.rejects(failing.categoryLeaders(query));assert.equal(attempts,1,'Unrelated validation and server errors must not retry');
 }
});

test('a slower older directory response cannot overwrite newer category evidence',async()=>{
 const pending=[];const api=await directory(async()=>new Promise(resolve=>pending.push(resolve)));
 const query={city:'Balasore',radius_km:6};
 const old=api.hireProfiles({...query,category:'cleaning'});
 const latest=api.categoryLeaders(query);
 const newer={...listed,total:9,categories:[{...listed.categories[0],name:'New category evidence'}]};
 pending[1](response(newer));await latest;
 const received=api.cachedCategoryLeaders(query).updatedAt;
 pending[0](response(listed));await old;
 const snapshot=api.cachedCategoryLeaders(query);
 assert.equal(snapshot.value.categories[0].name,'New category evidence');assert.equal(snapshot.value.total,9);
 assert.equal(snapshot.updatedAt,received,'Old requests must not relabel the last received rank refresh');
});
