import {useEffect,useRef,useState} from 'react';
import {ReceiptText,ChevronDown} from '../icons';
import {auth} from '../firebase';
import {useOperationResource} from '../hooks/useOperationResource';
import {money,operation} from '../services/operations';
import './booking-payment-recovery.css';

type Case={id:string;service_id:string;state:string;starts_at:string;version:number;amount_paise:number;booking_id?:string;available_starts?:string[]};
const labels:Record<string,string>={checking_payment:'Check payment',confirmation_pending:'Confirming booking',action_required:'Choose another time',fulfilled:'Booking confirmed',refund_submitting:'Checking refund',refund_pending:'Refund processing',refunded:'Refund completed',refund_failed:'Refund needs review'};
const appointment=(value:string)=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(value));

export function BookingPaymentRecovery(){
  const [after,setAfter]=useState('');
  const resource=useOperationResource<{cases:Case[];next:string|null}>('/booking-checkout'+(after?'?after='+encodeURIComponent(after):''),60000);
  if(!resource.uid)return null;
  if(!resource.error&&!resource.data?.cases.length)return null;
  return <details className="booking-payment-recovery">
    <summary><ReceiptText size={22} aria-hidden="true"/><strong>Booking payments</strong><ChevronDown size={18} aria-hidden="true"/></summary>
    <div className="booking-payment-recovery-body">
      {resource.error&&<div role="alert"><p>{resource.error}</p><button onClick={()=>void resource.refresh()}>Retry</button></div>}
      {resource.data?.cases.map(record=><Payment key={resource.uid+record.id} record={record} refresh={()=>resource.refresh(false,false)}/>)}
      {(after||resource.data?.next)&&<div className="booking-payment-actions">{after&&<button onClick={()=>setAfter('')}>First page</button>}{resource.data?.next&&<button onClick={()=>setAfter(resource.data!.next!)}>More payments</button>}</div>}
    </div>
  </details>;
}

function Payment({record,refresh}:{record:Case;refresh:()=>Promise<void>}){
  const [current,setCurrent]=useState(record),[error,setError]=useState(''),[busy,setBusy]=useState(false),[time,setTime]=useState(''),[refundReview,setRefundReview]=useState(false);
  const lock=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{setCurrent(previous=>record.version>previous.version?record:previous);},[record]);
  const act=async(action:string,body?:object)=>{
    if(lock.current)return;
    const uid=auth.currentUser?.uid;
    lock.current=true;setBusy(true);setError('');
    try{
      const result=await operation<Case>('/booking-checkout/'+encodeURIComponent(current.id)+'/'+action,{method:'POST',...(body?{body:JSON.stringify(body)}:{})});
      if(alive.current&&uid===auth.currentUser?.uid){setCurrent(result);setRefundReview(false);await refresh();}
    }catch(problem){if(alive.current&&uid===auth.currentUser?.uid)setError((problem as Error).message);}
    finally{lock.current=false;if(alive.current&&uid===auth.currentUser?.uid)setBusy(false);}
  };
  return <article className="booking-payment-card">
    <div className="booking-payment-heading"><div><strong>{current.service_id.replaceAll('-',' ')}</strong><span>{labels[current.state]||'Payment review'}</span></div><b>{money(current.amount_paise)}</b></div>
    <p>{appointment(current.starts_at)} · IST</p>
    {current.state==='fulfilled'&&<p>Booking reference: <code>{current.booking_id}</code></p>}
    {current.state==='action_required'&&<p>Your payment is saved. Choose a new time or request a full refund.</p>}
    {current.state==='refund_failed'&&<p>Contact Repaido support with the payment reference below. Another refund will require review.</p>}
    {current.state==='refund_submitting'&&<p>The provider outcome is being checked. No additional refund will be submitted.</p>}
    {error&&<p role="alert">{error}</p>}
    {!['fulfilled','refunded','refund_failed'].includes(current.state)&&<div className="booking-payment-actions"><button disabled={busy} onClick={()=>void act('check')}>{busy?'Checking…':'Check status'}</button>
      {current.state==='action_required'&&<button disabled={busy} onClick={()=>setRefundReview(value=>!value)}>Refund options</button>}
    </div>}
    {current.state==='action_required'&&!!current.available_starts?.length&&<form className="booking-payment-time" onSubmit={event=>{event.preventDefault();void act('reschedule',{expected_version:current.version,starts_at:time});}}>
      <label htmlFor={'booking-payment-time-'+current.id}>New appointment</label><select id={'booking-payment-time-'+current.id} required value={time} disabled={busy} onChange={event=>setTime(event.target.value)}><option value="">Choose a time · IST</option>{current.available_starts.map(value=><option key={value} value={value}>{appointment(value)}</option>)}</select>
      <button disabled={busy||!time}>Use saved payment</button>
    </form>}
    {refundReview&&current.state==='action_required'&&<div className="booking-payment-refund"><p>Refund {money(current.amount_paise)} to your original payment method? This ends this unconfirmed checkout.</p><div className="booking-payment-actions"><button disabled={busy} onClick={()=>void act('refund',{expected_version:current.version})}>Request full refund</button><button disabled={busy} onClick={()=>setRefundReview(false)}>Keep payment</button></div></div>}
    <details className="booking-payment-reference"><summary>Payment reference</summary><code>{current.id}</code></details>
  </article>;
}
