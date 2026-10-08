import {feedbackImports} from './feedback-module.mjs';
import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createReadCache} from '../src/services/readCache.mjs';
import {createContractWatcher} from '../src/services/contractLive.mjs';

const source=await readFile(new URL('../src/services/customContractsService.ts',import.meta.url),'utf8');
let executable=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
executable=feedbackImports(executable);
for(const [dependency,injected] of [['../firebase','const auth=globalThis.__contractAuth;'],['./api','const apiFetch=globalThis.__contractFetch;'],['./readCache.mjs','const createReadCache=globalThis.__contractCache;'],['./deviceLocation.mjs','const readDeviceLocation=globalThis.__contractLocation;'],['./contractLive.mjs','const createContractWatcher=globalThis.__contractWatcher;']]){
  const pattern=new RegExp(`^import .+ from ['"]${dependency.replaceAll('.','\\.')}['"];?$`,'m');assert.match(executable,pattern);executable=executable.replace(pattern,injected);
}
let service,calls,transport,values,revision=0;
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {resolve,promise};};
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
beforeEach(async()=>{
  calls=[];values=new Map([['repaido.token','session-a']]);globalThis.localStorage={getItem:key=>values.get(key)||null};globalThis.window=new EventTarget();
  globalThis.__contractAuth={currentUser:null,authStateReady:async()=>{}};globalThis.__contractCache=createReadCache;globalThis.__contractWatcher=createContractWatcher;globalThis.__contractLocation=()=>{throw Error('Location must be explicitly requested.');};
  transport=async()=>response({items:[],nextCursor:null});globalThis.__contractFetch=async(path,init)=>{calls.push({path,init});return transport(path,init);};
  service=await import('data:text/javascript;base64,'+Buffer.from(executable).toString('base64')+'#'+(++revision));
});

test('private contract reads coalesce but late results cannot cross accounts',async()=>{
  const pending=deferred();transport=()=>pending.promise;const first=service.customContractQueries('mine'),second=service.customContractQueries('mine');await tick();assert.equal(calls.length,1);
  values.set('repaido.token','session-b');transport=async()=>response({items:[{id:'b-only'}]});assert.equal((await service.customContractQueries('mine')).items[0].id,'b-only');
  pending.resolve(response({items:[{id:'a-private'}]}));await assert.rejects(first,/account changed/i);await assert.rejects(second,/account changed/i);
  assert.equal((await service.customContractQueries('mine')).items[0].id,'b-only');
});
test('an account switch while a Firebase bearer resolves sends no old credential',async()=>{
  const pending=deferred();globalThis.__contractAuth.currentUser={uid:'a',getIdToken:()=>pending.promise};const read=service.customContractDetails('private-query');await tick();
  globalThis.__contractAuth.currentUser={uid:'b',getIdToken:async()=> 'b-token'};pending.resolve('a-token');await assert.rejects(read,/account changed/i);assert.equal(calls.length,0);
});
test('failed award commands retain their retry identity and only notify after success',async()=>{
  let updates=0;window.addEventListener('repaido:custom-contracts-updated',()=>updates++);transport=async()=>response({detail:{code:'STALE_VERSION',message:'Refresh the saved proposal.'}},409);
  await assert.rejects(service.customContractCommand('query/one',3,'award',{bid_id:'proposal-real'}),error=>error.status===409&&error.code==='STALE_VERSION');assert.equal(updates,0);
  const old=JSON.parse(calls[0].init.body);transport=async()=>response({query:{id:'query/one'}});await service.customContractCommand('query/one',3,'award',{bid_id:'proposal-real'});
  assert.equal(JSON.parse(calls[1].init.body).request_id,old.request_id);assert.equal(old.expected_version,3);assert.equal(calls[1].path,'/api/operations/custom-contracts/queries/query%2Fone/commands');assert.equal(updates,1);
});
test('external document paths and unexpected PDF content never become private downloads',async()=>{
  await assert.rejects(service.privateContractBlob('https://outside.test/report.pdf','pdf'),/authorized local/);await assert.rejects(service.privateContractBlob('/contracts/../other','pdf'),/authorized local/);assert.equal(calls.length,0);
  transport=async()=>new Response('<html>Login</html>',{headers:{'Content-Type':'text/html'}});await assert.rejects(service.privateContractBlob('/contracts/projects/real/report.pdf','pdf'),/expected contract document/);
  transport=async()=>new Response('%PDF-1.7\nreal report',{headers:{'Content-Type':'application/pdf'}});const blob=await service.privateContractBlob('/api/operations/contracts/projects/real/report.pdf','pdf');assert.equal(blob.type,'application/pdf');
});
test('contract monetary inputs use integer paise and reject ambiguous precision',()=>{
  assert.equal(service.rupeesToPaise('1025.07'),102507);assert.equal(service.rupeesToPaise('0.01'),1);
  for(const bad of ['1.001','1e5','-10','50,000','500000001'])assert.throws(()=>service.rupeesToPaise(bad));
});


