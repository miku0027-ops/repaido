import {ArrowRight,BadgeCheck,CalendarDays,ChevronDown,CircleAlert,MapPin,Navigation,UserRound,Wrench} from 'lucide-react';
import type {Job} from '../services/operations';
import {money} from '../services/operations';
import {customerCardState} from '../services/customerBookings.mjs';
import {taskProgress} from '../services/taskStages.mjs';
import {seededServices} from '../data';
import ServiceImage from './ServiceImage';
export default function CustomerBookingCard({job,onOpen,onRebook}:{job:Job;onOpen:()=>void;onRebook?:()=>void}){
 const view=customerCardState(job),progress=taskProgress(job),service=seededServices.find(s=>s.id===job.service_id);
 const archived=['completed','cancelled'].includes(job.state);
 const StatusIcon=view.tone==='success'?BadgeCheck:view.tone==='attention'||view.tone==='review'?CircleAlert:Navigation;
 const payment=({verified:'Payment verified',pay_after_service:'Pay after service',partially_refunded:'Partially refunded',refunded:'Refunded',refund_review:'Refund review',no_payment_due:'No payment due'} as Record<string,string>)[job.payment_status]||job.payment_status.replaceAll('_',' ');
 return <article className="customer-booking-card" data-tone={view.tone} data-moving={view.moving}>
  <div className="booking-card-status"><span><StatusIcon size={14} aria-hidden="true"/>{view.label}</span><small>#{job.id.slice(0,8)}</small></div>
  <button className="booking-card-open" onClick={onOpen} aria-label={`${view.action}: ${job.service_name}`}>
   <span className="booking-card-service">{service?<ServiceImage service={service} className="booking-service-photo" decorative/>:<span className="booking-service-photo booking-photo-placeholder"><Wrench size={25} aria-hidden="true"/></span>}<span><strong>{job.service_name}</strong><span className="booking-visit"><CalendarDays size={12} aria-hidden="true"/>{new Date(job.starts_at).toLocaleString('en-IN',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</span><span className="booking-visit"><MapPin size={12} aria-hidden="true"/>{job.city}</span></span></span>
   <span className="booking-agent"><span className="booking-agent-icon"><UserRound size={17} aria-hidden="true"/></span><span><strong>{job.worker_name||(archived?'Professional not assigned or recorded':'Matching a professional')}</strong><small>{job.worker_name?`${job.worker_role||'Professional'}${job.state==='offered'?' · awaiting acceptance':''}`:archived?'Historical booking record':'Assigned details will appear here'}</small></span><span className="booking-bill"><strong>{money(job.total_paise)}</strong><small>{job.state==='cancelled'?'Original total':'Approved total'}</small></span></span>
   {!['cancelled','disputed','stop_requested'].includes(job.state)&&<span className="booking-stage-summary"><span className="booking-stage-track" role="progressbar" aria-label="Confirmed visit stages" aria-valuemin={0} aria-valuemax={5} aria-valuenow={progress.completed} aria-valuetext={`${progress.completed} of 5 visit stages confirmed`}>{[0,1,2,3,4].map(n=><span key={n} data-done={n<progress.completed}/>)}</span><small>{progress.completed}/5 visit stages confirmed</small></span>}
   <span className="booking-card-action"><span>{view.action}</span><ArrowRight size={16} aria-hidden="true"/></span>
  </button>
  <details className="booking-card-more"><summary>Visit details & payment <ChevronDown size={13} aria-hidden="true"/></summary><div><p>{view.hint}</p><dl><dt>Payment</dt><dd>{payment}</dd>{job.address&&<><dt>Service address</dt><dd>{job.address}</dd></>}{job.notes&&<><dt>Your instructions</dt><dd>{job.notes}</dd></>}</dl><p>Open the booking to use the controls available at its current stage.</p></div></details>
  {job.state==='completed'&&onRebook&&<button className="booking-rebook" onClick={onRebook}>Book this service again <ArrowRight size={14} aria-hidden="true"/></button>}
 </article>;
}
