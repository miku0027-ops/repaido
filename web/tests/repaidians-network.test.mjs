import {feedbackImports} from './feedback-module.mjs';
import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createReadCache} from '../src/services/readCache.mjs';

const source=await readFile(new URL('../src/services/repaidiansNetworkService.ts',import.meta.url),'utf8');
let executable=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
executable=feedbackImports(executable);
for(const [dependency,injected] of [['../firebase','const auth=globalThis.__networkAuth;'],['./repaidiansService','class CommunityError extends Error {constructor(message,status,code=""){super(message);this.status=status;this.code=code;}}'],['./readCache.mjs','const createReadCache=globalThis.__networkCache;']]){
  const pattern=new RegExp(`^import .+ from ['"]${dependency.replaceAll('.','\\.')}['"];?$`,'m');assert.match(executable,pattern);executable=executable.replace(pattern,injected);
}
let service,revision=0,calls,values,transport,now;
beforeEach(async()=>{
  now=0;calls=[];values=new Map([['repaido.token','session-a']]);globalThis.localStorage={getItem:key=>values.get(key)||null};globalThis.window=new EventTarget();
  globalThis.__networkAuth={currentUser:null,authStateReady:async()=>{}};globalThis.__networkCache=options=>createReadCache({...options,now:()=>now});
  transport=async()=>({profile:{id:'profile-a'}});globalThis.fetch=async(url,init)=>{calls.push({url,init});const result=await transport(url,init);return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});};
  service=await import('data:text/javascript;base64,'+Buffer.from(executable).toString('base64')+'#'+(++revision));
});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};

test('network records coalesce in bounded memory and one cancelled observer does not cancel others',async()=>{
  const pending=deferred();transport=()=>pending.promise;const controller=new AbortController();
  const first=service.networkRead('/network/connections',false,controller.signal),second=service.networkRead('/network/connections');await tick();assert.equal(calls.length,1);
  controller.abort();await assert.rejects(first,error=>error.name==='AbortError');pending.resolve({items:[{id:'real-connection'}]});assert.equal((await second).items[0].id,'real-connection');
  await service.networkRead('/network/connections');assert.equal(calls.length,1);now=60001;assert.equal(service.peekNetworkRead('/network/connections'),null);
});
test('account switches retire cached profiles and reject late private network results',async()=>{
  const pending=deferred();transport=()=>pending.promise;const old=service.networkRead('/network/connections');await tick();
  values.set('repaido.token','session-b');transport=async()=>({items:[{id:'b-only'}]});await service.networkRead('/network/connections');
  pending.resolve({items:[{id:'a-private'}]});await assert.rejects(old,error=>error.code==='ACCOUNT_CHANGED');assert.equal(service.peekNetworkRead('/network/connections').items[0].id,'b-only');
  assert.equal(calls[0].init.headers.get('Authorization'),'Bearer session-a');assert.equal(calls[1].init.headers.get('Authorization'),'Bearer session-b');
});
test('a token resolving after switching Firebase users cannot send a professional mutation',async()=>{
  const token=deferred();globalThis.__networkAuth.currentUser={uid:'a',getIdToken:()=>token.promise};
  const mutation=service.networkMutation('/network/profile','PUT',{experience:[]});await tick();globalThis.__networkAuth.currentUser={uid:'b',getIdToken:async()=>'b-token'};
  token.resolve('a-token');await assert.rejects(mutation,error=>error.code==='ACCOUNT_CHANGED');assert.equal(calls.length,0);
});
test('retries retain one server command ID, versions are preserved, and updates emit only after confirmation',async()=>{
  let updates=0;window.addEventListener('repaidians:network-update',()=>updates++);transport=async()=>{throw Error('offline');};
  await assert.rejects(service.networkCommand('/network/connections/person-one',{action:'accept',expectedVersion:3}),/offline/);assert.equal(updates,0);
  const first=JSON.parse(calls[0].init.body);transport=async()=>({status:'connected',version:4});
  const confirmed=await service.networkCommand('/network/connections/person-one',{action:'accept',expectedVersion:3});const second=JSON.parse(calls[1].init.body);
  assert.equal(first.clientId,second.clientId);assert.equal(second.expectedVersion,3);assert.equal(confirmed.status,'connected');assert.equal(updates,1);
});
test('failed responses never become network cache entries and errors retain server authorization reasons',async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify({detail:{message:'Connections are required.',code:'CONNECTION_REQUIRED'}}),{status:403});
  await assert.rejects(service.networkRead('/network/profile/person'),error=>error.status===403&&error.code==='CONNECTION_REQUIRED');assert.equal(service.peekNetworkRead('/network/profile/person'),null);
});
test('anonymous users can read public profiles but cannot send network commands',async()=>{
  values.delete('repaido.token');await service.networkRead('/network/profile/person');assert.equal(calls[0].init.headers.has('Authorization'),false);
  await assert.rejects(service.networkCommand('/network/connections/person',{action:'request'}),error=>error.code==='AUTH_REQUIRED');assert.equal(calls.length,1);
  await assert.rejects(service.networkRead('//external.invalid/path'),/Expected a Repaidians/);assert.equal(calls.length,1);
});
test('typed APIs keep server versions and encode member references; expired privacy sends only a visibility reduction',async()=>{
  await service.updateProfessionalProfile(7,{visibility:'connections'});
  assert.equal(calls[0].url,'/api/repaidians/network/profile');assert.equal(calls[0].init.method,'PATCH');const privacy=JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(privacy).sort(),['clientId','expectedVersion','visibility']);assert.equal(privacy.expectedVersion,7);assert.equal(privacy.visibility,'connections');
  await service.updateConnection('member/one','accept',3);assert.equal(calls[1].url,'/api/repaidians/network/members/member%2Fone/connection');assert.equal(JSON.parse(calls[1].init.body).expectedVersion,3);
  await service.decideRecommendation('recommendation/one','approve',5);assert.equal(calls[2].url,'/api/repaidians/network/recommendations/recommendation%2Fone');assert.equal(calls[2].init.method,'PUT');assert.equal(JSON.parse(calls[2].init.body).expectedVersion,5);
});
