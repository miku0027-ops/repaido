import {useEffect,useRef,useState} from 'react';
import {Clock,BriefcaseBusiness,Pause,ShieldCheck} from '../icons';
import {apiFetch} from '../services/api';
import {money,operation,type Job} from '../services/operations';
import {PaymentPanel} from './PaymentPanel';
import './hourly-hire.css';

export type HireAvailability={state:'reserved'|'at_work'|'hired'|'meal_break'|'available'|'not_confirmed'|'finishing_review';label:string;available_at:number|null;estimated:boolean;checked_at:number};
export function HireAvailabilityBadge({workerId,initial,live=false}:{workerId?:string;initial?:HireAvailability|null;live?:boolean}){
 const [value,setValue]=useState(initial),[failed,setFailed]=useState(false),[now,setNow]=useState(Date.now()/1000);
 useEffect(()=>{setValue(initial);setFailed(false);},[initial,workerId]);
 useEffect(()=>{if(!live||!workerId)return;let active=true,loading=false;const controller=new AbortController();
  const load=async()=>{if(document.hidden||loading)return;loading=true;try{const response=await apiFetch('/api/operations/hiring/availability/'+encodeURIComponent(workerId),{signal:controller.signal,cache:'no-store'},{background:true,feedback:false});if(!response.ok)throw Error();const data=await response.json();if(active){setValue(data.availability);setFailed(false);setNow(Date.now()/1000);}}catch{if(active)setFailed(true);}finally{loading=false;}};
  void load();const id=setInterval(()=>{setNow(Date.now()/1000);void load();},30000);document.addEventListener('visibilitychange',load);return()=>{active=false;controller.abort();clearInterval(id);document.removeEventListener('visibilitychange',load);};
 },[live,workerId]);
 if(!value)return null;
 const stale=failed||now-value.checked_at>90,working=!['available','not_confirmed'].includes(value.state);
 return <span className="hourly-availability" data-state={stale?'not_confirmed':value.state}>
  {working?<BriefcaseBusiness size={14} aria-hidden="true"/>:<Clock size={14} aria-hidden="true"/>}
  <span><strong>{stale?'Availability needs refreshing':value.label}</strong>{!stale&&working&&value.available_at&&<small>Next estimate · {new Date(value.available_at*1000).toLocaleString('en-IN',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</small>}</span>
 </span>;
}

function workTime(seconds:number){const minutes=Math.floor(seconds/60);return `${Math.floor(minutes/60)}h ${minutes%60}m ${Math.floor(seconds%60)}s`;}
export function HourlyHirePanel({job,worker=false,onRefresh,onAction,busy=false}:{job:Job;worker?:boolean;onRefresh:()=>Promise<void>;onAction?:(action:string)=>Promise<unknown>;busy?:boolean}){
 const [elapsed,setElapsed]=useState(0),[error,setError]=useState(''),[checking,setChecking]=useState(false);
 const refreshRef=useRef(onRefresh);refreshRef.current=onRefresh;
 useEffect(()=>{setElapsed(0);const received=Date.now();const id=setInterval(()=>setElapsed((Date.now()-received)/1000),1000);return()=>clearInterval(id);},[job.server_time]);
 useEffect(()=>{if(!job.hourly_hire||['completed','cancelled'].includes(job.state))return;let running=false;const id=setInterval(()=>{if(document.hidden||running)return;running=true;void refreshRef.current().catch(()=>{}).finally(()=>{running=false;});},15000);return()=>clearInterval(id);},[job.id,job.state,!!job.hourly_hire]);
 if(!job.hourly_hire||!job.hourly_bill)return null;
 const terms=job.hourly_hire,bill=job.hourly_bill,breakActive=job.hire_break?.state==='active',pending=job.hire_base_status==='pending'&&job.state==='accepted',expired=pending&&(job.hire_payment_expires_at||0)<=job.server_time+elapsed;
 const seconds=Math.min(terms.planned_minutes*60,bill.billable_seconds+(bill.timer_running?Math.min(30,elapsed):0));
 const breakLeft=breakActive?Math.max(0,Math.ceil(((job.hire_break?.until||0)-job.server_time-elapsed)/60)):0;
 const status=expired?'Reservation expired':pending?'Advance due':job.hire_base_status==='refund_review'?'Refund review':job.state==='cancelled'?'Cancelled':bill.limit_reached?'Work limit reached':breakActive?'Unpaid meal break':bill.timer_running?'Work in progress':job.state==='completed'?'Work completed':'Reserved work time';
 const check=async()=>{setChecking(true);setError('');try{await operation(`/jobs/${job.id}/hire-base/payment-check`,{method:'POST'});await onRefresh();}catch(e){setError((e as Error).message);}finally{setChecking(false);}};
 return <section className="hourly-hire-panel" aria-label="Hourly hire billing">
  <header><span className="hourly-hire-symbol"><Clock size={20} aria-hidden="true"/></span><div><small>PERSONAL HIRING</small><h3>{status}</h3></div><span className="hourly-rate">₹150 / hr</span></header>
  <div className="hourly-work-meter"><div><small>Recorded work{bill.timer_running?' · live estimate':''}</small><strong>{workTime(seconds)}</strong></div><span>Up to {terms.planned_minutes} min<br/>+ 30 min unpaid break</span></div>
  <progress max={terms.planned_minutes*60} value={seconds} aria-label="Agreed work time used"/>
  {bill.timer_running&&elapsed>30&&<p role="status">Waiting for a fresh timing update. Charges use the server record.</p>}
  {breakActive&&<p className="hourly-break"><Pause size={16} aria-hidden="true"/>{breakLeft?`${breakLeft} min until work can resume.`:'Break time completed. Resume when ready.'} Billing stays paused until the worker resumes.</p>}
  {worker&&onAction&&<div className="hourly-actions">{job.allowed_actions.includes('start_meal_break')&&<button disabled={busy} onClick={()=>void onAction('start_meal_break')}><Pause size={16} aria-hidden="true"/>Start 30-minute break</button>}{job.allowed_actions.includes('resume_after_break')&&<button disabled={busy} onClick={()=>void onAction('resume_after_break')}>Resume work</button>}</div>}
  <details className="hourly-bill-details"><summary>Bill &amp; recorded charges <strong>{money(bill.total_paise)}</strong></summary><dl className="hourly-bill"><div><dt>Booking base</dt><dd>{money(bill.base_paise)}</dd></div><div><dt>Recorded work · ₹2.50/min</dt><dd>{money(bill.work_paise)}</dd></div>{bill.surcharge_bps>0&&<div><dt>Locked demand rate · {bill.surcharge_bps/100}%</dt><dd>{money(bill.surcharge_paise)}</dd></div>}{bill.gst_paise>0&&<div><dt>GST</dt><dd>{money(bill.gst_paise)}</dd></div>}<div><dt>Advance verified</dt><dd>−{money(bill.advance_paid_paise)}</dd></div><div className="hourly-bill-total"><dt>{['completed','completion_pending'].includes(job.state)?'Service balance':'Service balance so far'}</dt><dd>{money(bill.remaining_service_paise)}</dd></div></dl>
  <p className="hourly-caption"><ShieldCheck size={14} aria-hidden="true"/>Actual work only. Meal breaks and parts collection are unpaid. Agreed service ceiling: {money(terms.quoted_service_total_paise)}. Separately approved materials are extra.</p></details>
  {pending&&!expired&&<p>{worker?'Waiting for the customer’s verified advance. Do not travel yet.':'Pay the booking advance to confirm your slot.'} Reservation expires {new Date((job.hire_payment_expires_at||0)*1000).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'})}.</p>}
  {expired&&<p>The payment window ended. Check any payment already made before creating another request.</p>}{!worker&&pending&&!expired&&<p className="hourly-upfront"><strong>{money(terms.booking_advance_paise)} due upfront</strong> · credited to your final bill</p>}{!worker&&pending&&!expired&&<PaymentPanel job={job} hireBase onRefresh={onRefresh}/>}
  {!worker&&job.hire_base_status!=='captured'&&<button disabled={checking} onClick={()=>void check()}>{checking?'Checking gateway…':'Check booking payment'}</button>}
  {job.hire_base_status==='refund_review'&&<p role="status">This payment needs refund review. It has not confirmed a new visit. Contact support with this booking.</p>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
