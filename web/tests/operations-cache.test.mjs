import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createReadCache} from '../src/services/readCache.mjs';
import {feedbackImports,feedbackModuleUrl} from './feedback-module.mjs';
const {actionFeedback,clearFeedback}=await import(feedbackModuleUrl);
let code=feedbackImports(ts.transpileModule(await readFile(new URL('../src/services/operations.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
for(const [name,value] of [['../firebase','const auth=globalThis.__ops.auth;'],['./api','const apiFetch=globalThis.__ops.fetch;'],['./loading','const beginLoading=globalThis.__ops.loading;'],['./readCache.mjs','const createReadCache=globalThis.__ops.cache;'],['./deviceLocation.mjs','const readDeviceLocation=()=>{};']])code=code.replace(new RegExp(`^import .+ from ['"]${name.replaceAll('.','\\.')}['"];?$`,'m'),value);
let service,calls,now,transport,visible,updates,revision=0;
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
beforeEach(async()=>{
 clearFeedback();calls=[];now=0;visible=0;updates=0;globalThis.window=new EventTarget();globalThis.localStorage={getItem:()=>null};
 window.addEventListener('repaido:operations-updated',()=>updates++);
 transport=async()=>response({jobs:[{id:'a-job'}],requests:[],plans:[]});
 globalThis.__ops={auth:{authStateReady:async()=>{},currentUser:{uid:'a',getIdToken:async()=>'a-token'}},cache:options=>createReadCache({...options,now:()=>now}),loading:()=>{visible++;return()=>visible--;},fetch:async(path,init)=>{calls.push({path,init});return transport(path,init);}};
 service=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')+'#'+(++revision));
});
test('all booking lists coalesce and warm snapshots survive quiet background receipts',async()=>{
 for(const path of ['/jobs','/hiring/requests','/home/plans','/local-business/rides','/local-business/shared']){
  const before=calls.length;await Promise.all([service.operation(path),service.operation(path)]);assert.equal(calls.length,before+1);
  assert.ok(service.operationSnapshot(path));await service.operation(path);assert.equal(calls.length,before+1);
 }
 for(const path of ['/coupons/launch','/discovery/events','/worker/availability','/notifications/read-all','/professionals/search'])await service.operation(path,{method:'POST',body:'{"heartbeat":true}'});
 assert.equal(updates,0);assert.equal(visible,0);assert.deepEqual(actionFeedback.getSnapshot(),[]);
 const before=calls.length;await service.operation('/jobs');assert.equal(calls.length,before);
 await service.operation('/profile',{method:'PUT',body:'{}'});assert.equal(updates,1);assert.equal(service.operationSnapshot('/jobs'),null);assert.equal(actionFeedback.getSnapshot()[0].tone,'success');
});
test('stale snapshots render while a refresh coalesces, expires, and a manual refresh bypasses freshness',async()=>{
 await service.operation('/home/plans');now=10001;let release;transport=()=>new Promise(resolve=>release=resolve);
 const a=service.operation('/home/plans'),b=service.operation('/home/plans');await tick();assert.equal(calls.length,2);assert.ok(service.operationSnapshot('/home/plans'));
 release(response({plans:[{id:'new'}]}));await Promise.all([a,b]);assert.equal(service.operationSnapshot('/home/plans').plans[0].id,'new');
 transport=async()=>response({plans:[{id:'manual'}]});await service.operation('/home/plans',{}, {force:true});assert.equal(calls.length,3);
 now=70001;assert.equal(service.operationSnapshot('/home/plans'),null);
});
test('late tokens and private responses cannot cross account boundaries',async()=>{
 let release;__ops.auth.currentUser.getIdToken=()=>new Promise(resolve=>release=resolve);const old=service.operation('/jobs');await tick();
 __ops.auth.currentUser={uid:'b',getIdToken:async()=>'b-token'};release('a-token');await assert.rejects(old,/account changed/);assert.equal(calls.length,0);
 transport=async()=>response({jobs:[{id:'b-job'}]});await service.operation('/jobs');assert.equal(service.operationSnapshot('/jobs').jobs[0].id,'b-job');
 transport=()=>new Promise(resolve=>release=resolve);const late=service.operation('/jobs',{}, {force:true});await tick();__ops.auth.currentUser=null;release(response({jobs:[{id:'b-private'}]}));await assert.rejects(late,/account changed/);assert.equal(service.operationSnapshot('/jobs'),null);
});
test('access rejection retires warm data and an offline refresh retains its last confirmed snapshot',async()=>{
 await service.operation('/hiring/requests');transport=async()=>response({detail:'Offline'},503);await assert.rejects(service.operation('/hiring/requests',{}, {force:true}),/Offline/);assert.ok(service.operationSnapshot('/hiring/requests'));
 transport=async()=>response({detail:'Sign in again'},401);await assert.rejects(service.operation('/hiring/requests',{}, {force:true}),error=>error.status===401);assert.equal(service.operationSnapshot('/hiring/requests'),null);
});
test('a late denial from another account cannot clear the current account cache',async()=>{
 let release;transport=()=>new Promise(resolve=>release=resolve);const old=service.operation('/home/plans');await tick();
 __ops.auth.currentUser={uid:'b',getIdToken:async()=>'b-token'};transport=async()=>response({jobs:[{id:'b-only'}]});await service.operation('/jobs');
 release(response({detail:'Expired A session'},401));await assert.rejects(old,/account changed/);assert.equal(service.operationSnapshot('/jobs').jobs[0].id,'b-only');
 transport=async()=>response({detail:'Restricted hiring'},403);await assert.rejects(service.operation('/hiring/requests'),error=>error.status===403);
 assert.equal(service.operationSnapshot('/jobs').jobs[0].id,'b-only','A denied module does not reset unrelated bookings');
});

test('company admin snapshots are quiet, account-scoped, refreshed explicitly and retired on access denial',async()=>{
 for(const path of ['/admin/workers','/admin/jobs','/shop/orders']){
  const before=calls.length;await service.operation(path,{}, {background:true});await service.operation(path,{}, {background:true});assert.equal(calls.length,before+1);assert.ok(service.operationSnapshot(path));
  await service.operation(path,{}, {background:true,force:true});assert.equal(calls.length,before+2);
 }
 assert.equal(visible,0);assert.deepEqual(actionFeedback.getSnapshot(),[]);
 __ops.auth.currentUser={uid:'another-admin',getIdToken:async()=>'another-token'};assert.equal(service.operationSnapshot('/admin/jobs'),null);
 await service.operation('/admin/jobs',{}, {background:true});transport=async()=>response({detail:'Access removed'},403);
 await assert.rejects(service.operation('/admin/jobs',{}, {force:true}),error=>error.status===403);assert.equal(service.operationSnapshot('/admin/jobs'),null);
});
test('a server error is distinguished from a disconnected browser without dropping last confirmed admin data',async()=>{
 await service.operation('/admin/jobs');transport=async()=>new Response('Internal Server Error',{status:500});
 await assert.rejects(service.operation('/admin/jobs',{}, {force:true}),error=>error.status===500&&/could not load this data/.test(error.message));assert.ok(service.operationSnapshot('/admin/jobs'));
});
