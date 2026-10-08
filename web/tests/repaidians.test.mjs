import {feedbackImports} from './feedback-module.mjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {beforeEach,test} from 'node:test';
import ts from 'typescript';
import {createReadCache} from '../src/services/readCache.mjs';

// These contract tests stub only transport and identity. The browser suite runs
// social behavior against a real isolated SQLite API, with no mock feed.
const source=await readFile(new URL('../src/services/repaidiansService.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
let executable=compiled;
executable=feedbackImports(executable);
for(const [pattern,replacement] of [
  [/^import \{ auth \} from ['"]\.\.\/firebase['"];?$/m,'const auth = globalThis.__communityAuth;'],
  [/^import \{ onAuthStateChanged \} from ['"]firebase\/auth['"];?$/m,'const onAuthStateChanged = globalThis.__communityOnAuthStateChanged;'],
  [/^import \{ createReadCache \} from ['"]\.\/readCache\.mjs['"];?$/m,'const createReadCache = globalThis.__communityReadCache;'],
  [/const cacheNow = \(\) => performance\.now\(\);/,'const cacheNow = () => globalThis.__communityCacheNow();'],
]){
  const injected=executable.replace(pattern,replacement);
  assert.notEqual(injected,executable,'Inject dependencies and the monotonic clock only at their module boundaries.');
  executable=injected;
}
const values=new Map();
let service,revision=0,calls,now,onClockRead;
const ok=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((done,failed)=>{resolve=done;reject=failed;});return {promise,resolve,reject};};
const page=id=>({items:[{id,caption:id,liked:false,saved:false}],members:[],nextCursor:null});
const mediaResponse=(body='private image',headers={})=>new Response(body,{headers:{'Content-Type':'image/jpeg',...headers}});
async function sdkIdentity(user){
  const auth=globalThis.__communityAuth;auth.currentUser=user;
  for(const listener of auth.listeners)queueMicrotask(()=>listener(user));
  await flush();
}
beforeEach(async()=>{
  values.clear();calls=[];now=0;onClockRead=null;
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))};
  globalThis.window=new EventTarget();
  globalThis.__communityAuth={currentUser:null,listeners:new Set(),authStateReady:async()=>{}};
  globalThis.__communityReadCache=createReadCache;
  globalThis.__communityCacheNow=()=>{const callback=onClockRead;onClockRead=null;callback?.();return now;};
  globalThis.__communityOnAuthStateChanged=(auth,listener)=>{
    auth.listeners.add(listener);
    queueMicrotask(()=>{if(auth.listeners.has(listener))listener(auth.currentUser);});
    return()=>auth.listeners.delete(listener);
  };
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
  const firstRejected=assert.rejects(first,error=>error.code==='ACCOUNT_CHANGED');
  const sameRejected=assert.rejects(same,error=>error.code==='ACCOUNT_CHANGED');
  finishA(ok({identity:'a'}));finish(ok({identity:'b'}));
  await firstRejected;await sameRejected;assert.deepEqual(await other,{identity:'b'});
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
  const startsAt=1791290000000,endsAt=startsAt+60*86400000;
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

test('compact metadata is uncached while feed pages keep their original 15-second deadline',async()=>{
  let version=0;
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok(path.includes('/feed?')?page('confirmed-'+(++version)):{unreadCount:version});};
  await service.snapshot('ignored','ignored',true);await service.snapshot('ignored','ignored',true);
  assert.ok(calls.every(call=>call.path==='/api/repaidians/state?content=compact'));
  const first=await service.feed('post','electrician','saved','cursor/a',undefined,20);
  const expiry=service.feedFreshUntil('post','electrician','saved','cursor/a',20);
  assert.equal(expiry,15000);
  now=14000;
  assert.deepEqual(service.peekFeed('post','electrician','saved','cursor/a',20),first);
  assert.equal(await service.feed('post','electrician','saved','cursor/a',undefined,20),first);
  assert.equal(service.feedFreshUntil('post','electrician','saved','cursor/a',20),expiry,'Cache hits do not extend the deadline.');
  assert.equal(calls.length,3);
  now=15000;
  assert.equal(service.peekFeed('post','electrician','saved','cursor/a',20),null);
  assert.equal(service.feedFreshUntil('post','electrician','saved','cursor/a',20),0);
  const current=await service.feed('post','electrician','saved','cursor/a',undefined,20);
  assert.equal(current.items[0].id,'confirmed-2');assert.equal(calls.length,4);
  const query=new URL(calls.at(-1).path,'https://repaido.test');
  assert.deepEqual(Object.fromEntries(query.searchParams),{kind:'post',trade:'electrician',mode:'saved',limit:'20',cursor:'cursor/a'});
});

test('content cache uses all source filters, honors force refresh and evicts the least recently used page',async()=>{
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok(page('response-'+calls.length));};
  const first=await service.feed('post');
  await service.feed('reel');await service.feed('post','civil');await service.feed('post','all','saved');
  await service.feed('post','all','all','next',undefined,20);
  assert.equal(calls.length,5,'Different kinds, trades, modes and native cursor windows do not collide.');
  now=1000;
  const forced=await service.feed('post','all','all','',undefined,12,true);
  assert.notDeepEqual(forced,first);assert.equal(calls.length,6);
  assert.equal(service.feedFreshUntil('post'),16000);
  service.retireCommunityContent();
  for(let index=0;index<48;index++)await service.feed('post','all','all','bounded-'+index);
  assert.ok(service.peekFeed('post','all','all','bounded-0'));
  await service.feed('post','all','all','bounded-new');
  assert.ok(service.peekFeed('post','all','all','bounded-0'),'A peek marks the page as recently used.');
  assert.equal(service.peekFeed('post','all','all','bounded-1'),null,'The least recently used page was evicted at the 48-entry bound.');
});

test('failed content reads retry and profile/publication caches use the same bounded freshness',async()=>{
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return new Response(JSON.stringify({detail:'Temporary outage'}),{status:503});};
  await assert.rejects(service.feed('post'),error=>error.status===503);
  assert.equal(service.peekFeed('post'),null);
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok(path.includes('/members/')?{member:{id:'peer/a'},viewerFollowing:true}:{item:{id:'post/a',liked:true}});};
  const profile=await service.memberProfile('peer/a'),publication=await service.publicationDetails('post/a');
  assert.equal(profile.viewerFollowing,true);assert.equal(publication.item.liked,true);
  assert.equal(await service.memberProfile('peer/a'),profile);assert.equal(await service.publicationDetails('post/a'),publication);
  assert.equal(calls.length,3);
  now=15000;
  await service.memberProfile('peer/a');await service.publicationDetails('post/a');
  assert.equal(calls.length,5);
  assert.equal(calls.at(-2).path,'/api/repaidians/members/peer%2Fa');
  assert.equal(calls.at(-1).path,'/api/repaidians/publications/post%2Fa');
  await service.feed('post');assert.equal(calls.length,6,'The failed feed did not become a cached success.');
});

test('aborting one feed observer leaves its shared request and the other observer alive',async()=>{
  const response=deferred(),firstController=new AbortController(),secondController=new AbortController();
  globalThis.fetch=(path,init)=>{calls.push({path,init});return response.promise;};
  const first=service.feed('post','all','all','',firstController.signal);
  const second=service.feed('post','all','all','',secondController.signal);
  const cancelled=assert.rejects(first,error=>error.name==='AbortError');
  await flush();assert.equal(calls.length,1);
  firstController.abort();await cancelled;
  assert.equal(calls[0].init.signal.aborted,false,'Observer cancellation cannot cancel another reader’s transport.');
  response.resolve(ok(page('shared-confirmed')));
  assert.equal((await second).items[0].id,'shared-confirmed');
  assert.equal((await service.feed('post')).items[0].id,'shared-confirmed');assert.equal(calls.length,1);
  const alreadyCancelled=new AbortController();alreadyCancelled.abort();
  await assert.rejects(service.feed('reel','all','all','',alreadyCancelled.signal),error=>error.name==='AbortError');
  assert.equal(calls.length,1);
});

test('successful scoped mutations invalidate old content without reviving pre-mutation requests',async()=>{
  const oldResponse=deferred(),newResponse=deferred(),events=[];let reads=0;
  const stop=service.subscribe(change=>events.push(change));
  globalThis.fetch=(path,init)=>{
    calls.push({path,init});
    if(init.method==='PUT')return Promise.resolve(ok({active:true,likeCount:8}));
    return ++reads===1?oldResponse.promise:newResponse.promise;
  };
  const old=service.feed('post'),oldRejected=assert.rejects(old,error=>error.code==='CONTENT_CHANGED');
  await flush();
  assert.deepEqual(await service.toggleActivity('ignored','likes','post/a',true),{active:true,likeCount:8});
  assert.deepEqual(events,[{path:'/activity/likes/post%2Fa',contentChanged:false}]);
  const current=service.feed('post');await flush();assert.equal(calls.length,3,'The new read does not join the old transport.');
  oldResponse.resolve(ok(page('old-before-like')));await oldRejected;
  newResponse.resolve(ok({...page('confirmed-after-like'),items:[{id:'post/a',liked:true,likeCount:8}]}));
  const canonical=await current;
  assert.equal(canonical.items[0].likeCount,8);assert.equal(service.peekFeed('post'),canonical);
  stop();
});

test('a mutation between a warm cache hit and its settlement rejects the obsolete snapshot',async()=>{
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return ok(page('confirmed-'+calls.length));};
  await service.feed('post');
  onClockRead=()=>queueMicrotask(()=>window.dispatchEvent(new Event('repaidians:update')));
  await assert.rejects(service.feed('post'),error=>error.code==='CONTENT_CHANGED');
  assert.equal(calls.length,1,'This race exercises a cache hit, without another transport.');
  assert.equal(service.peekFeed('post'),null);
  assert.equal((await service.feed('post')).items[0].id,'confirmed-2');
});

test('SDK sign-out and re-entry with the same UID clear content/media and never use a stale local credential',async()=>{
  values.set('repaido.token','stale-fallback');let identityChanges=0;
  const stop=service.subscribeCommunityIdentity(()=>identityChanges++);
  globalThis.fetch=async(path,init)=>{
    calls.push({path,init});const credential=new Headers(init.headers).get('Authorization')||'guest';
    return path.startsWith('/api/repaidians/media/')?mediaResponse(credential):ok(page(credential));
  };
  await sdkIdentity({uid:'same-member',getIdToken:async()=>'first-sdk-token'});
  const firstFeed=await service.feed('post'),firstMedia=await service.loadMedia('/api/repaidians/media/avatar');
  assert.equal(firstFeed.items[0].id,'Bearer first-sdk-token');
  await sdkIdentity(null);
  assert.equal(service.communityIdentityKey(),'guest');assert.equal(service.peekFeed('post'),null);
  assert.equal(service.mediaFreshUntil('/api/repaidians/media/avatar'),0);
  await service.snapshot();assert.equal(calls.at(-1).init.headers.get('Authorization'),null);
  const guestMedia=await service.loadMedia('/api/repaidians/media/avatar');assert.equal(await guestMedia.text(),'guest');
  assert.notEqual(guestMedia,firstMedia);
  await sdkIdentity({uid:'same-member',getIdToken:async()=>'second-sdk-token'});
  assert.equal(service.peekFeed('post'),null);
  const current=await service.feed('post'),currentMedia=await service.loadMedia('/api/repaidians/media/avatar');
  assert.equal(current.items[0].id,'Bearer second-sdk-token');assert.equal(await currentMedia.text(),'Bearer second-sdk-token');
  assert.equal(identityChanges,3);assert.ok(calls.every(call=>new Headers(call.init.headers).get('Authorization')!=='Bearer stale-fallback'));
  stop();
});

test('authoritative content access denials retire other cached content and protected media',async()=>{
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return path.includes('/media/')?mediaResponse():ok(page('authorized'));};
  await service.feed('post');await service.loadMedia('/api/repaidians/media/avatar');
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return new Response(JSON.stringify({detail:{code:'PROFILE_PRIVATE',message:'This profile is unavailable.'}}),{status:403});};
  await assert.rejects(service.memberProfile('unavailable'),error=>error.status===403&&error.code==='PROFILE_PRIVATE');
  assert.equal(service.peekFeed('post'),null);assert.equal(service.mediaFreshUntil('/api/repaidians/media/avatar'),0);
});

