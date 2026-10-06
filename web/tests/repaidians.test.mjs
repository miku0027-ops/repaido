import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {beforeEach,test} from 'node:test';
import ts from 'typescript';

// These contract tests stub only transport and identity. The browser suite runs
// social behavior against a real isolated SQLite API, with no mock feed.
const source=await readFile(new URL('../src/services/repaidiansService.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const executable=compiled.replace(/^import \{ auth \} from ['"]\.\.\/firebase['"];?$/m,'const auth = globalThis.__communityAuth;');
assert.notEqual(executable,compiled,'Inject the test Firebase identity at the module boundary.');
const values=new Map();
let service,revision=0,calls;
const ok=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
beforeEach(async()=>{
  values.clear();calls=[];
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))};
  globalThis.window=new EventTarget();
  globalThis.__communityAuth={currentUser:null,authStateReady:async()=>{}};
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok({});};
  service=await import('data:text/javascript;base64,'+Buffer.from(executable).toString('base64')+'#'+(++revision));
});

test('API identity comes from the verified session, never a caller supplied account',async()=>{
  values.set('repaido.token','local-test-session');
  await service.snapshot('another-users-id','Impersonation attempt');
  assert.equal(calls[0].path,'/api/repaidians/state');
  assert.equal(calls[0].init.headers.get('Authorization'),'Bearer local-test-session');
  assert.equal(calls[0].init.credentials,'same-origin');
  assert.equal(calls[0].init.body,undefined);
  globalThis.__communityAuth.currentUser={uid:'firebase-member',getIdToken:async()=>'fresh-firebase-token'};
  await service.snapshot('guest');
  assert.equal(calls[1].init.headers.get('Authorization'),'Bearer fresh-firebase-token');
  assert.equal('activateMockPro' in service,false,'No browser entitlement activation remains.');
  assert.deepEqual([...values.keys()],['repaido.token']);
});

test('requests never forward session credentials to external API paths',async()=>{
  for(const path of ['https://other.example/state','//other.example/state','/feed?target=https://other.example'])
    await assert.rejects(service.communityRequest(path),/Expected a Repaidians API path/);
  assert.equal(calls.length,0);
  await service.searchMembers('name & role/cleaning');
  assert.equal(calls[0].path,'/api/repaidians/members?search=name%20%26%20role%2Fcleaning&limit=20');
});

test('in-flight reads deduplicate within an identity and remain isolated across accounts',async()=>{
  let finish,started;
  const fetching=new Promise(resolve=>{started=resolve;});
  globalThis.fetch=(path,init)=>{calls.push({path,init});started();return new Promise(resolve=>{finish=resolve;});};
  values.set('repaido.token','account-a');
  const first=service.snapshot();await fetching;
  const same=service.snapshot();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(calls.length,1);
  const finishA=finish;values.set('repaido.token','account-b');
  const other=service.snapshot();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(calls.length,2);
  finishA(ok({identity:'a'}));finish(ok({identity:'b'}));
  assert.deepEqual(await first,{identity:'a'});assert.deepEqual(await same,{identity:'a'});assert.deepEqual(await other,{identity:'b'});
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok({identity:'b refreshed'});};
  assert.deepEqual(await service.snapshot(),{identity:'b refreshed'});
  assert.equal(calls.length,3,'Resolved reads do not serve indefinitely stale data.');
});

test('server authorization errors survive transport and failed reads can retry',async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify({detail:{code:'PRO_REQUIRED',message:'Subscribe before publishing.'}}),{status:403});
  await assert.rejects(service.snapshot(),error=>error instanceof service.CommunityError&&error.status===403&&error.code==='PRO_REQUIRED'&&error.message==='Subscribe before publishing.');
  globalThis.fetch=async()=>ok({remainingMs:75000});
  assert.deepEqual(await service.snapshot(),{remainingMs:75000});
  globalThis.fetch=async()=>new Response('Unavailable',{status:503});
  await assert.rejects(service.snapshot(),error=>error.status===503&&/retry/i.test(error.message));
});

