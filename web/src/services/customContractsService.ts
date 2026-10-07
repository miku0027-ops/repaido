import {auth} from '../firebase';
import {apiFetch} from './api';
import {createReadCache} from './readCache.mjs';
import type {ContractFreshLocation,ContractReaction,CustomContractCommentsPage,CustomContractDetails,CustomContractDraft,CustomContractMessagesPage,CustomContractInterestsPage,CustomContractsPage} from '../types/customContracts';
import {readDeviceLocation} from './deviceLocation.mjs';

const reads=createReadCache({maxEntries:64}),commands=new Map<string,string>();
const UPDATE='repaido:custom-contracts-updated';
let identity='',generation=0;
export class CustomContractError extends Error{constructor(message:string,public status:number,public code=''){super(message);}}
function scopeNow(){return auth.currentUser?.uid||localStorage.getItem('repaido.token')||'';}
function syncIdentity(){const next=scopeNow();if(next!==identity){identity=next;generation++;reads.invalidate();commands.clear();}return next;}
async function capturedIdentity(){await auth.authStateReady();const user=auth.currentUser,fallback=user?null:localStorage.getItem('repaido.token'),scope=syncIdentity(),epoch=generation;const token=user?await user.getIdToken():fallback;if(auth.currentUser?.uid!==user?.uid||(!user&&localStorage.getItem('repaido.token')!==fallback)||syncIdentity()!==scope)throw new CustomContractError('Your account changed. Reopen this contract.',409,'ACCOUNT_CHANGED');if(!token)throw new CustomContractError('Sign in to view your contract requests.',401,'AUTH_REQUIRED');return {scope,token,epoch};}
export function invalidateCustomContractReads(){generation++;reads.invalidate();window.dispatchEvent(new Event(UPDATE));}
export function subscribeCustomContracts(listener:()=>void){window.addEventListener(UPDATE,listener);return()=>window.removeEventListener(UPDATE,listener);}
async function request<T>(path:string,init:RequestInit={},owner?:Awaited<ReturnType<typeof capturedIdentity>>):Promise<T>{
  if(!path.startsWith('/')||path.startsWith('//')||/[?#].*https?:/i.test(path))throw new Error('Expected a local contract API path.');
  const captured=owner||await capturedIdentity();if(syncIdentity()!==captured.scope)throw new CustomContractError('Your account changed. Reopen this contract.',409,'ACCOUNT_CHANGED');
  const response=await apiFetch('/api/operations'+path,{...init,headers:{'Content-Type':'application/json','Accept':'application/json','Authorization':'Bearer '+captured.token,...init.headers},signal:init.signal||AbortSignal.timeout(30000)},{background:true});
  const body=await response.json().catch(()=>({}));if(syncIdentity()!==captured.scope)throw new CustomContractError('Your account changed. Reopen this contract.',409,'ACCOUNT_CHANGED');
  if(!response.ok){const detail=body.detail;throw new CustomContractError(typeof detail==='string'?detail:detail?.message||(Array.isArray(detail)?detail.map((item:{msg:string})=>item.msg).join('. '):'')||(response.status===401?'Your sign-in expired. Sign in again.':'Could not load this contract. Retry.'),response.status,detail?.code||'');}return body as T;
}
function observeAbort<T>(value:Promise<T>,signal?:AbortSignal):Promise<T>{if(!signal)return value;if(signal.aborted){void value.catch(()=>{});return Promise.reject(new DOMException('Request cancelled.','AbortError'));}return new Promise((resolve,reject)=>{const cancelled=()=>reject(new DOMException('Request cancelled.','AbortError'));signal.addEventListener('abort',cancelled,{once:true});value.then(result=>{signal.removeEventListener('abort',cancelled);if(!signal.aborted)resolve(result);},error=>{signal.removeEventListener('abort',cancelled);if(!signal.aborted)reject(error);});});}
export async function contractRead<T>(path:string,force=false,signal?:AbortSignal):Promise<T>{if(signal?.aborted)throw new DOMException('Request cancelled.','AbortError');const owner=await capturedIdentity();if(signal?.aborted)throw new DOMException('Request cancelled.','AbortError');const value=reads.read(owner.scope+':'+path,async()=>{const result=await request<T>(path,{},owner);if(syncIdentity()!==owner.scope||generation!==owner.epoch)throw new CustomContractError('Contract details changed. Refresh this view.',409,'CONTRACT_CHANGED');return result;},{freshMs:8000,force}) as Promise<T>;return observeAbort(value,signal);}
export async function contractMutation<T>(path:string,body:Record<string,unknown>,method='POST'):Promise<T>{const owner=await capturedIdentity(),key=owner.scope+':'+method+':'+path+':'+JSON.stringify(body),requestId=commands.get(key)||crypto.randomUUID();commands.set(key,requestId);while(commands.size>64)commands.delete(commands.keys().next().value!);const result=await request<T>(path,{method,body:JSON.stringify({...body,request_id:requestId})},owner);commands.delete(key);invalidateCustomContractReads();window.dispatchEvent(new Event('repaido:operations-updated'));return result;}
export async function contractPostRead<T>(path:string,body:Record<string,unknown>,signal?:AbortSignal):Promise<T>{const owner=await capturedIdentity();return request<T>(path,{method:'POST',body:JSON.stringify(body),signal},owner);}
const queryPath=(id:string)=>'/custom-contracts/queries/'+encodeURIComponent(id);
const paging=(cursor='')=>new URLSearchParams({limit:'20',...(cursor?{cursor}:{})});
export const customContractQueries=(scope:'mine'|'matched',cursor='',force=false,signal?:AbortSignal)=>contractRead<CustomContractsPage>('/custom-contracts/queries?'+new URLSearchParams({scope,...Object.fromEntries(paging(cursor))}),force,signal);
export const customContractDetails=(id:string,force=false,signal?:AbortSignal)=>contractRead<CustomContractDetails>(queryPath(id),force,signal);
export const createCustomContract=(draft:CustomContractDraft)=>contractMutation<CustomContractDetails>('/custom-contracts/queries',draft as unknown as Record<string,unknown>);
export const bidCustomContract=(id:string,version:number,amountPaise:number,proposal:string)=>contractMutation<CustomContractDetails>(queryPath(id)+'/bids',{expected_version:version,amount_paise:amountPaise,proposal:proposal.trim(),accepted_terms:true});
export const customContractCommand=(id:string,version:number,action:'award'|'close'|'engagement'|'public_progress',payload:Record<string,unknown>={})=>contractMutation<CustomContractDetails>(queryPath(id)+'/commands',{expected_version:version,action,...payload});
export const reactToCustomContract=(id:string,reaction:ContractReaction|null)=>contractMutation<{reaction:ContractReaction|null}>(queryPath(id)+'/reaction',{reaction},'PUT');
export const customContractComments=(id:string,cursor='',force=false,signal?:AbortSignal)=>contractRead<CustomContractCommentsPage>(queryPath(id)+'/comments?'+paging(cursor),force,signal);
export const commentOnCustomContract=(id:string,text:string,parentId:string|null=null)=>contractMutation(queryPath(id)+'/comments',{text:text.trim(),parent_id:parentId});
export const customContractMessages=(id:string,cursor='',force=false,signal?:AbortSignal)=>contractRead<CustomContractMessagesPage>(queryPath(id)+'/messages?'+paging(cursor),force,signal);
export const sendCustomContractMessage=(id:string,text:string)=>contractMutation(queryPath(id)+'/messages',{text:text.trim()});
export const enquireCustomContract=(id:string,bidId:string,text:string)=>contractMutation(queryPath(id)+'/enquiries',{bid_id:bidId,text:text.trim()});
export const customContractEnquiries=(id:string,cursor='',force=false,signal?:AbortSignal)=>contractRead<CustomContractMessagesPage>(queryPath(id)+'/enquiries?'+paging(cursor),force,signal);
export const markCustomContractViewed=(id:string)=>contractMutation<{recorded:boolean;views:number}>(queryPath(id)+'/view',{});
export const freshContractLocation=()=>readDeviceLocation(navigator.geolocation,{secure:window.isSecureContext}) as Promise<ContractFreshLocation>;
export const pendingContractOpportunities=(location:ContractFreshLocation|null,cursor='',signal?:AbortSignal)=>contractPostRead<CustomContractsPage>('/custom-contracts/agent-opportunities',{...(location?{location,location_consent:true}:{}),limit:20,...(cursor?{cursor}: {})},signal);
export const expressContractInterest=(id:string,note:string,workerType:string,location:ContractFreshLocation|null)=>contractMutation(queryPath(id)+'/interest',{note:note.trim(),available:true,worker_type:workerType,...(location?{location,location_consent:true}:{})});

export function rupeesToPaise(value:string){if(!/^\d+(\.\d{1,2})?$/.test(value.trim()))throw new Error('Enter rupees with no more than two decimal places.');const [rupees,paise='']=value.trim().split('.');const result=Number(rupees)*100+Number(paise.padEnd(2,'0'));if(!Number.isSafeInteger(result)||result>50000000000)throw new Error('Enter an amount within the contract limit.');return result;}

// Provider commands have their own server idempotency and accept no browser request ID.
export async function contractRawCommand<T>(path:string,body:Record<string,unknown>={}):Promise<T>{const owner=await capturedIdentity();const result=await request<T>(path,{method:'POST',body:JSON.stringify(body)},owner);invalidateCustomContractReads();window.dispatchEvent(new Event('repaido:operations-updated'));return result;}
export async function uploadContractEvidence(projectId:string,file:File,purpose:'progress'|'payment'|'purchase',sharePublic=false){
  if(!(purpose==='progress'?['image/jpeg','image/png','image/webp','video/mp4','video/webm']:['image/jpeg','image/png','image/webp']).includes(file.type))throw new Error(purpose==='progress'?'Choose a JPEG, PNG, WebP, MP4 or WebM file.':'Choose a JPEG, PNG or WebP photo.');
  if(file.size<=0||file.size>8*1024*1024)throw new Error('Choose a contract evidence file up to 8 MB.');
  if(purpose!=='progress'&&sharePublic)throw new Error('Payment and purchase evidence stays private.');
  const owner=await capturedIdentity(),path='/contracts/projects/'+encodeURIComponent(projectId)+'/attachments?'+new URLSearchParams({purpose,share_public:String(sharePublic)});
  const result=await request<{id:string;url:string;mime:string;purpose:string}>(path,{method:'POST',body:file,headers:{'Content-Type':file.type}},owner);
  return result;
}
export async function privateContractBlob(path:string,expectedType:'image'|'video'|'pdf',signal?:AbortSignal):Promise<Blob>{
  const local=path.startsWith('/api/operations/contracts/')?path.slice('/api/operations'.length):path;
  if(!local.startsWith('/contracts/')||local.includes('://')||local.includes('..')||local.includes('#'))throw new Error('Expected an authorized local contract document.');
  const owner=await capturedIdentity(),response=await apiFetch('/api/operations'+local,{headers:{Authorization:'Bearer '+owner.token,Accept:expectedType==='pdf'?'application/pdf':expectedType==='video'?'video/mp4,video/webm':'image/jpeg,image/png,image/webp'},signal:signal||AbortSignal.timeout(30000)},{background:true});
  const type=(response.headers.get('content-type')||'').split(';')[0];
  if(syncIdentity()!==owner.scope)throw new CustomContractError('Your account changed. Reopen this contract.',409,'ACCOUNT_CHANGED');
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new CustomContractError(body.detail?.message||'This private document could not be opened. Refresh your access and retry.',response.status,body.detail?.code||'');}
  if(expectedType==='pdf'?type!=='application/pdf':expectedType==='video'?!['video/mp4','video/webm'].includes(type):!['image/jpeg','image/png','image/webp'].includes(type))throw new Error('The server did not return the expected contract document.');
  const blob=await response.blob();if(syncIdentity()!==owner.scope)throw new CustomContractError('Your account changed. Reopen this contract.',409,'ACCOUNT_CHANGED');if(!blob.size)throw new Error('The contract document is empty. Retry.');return blob;
}
export async function downloadContractReport(path:string,filename='Repaido-contract-record.pdf'){const blob=await privateContractBlob(path,'pdf'),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}

export const messageNearbyContractor=(id:string,recipientId:string,text:string,location:ContractFreshLocation)=>contractMutation(queryPath(id)+'/agent-messages',{recipient_id:recipientId,text:text.trim(),location,location_consent:true});

export const customContractInterests=(id:string,cursor='',force=false,signal?:AbortSignal)=>contractRead<CustomContractInterestsPage>(queryPath(id)+'/interests?'+paging(cursor),force,signal);
