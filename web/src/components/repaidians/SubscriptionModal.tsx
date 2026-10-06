import {useEffect,useRef,useState} from 'react';
import {Check,Crown,Gift,ShieldCheck} from 'lucide-react';
import {Modal} from '../ui';
import {loadCheckout} from '../PaymentPanel';
import {PRO_PRICE_RUPEES,subscriptionOrder,subscriptionStatus} from '../../services/repaidiansService';
import type {SubscriptionStatus} from '../../types/repaidians';
const expiry=(at:number)=>new Date(at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST';
export function SubscriptionModal({reason,onClose,onActivated}:{account?:string;reason:string;onClose:()=>void;onActivated:()=>void}) {
  const [data,setData]=useState<SubscriptionStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[agreed,setAgreed]=useState(false),[message,setMessage]=useState(''),[now,setNow]=useState(Date.now());
  const clock=useRef({ms:Date.now(),at:performance.now()}),alive=useRef(true);
  const apply=(status:SubscriptionStatus)=>{if(!alive.current)return;clock.current={ms:status.serverNow??Date.now(),at:performance.now()};setNow(clock.current.ms);setData(status);};
  const refresh=async(check=false)=>{const status=await subscriptionStatus(check);apply(status);return status;};
  useEffect(()=>{alive.current=true;void subscriptionStatus().then(apply).catch(e=>{if(alive.current)setError((e as Error).message);});const timer=setInterval(()=>setNow(clock.current.ms+performance.now()-clock.current.at),1000);return()=>{alive.current=false;clearInterval(timer);};},[]);
  useEffect(()=>{if(!data?.subscription)return;const remaining=data.subscription.endsAt-(clock.current.ms+performance.now()-clock.current.at);if(remaining<=0){void refresh().catch(e=>setError((e as Error).message));return;}const timer=setTimeout(()=>void refresh().catch(e=>setError((e as Error).message)),Math.min(remaining+50,2147483647));return()=>clearTimeout(timer);},[data?.subscription?.endsAt,data?.subscription?.plan]);
  const activeTrial=!!data?.active&&data.subscription?.plan==='trial'&&data.subscription.endsAt>now;
  const paid=!!data?.active&&data.subscription?.plan==='pro'&&data.subscription.endsAt>now;
  const trialEnded=!!data?.trial&&!activeTrial&&!paid&&(data.trial.status==='expired'||data.trial.endsAt<=now);
  const trialDays=activeTrial?Math.max(1,Math.ceil((data!.subscription!.endsAt-now)/86400000)):0;
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{if(alive.current)setBusy(false);}};
  const acknowledgePayment=(status:SubscriptionStatus)=>{
    if(status.paymentStatus==='captured'){
      if(status.active&&status.subscription?.plan==='pro')onActivated();
      else if(status.subscription?.plan==='trial')setMessage('Payment confirmed. Your paid month starts after your free trial ends.');
      else setMessage('Payment is confirmed. Refresh your membership to check its activation.');
    }else setMessage('No captured payment has been confirmed yet. Check its status before trying again.');
  };
  const pay=()=>run(async()=>{
    if(activeTrial)return;
    const order=await subscriptionOrder();
    if(order.settled){acknowledgePayment(await refresh(true));return;}
    await loadCheckout();
    await new Promise<void>((resolve,reject)=>{
      const checkout=new window.Razorpay!({key:order.key_id,order_id:order.order_id,amount:order.amount,currency:order.currency,name:'Repaidians',description:'Repaidians Pro · one calendar month',
        handler:()=>{void refresh(true).then(status=>{acknowledgePayment(status);resolve();}).catch(reject);},
        modal:{ondismiss:()=>{setMessage('Checkout closed. Check payment status before retrying.');resolve();}}});
      checkout.on('payment.failed',()=>reject(new Error('Payment was not confirmed. Check its status before retrying.')));checkout.open();
    });
  });
  return <Modal title="Repaidians membership" className="rp-dialog rp-upgrade" onClose={onClose}>
    <span className="rp-kicker">{activeTrial?<Gift size={17}/>:<Crown size={17}/>} {activeTrial?'Your craft, without limits':'More space for your craft'}</span>
    <h3>{activeTrial?'Every feature. 30 days free.':trialEnded?'Keep your community growing.':'Your work deserves an audience.'}</h3><p>{activeTrial?'Your free trial includes unlimited browsing and every social feature. No purchase is needed during your trial.':trialEnded?'Your free trial has ended. Continue with Repaidians Pro to browse, publish, bid and message.':reason}</p>
    <div className="rp-trial-terms"><Gift size={20}/><p><strong>30 days free from first joining Repaidians.</strong><span>₹{PRO_PRICE_RUPEES}/month after your trial, with manual payment and renewal. No automatic charge.</span></p></div>
    {activeTrial?<><div className="rp-membership-badge"><Gift size={16}/>Free trial · {trialDays} {trialDays===1?'day':'days'} remaining</div><p className="rp-fine">Your trial ends <time dateTime={new Date(data!.subscription!.endsAt).toISOString()}>{expiry(data!.subscription!.endsAt)}</time>.</p></>:<div className="rp-price"><strong>₹{PRO_PRICE_RUPEES}</strong><span>/ month</span></div>}
    <ul className="rp-benefits">{['Unlimited community browsing','Photo posts, reels and 24-hour stories','Tender bids and contact details','Private messages and story replies'].map(text=><li key={text}><Check size={18}/>{text}</li>)}</ul>
    {!activeTrial&&<p className="rp-notice"><ShieldCheck size={20}/><span>Secure Razorpay checkout, including UPI. One calendar month from activation, with manual renewal and no automatic debit.</span></p>}
    {error&&<p className="rp-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {!data&&!error&&<p role="status">Checking your membership…</p>}
    {activeTrial&&<button className="rp-primary" onClick={onClose}>Keep exploring · free trial</button>}
    {paid&&<p role="status">Paid Pro is active until <time dateTime={new Date(data!.subscription!.endsAt).toISOString()}>{expiry(data!.subscription!.endsAt)}</time>.</p>}
    {data&&!activeTrial&&!paid&&<><label className="rp-consent"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>I agree to pay ₹199 for one calendar month of Repaidians Pro.</label><button className="rp-primary" disabled={busy||!agreed||!data.paymentsReady} onClick={()=>void pay()}><Crown size={18}/>{busy?'Checking payment…':'Pay ₹199 for one month'}</button>{!data.paymentsReady&&<p className="rp-fine" role="status">Paid checkout is awaiting activation. No purchase can be made yet.</p>}</>}
    {data&&!activeTrial&&<button className="rp-secondary" disabled={busy} onClick={()=>void run(async()=>acknowledgePayment(await refresh(true)))}>Check payment status</button>}
  </Modal>;
}
