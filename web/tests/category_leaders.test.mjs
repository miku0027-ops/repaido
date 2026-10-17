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