test('media observers deduplicate downloads, isolate cancellation and retain a fixed 60-second expiry',async()=>{
  const response=deferred(),controller=new AbortController(),url='/api/repaidians/media/shared';
  globalThis.fetch=(path,init)=>{calls.push({path,init});return response.promise;};
  const first=service.loadMedia(url,controller.signal),second=service.loadMedia(url);
  const cancelled=assert.rejects(first,error=>error.name==='AbortError');
  await flush();assert.equal(calls.length,1);controller.abort();await cancelled;
  assert.equal(calls[0].init.signal.aborted,false);
  response.resolve(mediaResponse('server-confirmed image'));
  const blob=await second;assert.equal(await blob.text(),'server-confirmed image');
  assert.equal(service.mediaFreshUntil(url),60000);
  now=59999;assert.equal(await service.loadMedia(url),blob);assert.equal(service.mediaFreshUntil(url),60000);assert.equal(calls.length,1);
  now=60000;assert.equal(service.mediaFreshUntil(url),0);
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return mediaResponse('refreshed image');};
  assert.equal(await(await service.loadMedia(url)).text(),'refreshed image');assert.equal(calls.length,2);
});

test('media cache evicts by LRU entry count and the 32 MiB byte budget',async()=>{
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return mediaResponse('x');};
  for(let index=0;index<64;index++)await service.loadMedia('/api/repaidians/media/small_'+index);
  await service.loadMedia('/api/repaidians/media/small_0');assert.equal(calls.length,64);
  await service.loadMedia('/api/repaidians/media/small_64');
  assert.equal(service.mediaFreshUntil('/api/repaidians/media/small_1'),0);
  assert.equal(service.mediaFreshUntil('/api/repaidians/media/small_0'),60000);
  service.retireCommunityContent();calls=[];
  const eightMiB=new Uint8Array(8*1024*1024);
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return mediaResponse(eightMiB);};
  const large=[];
  for(let index=0;index<5;index++)large.push(await service.loadMedia('/api/repaidians/media/large_'+index));
  assert.equal(service.mediaFreshUntil('/api/repaidians/media/large_0'),0,'Five 8 MiB files cannot remain in a 32 MiB cache.');
  assert.equal(service.mediaFreshUntil('/api/repaidians/media/large_0',large[0]),60000,'An evicted mounted blob retains its original authorization deadline.');
  const retained=await service.loadMedia('/api/repaidians/media/large_1');assert.equal(retained.size,8*1024*1024);assert.equal(calls.length,5);
  await service.loadMedia('/api/repaidians/media/large_0');assert.equal(calls.length,6);
  assert.equal(service.mediaFreshUntil('/api/repaidians/media/large_2'),0,'The budget evicts the least recently used retained file.');
  now=59999;assert.equal(service.mediaFreshUntil('/api/repaidians/media/large_0',large[0]),60000);
  now=60000;assert.equal(service.mediaFreshUntil('/api/repaidians/media/large_0',large[0]),0);
  const current=await service.loadMedia('/api/repaidians/media/large_0');
  assert.equal(service.mediaFreshUntil('/api/repaidians/media/large_0',current),120000);
  service.retireCommunityContent();assert.equal(service.mediaFreshUntil('/api/repaidians/media/large_0',current),0,'Retired authorization cannot be restored by a retained blob reference.');
});