test('trial metadata stays server-owned and expired-trial errors do not mint browser access',async()=>{
  const startsAt=1791290000000,endsAt=startsAt+30*86400000;
  const subscription={plan:'trial',provider:'trial',amountPaise:0,startsAt,endsAt};
  const trial={startsAt,endsAt,status:'active'};
  values.set('repaido.token','trial-account');
  values.set('repaidians.v1.subscription.guest',JSON.stringify({plan:'demo-pro',provider:'mock',endsAt:9999999999999}));
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok({subscription,trial,remainingMs:900000});};
  const state=await service.snapshot('guest');
  assert.deepEqual(state.subscription,subscription);assert.deepEqual(state.trial,trial);
  assert.deepEqual((await service.subscriptionStatus()).trial,trial);
  assert.deepEqual((await service.chargeBrowsing(true)).subscription,subscription);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body),{active:true},'The browser cannot send a trial start or expiry.');
  const stored=[...values.entries()];
  globalThis.fetch=async()=>new Response(JSON.stringify({detail:{code:'TRIAL_EXPIRED',message:'Your 30-day free trial has ended.'}}),{status:402});
  await assert.rejects(service.snapshot(),error=>error.status===402&&error.code==='TRIAL_EXPIRED');
  await assert.rejects(service.publish('guest',{kind:'post'}),error=>error.status===402&&error.code==='TRIAL_EXPIRED');
  assert.deepEqual([...values.entries()],stored,'An expired trial never becomes a local entitlement.');
  assert.equal('activateTrial' in service,false);assert.equal('activateMockPro' in service,false);
});

test('retried message commands reuse their idempotency key and notify only after server success',async()=>{
  let changes=0;const stop=service.subscribe(()=>changes++);
  globalThis.fetch=async(path,init)=>{calls.push({path,init});throw new TypeError('Connection interrupted');};
  await assert.rejects(service.sendMessage('ignored-owner','recipient/a','  Hello  '),/interrupted/);
  const original=JSON.parse(calls[0].init.body);
  assert.equal(changes,0);assert.equal(original.text,'Hello');assert.ok(original.clientId);
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok({id:'stored-on-server'});};
  await service.sendMessage('ignored-owner','recipient/a','Hello');
  assert.equal(calls[1].path,'/api/repaidians/messages/recipient%2Fa');
  assert.equal(JSON.parse(calls[1].init.body).clientId,original.clientId);assert.equal(changes,1);
  await service.sendMessage('ignored-owner','recipient/a','Hello');
  assert.notEqual(JSON.parse(calls[2].init.body).clientId,original.clientId);
  stop();await service.follow('ignored-owner','member/a',true);assert.equal(changes,2);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body),{active:true});
});

test('uploads validate limits before transport and private media caches are scoped to identity',async()=>{
  await assert.rejects(service.storeMedia([]),/one to four/);
  await assert.rejects(service.storeMedia([new File(['<svg/>'],'unsafe.svg',{type:'image/svg+xml'})]),/8 MB/);
  await assert.rejects(service.storeMedia([new File([new Uint8Array(service.MAX_MEDIA_BYTES+1)],'too-large.jpg',{type:'image/jpeg'})]),/8 MB/);
  assert.equal(calls.length,0);
  values.set('repaido.token','account-a');
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok({id:'private-media',url:'/api/repaidians/media/private-media',kind:'image',alt:''});};
  const file=new File(['image fixture'],'site-photo.jpg',{type:'image/jpeg'});
  const uploaded=await service.storeMedia([file]);
  assert.equal(calls[0].path,'/api/repaidians/media');assert.equal(calls[0].init.body,file);
  assert.equal(calls[0].init.headers.get('Content-Type'),'image/jpeg');assert.equal(uploaded[0].alt,'site-photo');
  assert.deepEqual(Object.keys(uploaded[0]).sort(),['alt','kind','url'],'Only publication media fields are sent back to the server.');
  calls=[];
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return new Response('private image',{headers:{'Content-Type':'image/jpeg'}});};
  const first=await service.loadMedia(uploaded[0].url),second=await service.loadMedia(uploaded[0].url);
  assert.equal(first,second);assert.equal(calls.length,1);
  values.set('repaido.token','account-b');await service.loadMedia(uploaded[0].url);
  assert.equal(calls.length,2);assert.equal(calls[1].init.headers.Authorization,'Bearer account-b');
  assert.equal(await service.loadMedia('https://external.example/private.jpg'),null);assert.equal(calls.length,2);
});
