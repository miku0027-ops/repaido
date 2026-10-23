import {updateProfile} from 'firebase/auth';
import {auth} from '../firebase';
import {apiFetch} from './api';
import {establishAccountSession} from './accountProfileService';

export type CustomerSetup={id:string;completed:boolean;required:boolean;phone_verified:boolean;name:string;email:string|null;categories:string[];primary_category:string;adapt_suggestions:boolean;choices:{id:string;name:string}[]};
export type CustomerSetupInput={name:string;email:string;categories:string[];primary_category:string;adapt_suggestions:boolean;city:string};
const requests=new Map<string,string>();
export async function onboardingRequest(uid:string,body?:CustomerSetupInput):Promise<CustomerSetup>{
 const member=auth.currentUser;
 if(member?.uid!==uid)throw Error('Your account changed. Sign in again to continue.');
 const token=await member.getIdToken();
 if(auth.currentUser?.uid!==uid)throw Error('Your account changed. Sign in again to continue.');
 const key=uid+':'+JSON.stringify(body);
 if(body&&!requests.has(key)){if(requests.size>=16)requests.delete(requests.keys().next().value!);requests.set(key,crypto.randomUUID());}
 const response=await apiFetch('/api/account/onboarding',{method:body?'PUT':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},cache:'no-store',signal:AbortSignal.timeout(15000),...(body?{body:JSON.stringify({...body,request_id:requests.get(key)})}:{})},{background:true,feedback:false});
 const data=await response.json().catch(()=>({}));
 if(auth.currentUser?.uid!==uid)throw Error('Your account changed. Sign in again to continue.');
 if(!response.ok)throw Error(data.detail?.message||(typeof data.detail==='string'?data.detail:'Account setup could not be saved. Please retry.'));
 if(data.id!==uid)throw Error('Your account changed. Sign in again to continue.');
 if(body){requests.delete(key);window.dispatchEvent(new Event('repaido:account-profile-updated'));window.dispatchEvent(new Event('repaido:interests'));window.dispatchEvent(new Event('repaido:onboarding-updated'));}
 return data;
}
export async function finishCustomerSession(uid:string,name?:string,newAccount=false){
 const member=auth.currentUser;
 if(member?.uid!==uid)throw Error('Your account changed. Sign in again to continue.');
 if(name&&member.displayName!==name)await updateProfile(member,{displayName:name});
 if(auth.currentUser?.uid!==uid)throw Error('Your account changed. Sign in again to continue.');
 await establishAccountSession(uid,newAccount?'register':'login');
 if(auth.currentUser?.uid!==uid)throw Error('Your account changed. Sign in again to continue.');
 return {id:uid,name:member.displayName||name||'',phone:member.phoneNumber||undefined,email:member.email||undefined,photoURL:member.photoURL||undefined};
}