test('a warm media hit cannot settle after its authorization generation has retired',async()=>{
  const url='/api/repaidians/media/avatar';
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return mediaResponse('confirmed-'+calls.length);};
  await service.loadMedia(url);
  onClockRead=()=>queueMicrotask(()=>service.retireCommunityContent());
  await assert.rejects(service.loadMedia(url),error=>error.code==='MEDIA_CHANGED');
  assert.equal(calls.length,1,'This exercises a warm blob lookup without a transport.');
  assert.equal(service.mediaFreshUntil(url),0);
  assert.equal(await(await service.loadMedia(url)).text(),'confirmed-2');
});

test('media failures never cache unsafe bytes and a failed download can retry',async()=>{
  const url='/api/repaidians/media/source';
  for(const response of [
    new Response('offline',{status:503}),
    new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}}),
    mediaResponse('x',{'Content-Length':String(service.MAX_MEDIA_BYTES+1)}),
    mediaResponse(new Uint8Array(service.MAX_MEDIA_BYTES+1)),
  ]){
    globalThis.fetch=async(path,init)=>{calls.push({path,init});return response;};
    await assert.rejects(service.loadMedia(url),error=>error.status>=400);
    assert.equal(service.mediaFreshUntil(url),0);
  }
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return mediaResponse('confirmed image');};
  assert.equal(await(await service.loadMedia(url)).text(),'confirmed image');assert.equal(calls.length,5);
  const controller=new AbortController();controller.abort();
  await assert.rejects(service.loadMedia('/api/repaidians/media/not-started',controller.signal),error=>error.name==='AbortError');
  assert.equal(calls.length,5);
});

