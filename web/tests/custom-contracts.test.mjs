import {feedbackImports} from './feedback-module.mjs';
import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createReadCache} from '../src/services/readCache.mjs';

const source=await readFile(new URL('../src/services/customContractsService.ts',import.meta.url),'utf8');
let executable=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
executable=feedbackImports(executable);
for(const [dependency,injected] of [['../firebase','const auth=globalThis.__contractAuth;'],['./api','const apiFetch=globalThis.__contractFetch;'],['./readCache.mjs','const createReadCache=globalThis.__contractCache;'],['./deviceLocation.mjs','const readDeviceLocation=globalThis.__contractLocation;']]){
  const pattern=new RegExp(`^import .+ from ['"]${dependency.replaceAll('.','\\.')}['"];?$`,'m');assert.match(executable,pattern);executable=executable.replace(pattern,injected);
}
let service,calls,transport,values,revision=0;
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {resolve,promise};};
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
beforeEach(async()=>{
  calls=[];values=new Map([['repaido.token','session-a']]);globalThis.localStorage={getItem:key=>values.get(key)||null};globalThis.window=new EventTarget();
  globalThis.__contractAuth={currentUser:null,authStateReady:async()=>{}};globalThis.__contractCache=createReadCache;globalThis.__contractLocation=()=>{throw Error('Location must be explicitly requested.');};
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
