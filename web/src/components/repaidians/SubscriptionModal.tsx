import {useEffect,useState} from 'react';
import {Check,Crown,ShieldCheck} from 'lucide-react';
import {Modal} from '../ui';
import {loadCheckout} from '../PaymentPanel';
import {PRO_PRICE_RUPEES,subscriptionOrder,subscriptionStatus} from '../../services/repaidiansService';
import type {SubscriptionStatus} from '../../types/repaidians';
export function SubscriptionModal({reason,onClose,onActivated}:{account?:string;reason:string;onClose:()=>void;onActivated:()=>void}) {
  const [data,setData]=useState<SubscriptionStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[agreed,setAgreed]=useState(false),[message,setMessage]=useState('');
  const refresh=async(check=false)=>{const status=await subscriptionStatus(check);setData(status);return status;};
  useEffect(()=>{let active=true;void subscriptionStatus().then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[]);
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const pay=()=>run(async()=>{
    const order=await subscriptionOrder();
    if(order.settled){const status=await refresh();if(status.active)onActivated();return;}
    await loadCheckout();
    await new Promise<void>((resolve,reject)=>{
      const checkout=new window.Razorpay!({key:order.key_id,order_id:order.order_id,amount:order.amount,currency:order.currency,name:'Repaidians',description:'Repaidians Pro · one calendar month',
        handler:()=>{void refresh(true).then(status=>{if(status.active)onActivated();else setMessage('Payment is being confirmed. Check its status before trying again.');resolve();}).catch(reject);},
        modal:{ondismiss:()=>{setMessage('Checkout closed. Check payment status before retrying.');resolve();}}});
      checkout.on('payment.failed',()=>reject(new Error('Payment was not confirmed. Check its status before retrying.')));checkout.open();
    });
  });
  return <Modal title="Repaidians Pro" className="rp-dialog rp-upgrade" onClose={onClose}>
    <span className="rp-kicker"><Crown size={17}/> More space for your craft</span><h3>Your work deserves an audience.</h3><p>{reason}</p>
    <div className="rp-price"><strong>₹{PRO_PRICE_RUPEES}</strong><span>/ month</span></div>
    <ul className="rp-benefits">{['Unlimited community browsing','Photo posts, reels and 24-hour stories','Tender bids and contact details','Private messages and story replies'].map(text=><li key={text}><Check size={18}/>{text}</li>)}</ul>
    <p className="rp-notice"><ShieldCheck size={20}/><span>Secure Razorpay checkout, including UPI. One calendar month from activation, with manual renewal and no automatic debit.</span></p>
    {error&&<p className="rp-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {!data&&!error&&<p role="status">Checking your membership…</p>}
    {data?.active&&<p role="status">Pro is active until {new Date(data.subscription!.endsAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST.</p>}
    {data&&!data.active&&<><label className="rp-consent"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>I agree to pay ₹199 for one calendar month of Repaidians Pro.</label><button className="rp-primary" disabled={busy||!agreed||!data.paymentsReady} onClick={()=>void pay()}><Crown size={18}/>{busy?'Checking payment…':'Pay ₹199 for one month'}</button>{!data.paymentsReady&&<p className="rp-fine" role="status">The payment service is awaiting activation. No purchase can be made yet.</p>}</>}
    <button className="rp-secondary" disabled={busy} onClick={()=>void run(async()=>{const status=await refresh(true);if(status.active)onActivated();else setMessage('No active payment has been confirmed yet.');})}>Check payment status</button>
  </Modal>;
}
