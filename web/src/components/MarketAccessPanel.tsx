import {useEffect,useRef,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {Check,ChevronRight,Clock3,RefreshCw,Info,Store} from '../icons';
import {auth} from '../firebase';
import {operation} from '../services/operations';
import {invalidateMarketAccess,readMarketAccess,type MarketAccess} from '../services/marketAccess';
import {marketPurchaseIntent,acknowledgeMarketPurchase} from '../services/marketPurchaseIntent.mjs';
import {loadCheckout} from './PaymentPanel';
import {Modal} from './ui';
import './market-access.css';

const when=(value:number|null)=>value?new Date(value*1000).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'';
function useAccess(){
 const [uid,setUid]=useState(auth.currentUser?.uid||''),[state,setState]=useState<{uid:string;data:MarketAccess|null;error:string;busy:boolean}>({uid:'',data:null,error:'',busy:false});
 const generation=useRef(0),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
 useEffect(()=>onIdTokenChanged(auth,user=>setUid(user?.uid||'')),[]);
 const refresh=async(force=false)=>{
  const actor=auth.currentUser?.uid||'',sequence=++generation.current;
  if(!actor){setState({uid:'',data:null,error:'',busy:false});return;}
  setState(old=>({uid:actor,data:old.uid===actor?old.data:null,error:'',busy:true}));
  try{const data=await readMarketAccess(force);if(alive.current&&sequence===generation.current&&auth.currentUser?.uid===actor)setState({uid:actor,data,error:'',busy:false});}
  catch(e){if(alive.current&&sequence===generation.current&&(auth.currentUser?.uid||'')===actor)setState(old=>({...old,error:(e as Error).message,busy:false}));}
 };
 useEffect(()=>{
  void refresh();const update=()=>{if(!document.hidden&&navigator.onLine)void refresh();};
  window.addEventListener('repaido:market-access-updated',update);window.addEventListener('focus',update);
  const timer=setInterval(update,60000);
  return()=>{generation.current++;clearInterval(timer);window.removeEventListener('repaido:market-access-updated',update);window.removeEventListener('focus',update);};
 },[uid]);
 return {uid,data:state.uid===uid?state.data:null,error:state.uid===uid?state.error:'',busy:state.uid===uid?state.busy:!!uid,refresh};
}
export function MarketAccessSummary({onOpen}:{onOpen:()=>void}){
 const {uid,data,error}=useAccess();
 const title=data?.status==='trial'?'Your free marketplace period':data?.status==='paid'?'Marketplace access active':data?.status==='expired'?'Keep buying, selling & swapping':'Your local market. One simple plan.';
 const text=data?.active?`Until ${when(data.current_period_ends_at)} · Swaps, used items & messaging`:data?.status==='expired'?'₹99 for one calendar month · Manual renewal':'90 days free, then ₹99/month · Swaps, used items & messaging';
 return <button type="button" className="market-access-summary" onClick={onOpen}><span className="market-access-summary-icon"><Store size={20} aria-hidden="true"/></span><span><strong>{title}</strong><small>{error&&uid?'Plan status unavailable · Open to retry':text}</small></span><ChevronRight size={20} aria-hidden="true"/></button>;
}
export function MarketAccessModal({onClose,onSignIn,onUpdated}:{onClose:()=>void;onSignIn?:()=>void;onUpdated?:()=>void}){
 const {uid,data,error:readError,busy:reading,refresh}=useAccess();
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const alive=useRef(true),checkoutOpen=useRef(false),restoreDialogs=useRef<()=>void>(()=>{}),checkoutWidget=useRef<{close?:()=>void}|null>(null);
 const restoreCheckout=()=>{checkoutOpen.current=false;restoreDialogs.current();restoreDialogs.current=()=>{};checkoutWidget.current=null;};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;checkoutWidget.current?.close?.();restoreCheckout();};},[]);
 useEffect(()=>{checkoutWidget.current?.close?.();restoreCheckout();},[uid]);
 useEffect(()=>{setError('');setMessage('');setBusy(false);},[uid]);
 const current=(actor:string)=>alive.current&&auth.currentUser?.uid===actor;
 const updated=async(actor:string)=>{if(!current(actor))return;invalidateMarketAccess();await refresh(true);if(current(actor))onUpdated?.();};
 const check=async()=>{
  const actor=auth.currentUser?.uid;if(!actor){onSignIn?.();return;}if(busy)return;
  setBusy(true);setError('');setMessage('');
  try{const result=await operation<MarketAccess>('/market/access/check',{method:'POST',body:'{}'},{background:true,feedback:false});acknowledgeMarketPurchase(actor,result.payment_status);await updated(actor);if(current(actor))setMessage('Payment checked with the provider. Your confirmed access is shown above.');}
  catch(e){if(current(actor))setError((e as Error).message);}finally{if(current(actor))setBusy(false);}
 };
 const start=async()=>{
  const actor=auth.currentUser?.uid;if(!actor){onSignIn?.();return;}if(busy)return;setBusy(true);setError('');
  try{await operation('/market/access/trial',{method:'POST',body:'{}'},{background:true,feedback:false});await updated(actor);if(current(actor))setMessage('Your shared marketplace trial is confirmed. Its end date is shown above.');}
  catch(e){if(current(actor))setError((e as Error).message);}finally{if(current(actor))setBusy(false);}
 };
 const pay=async()=>{
  const actor=auth.currentUser?.uid;if(!actor){onSignIn?.();return;}if(busy||checkoutOpen.current)return;
  setBusy(true);setError('');setMessage('');
  try{
   const order=await operation<{settled?:boolean;payment_status?:string;key_id:string;order_id:string;amount:number;currency:string}>('/market/access/order',{method:'POST',body:JSON.stringify({request_id:marketPurchaseIntent(actor)})},{background:true,feedback:false});
   if(!current(actor))return;
   if(order.settled){acknowledgeMarketPurchase(actor,order.payment_status);await updated(actor);setMessage('The existing payment was reconciled. Review your access above.');return;}
   if(order.amount!==9900||order.currency!=='INR'||!order.order_id||!order.key_id)throw Error('The payment order could not be confirmed. Check payment status before retrying.');
   await loadCheckout();if(!current(actor))return;
   const widget=new window.Razorpay!({key:order.key_id,order_id:order.order_id,amount:order.amount,currency:'INR',name:'Repaido Market',description:'Swaps, used items & messaging · One calendar month',handler:async()=>{
    restoreCheckout();if(!current(actor))return;setBusy(true);setError('');
    try{const result=await operation<MarketAccess>('/market/access/check',{method:'POST',body:'{}'},{background:true,feedback:false});acknowledgeMarketPurchase(actor,result.payment_status);await updated(actor);if(current(actor))setMessage('Payment checked with the provider. Review your confirmed access above.');}
    catch(e){if(current(actor))setError((e as Error).message);}finally{if(current(actor))setBusy(false);}
   },modal:{ondismiss:()=>{restoreCheckout();if(current(actor)){setBusy(false);setMessage('Checkout closed. If debited, use Check payment before trying again.');}}}});
   widget.on('payment.failed',()=>{widget.close?.();restoreCheckout();if(current(actor)){setBusy(false);setError('Payment was not confirmed. Use Check payment before retrying.');}});
   // The provider appends its iframe outside our dialogs. Native modal dialogs
   // would make it inert, so suspend their top-layer entries without unmounting
   // any drafts, then restore those still present after checkout.
   const dialogs=Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'));
   let restored=false;restoreDialogs.current=()=>{if(restored)return;restored=true;for(const dialog of dialogs)if(dialog.isConnected&&!dialog.open)dialog.showModal();};
   for(const dialog of [...dialogs].reverse())dialog.close();
   checkoutWidget.current=widget;checkoutOpen.current=true;widget.open();
  }catch(e){restoreCheckout();if(current(actor))setError((e as Error).message);}finally{if(current(actor)&&!checkoutOpen.current)setBusy(false);}
 };
 const status=data?.status==='paid'?'Monthly access active':data?.status==='trial'?'Free period active':data?.status==='expired'?'Your free or paid period has ended':'Start your 90 free days';
 return <Modal title="Your marketplace plan" className="market-access-modal" onClose={()=>{if(!busy)onClose();}}><div className="market-access-panel">
  <span className="market-access-eyebrow"><Store size={16} aria-hidden="true"/> REPAIDO MARKET</span><h3>Good finds. Better conversations.</h3><p>One plan for direct swaps, second-hand selling and buyer–seller messaging.</p>
  <div className="market-access-price"><strong>90 days free</strong><span>Then <b>₹99</b> / calendar month</span><small>Manual renewal. No automatic debit.</small></div>
  <ul>{['Publish used items and exchange listings','Message buyers and sellers about an item','Make price offers and propose your swap','Keep your inbox, read receipts and safety controls together'].map(text=><li key={text}><Check size={16} aria-hidden="true"/>{text}</li>)}</ul>
  <section className="market-access-state" aria-live="polite"><Clock3 size={20} aria-hidden="true"/><div><strong>{uid?data?status:reading?'Checking your access…':'Your access status': 'Sign in to manage access'}</strong>{data?.current_period_ends_at&&<p>Access until {when(data.current_period_ends_at)}</p>}{data?.trial_started_at&&<small>Your one-time trial began {when(data.trial_started_at)}. It is shared across both sections.</small>}</div></section>
  <p className="market-access-note"><Info size={16} aria-hidden="true"/><span>Browsing, earlier messages and reporting remain available when access ends. Item payments and handovers are arranged between you and the other person.</span></p>
  {(error||readError)&&<div className="market-access-error" role="alert"><p>{error||readError}</p><button type="button" disabled={busy} onClick={()=>void refresh(true)}><RefreshCw size={20} aria-hidden="true"/>Retry status</button></div>}
  {message&&<p role="status">{message}</p>}
  <div className="market-access-actions">{!uid?<button type="button" className="market-access-primary" onClick={onSignIn}>Sign in</button>:data?.status==='not_started'?<button type="button" className="market-access-primary" disabled={busy} onClick={()=>void start()}>{busy?'Confirming…':'Start 90-day free trial'}</button>:data&&<button type="button" className="market-access-primary" disabled={busy||!data.payments_ready} onClick={()=>void pay()}>{busy?'Checking payment…':data.active?'Add one month · ₹99':'Continue for ₹99 / month'}</button>}{uid&&<button type="button" disabled={busy} onClick={()=>void check()}>Check payment</button>}</div>
  {data&&!data.payments_ready&&data.status!=='not_started'&&<p className="market-access-fine">Paid checkout is currently unavailable. Your existing access end date still applies; no charge was made.</p>}
 </div></Modal>;
}
