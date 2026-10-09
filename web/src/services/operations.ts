import type {RepaidianBadgeMetadata} from '../components/RepaidianBadge';
import {readDeviceLocation} from './deviceLocation.mjs';
import { apiFetch } from './api';
import { auth } from '../firebase';
import {beginLoading} from './loading';
import {createReadCache} from './readCache.mjs';
import {withActionFeedback} from './actionFeedback';
import {quietRequest,changesAccountData} from './actionMessages.mjs';
const operationCache=createReadCache();
let cacheAccount='';
function accountScope(){return auth.currentUser?.uid||localStorage.getItem('repaido.token')||'';}
function syncAccount(){const scope=accountScope();if(scope!==cacheAccount){operationCache.invalidate();cacheAccount=scope;}return scope;}
export function operationSnapshot<T>(path:string):T|null {const scope=syncAccount();return scope?operationCache.peek(scope+':'+path) as T|null:null;}
export function invalidateOperationReads(){operationCache.invalidate();window.dispatchEvent(new Event('repaido:operations-updated'));}

export interface Job {
  coupon?:{code:string;bps:number;discount_paise:number};vendor_discount_paise?:number;
  service_id:string;
  home_plan_id?:string;home_brief_rows?:{label:string;value:string}[];home_log_required?:boolean;home_checklist?:string[];home_arrival_log?:{hygiene:boolean;checked:number[];note:string;at:number};home_daily_log?:{hygiene:boolean;checked:number[];note:string;at:number};
  promotion_discount_paise?:number; promotion?:{id:string;title:string;discount_paise:number;terms:string};
  service_terms?:{version:number;text:string};
  parts_paid_paise?:number; parts_refund_hold?:boolean; procurement_version?:number; arrival_verified_visit?:string; id: string; visit_id:string; is_follow_up?:boolean; follow_up_reason?:string; follow_up_purpose?:string; version: number; state: string; service_name: string; category: string;
  starts_at: string; starts_epoch: number; total_paise: number; base_price_paise: number;
  city: string; address?: string; phone?: string; notes?: string; location?: {lat:number;lng:number};
  worker_id?: string; worker_name?: string; worker_role?: string;
  reminder_at: number; reminder_ack_at?: number; offer_expires_at?: number;
  server_time: number; distance_metres: number | null; payment_status: string; payout_status: string;
  allowed_actions: string[]; blockers: string[];
  proposal?: {id:string;status:string;amount_paise:number;items:{name:string;quantity:number;unit_price_paise:number}[]};
  penalties: {visit_id:string;code:string;current_percent:number;next_task_percent?:number;status:string}[];
  events: {event_id:string;event_type:string;occurred_at_server_time:number}[];
  completion_notes?: string; invoice?: {id:string;total_paise:number;status:string};
  review?: {rating:number;text:string};
  pickup_locations?: {name:string;location:{lat:number;lng:number}}[];
  scopes: {credit_paise?:number;version:number;price_paise:number;quote?:{items:{name:string;quantity:number;unit_price_paise:number}[]}}[];
  forgotten_info?: string;
  before_omission_reason?: string;
  evidence_summary?: {
    has_before: boolean;
    has_after: boolean;
    has_forgotten_info: boolean;
    before_omission_reason: string;
    count: number;
  };
}
export interface LiveWorker {
  portrait_url?:string;repaidianBadge?:RepaidianBadgeMetadata|null;
  dob?:string; home_address?:string; location?:{lat:number;lng:number}; requested_role?:string; experience_years?:number; radius_km?:number;
  id:string; name:string; phone:string; status:string; role:string; city:string;
  categories:string[]; skills:string[]; tools:string[]; online:boolean; points:number;
  completed_tasks:number; rating_sum:number; rating_count:number; review_reason?:string;
}
export async function operation<T>(path:string, init:RequestInit={}, options:{background?:boolean;force?:boolean}={}):Promise<T> {
  return withActionFeedback(path,init,()=>performOperation<T>(path,init,options));
}
async function performOperation<T>(path:string, init:RequestInit, options:{background?:boolean;force?:boolean}):Promise<T> {
  await auth.authStateReady();
  const scope=syncAccount();
  const token = auth.currentUser?await auth.currentUser.getIdToken():localStorage.getItem('repaido.token');
  if(accountScope()!==scope)throw new Error('Your account changed. Reopen this view.');
  if (!token) throw new Error('Sign in to view your account.');
  const read=(init.method||'GET').toUpperCase()==='GET';
  const cached=['/jobs','/notifications','/hiring/requests','/home/plans','/local-business/rides','/local-business/scrap','/local-business/shared','/worker/profile-progress'].includes(path);
  const done=(options.background??quietRequest(path,init))?()=>{}:beginLoading(path);
  const load=async()=>{
    const response = await apiFetch(`/api/operations${path}`, {...init, signal:init.signal, headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`, ...init.headers}}, {background:true,feedback:false});
    const body = await response.json().catch(()=>({}));
    if (!response.ok) {
      if([401,402,403,404].includes(response.status))operationCache.invalidate();
      throw Object.assign(new Error(body.detail?.message || (Array.isArray(body.detail)?body.detail.map((d:{loc?:string[];msg?:string})=>`${d.loc?.slice(1).join(' ')}: ${d.msg}`).join('. '):null) || (typeof body.detail==='string'?body.detail:null) || (response.status===401?'Your sign-in expired. Sign in again.':'Unable to connect. Check your connection and retry.')),{status:response.status});
    }
    if(accountScope()!==scope)throw new Error('Your account changed. Reopen this view.');
    return body as T;
  };
  try {
    const result=read&&!init.signal?await operationCache.read(scope+':'+path,load,{freshMs:cached?10000:0,force:options.force}):await load();
    if(accountScope()!==scope)throw new Error('Your account changed. Reopen this view.');
    if(!read&&/^\/notifications\/(?:[^/]+\/read|read-all)$/.test(path))operationCache.invalidate(scope+':/notifications');
    if(changesAccountData(path,init))invalidateOperationReads();
    return result as T;
  }finally{done();}
}
const pending = new Map<string, {command_id:string;action:string;expected_version:number;payload:object}>();
export async function jobCommand(job:Job, action:string, payload:object={}):Promise<Job> {
  // Keep the same command across uncertain network retries. A changed version is a new intent.
  const key = `${job.id}:${job.version}:${action}:${JSON.stringify(payload)}`;
  const command = pending.get(key) || {command_id:crypto.randomUUID(), action, expected_version:job.version, payload};
  pending.set(key, command);
  const result = await operation<Job>(`/jobs/${job.id}/commands`, {method:'POST', body:JSON.stringify(command)});
  pending.delete(key);
  window.dispatchEvent(new Event('repaido:job-updated'));
  return result;
}
export async function currentPosition(registration=false) {
  return readDeviceLocation(navigator.geolocation,{registration,secure:window.isSecureContext});
}
export const money = (paise:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(paise/100);
