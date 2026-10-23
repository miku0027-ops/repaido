/** Exercise deployed source rules against the actual Firestore emulator.
 * No production endpoint, SDK credential or data is used. */
import assert from 'node:assert/strict';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const project = process.env.GCLOUD_PROJECT || 'demo-repaido-security';
if (!host || !/^127\.0\.0\.1:\d+$|^localhost:\d+$/.test(host) || !project.startsWith('demo-')) {
  throw new Error('Security tests require a loopback Firestore emulator and a demo project.');
}
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (uid, claims={}) => {
  const now = Math.floor(Date.now()/1000);
  return encode({alg:'none',typ:'JWT'})+'.'+encode({iss:`https://securetoken.google.com/${project}`,aud:project,
    iat:now,exp:now+3600,auth_time:now,sub:uid,user_id:uid,firebase:{sign_in_provider:'custom',identities:{}},...claims})+'.';
};
const fields = values => Object.fromEntries(Object.entries(values).map(([name,value]) => [name,typeof value==='boolean'?{booleanValue:value}:{stringValue:value}]));
let checks = 0;
async function call(method, path, identity, values, status) {
  const response = await fetch(base+'/'+path, {method, headers:{...(identity?{Authorization:'Bearer '+identity}:{}), 'Content-Type':'application/json'},
    ...(values?{body:JSON.stringify({fields:fields(values)})}:{})});
  assert.equal(response.status,status,`${method} ${path}: ${await response.text()}`);checks++;
}
const alice=token('alice'),bob=token('bob'),admin=token('admin',{admin:true}),roleAdmin=token('role-admin',{role:'admin'});
const emailOnly=token('email-only',{email:'firebase-adminsdk-fbsvc@repaido.iam.gserviceaccount.com',email_verified:true});
const stringAdmin=token('string-admin',{admin:'true'}), numericAdmin=token('numeric-admin',{admin:1});
await call('PATCH','services/service','owner',{name:'Local service'},200);
await call('PATCH','users/alice','owner',{name:'Alice',email:'alice@example.invalid'},200);
await call('PATCH','support_tickets/alice-ticket','owner',{user_id:'alice',userId:'alice',message:'Private issue',status:'open'},200);
await call('PATCH','ops_workers/worker','owner',{name:'Private worker'},200);
await call('PATCH','technicians/alice','owner',{name:'Private technician',phone:'Private phone',status:'active'},200);
await call('PATCH','bookings/assigned','owner',{user_id:'alice',technician_id:'bob',status:'confirmed'},200);
await call('PATCH','bookings/unassigned','owner',{user_id:'alice',status:'requested'},200);
await call('GET','services/service',null,null,200);
await call('PATCH','services/service',alice,{name:'Cannot change prices'},403);
await call('PATCH','services/service',emailOnly,{name:'Email is not admin proof'},403);
await call('PATCH','services/service',stringAdmin,{name:'String is not boolean admin proof'},403);
await call('PATCH','services/service',numericAdmin,{name:'Number is not boolean admin proof'},403);
await call('PATCH','services/service',admin,{name:'Authorized admin'},200);
await call('PATCH','services/service',roleAdmin,{name:'Authorized role admin'},200);
await call('GET','users/alice',alice,null,200);
await call('GET','users/alice',bob,null,403);
await call('GET','users/alice',emailOnly,null,403);
// Provisioning must run through the API so its new-account phone policy is
// recorded before a user document can be mistaken for a legacy account.
await call('PATCH','users/new-google',token('new-google'),{name:'Cannot bypass setup'},403);
await call('PATCH','users/new-phone',token('new-phone',{phone_number:'+919876543210'}),{name:'Use the API'},403);
for (const collection of ['ops_account_creation_policy','ops_customer_onboarding']) {
  await call('PATCH',collection+'/alice',alice,{phone_required:false,completed_at:'forged'},403);
  await call('GET',collection+'/alice',alice,null,403);
}
// An owner-editable profile field never becomes a server-issued auth claim.
await call('PATCH','users/alice',alice,{name:'Alice',role:'admin',admin:true},200);
await call('PATCH','services/service',alice,{name:'Profile role is not authority'},403);
await call('GET','ops_workers/worker',alice,null,403);
await call('GET','support_tickets/alice-ticket',null,null,403);
await call('GET','support_tickets/alice-ticket',alice,null,200);
await call('GET','support_tickets/alice-ticket',bob,null,403);
await call('GET','support_tickets/alice-ticket',admin,null,200);
await call('GET','support_tickets/alice-ticket',emailOnly,null,403);
for (const [label,identity] of [['guest',null],['owner',alice],['stranger',bob],['custom-admin',admin]]) {
  await call('PATCH','support_tickets/'+label+'-new',identity,{user_id:'alice',message:'Bypass attempt'},403);
  await call('PATCH','support_tickets/alice-ticket',identity,{user_id:'bob',status:'resolved'},403);
  await call('DELETE','support_tickets/alice-ticket',identity,null,403);
}
await call('GET','ops_workers/worker',alice,null,403);
await call('GET','ops_workers/worker',admin,null,403);
await call('PATCH','ops_workers/worker',alice,{status:'approved'},403);
for (const [identity,status] of [[null,403],[alice,200],[bob,403],[admin,200],[emailOnly,403]]) {
  await call('GET','technicians/alice',identity,null,status);
}
for (const [identity,status] of [[null,403],[alice,200],[bob,200],[admin,200],[emailOnly,403]]) {
  await call('GET','bookings/assigned',identity,null,status);
}
for (const [identity,status] of [[null,403],[alice,200],[bob,403],[admin,200]]) {
  await call('GET','bookings/unassigned',identity,null,status);
}
for (const identity of [null,alice,bob,admin]) {
  for (const path of ['bookings/assigned','technicians/alice','partner_applications/application','ops_account_contacts/alice']) {
    await call('PATCH',path,identity,{status:'approved',user_id:'bob'},403);
    await call('DELETE',path,identity,null,403);
  }
  await call('GET','ops_account_contacts/alice',identity,null,403);
  await call('GET','users/alice/private/nested',identity,null,403);
}
await call('PATCH','users/alice',bob,{name:'Cannot take another account'},403);
await call('DELETE','users/alice',alice,null,403);
console.log(JSON.stringify({status:'passed',checks,project,endpoint:'local Firestore emulator'}));
