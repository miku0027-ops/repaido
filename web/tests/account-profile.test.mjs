import {afterEach, beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/services/accountProfileService.ts', import.meta.url), 'utf8');
let executable = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext}}).outputText;
for (const [dependency, replacement] of [['../firebase', 'const auth=globalThis.__accountAuth;'], ['./api', 'const apiFetch=globalThis.__accountFetch;']]) {
  const pattern = new RegExp(`^import .+ from ['"]${dependency.replaceAll('.', '\\.')}['"];?$`, 'm');
  assert.match(executable, pattern);
  executable = executable.replace(pattern, replacement);
}
const linkSource = await readFile(new URL('../src/services/emailVerificationLink.mjs', import.meta.url), 'utf8');
const response = (body, status=200) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json'}});
const profile = (id='account-a', version=1) => ({id, name:'Test member', email:'actual@example.com', email_verified:false, email_required:false, version, verification_status:'unverified', verification:{ready:true, reason:null, next_request_at:0, challenge_id:null, expires_at:null}});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve=done; }); return {promise, resolve}; };
const tick = async () => { for (let index=0; index<12; index++) await Promise.resolve(); };
const bodyAt = index => JSON.parse(calls[index].init.body);
let service, calls, transport, values, revision=0;
const signIn = (uid='account-a', bearer=uid+'-bearer') => { globalThis.__accountAuth.currentUser={uid, getIdToken:async () => bearer}; };

beforeEach(async () => {
  calls=[];
  values=new Map([['repaido.token', 'cached-token-must-not-replace-firebase']]);
  globalThis.localStorage={getItem:key => values.get(key) || null};
  globalThis.window=new EventTarget();
  globalThis.__accountAuth={currentUser:null, authStateReady:async () => {}};
  signIn();
  transport=async () => response(profile());
  globalThis.__accountFetch=async (path, init) => { calls.push({path, init}); return transport(path, init); };
  service=await import('data:text/javascript;base64,'+Buffer.from(executable).toString('base64')+'#'+(++revision));
});
afterEach(async () => { await new Promise(resolve => setTimeout(resolve, 2)); });

test('account requests use the verified Firebase bearer and keep identity out of command bodies', async () => {
  const saved=await service.saveAccountEmail('account-a', ' actual@example.com ', 7);
  assert.equal(saved.id, 'account-a');
  assert.equal(calls[0].path, '/api/account/profile');
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer account-a-bearer');
  assert.deepEqual(Object.keys(bodyAt(0)).sort(), ['email', 'expected_version', 'request_id']);
  assert.equal(bodyAt(0).email, 'actual@example.com');
  assert.equal(bodyAt(0).expected_version, 7);
});

test('a mismatched requested account or a switch during token resolution sends no bearer', async () => {
  await assert.rejects(service.readAccountProfile('different-account'), error => error.code==='ACCOUNT_CHANGED');
  assert.equal(calls.length, 0);
  const token=deferred();
  globalThis.__accountAuth.currentUser={uid:'account-a', getIdToken:() => token.promise};
  const pending=service.requestEmailVerification('account-a', 3);
  await tick(); signIn('account-b'); token.resolve('old-account-token');
  await assert.rejects(pending, error => error.status===409 && error.code==='ACCOUNT_CHANGED');
  assert.equal(calls.length, 0);
});

test('an account switch while the private response body resolves rejects the old result', async () => {
  const json=deferred();
  transport=async () => ({ok:true, status:200, json:() => json.promise});
  const pending=service.readAccountProfile('account-a');
  await tick(); assert.equal(calls.length, 1); signIn('account-b'); json.resolve(profile('account-a'));
  await assert.rejects(pending, error => error.code==='ACCOUNT_CHANGED');
  transport=async () => response(profile('account-b'));
  assert.equal((await service.readAccountProfile('account-b')).id, 'account-b');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer account-b-bearer');
});

