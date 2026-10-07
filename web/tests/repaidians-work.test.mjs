import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createReadCache} from '../src/services/readCache.mjs';

const source=await readFile(new URL('../src/services/repaidiansWorkService.ts',import.meta.url),'utf8');
let executable=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
for(const [dependency,injected] of [['../firebase','const auth=globalThis.__workAuth;'],['./repaidiansService','const communityRequest=globalThis.__workRequest;'],['./operations','const operation=globalThis.__workOperation;'],['./readCache.mjs','const createReadCache=globalThis.__workCache;'],['./repaidiansPushService','const syncWorkPushAccount=async()=>{};']]) {
  const escaped=dependency.replaceAll('.','\\.');const pattern=new RegExp(`^import .+ from ['"]${escaped}['"];?$`,'m');assert.match(executable,pattern);executable=executable.replace(pattern,injected);
}
let service,revision=0,calls,now,transport,values;
beforeEach(async()=>{
  now=0;calls=[];values=new Map([['repaido.token','account-a-session']]);globalThis.localStorage={getItem:key=>values.get(key)||null};globalThis.window=new EventTarget();
  globalThis.__workAuth={currentUser:null,authStateReady:async()=>{}};
  globalThis.__workCache=options=>createReadCache({...options,now:()=>now});
  transport=async()=>({items:[],nextCursor:null});
  globalThis.__workRequest=async(path,init)=>{calls.push({path,init});return transport(path,init);};globalThis.__workOperation=globalThis.__workRequest;
  service=await import('data:text/javascript;base64,'+Buffer.from(executable).toString('base64')+'#'+(++revision));
});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};

test('duplicate work reads coalesce; aborting one observer does not cancel another',async()=>{
  const pending=deferred();transport=()=>pending.promise;const controller=new AbortController();
  const cancelled=service.workJobs('a',{},false,controller.signal),other=service.workJobs('a');await tick();assert.equal(calls.length,1);
  controller.abort();await assert.rejects(cancelled,error=>error.name==='AbortError');pending.resolve({items:[{id:'real-project'}],nextCursor:null});assert.deepEqual((await other).items,[{id:'real-project'}]);
  assert.equal((await service.workJobs('a')).items[0].id,'real-project');assert.equal(calls.length,1);
});
test('fresh results avoid requests; stale snapshots have a fixed expiry',async()=>{
  await service.workJobs('a');assert.equal(calls.length,1);now=9000;await service.workJobs('a');assert.equal(calls.length,1);
  now=10001;assert.ok(service.peekWorkJobs('a'));await service.workJobs('a');assert.equal(calls.length,2);
  now=70001;assert.equal(service.peekWorkJobs('a'),null);
});
test('account switch rejects late private results and retires old cache entries',async()=>{
  const pending=deferred();transport=()=>pending.promise;const old=service.workJobs('a');await tick();
  values.set('repaido.token','account-b-session');transport=async()=>({items:[{id:'b-only'}],nextCursor:null});await service.workJobs('b');
  pending.resolve({items:[{id:'a-private'}],nextCursor:null});await assert.rejects(old,/account or work details changed/);assert.equal(service.peekWorkJobs('a'),null);assert.equal(service.peekWorkJobs('b').items[0].id,'b-only');
});
test('failed reads never become cached, and parameters are bounded and encoded',async()=>{
  transport=async()=>{throw Error('offline');};await assert.rejects(service.workJobs('a'),/offline/);assert.equal(service.peekWorkJobs('a'),null);
  transport=async()=>({items:[],nextCursor:null});await service.workJobs('a',{query:'wiring & testing',sector:'Education',trade:'electrician',limit:1000,experience:0});
  const url=new URL(calls.at(-1).path,'https://repaido.test');assert.equal(url.searchParams.get('query'),'wiring & testing');assert.equal(url.searchParams.get('sector'),'Education');assert.equal(url.searchParams.get('trade'),'electrician');assert.equal(url.searchParams.get('limit'),'30');assert.equal(url.searchParams.get('experience'),'0');
});
test('profile updates invalidate work matches; work mutations emit one coherent update',async()=>{
  await service.workJobs('a');let updates=0;window.addEventListener('repaidians:work-update',()=>updates++);
  window.dispatchEvent(new Event('repaidians:update'));assert.equal(service.peekWorkJobs('a'),null);assert.equal(updates,1);
  await service.workJobs('a');transport=async()=>({preferences:{sharePlacements:true}});await service.updateWorkPreferences({sharePlacements:true});assert.equal(service.peekWorkJobs('a'),null);assert.equal(updates,2);
});
test('offer responses and withdrawals carry optimistic concurrency guards',async()=>{
  await service.respondToWorkOffer('project/one',8,'offer-one','accept');assert.equal(calls[0].path,'/contractor/projects/project%2Fone/commands');assert.deepEqual(JSON.parse(calls[0].init.body),{expected_version:8,action:'accept',target_id:'offer-one'});
  await service.withdrawWorkApplication('application-one',4);assert.deepEqual(JSON.parse(calls[1].init.body),{expected_version:4});
  await service.workApplication('a','old/application',true);assert.equal(calls[2].path,'/contractor/hiring/applications/old%2Fapplication');
});
test('a discovery target refreshes the exact job and preserves an unavailable response',async()=>{
  transport=async()=>({id:'project/one',title:'Electrical work'});
  assert.equal((await service.workJob('a','project/one')).title,'Electrical work');
  transport=async()=>{throw Error('This job is no longer available.');};
  await assert.rejects(service.workJob('a','project/one',true),/no longer available/);
  assert.deepEqual(calls.map(call=>call.path),['/work/jobs/project%2Fone','/work/jobs/project%2Fone']);
});
