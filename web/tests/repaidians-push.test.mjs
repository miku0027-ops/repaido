import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const source=await readFile(new URL('../src/services/repaidiansPushService.ts',import.meta.url),'utf8');
let executable=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
executable=executable.replace(/^import \{ onAuthStateChanged \} from ['"]firebase\/auth['"];?$/m,'const onAuthStateChanged=globalThis.__pushOnAuth;');
executable=executable.replace(/^import \{ app, auth \} from ['"]\.\.\/firebase['"];?$/m,'const app={},auth=globalThis.__pushAuth;');
executable=executable.replace(/^import \{ apiFetch \} from ['"]\.\/api['"];?$/m,'const apiFetch=globalThis.__pushApi;');
executable=executable.replaceAll(/import\(['"]firebase\/messaging['"]\)/g,'Promise.resolve(globalThis.__pushMessaging)').replaceAll('import.meta.env.VITE_FIREBASE_VAPID_KEY','globalThis.__pushVapid');
executable='const navigator=globalThis.__pushNavigator;\n'+executable;
let service,revision=0,calls,permissions,deleted,tokens,values,session,apiImpl,messagingImpl,callbacks;
const token='fixture-push-token-1234567890',deviceId='a'.repeat(64);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
async function reload(){return import('data:text/javascript;base64,'+Buffer.from(executable).toString('base64')+'#'+(++revision));}
const user=id=>({uid:id,getIdToken:async()=>'verified-'+id});
beforeEach(async()=>{
  calls=[];permissions=0;deleted=0;tokens=0;values=new Map();session=new Map();callbacks=[];
  globalThis.window=new EventTarget();window.isSecureContext=true;window.PushManager=function(){};
  globalThis.Notification=class{static permission='default';static async requestPermission(){permissions++;this.permission='granted';return 'granted';}};window.Notification=Notification;
  globalThis.localStorage={getItem:key=>values.get(key)||null};globalThis.sessionStorage={getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,value),removeItem:key=>session.delete(key)};
  globalThis.__pushAuth={currentUser:user('account-a'),authStateReady:async()=>{}};globalThis.__pushOnAuth=(_auth,fn)=>callbacks.push(fn);
  const registration={active:{state:'activated',postMessage:(_message,ports)=>ports[0].postMessage({ok:true})}};globalThis.__pushNavigator={serviceWorker:{register:async()=>registration,getRegistration:async()=>registration}};window.serviceWorker=__pushNavigator.serviceWorker;
  globalThis.__pushMessaging={isSupported:async()=>true,getMessaging:()=>({}),getToken:async()=>{tokens++;return messagingImpl?messagingImpl():token;},deleteToken:async()=>{deleted++;}};
  apiImpl=async()=>new Response(JSON.stringify({id:deviceId,user_id:__pushAuth.currentUser?.uid}),{status:200,headers:{'Content-Type':'application/json'}});
  globalThis.__pushApi=async(path,init)=>{calls.push({path,init});return apiImpl(path,init);};service=await reload();
});

test('support checks never prompt for permission or register a device',async()=>{
  const status=await service.workPushStatus();assert.equal(status.supported,true);assert.equal(status.enabled,false);assert.equal(permissions,0);assert.equal(tokens,0);assert.equal(calls.length,0);
});
test('explicit enable registers verified device; metadata never stores bearer or push token',async()=>{
  const status=await service.enableWorkPush();assert.equal(status.enabled,true);assert.equal(permissions,1);assert.equal(tokens,1);
  assert.equal(calls[0].path,'/api/operations/devices');assert.equal(calls[0].init.headers.Authorization,'Bearer verified-account-a');assert.deepEqual(JSON.parse(calls[0].init.body),{token,platform:'web',audience:'customer',promotional_capable:false});
  const metadata=session.get('repaidians.work-push.registration');assert.ok(metadata);assert.doesNotMatch(metadata,/fixture-push|verified-account-a|account-a/);assert.deepEqual(Object.keys(JSON.parse(metadata)).sort(),['account','deviceId','recipientFingerprint']);
  const disabled=await service.disableWorkPush();assert.equal(disabled.enabled,false);assert.equal(calls[1].path,'/api/operations/devices/'+deviceId);assert.equal(calls[1].init.method,'DELETE');assert.equal(deleted,1);assert.equal(session.size,0);
});
test('a token resolving after an account switch cannot register with the wrong bearer',async()=>{
  Notification.permission='granted';const pending=deferred(),started=deferred();__pushAuth.currentUser={uid:'account-a',getIdToken:()=>{started.resolve();return pending.promise;}};const enabling=service.enableWorkPush();await started.promise;
  __pushAuth.currentUser=user('account-b');pending.resolve('verified-account-a');await assert.rejects(enabling,/account changed/);assert.equal(calls.length,0);assert.equal(tokens,0);
});
test('old account retirement completes before a new browser subscription is registered',async()=>{
  await service.enableWorkPush();const retiring=deferred();apiImpl=async(path)=>path.endsWith(deviceId)?retiring.promise:new Response(JSON.stringify({id:deviceId,user_id:__pushAuth.currentUser?.uid}),{status:200});
  __pushAuth.currentUser=user('account-b');const cleanup=service.syncWorkPushAccount();await tick();const enabling=service.enableWorkPush();await tick();assert.equal(tokens,1,'New subscription waits for old deletion');
  retiring.resolve(new Response('{}',{status:200}));await cleanup;await enabling;assert.equal(calls[1].init.headers.Authorization,'Bearer verified-account-a');assert.equal(calls.at(-1).init.headers.Authorization,'Bearer verified-account-b');assert.equal(tokens,2);assert.equal(deleted,1);
});
test('reload restores same-account registration with a fresh verified bearer',async()=>{
  await service.enableWorkPush();__pushAuth.currentUser={uid:'account-a',getIdToken:async()=>'refreshed-account-a'};const restored=await reload();assert.equal((await restored.workPushStatus()).enabled,true);assert.equal(permissions,1);assert.equal(tokens,1);
  await restored.disableWorkPush();assert.equal(calls.at(-1).init.headers.Authorization,'Bearer refreshed-account-a');assert.equal(session.size,0);
});
test('reload into a different account retires the old subscription without an unauthorized device delete',async()=>{
  await service.enableWorkPush();calls=[];__pushAuth.currentUser=user('account-b');const restored=await reload();const status=await restored.workPushStatus();assert.equal(status.enabled,false);assert.equal(deleted,1);assert.equal(session.size,0);assert.equal(calls.length,0);assert.equal(permissions,1);
});

test('push worker filters recipient after restart/signout and opens only the local destination',async()=>{
  const worker=await readFile(new URL('../public/repaidians-work-push-sw.js',import.meta.url),'utf8'),records=new Map(),shown=[],navigated=[];let waits=[],handlers={};
  const database={createObjectStore(){},close(){},transaction(){const tx={};tx.objectStore=()=>({put(value,key){const request={};queueMicrotask(()=>{records.set(key,value);request.onsuccess?.();tx.oncomplete?.();});return request;},get(key){const request={};queueMicrotask(()=>{request.result=records.get(key);request.onsuccess?.();tx.oncomplete?.();});return request;}});return tx;}};
  const indexedDB={open(){const request={result:database};queueMicrotask(()=>{request.onupgradeneeded?.();request.onsuccess?.();});return request;}};
  const self={location:{origin:'https://repaido.test'},addEventListener:(name,handler)=>handlers[name]=handler,skipWaiting:()=>{},registration:{showNotification:async(title,options)=>shown.push({title,options})},clients:{claim:async()=>{},matchAll:async()=>[{url:'https://repaido.test/',navigate:async url=>navigated.push(url),focus:async()=>{}}],openWindow:async url=>navigated.push(url)}};
  const restart=()=>runInNewContext(worker,{self,URL,Date,indexedDB,crypto,TextEncoder,Uint8Array});restart();
  const send=data=>handlers.push({data:{json:()=>data},waitUntil:promise=>waits.push(promise)});
  const setAccount=async fingerprint=>{waits=[];handlers.message({data:{type:'repaidians-work-push-account',fingerprint},source:{url:'https://repaido.test/'},ports:[{postMessage:message=>assert.equal(message.ok,true)}],waitUntil:promise=>waits.push(promise)});await Promise.all(waits);};
  send({data:{destination:'other'}});send({data:{destination:'repaidians',recipient_id:'account-a',expires_at:'1'}});send({data:{destination:'repaidians',recipient_id:'account-a'}});await Promise.all(waits);assert.equal(shown.length,0);
  const fingerprint=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('account-a'))).toString('hex');await setAccount(fingerprint);
  waits=[];send({data:{destination:'repaidians',recipient_id:'account-b'}});await Promise.all(waits);assert.equal(shown.length,0,'Wrong recipient cannot notify this account');
  const valid={data:{destination:'repaidians',recipient_id:'account-a',notification_id:'notice-one',url:'https://attacker.test/',salary:'private'}};
  waits=[];send(valid);await Promise.all(waits);assert.equal(shown.length,1);assert.equal(shown[0].options.data.url,'/?repaidians&community=notifications');assert.doesNotMatch(JSON.stringify(shown),/attacker|private|salary/);
  handlers={};restart();waits=[];send(valid);await Promise.all(waits);assert.equal(shown.length,2,'Hashed scope survives a worker restart');
  await setAccount(null);waits=[];send(valid);await Promise.all(waits);assert.equal(shown.length,2,'Queued pushes after signout are suppressed');
  waits=[];handlers.notificationclick({notification:{close(){}},waitUntil:promise=>waits.push(promise)});await Promise.all(waits);assert.deepEqual(navigated,['https://repaido.test/?repaidians&community=notifications']);
  assert.deepEqual([...records.values()],[null],'Only account hash or cleared scope is persisted');
});