test('pending private reads deduplicate; a failure can retry and completed results are not cached', async () => {
  const pending=deferred(); transport=() => pending.promise;
  const first=service.readAccountProfile('account-a'), second=service.readAccountProfile('account-a');
  assert.equal(first, second); await tick(); assert.equal(calls.length, 1);
  pending.resolve(response({detail:{code:'PROFILE_UNAVAILABLE', message:'Refresh your account details.'}}, 503));
  await assert.rejects(first, error => error.status===503 && error.code==='PROFILE_UNAVAILABLE' && error.message==='Refresh your account details.');
  await assert.rejects(second, error => error.code==='PROFILE_UNAVAILABLE');
  transport=async () => response(profile('account-a', 2));
  assert.equal((await service.readAccountProfile('account-a')).version, 2);
  transport=async () => response(profile('account-a', 3));
  assert.equal((await service.readAccountProfile('account-a')).version, 3);
  assert.equal(calls.length, 3);
});

test('a wrong response owner is rejected, including an auth-session wrapper from another account', async () => {
  transport=async () => response(profile('account-b'));
  await assert.rejects(service.readAccountProfile('account-a'), error => error.status===403 && error.code==='ACCOUNT_CHANGED');
  transport=async () => response({account_profile:profile('account-b'), unrelated:'session metadata'});
  await assert.rejects(service.establishAccountSession('account-a'), error => error.status===403 && error.code==='ACCOUNT_CHANGED');
  transport=async () => response({account_profile:profile('account-a', 4), phone_verified:true});
  const saved=await service.establishAccountSession('account-a', 'register', ' actual@example.com ');
  assert.equal(saved.version, 4); assert.equal(saved.phone_verified, undefined);
  assert.equal(calls[2].path, '/api/auth/session'); assert.equal(calls[2].init.method, 'POST');
  assert.equal(bodyAt(2).mode, 'register'); assert.equal(bodyAt(2).email, 'actual@example.com');
});

test('uncertain network retries reuse one request ID; confirmed or changed commands use new IDs', async () => {
  let updates=0; window.addEventListener('repaido:account-profile-updated', () => updates++);
  transport=async () => { throw Error('Connection lost before confirmation.'); };
  await assert.rejects(service.saveAccountEmail('account-a', 'first@example.com', 1), /Connection lost/);
  const uncertain=bodyAt(0).request_id; assert.equal(updates, 0);
  transport=async () => response(profile('account-a', 2));
  await service.saveAccountEmail('account-a', ' first@example.com ', 1);
  assert.equal(bodyAt(1).request_id, uncertain);
  await new Promise(resolve => setTimeout(resolve, 2)); assert.equal(updates, 1);
  await service.saveAccountEmail('account-a', 'first@example.com', 1);
  assert.notEqual(bodyAt(2).request_id, uncertain);
  await service.saveAccountEmail('account-a', 'second@example.com', 2);
  assert.notEqual(bodyAt(3).request_id, bodyAt(2).request_id);
  assert.equal(bodyAt(3).expected_version, 2);
});

test('failed email commands remain bounded and preserve the most recent retry identity', async () => {
  transport=async () => { throw Error('offline'); };
  for (let index=0; index<33; index++) await assert.rejects(service.saveAccountEmail('account-a', `member${index}@example.com`, 1), /offline/);
  const oldest=bodyAt(0).request_id, newest=bodyAt(32).request_id;
  await assert.rejects(service.saveAccountEmail('account-a', 'member0@example.com', 1), /offline/);
  assert.notEqual(bodyAt(33).request_id, oldest);
  await assert.rejects(service.saveAccountEmail('account-a', 'member32@example.com', 1), /offline/);
  assert.equal(bodyAt(34).request_id, newest);
});

test('command retry IDs are isolated by account and legacy-token reads reject changed sessions', async () => {
  transport=async () => { throw Error('offline'); };
  await assert.rejects(service.requestEmailVerification('account-a', 1), /offline/);
  const first=bodyAt(0).request_id; signIn('account-b');
  await assert.rejects(service.requestEmailVerification('account-b', 1), /offline/);
  assert.notEqual(bodyAt(1).request_id, first); assert.equal(calls[1].init.headers.Authorization, 'Bearer account-b-bearer');
  signIn(); await assert.rejects(service.requestEmailVerification('account-a', 1), /offline/);
  assert.equal(bodyAt(2).request_id, first);
  globalThis.__accountAuth.currentUser=null; values.set('repaido.token', 'legacy-a');
  const pending=deferred(); transport=() => pending.promise;
  const read=service.readAccountProfile('account-a'); await tick();
  assert.equal(calls[3].init.headers.Authorization, 'Bearer legacy-a'); values.set('repaido.token', 'legacy-b');
  pending.resolve(response(profile('account-a'))); await assert.rejects(read, error => error.code==='ACCOUNT_CHANGED');
});

