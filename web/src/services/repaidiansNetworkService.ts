import {auth} from '../firebase';
import {withActionFeedback} from './actionFeedback';
import {CommunityError} from './repaidiansService';
import {createReadCache} from './readCache.mjs';
import type {NetworkConnection,NetworkConnectionsPage,NetworkEndorsementsPage,NetworkPreferences,NetworkProfileDetails,NetworkProfilePatch,NetworkProfessionalProfile,NetworkRecommendation,NetworkRecommendationsPage} from '../types/repaidiansNetwork';

// Professional records and relationship state remain in bounded memory for the
// current identity. Neither bearer tokens nor private responses are persisted.
const reads=createReadCache({maxEntries:48});
const commandKeys=new Map<string,string>();
const UPDATE='repaidians:network-update';
let scope='',generation=0,ownUpdate=false;
function currentIdentity(){return auth.currentUser?.uid||localStorage.getItem('repaido.token')||'guest';}
function syncIdentity(){const next=currentIdentity();if(next!==scope){scope=next;generation++;reads.invalidate();commandKeys.clear();}return next;}
export function clearNetworkReads(){generation++;reads.invalidate();}
function changed(){clearNetworkReads();ownUpdate=true;try{window.dispatchEvent(new Event(UPDATE));window.dispatchEvent(new Event('repaidians:update'));}finally{ownUpdate=false;}}
window.addEventListener('repaidians:update',()=>{if(!ownUpdate){clearNetworkReads();window.dispatchEvent(new Event(UPDATE));}});
export function subscribeNetworkReads(listener:()=>void){window.addEventListener(UPDATE,listener);return()=>window.removeEventListener(UPDATE,listener);}
async function capturedIdentity(){
  await auth.authStateReady();
  const user=auth.currentUser,fallback=user?null:localStorage.getItem('repaido.token'),identity=syncIdentity(),epoch=generation;
  const token=user?await user.getIdToken():fallback;
  if(auth.currentUser?.uid!==user?.uid||(!user&&localStorage.getItem('repaido.token')!==fallback)||syncIdentity()!==identity)
    throw new CommunityError('Your account changed. Reopen this view.',409,'ACCOUNT_CHANGED');
  return {identity,epoch,token};
}
async function request<T>(path:string,init:RequestInit={},captured?:Awaited<ReturnType<typeof capturedIdentity>>):Promise<T>{
  return withActionFeedback('/community'+path,init,()=>performRequest<T>(path,init,captured));
}
async function performRequest<T>(path:string,init:RequestInit,captured?:Awaited<ReturnType<typeof capturedIdentity>>):Promise<T>{
  if(!path.startsWith('/')||path.startsWith('//')||/[?#].*https?:/i.test(path))throw new Error('Expected a Repaidians network API path.');
  const owner=captured||await capturedIdentity();
  if(syncIdentity()!==owner.identity)throw new CommunityError('Your account changed. Reopen this view.',409,'ACCOUNT_CHANGED');
  const headers=new Headers(init.headers);headers.set('Accept','application/json');
  if(owner.token)headers.set('Authorization','Bearer '+owner.token);
  if(typeof init.body==='string')headers.set('Content-Type','application/json');
  const response=await fetch('/api/repaidians'+path,{...init,headers,credentials:'same-origin',signal:init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
  const body=await response.json().catch(()=>({}));
  if(syncIdentity()!==owner.identity)throw new CommunityError('Your account changed. Reopen this view.',409,'ACCOUNT_CHANGED');
  if(!response.ok){const detail=body.detail;const message=typeof detail==='string'?detail:detail?.message||(Array.isArray(detail)?detail.map((item:{msg:string})=>item.msg).join('. '):'')||(response.status===401?'Sign in to build your professional network.':'Could not save these details. Retry.');throw new CommunityError(message,response.status,detail?.code||'');}
  return body as T;
}
function abortObserver<T>(value:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return value;
  if(signal.aborted)return Promise.reject(new DOMException('Request cancelled.','AbortError'));
  return new Promise((resolve,reject)=>{const cancelled=()=>reject(new DOMException('Request cancelled.','AbortError'));signal.addEventListener('abort',cancelled,{once:true});value.then(result=>{signal.removeEventListener('abort',cancelled);if(!signal.aborted)resolve(result);},error=>{signal.removeEventListener('abort',cancelled);if(!signal.aborted)reject(error);});});
}
export async function networkRead<T>(path:string,force=false,signal?:AbortSignal):Promise<T>{
  const owner=await capturedIdentity();
  const value=reads.read(owner.identity+':'+path,async()=>{const result=await request<T>(path,{},owner);if(syncIdentity()!==owner.identity||generation!==owner.epoch)throw new CommunityError('Your professional details changed. Refresh this view.',409,'PROFILE_CHANGED');return result;},{freshMs:10000,force}) as Promise<T>;
  return abortObserver(value,signal);
}
export function peekNetworkRead<T>(path:string):T|null{return reads.peek(syncIdentity()+':'+path,60000) as T|null;}
export async function networkMutation<T>(path:string,method:string,body?:object):Promise<T>{
  const owner=await capturedIdentity();
  if(!owner.token)throw new CommunityError('Sign in to build your professional network.',401,'AUTH_REQUIRED');
  const result=await request<T>(path,{method,...(body?{body:JSON.stringify(body)}:{})},owner);changed();return result;
}
export async function networkCommand<T>(path:string,body:Record<string,unknown>,method='POST'):Promise<T>{
  const owner=await capturedIdentity();
  if(!owner.token)throw new CommunityError('Sign in to build your professional network.',401,'AUTH_REQUIRED');
  const key=owner.identity+':'+method+':'+path+':'+JSON.stringify(body),clientId=commandKeys.get(key)||crypto.randomUUID();
  commandKeys.set(key,clientId);while(commandKeys.size>64)commandKeys.delete(commandKeys.keys().next().value!);
  const result=await request<T>(path,{method,body:JSON.stringify({...body,clientId})},owner);
  commandKeys.delete(key);changed();return result;
}
const memberPath=(id:string)=>'/network/members/'+encodeURIComponent(id);
const pageQuery=(mode:string,cursor='')=>new URLSearchParams({mode,limit:'24',...(cursor?{cursor}: {})}).toString();
export const professionalProfile=(id:string,self=false,force=false,signal?:AbortSignal)=>networkRead<NetworkProfileDetails>(self?'/network/profile':memberPath(id)+'/profile',force,signal);
export const updateProfessionalProfile=(expectedVersion:number,fields:NetworkProfilePatch)=>networkCommand<{profile:NetworkProfessionalProfile}>('/network/profile',{...fields,expectedVersion},'PATCH');
export const networkConnections=(mode:'connections'|'incoming'|'outgoing',cursor='',force=false,signal?:AbortSignal)=>networkRead<NetworkConnectionsPage>('/network/connections?'+pageQuery(mode,cursor),force,signal);
export const memberConnection=(id:string,force=false,signal?:AbortSignal)=>networkRead<{connection:NetworkConnection}>(memberPath(id)+'/connection',force,signal);
export const updateConnection=(id:string,action:'request'|'accept'|'decline'|'cancel'|'remove',expectedVersion:number,note='')=>networkCommand<{connection:NetworkConnection}>(memberPath(id)+'/connection',{action,expectedVersion,...(action==='request'?{note:note.trim()}: {})});
export const skillEndorsements=(id:string,cursor='',force=false,signal?:AbortSignal)=>networkRead<NetworkEndorsementsPage>(memberPath(id)+'/endorsements?'+new URLSearchParams({limit:'24',...(cursor?{cursor}:{})}),force,signal);
export const endorseSkill=(id:string,skill:string,active:boolean)=>networkCommand<{active:boolean;skill:string}>(memberPath(id)+'/endorsements',{skill,active},'PUT');
export const networkRecommendations=(mode:'received'|'pending'|'written',cursor='',force=false,signal?:AbortSignal)=>networkRead<NetworkRecommendationsPage>('/network/recommendations?'+pageQuery(mode,cursor),force,signal);
export const memberRecommendations=(id:string,cursor='',force=false,signal?:AbortSignal)=>networkRead<NetworkRecommendationsPage>(memberPath(id)+'/recommendations?'+new URLSearchParams({limit:'24',...(cursor?{cursor}:{})}),force,signal);
export const writeRecommendation=(id:string,text:string,relationship:string)=>networkCommand<{recommendation:NetworkRecommendation}>(memberPath(id)+'/recommendations',{text:text.trim(),relationship:relationship.trim()});
export const decideRecommendation=(id:string,action:'approve'|'decline'|'retract',expectedVersion:number)=>networkCommand<{recommendation:NetworkRecommendation}>('/network/recommendations/'+encodeURIComponent(id),{action,expectedVersion},'PUT');
export const networkPreferences=(force=false,signal?:AbortSignal)=>networkRead<{preferences:NetworkPreferences}>('/network/preferences',force,signal);
export const updateNetworkPreferences=(preferences:Partial<NetworkPreferences>)=>networkMutation<{preferences:NetworkPreferences}>('/network/preferences','PATCH',preferences);
