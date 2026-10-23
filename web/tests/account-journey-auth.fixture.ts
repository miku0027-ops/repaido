// Test-server alias only. Production never imports this SDK boundary.
export * from '../node_modules/firebase/auth/dist/esm/index.esm.js';
const listeners=new Set<(user:any)=>void>();
const instance:any={currentUser:null,authStateReady:async()=>{},settings:{}};
export const fixture={newAccount:true,uid:'journey-new',delay:0,failSend:false};
export function emit(uid:string,phone=false){
 instance.currentUser=uid?{uid,displayName:'Asha',email:uid+'@example.com',emailVerified:true,phoneNumber:phone?'+919876543210':null,
  getIdToken:async()=>uid+(instance.currentUser?.phoneNumber?':verified':':pending'),getIdTokenResult:async()=>({claims:{}})}:null;
 for(const callback of listeners)callback(instance.currentUser);
 return instance.currentUser;
}
export const getAuth=()=>instance;
export function onIdTokenChanged(_auth:any,callback:(user:any)=>void){listeners.add(callback);queueMicrotask(()=>{if(listeners.has(callback))callback(instance.currentUser);});return()=>listeners.delete(callback);}
export const onAuthStateChanged=onIdTokenChanged;
export async function signOut(){emit('');}
export async function updateProfile(user:any,changes:any){Object.assign(user,changes);}
export const getAdditionalUserInfo=(credential:any)=>({isNewUser:!!credential.newAccount});
export class RecaptchaVerifier {clear(){}}
const delay=()=>new Promise(resolve=>setTimeout(resolve,fixture.delay));
const check=(code:string)=>{if(code!=='123456')throw Object.assign(Error('Invalid code'),{code:'auth/invalid-verification-code'});};
export async function signInWithPopup(){await delay();return {user:emit(fixture.uid),newAccount:fixture.newAccount};}
export async function signInWithPhoneNumber(){await delay();if(fixture.failSend)throw Error('Code delivery unavailable. Please retry.');return {verificationId:'test-proof',confirm:async(code:string)=>{await delay();check(code);return {user:emit(fixture.uid,true),newAccount:fixture.newAccount};}};}
export class PhoneAuthProvider {async verifyPhoneNumber(){await delay();return 'test-link-proof';}static credential(_id:string,code:string){return {code};}static credentialFromError(){return null;}}
export async function linkWithCredential(user:any,credential:any){await delay();check(credential.code);user.phoneNumber='+919876543210';return {user,newAccount:false};}
export const reauthenticateWithCredential=linkWithCredential;
(window as any).__accountFixture={fixture,emit};
