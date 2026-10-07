import {auth} from '../firebase';
import {communityRequest} from './repaidiansService';
import {operation} from './operations';
import {createReadCache} from './readCache.mjs';
import {syncWorkPushAccount} from './repaidiansPushService';
import type {Trade} from '../types/repaidians';
import type {WorkApplication,WorkApplicationsPage,WorkCompaniesPage,WorkCompanyDetails,WorkCongratulations,WorkInterests,WorkJobFilters,WorkJobsPage,WorkPlacement,WorkPreferences} from '../types/repaidiansWork';

// Responses remain in bounded process memory. An account switch retires both
// fulfilled entries and in-flight generations; private work data is never persisted.
const reads=createReadCache({maxEntries:64});
let identityScope='',generation=0;
const UPDATE='repaidians:work-update';
let ownChange=false;
function identityNow(){return auth.currentUser?.uid||localStorage.getItem('repaido.token')||'guest';}
function syncIdentity(){const current=identityNow();if(current!==identityScope){identityScope=current;generation++;reads.invalidate();void syncWorkPushAccount();}return current;}
export function clearWorkReads(){generation++;reads.invalidate();}
function changed(){clearWorkReads();ownChange=true;try{window.dispatchEvent(new Event(UPDATE));window.dispatchEvent(new Event('repaidians:update'));}finally{ownChange=false;}}
window.addEventListener('repaidians:update',()=>{if(!ownChange){clearWorkReads();window.dispatchEvent(new Event(UPDATE));}});
export function subscribeWorkReads(listener:()=>void){window.addEventListener(UPDATE,listener);return()=>window.removeEventListener(UPDATE,listener);}
function queryString(filters:Record<string,unknown>){const params=new URLSearchParams();for(const [key,value] of Object.entries(filters))if(value!==undefined&&value!==null&&value!=='')params.set(key,String(value));return params.toString();}
function keyFor(account:string,path:string){syncIdentity();return account+':'+path;}
function observeAbort<T>(request:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return request;
  if(signal.aborted)return Promise.reject(new DOMException('Request cancelled.','AbortError'));
  return new Promise((resolve,reject)=>{const cancelled=()=>reject(new DOMException('Request cancelled.','AbortError'));signal.addEventListener('abort',cancelled,{once:true});request.then(value=>{signal.removeEventListener('abort',cancelled);if(!signal.aborted)resolve(value);},error=>{signal.removeEventListener('abort',cancelled);if(!signal.aborted)reject(error);});});
}
function peek<T>(account:string,path:string):T|null{return reads.peek(keyFor(account,path),60000) as T|null;}
async function read<T>(account:string,path:string,force=false,signal?:AbortSignal,operations=false):Promise<T>{
  await auth.authStateReady();const scope=syncIdentity(),epoch=generation;
  const request=reads.read(keyFor(account,path),async()=>{
    const result=operations?await operation<T>(path,{}, {background:true,force}):await communityRequest<T>(path);
    if(syncIdentity()!==scope||epoch!==generation)throw new Error('Your account or work details changed. Refresh this view.');
    return result;
  },{freshMs:10000,force}) as Promise<T>;
  return observeAbort(request,signal);
}
function jobsPath(filters:WorkJobFilters={}){return '/work/jobs?'+queryString({...filters,limit:Math.min(30,Math.max(1,filters.limit||20))});}
export const peekWorkJobs=(account:string,filters:WorkJobFilters={})=>peek<WorkJobsPage>(account,jobsPath(filters));
export const workJobs=(account:string,filters:WorkJobFilters={},force=false,signal?:AbortSignal)=>read<WorkJobsPage>(account,jobsPath(filters),force,signal);
export const peekWorkInterests=(account:string)=>peek<WorkInterests>(account,'/work/interests');
export const workInterests=(account:string,force=false,signal?:AbortSignal)=>read<WorkInterests>(account,'/work/interests',force,signal);
const applicationsPath=(cursor='')=>'/contractor/hiring/applications?'+queryString({scope:'mine',limit:24,cursor});
export const peekWorkApplications=(account:string)=>peek<WorkApplicationsPage>(account,applicationsPath());
export const workApplications=(account:string,cursor='',force=false,signal?:AbortSignal)=>read<WorkApplicationsPage>(account,applicationsPath(cursor),force,signal,true);
export const workApplication=(account:string,id:string,force=false,signal?:AbortSignal)=>read<WorkApplication>(account,'/contractor/hiring/applications/'+encodeURIComponent(id),force,signal,true);
const companiesPath=(filters:{query?:string;city?:string;trade?:Trade|'all';cursor?:string}={})=>'/companies?'+queryString({...filters,limit:20});
export const peekWorkCompanies=(account:string,filters:{query?:string;city?:string;trade?:Trade|'all'}={})=>peek<WorkCompaniesPage>(account,companiesPath(filters));
export const workCompanies=(account:string,filters:{query?:string;city?:string;trade?:Trade|'all';cursor?:string}={},force=false,signal?:AbortSignal)=>read<WorkCompaniesPage>(account,companiesPath(filters),force,signal);
export const workCompanyDetails=(account:string,id:string,force=false,signal?:AbortSignal)=>read<WorkCompanyDetails>(account,'/companies/'+encodeURIComponent(id),force,signal);
export const workPlacement=(account:string,id:string,force=false,signal?:AbortSignal)=>read<WorkPlacement>(account,'/placements/'+encodeURIComponent(id),force,signal);
export const workCachedRead=<T,>(account:string,path:string,force=false,signal?:AbortSignal)=>read<T>(account,path,force,signal);
export const workCachedPeek=<T,>(account:string,path:string)=>peek<T>(account,path);
export const workPreferences=(account:string,force=false,signal?:AbortSignal)=>read<{preferences:WorkPreferences}>(account,'/work/preferences',force,signal);
export const peekWorkPreferences=(account:string)=>peek<{preferences:WorkPreferences}>(account,'/work/preferences');
async function mutation<T>(run:()=>Promise<T>){await auth.authStateReady();const scope=syncIdentity();const result=await run();if(syncIdentity()!==scope)throw new Error('Your account changed. Reopen this view.');changed();return result;}
export const applyForWork=(id:string,hiringVersion:number,note:string,workerType?:string)=>mutation(()=>operation('/contractor/projects/'+encodeURIComponent(id)+'/apply',{method:'POST',body:JSON.stringify({hiring_version:hiringVersion,note:note.trim(),available:true,...(workerType?{worker_type:workerType}:{})})},{background:true}));
export const withdrawWorkApplication=(id:string,version:number)=>mutation(()=>operation('/contractor/hiring/applications/'+encodeURIComponent(id)+'/withdraw',{method:'POST',body:JSON.stringify({expected_version:version})},{background:true}));
export const respondToWorkOffer=(projectId:string,projectVersion:number,invitationId:string,action:'accept'|'decline')=>mutation(()=>operation('/contractor/projects/'+encodeURIComponent(projectId)+'/commands',{method:'POST',body:JSON.stringify({expected_version:projectVersion,action,target_id:invitationId})},{background:true}));
export const updateWorkPreferences=(preferences:Partial<WorkPreferences>)=>mutation(()=>communityRequest<{preferences:WorkPreferences}>('/work/preferences',{method:'PATCH',body:JSON.stringify(preferences)}));
export const workCall=<T,>(path:string,body?:object,method=body?'POST':'GET')=>method==='GET'?communityRequest<T>(path):mutation(()=>communityRequest<T>(path,{method,...(body?{body:JSON.stringify(body)}:{})}));
export const contractDiscovery=<T,>(account:string,filters:{trade?:string;query?:string;city?:string;sector?:string;limit?:number;cursor?:string}={},force=false,signal?:AbortSignal)=>read<T>(account,'/work/contracts?'+queryString(filters),force,signal);
export const watchContract=(id:string,active:boolean)=>workCall<{active:boolean}>('/work/contracts/'+encodeURIComponent(id)+'/watch',{active},'PUT');
export const congratulatePlacement=(id:string,message:WorkCongratulations,clientId:string)=>mutation(()=>communityRequest<{congratulated:boolean}>('/placements/'+encodeURIComponent(id)+'/congratulate',{method:'POST',body:JSON.stringify({clientId,message})}));
export async function trackWorkBehavior(account:string,event:{trade:Trade;type:'search'|'view'|'apply'|'save';query?:string;sourceId?:string;eventId?:string}){
  await auth.authStateReady();const scope=syncIdentity();
  await communityRequest('/work/behavior',{method:'POST',body:JSON.stringify({...event,query:event.query?.slice(0,120),eventId:event.eventId||crypto.randomUUID()})});
  if(syncIdentity()===scope){reads.invalidate();window.dispatchEvent(new CustomEvent('repaidians:work-interests',{detail:{account}}));}
}
