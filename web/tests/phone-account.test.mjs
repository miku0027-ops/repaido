import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FirebaseError} from 'firebase/app';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const sdkRequire=createRequire(require.resolve('firebase/auth'));
// Firebase's Node export deliberately omits phone browser helpers; test the deployed browser implementation.
const {PhoneAuthProvider}=require(resolve(dirname(sdkRequire.resolve('@firebase/auth')), '../browser-cjs/index.js'));
import {createPhoneAccountRecovery} from '../src/services/phoneAccountRecovery.mjs';
const collision = () => new FirebaseError('auth/account-exists-with-different-credential','Existing phone account',{_tokenResponse:{phoneNumber:'+919000000000',temporaryProof:'test-only-proof'}});
function setup() {
 let uid='customer-uid',time=0,calls=0;
 const recovery=createPhoneAccountRecovery({currentUid:()=>uid,now:()=>time,signIn:async credential=>{calls++;assert.equal(credential.providerId,'phone');uid='worker-uid';return {user:{uid}};}});
 return {recovery,changeUser:()=>uid='someone-else',expire:()=>time=120001,calls:()=>calls};
}
test('Firebase phone collision yields verified proof; switch needs explicit continuation',async()=>{
 const x=setup(),error=collision(),credential=PhoneAuthProvider.credentialFromError(error);
 assert.ok(credential);assert.equal(x.recovery.capture(error,credential,'customer-uid'),true);
 assert.equal(x.calls(),0);assert.equal(x.recovery.available(),true);
 assert.equal((await x.recovery.continue()).user.uid,'worker-uid');assert.equal(x.calls(),1);
 await assert.rejects(x.recovery.continue(),/expired/);assert.equal(x.calls(),1);
});
test('invalid OTP and collision without verified proof cannot switch',async()=>{
 const x=setup();assert.equal(x.recovery.capture({code:'auth/invalid-verification-code'},null,'customer-uid'),false);
 assert.equal(x.recovery.capture(collision(),null,'customer-uid'),false);
 await assert.rejects(x.recovery.continue(),/expired/);assert.equal(x.calls(),0);
});
for(const action of ['changeUser','expire'])test(`proof is rejected after ${action}`,async()=>{
 const x=setup(),e=collision();x.recovery.capture(e,PhoneAuthProvider.credentialFromError(e),'customer-uid');x[action]();
 assert.equal(x.recovery.available(),false);await assert.rejects(x.recovery.continue(),/changed or expired/);assert.equal(x.calls(),0);
});
test('resend/sign-out cleanup invalidates pending proof',async()=>{
 const x=setup(),e=collision();x.recovery.capture(e,PhoneAuthProvider.credentialFromError(e),'customer-uid');x.recovery.clear();
 await assert.rejects(x.recovery.continue(),/expired/);assert.equal(x.calls(),0);
});
test('uncertain failed sign-in cannot replay proof',async()=>{
 let calls=0;const x=createPhoneAccountRecovery({currentUid:()=> 'customer-uid',signIn:async()=>{calls++;throw Error('Network unavailable');}}),e=collision();
 x.capture(e,PhoneAuthProvider.credentialFromError(e),'customer-uid');await assert.rejects(x.continue(),/Network/);
 await assert.rejects(x.continue(),/expired/);assert.equal(calls,1);
});