test('identity changes and media retirement reject late private downloads without repopulating the cache',async()=>{
  const url='/api/repaidians/media/private',oldResponse=deferred();
  values.set('repaido.token','owner-a');
  globalThis.fetch=(path,init)=>{calls.push({path,init});return oldResponse.promise;};
  const old=service.loadMedia(url),rejected=assert.rejects(old,error=>error.code==='ACCOUNT_CHANGED');
  await flush();values.set('repaido.token','owner-b');
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return mediaResponse('owner-b confirmed');};
  const current=await service.loadMedia(url);oldResponse.resolve(mediaResponse('owner-a private'));await rejected;
  assert.equal(await current.text(),'owner-b confirmed');assert.equal(await service.loadMedia(url),current);assert.equal(calls.length,2);
  service.retireCommunityContent();const obsoleteResponse=deferred();
  globalThis.fetch=(path,init)=>{calls.push({path,init});return obsoleteResponse.promise;};
  const obsolete=service.loadMedia(url),retired=assert.rejects(obsolete,error=>error.code==='MEDIA_CHANGED');
  await flush();service.retireCommunityContent();obsoleteResponse.resolve(mediaResponse('retired private bytes'));await retired;
  assert.equal(service.mediaFreshUntil(url),0);
});

test('a denied media source leaves a separately authorized fresh avatar available',async()=>{
  const privateUrl='/api/repaidians/media/private',avatarUrl='/api/repaidians/media/avatar';
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return mediaResponse(path);};
  await service.loadMedia(privateUrl);now=50000;const avatar=await service.loadMedia(avatarUrl);
  now=60000;
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return new Response('withdrawn',{status:403});};
  await assert.rejects(service.loadMedia(privateUrl),error=>error.status===403);
  assert.equal(service.mediaFreshUntil(privateUrl),0);
  assert.equal(await service.loadMedia(avatarUrl),avatar);assert.equal(calls.length,3,'One denied source does not cause a global media retry loop.');
});

test('a late denial from an old media generation cannot evict the current authorized source',async()=>{
  const url='/api/repaidians/media/reviewed-avatar',oldResponse=deferred();
  globalThis.fetch=(path,init)=>{calls.push({path,init});return oldResponse.promise;};
  const old=service.loadMedia(url),retired=assert.rejects(old,error=>error.code==='MEDIA_CHANGED');
  await flush();service.retireCommunityContent();
  globalThis.fetch=async(path,init)=>{calls.push({path,init});return mediaResponse('currently authorized');};
  const current=await service.loadMedia(url);
  oldResponse.resolve(new Response('old access denied',{status:403}));await retired;
  assert.equal(await service.loadMedia(url),current);assert.equal(calls.length,2);
  assert.equal(service.mediaFreshUntil(url,current),60000);
});
