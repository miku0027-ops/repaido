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
await call('PATCH','services/service','owner',{name:'Local service'},200);
await call('PATCH','users/alice','owner',{name:'Alice',email:'alice@example.invalid'},200);
await call('PATCH','support_tickets/alice-ticket','owner',{user_id:'alice',userId:'alice',message:'Private issue',status:'open'},200);
await call('PATCH','ops_workers/worker','owner',{name:'Private worker'},200);
await call('GET','services/service',null,null,200);
await call('PATCH','services/service',alice,{name:'Cannot change prices'},403);
await call('PATCH','services/service',emailOnly,{name:'Email is not admin proof'},403);
await call('PATCH','services/service',admin,{name:'Authorized admin'},200);
await call('PATCH','services/service',roleAdmin,{name:'Authorized role admin'},200);
await call('GET','users/alice',alice,null,200);
await call('GET','users/alice',bob,null,403);
await call('GET','users/alice',emailOnly,null,403);
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
console.log(JSON.stringify({status:'passed',checks,project,endpoint:'local Firestore emulator'}));
