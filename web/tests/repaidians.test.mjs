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

test('an account switch while resolving a Firebase token never sends the previous credential',async()=>{
  let release,started;
  const entered=new Promise(resolve=>{started=resolve;});
  globalThis.__communityAuth.currentUser={uid:'member-a',getIdToken:()=>{started();return new Promise(resolve=>{release=resolve;});}};
  const pending=service.updatePartialProfile({workStatus:'open_to_work'});
  await entered;
  globalThis.__communityAuth.currentUser={uid:'member-b',getIdToken:async()=>'token-b'};
  release('token-a');
  await assert.rejects(pending,error=>error.code==='ACCOUNT_CHANGED');
  assert.equal(calls.length,0);
  await service.snapshot();
  assert.equal(calls[0].init.headers.get('Authorization'),'Bearer token-b');
});

test('requests never forward session credentials to external API paths',async()=>{
  for(const path of ['https://other.example/state','//other.example/state','/feed?target=https://other.example'])
    await assert.rejects(service.communityRequest(path),/Expected a Repaidians API path/);
  assert.equal(calls.length,0);
  await service.searchMembers('name & role/cleaning');
  const query=new URL(calls[0].path,'https://repaido.test');
  assert.equal(query.pathname,'/api/repaidians/members');assert.equal(query.searchParams.get('search'),'name & role/cleaning');
});

test('professional discovery and native opportunity references preserve server identity and encoded filters',async()=>{
  values.set('repaido.token','professional-session');
  await service.searchMembers('@Alice & crew',undefined,{trade:'electrician',city:'Balasore & coast',workStatus:'open_to_work',professionalType:'specialist'},'prefix/next');
  const people=new URL(calls.at(-1).path,'https://repaido.test');
  assert.deepEqual(Object.fromEntries(people.searchParams),{search:'Alice & crew',limit:'20',trade:'electrician',city:'Balasore & coast',workStatus:'open_to_work',professionalType:'specialist',cursor:'prefix/next'});
  const fields={headline:'Electrical inspections',city:'Balasore',skills:['Wiring'],experienceYears:8,workStatus:'open_to_work',professionalType:'specialist'};
  await service.updateProfile('another-user','Alice','electrician','Agreed electrical scope.',fields);
  assert.equal(calls.at(-1).path,'/api/repaidians/profile');assert.equal(calls.at(-1).init.method,'PATCH');
  assert.deepEqual(JSON.parse(calls.at(-1).init.body),{name:'Alice',trade:'electrician',bio:'Agreed electrical scope.',...fields});
  await service.opportunities({kind:'products',mode:'shareable',city:'Balasore & coast',cursor:'source/next',limit:20});
  const market=new URL(calls.at(-1).path,'https://repaido.test');
  assert.equal(market.pathname,'/api/repaidians/opportunities');
  assert.deepEqual(Object.fromEntries(market.searchParams),{kind:'products',mode:'shareable',city:'Balasore & coast',cursor:'source/next',limit:'20'});
  const reference={source:'inventory',id:'product/a'};
  await service.opportunityDetails(reference);assert.equal(calls.at(-1).path,'/api/repaidians/opportunities/inventory/product%2Fa');
  await service.saveOpportunity(reference,true);assert.equal(calls.at(-1).path,'/api/repaidians/opportunities/inventory/product%2Fa/saved');
  assert.equal(calls.at(-1).init.method,'PUT');assert.deepEqual(JSON.parse(calls.at(-1).init.body),{active:true});
  await service.publish('another-user',{kind:'post',caption:'Purchased through Repaido.',trade:'spares',visibility:'public',media:[],reference});
  const published=JSON.parse(calls.at(-1).init.body);assert.deepEqual(published.reference,reference);assert.equal('ownerId' in published,false);
  assert.ok(published.clientId);assert.equal(calls.at(-1).init.headers.get('Authorization'),'Bearer professional-session');
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

test('profile handles reject spaces before a write and suggest a format without saving it',async()=>{
  assert.match(service.profileHandleError('paramesh electrician'),/cannot contain spaces/);
  assert.equal(service.suggestProfileHandle('paramesh electrician'),'paramesh_electrician');
  assert.equal(calls.length,0,'Suggestions do not rename an account.');
  for(const invalid of ['ab','a'.repeat(31),'_worker','worker/name','worker name'])
    await assert.rejects(service.updateProfile('ignored','Worker Name','electrician','',{handle:invalid}),error=>error.code==='INVALID_HANDLE'&&error.status===422);
  assert.equal(calls.length,0,'Invalid handles cannot partially save other profile fields.');
  assert.equal(service.profileHandleError('a'.repeat(30)),'');
  await service.updateProfile('ignored','Worker Name','electrician','',{handle:' @Worker.Name '});
  assert.equal(JSON.parse(calls[0].init.body).handle,'worker.name');
  await service.updateProfile('ignored','Worker Name','electrician','',{headline:'Updated headline'});
  assert.equal('handle' in JSON.parse(calls[1].init.body),false,'Name-only changes need not rewrite existing handles.');
  globalThis.fetch=async()=>new Response(JSON.stringify({detail:{code:'HANDLE_TAKEN',message:'This handle is already in use. Choose another.'}}),{status:409});
  await assert.rejects(service.updateProfile('ignored','Worker Name','electrician','',{handle:'taken.name'}),error=>error.code==='HANDLE_TAKEN'&&/already in use/.test(error.message));
});

test('server profile handle validation becomes an actionable error',async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify({detail:[{loc:['body','handle'],msg:'String should match pattern',type:'string_pattern_mismatch'}]}),{status:422});
  await assert.rejects(service.communityRequest('/profile',{method:'PATCH',body:JSON.stringify({handle:'worker name'})}),error=>error.code==='INVALID_HANDLE'&&/Spaces are not allowed/.test(error.message)&&!/pattern/.test(error.message));
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
  globalThis.fetch=async()=>new Response(JSON.stringify({detail:{code:'TRIAL_EXPIRED',message:'Your 60-day free trial has ended.'}}),{status:402});
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

test('private conversation pages preserve the selected member and the server cursor',async()=>{
  values.set('repaido.token','signed-professional');
  const thread={id:'peer/a',recipientId:'peer/a',lastMessage:'Confirmed work scope',updatedAt:42};
  const message={id:'server-message',senderId:'peer/a',recipientId:'signed-owner',text:'Confirmed work scope',createdAt:42};
  globalThis.fetch=async(path,init)=>{
    calls.push({path,init});
    return ok(path.includes('/threads')?{threads:[thread],members:[],nextCursor:'older/threads+cursor'}:{messages:[message],members:[],nextCursor:'older/messages+cursor'});
  };
  assert.deepEqual((await service.threadsPage('older/threads+cursor')).threads,[thread]);
  assert.deepEqual((await service.messagesPage(thread.recipientId,'older/messages+cursor')).messages,[message]);
  const inbox=new URL(calls[0].path,'https://repaido.test'),conversation=new URL(calls[1].path,'https://repaido.test');
  assert.equal(inbox.pathname,'/api/repaidians/threads');assert.equal(inbox.searchParams.get('cursor'),'older/threads+cursor');
  assert.equal(conversation.pathname,'/api/repaidians/messages/peer%2Fa');assert.equal(conversation.searchParams.get('cursor'),'older/messages+cursor');
  assert.ok(calls.every(call=>call.init.headers.get('Authorization')==='Bearer signed-professional'));
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
