import {auth} from '../firebase';
import {apiFetch} from './api';

export type AccountProfile = {
  id:string; name:string; email:string|null; email_verified:boolean; email_required:boolean; version:number;
  verification_status:'missing'|'unverified'|'verified';
  verification:{ready:boolean;reason:string|null;next_request_at:number;challenge_id:string|null;expires_at:number|null};
};
export class AccountProfileError extends Error {
  constructor(message:string, public status:number, public code:string='') {super(message);}
}
const pending=new Map<string,Promise<AccountProfile>>();
const commands=new Map<string,string>();
async function request(uid:string,path:string,init:RequestInit={}):Promise<AccountProfile> {
  await auth.authStateReady();
  const member=auth.currentUser;
  const token=member?await member.getIdToken():localStorage.getItem('repaido.token');
  const identity=()=>member ? auth.currentUser?.uid===uid : !auth.currentUser&&localStorage.getItem('repaido.token')===token;
  if(!token||(member&&member.uid!==uid)||!identity()) throw new AccountProfileError('Your account changed. Reopen your profile.',409,'ACCOUNT_CHANGED');
  const response=await apiFetch('/api'+path,{...init,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},cache:'no-store'});
  const body=await response.json().catch(()=>({}));
  if(!identity())throw new AccountProfileError('Your account changed. Reopen your profile.',409,'ACCOUNT_CHANGED');
  if(!response.ok){
    const detail=body.detail;
    throw new AccountProfileError(typeof detail==='string'?detail:detail?.message||(Array.isArray(detail)?detail.map((item:{msg:string})=>item.msg).join('. '):'Account details could not be saved. Please retry.'),response.status,detail?.code||'');
  }
  const profile=path==='/auth/session'?body.account_profile:body;
  if(profile?.id!==uid)throw new AccountProfileError('Sign in to the account for these details.',403,'ACCOUNT_CHANGED');
  return profile;
}
export function readAccountProfile(uid:string):Promise<AccountProfile> {
  const prior=pending.get(uid);if(prior)return prior;
  const promise=request(uid,'/account/profile');pending.set(uid,promise);
  void promise.finally(()=>{if(pending.get(uid)===promise)pending.delete(uid);}).catch(()=>{});
  return promise;
}
async function command(uid:string,path:string,method:string,body:Record<string,unknown>) {
  const key=uid+':'+path+':'+JSON.stringify(body);
  const requestId=commands.get(key)||crypto.randomUUID();
  if(commands.size>=32&&!commands.has(key))commands.delete(commands.keys().next().value!);
  commands.set(key,requestId);
  const result=await request(uid,path,{method,body:JSON.stringify({...body,request_id:requestId})});
  commands.delete(key);setTimeout(()=>window.dispatchEvent(new Event('repaido:account-profile-updated')),0);return result;
}
export const saveAccountEmail=(uid:string,email:string,version:number)=>command(uid,'/account/profile','PATCH',{email:email.trim(),expected_version:version});
export const requestEmailVerification=(uid:string,version:number)=>command(uid,'/account/profile/email-verification','POST',{expected_version:version});
export const confirmEmailVerification=(uid:string,challenge_id:string,token:string)=>command(uid,'/account/profile/email-verification/confirm','POST',{challenge_id,token});
export const establishAccountSession=(uid:string,mode:'login'|'register'='login',email?:string)=>command(uid,'/auth/session','POST',{mode,...(email?{email:email.trim()}: {})});
export function accountEmailError(value:string):string {
  const email=value.trim();
  if(!email||email.length>254||/\s|[\x00-\x1f\x7f]/.test(email)||! /^[^@.]+(?:\.[^@.]+)*@[^@.]+(?:\.[^@.]+)+$/.test(email)||/@repaido\.user$/i.test(email))return 'Enter a valid email address for your account.';
  return '';
}