test('already-aborted contract observers start no transport and an active observer can retry',async()=>{
  const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(service.customContractDetails('private-query',false,cancelled.signal),error=>error.name==='AbortError');
  assert.equal(calls.length,0);
  transport=async()=>response({query:{id:'private-query',version:1}});
  assert.equal((await service.customContractDetails('private-query')).query.version,1);
  assert.equal(calls.length,1);
});
test('aborting during token resolution retires the observer before transport; later rejected reads remain handled and retry',async()=>{
  const token=deferred(),cancelled=new AbortController();globalThis.__contractAuth.currentUser={uid:'a',getIdToken:()=>token.promise};
  const abandoned=service.customContractDetails('private-query',false,cancelled.signal);await tick();cancelled.abort();token.resolve('a-token');
  await assert.rejects(abandoned,error=>error.name==='AbortError');assert.equal(calls.length,0);
  globalThis.__contractAuth.currentUser={uid:'a',getIdToken:async()=> 'a-token'};
  const pending=deferred();transport=()=>pending.promise;const observer=new AbortController();
  const late=service.customContractDetails('private-query',false,observer.signal);await tick();observer.abort();
  await assert.rejects(late,error=>error.name==='AbortError');
  pending.resolve(response({detail:{code:'NOT_FOUND',message:'This contract is private.'}},403));await tick();
  transport=async()=>response({query:{id:'private-query',version:2}});
  assert.equal((await service.customContractDetails('private-query')).query.version,2);
});

function liveClock(){let next=0;const pending=new Map();return {schedule(task,delay){const id=++next;pending.set(id,{task,delay});return id;},cancel(id){pending.delete(id);},async run(){const [id,value]=pending.entries().next().value;pending.delete(id);await value.task();},get size(){return pending.size;},get delay(){return pending.values().next().value?.delay;}};}
test('live checks refresh the first snapshot and every saved revision without overlapping',async()=>{
  const clock=liveClock(),states=[],seen=[];let revision='one',calls=0;
  const watcher=createContractWatcher({...clock,read:async()=>{calls++;return {revision};},onChange:()=>seen.push(revision),onState:state=>states.push(state)});
  watcher.start();watcher.start();assert.equal(clock.size,1);await clock.run();assert.deepEqual(seen,['one']);
  await clock.run();assert.equal(calls,2);assert.deepEqual(seen,['one']);revision='two';await clock.run();assert.deepEqual(seen,['one','two']);assert.equal(clock.size,1);
  watcher.stop();assert.equal(clock.size,0);assert.equal(states.at(-1),'current');
});
test('hidden tabs pause; returning catches up immediately and retires a pending response',async()=>{
  const clock=liveClock(),states=[];let visible=false,changes=0,read=0;const pending=deferred();
  const watcher=createContractWatcher({...clock,active:()=>visible,read:()=>{read++;return pending.promise;},onChange:()=>changes++,onState:state=>states.push(state)});
  watcher.start();await clock.run();assert.equal(read,0);assert.equal(clock.size,0);assert.equal(states.at(-1),'paused');
  visible=true;watcher.resume();const check=clock.run();await tick();assert.equal(read,1);watcher.stop();pending.resolve({revision:'late'});await check;assert.equal(changes,0);assert.equal(clock.size,0);
});
test('a transient connection failure backs off and recovers authoritative updates',async()=>{
  const clock=liveClock(),states=[];let fail=true,changes=0;
  const watcher=createContractWatcher({...clock,read:async()=>{if(fail)throw Error('offline');return {revision:'saved'};},onChange:()=>changes++,onState:state=>states.push(state)});
  watcher.start();await clock.run();assert.equal(states.at(-1),'reconnecting');assert.equal(clock.delay,5000);fail=false;watcher.resume();assert.equal(clock.delay,0);await clock.run();assert.equal(states.at(-1),'current');assert.equal(changes,1);assert.equal(clock.delay,2500);watcher.stop();
});
test('revoked contract access invalidates the detail once and stops the update channel',async()=>{
  const clock=liveClock(),states=[];let changes=0;
  const watcher=createContractWatcher({...clock,read:async()=>{throw Object.assign(Error('private'),{status:403});},onChange:()=>changes++,onState:state=>states.push(state)});
  watcher.start();await clock.run();assert.equal(states.at(-1),'unavailable');assert.equal(changes,1);assert.equal(clock.size,0);watcher.resume();assert.equal(clock.size,0);
});
test('detail and comment listeners share one account-scoped watcher and clean up together',async()=>{
  const clock=liveClock();globalThis.document=Object.assign(new EventTarget(),{hidden:false});Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
  globalThis.__contractWatcher=options=>createContractWatcher({...options,...clock});
  service=await import('data:text/javascript;base64,'+Buffer.from(executable).toString('base64')+'#'+(++revision));
  transport=async()=>response({revision:'one'});let updated=0;window.addEventListener('repaido:custom-contracts-updated',()=>updated++);
  const first=service.watchCustomContract('q',()=>{}),second=service.watchCustomContract('q',()=>{});
  assert.equal(clock.size,1);await clock.run();assert.equal(calls.length,1);assert.equal(updated,1);
  first();assert.equal(clock.size,1);values.set('repaido.token','other-account');await clock.run();assert.equal(calls.length,1);assert.equal(updated,1);second();assert.equal(clock.size,0);
});