test('verification confirmation sends only the saved challenge, token and retry ID', async () => {
  await service.confirmEmailVerification('account-a', 'challenge-fixture', 'ownership-token-fixture');
  assert.equal(calls[0].path, '/api/account/profile/email-verification/confirm');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(Object.keys(bodyAt(0)).sort(), ['challenge_id', 'request_id', 'token']);
  assert.equal(bodyAt(0).challenge_id, 'challenge-fixture');
  assert.equal(bodyAt(0).token, 'ownership-token-fixture');
});

test('email input validation excludes missing, malformed and internal placeholder addresses', () => {
  for (const email of ['', '   ', 'missing-at.example.com', '.first@example.com', 'first..last@example.com', 'first@example', 'first name@example.com', 'first\n@example.com', 'phone@repaido.user', 'PHONE@REPAIDO.USER', 'x'.repeat(243)+'@example.com']) assert.match(service.accountEmailError(email), /valid email/);
  for (const email of [' first.last@example.com ', 'first+booking@example.co.in', 'first_last@example.com']) assert.equal(service.accountEmailError(email), '');
});

async function importLink(hash, analytics=false) {
  const events=[], state={previous:'history entry'};
  globalThis.location={hash, pathname:'/account', search:'?view=account&keep=1'};
  globalThis.history={state, replaceState:(received, title, url) => { events.push({kind:'replace', state:received, title, url}); globalThis.location.hash=''; }};
  const nativeAtob=globalThis.atob;
  globalThis.atob=value => { events.push({kind:'decode', hash:globalThis.location.hash}); return nativeAtob(value); };
  globalThis.__emailLinkAnalytics=() => events.push({kind:'analytics', hash:globalThis.location.hash});
  const linkUrl='data:text/javascript;base64,'+Buffer.from(linkSource).toString('base64')+'#link-'+(++revision);
  try {
    const url=analytics ? 'data:text/javascript;base64,'+Buffer.from(`export * from ${JSON.stringify(linkUrl)}; import ${JSON.stringify(linkUrl)}; globalThis.__emailLinkAnalytics();`).toString('base64')+'#app-'+revision : linkUrl;
    return {link:await import(url), events, state};
  } finally { globalThis.atob=nativeAtob; }
}
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const challenge_id='c'.repeat(32), token='t'.repeat(48);

test('verification ownership fragments are removed before decoding and importer analytics, then kept only in memory', async () => {
  const {link, events, state}=await importLink('#email-verification='+encode({challenge_id, token, ignored_private_field:'not exposed'}), true);
  assert.deepEqual(events.map(event => event.kind), ['replace', 'decode', 'analytics']);
  assert.equal(events[0].state, state); assert.equal(events[0].url, '/account?view=account&keep=1');
  assert.equal(events[1].hash, ''); assert.equal(events[2].hash, '');
  assert.deepEqual(link.emailVerificationLink(), {challenge_id, token});
  link.clearEmailVerificationLink(); assert.equal(link.emailVerificationLink(), null);
  assert.equal(events.filter(event => event.kind==='replace').length, 1);
});

test('invalid verification links are stripped immediately and cannot yield an ownership token', async () => {
  for (const fragment of ['bad%20value', 'a'.repeat(1001), 'A', Buffer.from('not json').toString('base64url'), encode({challenge_id:'short', token}), encode({challenge_id, token:'short'}), encode({challenge_id:42, token}), encode({challenge_id, token:null}), encode({challenge_id, token:'x/'.repeat(30)})]) {
    const {link, events}=await importLink('#email-verification='+fragment);
    assert.equal(events[0].kind, 'replace'); assert.equal(location.hash, '');
    assert.deepEqual(link.emailVerificationLink(), {invalid:true});
    link.clearEmailVerificationLink(); assert.equal(link.emailVerificationLink(), null);
  }
});

test('ordinary anchors remain intact and do not create a verification request', async () => {
  const {link, events}=await importLink('#booking-details');
  assert.equal(location.hash, '#booking-details'); assert.deepEqual(events, []); assert.equal(link.emailVerificationLink(), null);
});
