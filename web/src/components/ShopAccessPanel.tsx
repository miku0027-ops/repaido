import {useEffect,useRef,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {Check,ExternalLink,RefreshCw,ShieldCheck,Store,Tag} from '../icons';
import {auth} from '../firebase';
import {operation,money} from '../services/operations';
import {marketPurchaseIntent,acknowledgeMarketPurchase} from '../services/marketPurchaseIntent.mjs';
import {loadCheckout} from './PaymentPanel';
import './shop-access.css';

type Access={shop_id:string;active:boolean;status:'trial'|'paid'|'expired';trial_started_at:number;trial_ends_at:number;current_period_ends_at:number|null;amount_paise:number;currency:string;server_now:number;payments_ready:boolean;auto_renew:false;default_offer_enabled:boolean;settings_version:number;trial_source:string;payment_status?:string|null};
type Product={id:string;name:string;condition?:string;price_paise:number;version:number;shop_offer?:{active:boolean;discount_bps:number;min_price_paise:number}};
const date=(at:number|null)=>at?new Date(at*1000).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}):'Not recorded';
export function ShopPresence(){
 const [uid,setUid]=useState(auth.currentUser?.uid||'');
 useEffect(()=>onIdTokenChanged(auth,user=>setUid(user?.uid||'')),[]);
 useEffect(()=>{
  const actor=uid;if(!actor)return;
  const session=crypto.randomUUID();let seq=0,stopped=false,inflight=0;let timer:number|undefined;
  const send=async(online:boolean,transition=false)=>{
   if(auth.currentUser?.uid!==actor||inflight>0&&online&&!transition)return;
   inflight++;
   try{await operation('/shop-discovery/presence',{method:'POST',body:JSON.stringify({online,session_id:session,sequence:++seq}),keepalive:!online},{background:true,feedback:false});}catch{/* Presence expires on the server if a browser cannot close its lease. */}
   finally{inflight--;}
  };
  const tick=(transition=false)=>{clearTimeout(timer);if(stopped)return;if(!document.hidden&&document.hasFocus()&&navigator.onLine)void send(true,transition);timer=window.setTimeout(()=>tick(),40000);};
  // Transitions must not be dropped behind a slower heartbeat. The server's
  // per-session sequence guard makes out-of-order network arrivals harmless.
  const state=()=>{if(document.hidden||!document.hasFocus()||!navigator.onLine)void send(false,true);else tick(true);};
  const away=()=>void send(false,true);
  tick();document.addEventListener('visibilitychange',state);window.addEventListener('focus',state);window.addEventListener('blur',state);window.addEventListener('online',state);window.addEventListener('offline',away);window.addEventListener('pagehide',away);
  return()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',state);window.removeEventListener('focus',state);window.removeEventListener('blur',state);window.removeEventListener('online',state);window.removeEventListener('offline',away);window.removeEventListener('pagehide',away);void send(false,true);};
 },[uid]);
 return null;
}
export function ShopAccessPanel({onUpdated}:{onUpdated?:()=>void}){
 const [uid,setUid]=useState(auth.currentUser?.uid||''),[state,setState]=useState<{uid:string;data:Access|null}>({uid:'',data:null});
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [products,setProducts]=useState<Product[]>([]),[selected,setSelected]=useState(''),[bps,setBps]=useState('5'),[floor,setFloor]=useState(''),[offerActive,setOfferActive]=useState(true);
 const alive=useRef(true),sequence=useRef(0),widgetRef=useRef<{close?:()=>void}|null>(null),restore=useRef<()=>void>(()=>{});
 const data=state.uid===uid?state.data:null,product=products.find(p=>p.id===selected);
 const registrationTrialActive=!!data&&data.trial_source==='registration'&&data.server_now>=data.trial_started_at&&data.server_now<data.trial_ends_at;
 const current=(actor:string)=>alive.current&&auth.currentUser?.uid===actor;
 const restoreCheckout=()=>{restore.current();restore.current=()=>{};widgetRef.current=null;};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;sequence.current++;widgetRef.current?.close?.();restoreCheckout();};},[]);
 useEffect(()=>onIdTokenChanged(auth,user=>setUid(user?.uid||'')),[]);
 const refresh=async()=>{
  const actor=auth.currentUser?.uid||'',request=++sequence.current;setLoading(true);setError('');
  if(!actor){setState({uid:'',data:null});setProducts([]);setLoading(false);return;}
  try{
   const [access,inventory]=await Promise.all([operation<Access>('/shop/access',{},{background:true,feedback:false,force:true}),operation<{items:Product[]}>('/shop/inventory',{},{background:true,feedback:false,force:true})]);
   if(!current(actor)||sequence.current!==request)return;
   if(access.amount_paise!==49900||access.currency!=='INR'||typeof access.active!=='boolean'||!Array.isArray(inventory.items))throw Error('Your shop plan could not be confirmed. Please retry.');
   setState({uid:actor,data:access});setProducts(inventory.items.filter(item=>(item.condition||'new')==='new'));
  }catch(e){if(current(actor)&&sequence.current===request)setError((e as Error).message);}finally{if(current(actor)&&sequence.current===request)setLoading(false);}
 };
 useEffect(()=>{setProducts([]);setSelected('');setError('');setNotice('');setBusy(false);widgetRef.current?.close?.();restoreCheckout();void refresh();},[uid]);
 useEffect(()=>{if(!product)return;setBps(String((product.shop_offer?.discount_bps??500)/100));setFloor(product.shop_offer?.min_price_paise?String(product.shop_offer.min_price_paise/100):'');setOfferActive(product.shop_offer?.active??true);},[selected,product?.version]);
 const run=async(fn:()=>Promise<void>)=>{if(busy)return;const actor=auth.currentUser?.uid;if(!actor)return;setBusy(true);setError('');setNotice('');try{await fn();if(current(actor)){await refresh();onUpdated?.();}}catch(e){if(current(actor))setError((e as Error).message);}finally{if(current(actor))setBusy(false);}};
 const check=()=>run(async()=>{const actor=auth.currentUser!.uid,result=await operation<Access>('/shop/access/check',{method:'POST',body:'{}'},{background:true,feedback:false});acknowledgeMarketPurchase('shop:'+actor+':'+result.shop_id,result.payment_status);if(current(actor))setNotice('Payment checked with the provider. Review the confirmed visibility dates below.');});
 const pay=async()=>{
  if(busy||!data)return;const actor=auth.currentUser?.uid;if(!actor)return;const shopId=data.shop_id,intent='shop:'+actor+':'+shopId;setBusy(true);setError('');setNotice('');
  try{
   const order=await operation<{settled?:boolean;payment_status?:string;key_id:string;order_id:string;amount:number;currency:string}>('/shop/access/order',{method:'POST',body:JSON.stringify({request_id:marketPurchaseIntent(intent)})},{background:true,feedback:false});
   if(!current(actor))return;
   if(order.settled){acknowledgeMarketPurchase(intent,order.payment_status);await refresh();setNotice('Your earlier payment was reconciled. Review its confirmed access dates.');return;}
   if(order.amount!==49900||order.currency!=='INR'||!order.order_id||!order.key_id)throw Error('The ₹499 payment order was not confirmed. Check payment before retrying.');
   await loadCheckout();if(!current(actor))return;
   const widget=new window.Razorpay!({key:order.key_id,order_id:order.order_id,amount:49900,currency:'INR',name:'Repaido Shop',description:'Shop visibility · One calendar month',handler:async()=>{
    restoreCheckout();if(!current(actor))return;setBusy(true);setError('');
    try{const result=await operation<Access>('/shop/access/check',{method:'POST',body:'{}'},{background:true,feedback:false});acknowledgeMarketPurchase(intent,result.payment_status);await refresh();if(current(actor)){setNotice('Payment checked with the provider. Your confirmed visibility is shown below.');onUpdated?.();}}
    catch(e){if(current(actor))setError((e as Error).message);}finally{if(current(actor))setBusy(false);}
   },modal:{ondismiss:()=>{restoreCheckout();if(current(actor)){setBusy(false);setNotice('Checkout closed. If debited, check payment before trying again.');}}}});
   widget.on('payment.failed',()=>{widget.close?.();restoreCheckout();if(current(actor)){setBusy(false);setError('Payment was not confirmed. Check payment before retrying.');}});
   const dialogs=Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'));let restored=false;
   restore.current=()=>{if(restored)return;restored=true;for(const dialog of dialogs)if(dialog.isConnected&&!dialog.open)dialog.showModal();};
   for(const dialog of [...dialogs].reverse())dialog.close();widgetRef.current=widget;widget.open();
  }catch(e){restoreCheckout();if(current(actor))setError((e as Error).message);}finally{if(current(actor)&&!widgetRef.current)setBusy(false);}
 };
 return <section className="shop-access-panel" aria-label="Shop visibility and offers"><header><span className="shop-access-icon"><Store size={20} aria-hidden="true"/></span><div><span className="shop-access-eyebrow">YOUR REPAIDO STOREFRONT</span><h2>Visibility & offers</h2><p>90 days after registration, then ₹499 per calendar month. Manual renewal.</p></div><button type="button" disabled={busy||loading} aria-label="Refresh shop access" onClick={()=>void refresh()}><RefreshCw size={18} aria-hidden="true"/></button></header>
  {loading&&!data&&<p role="status">Loading your shop visibility…</p>}{error&&<p className="shop-access-error" role="alert">{error}</p>}{notice&&<p className="shop-access-notice" role="status">{notice}</p>}
  {data&&<><div className="shop-access-status"><div><span>{data.status==='trial'?'Registration period':data.status==='paid'?'Paid visibility':'Visibility expired'}</span><strong>{data.active?'Your approved shop can appear in Market':'Renew to appear in Market'}</strong><small>{data.active?'Visible until':'Previous period ended'} {date(data.current_period_ends_at||data.trial_ends_at)}</small></div><b>₹499<small>/ month</small></b></div>
   <p className="shop-access-help"><ShieldCheck size={16} aria-hidden="true"/>Visibility never buys verification or a quality rating. Optional Shop Prime placement is separate.</p>{data.trial_source==='legacy_migration'&&<p className="shop-access-help">This earlier record has no registration date. Its fixed migration period is shown above; it does not restart when you open the page.</p>}
   <div className="shop-access-actions"><button type="button" className="shop-access-primary" disabled={busy||!data.payments_ready} onClick={()=>void pay()}>{busy?'Checking payment…':data.active?'Add one month · ₹499':'Renew shop visibility · ₹499'}</button><button type="button" disabled={busy} onClick={()=>void check()}>Check payment</button><button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('repaido:market-open-shop',{detail:{id:data.shop_id}}))}><ExternalLink size={16} aria-hidden="true"/>Preview storefront</button></div>{!data.payments_ready&&<p className="shop-access-help">Paid checkout is currently unavailable. No charge was made; the displayed visibility end date still applies.</p>}
   <details className="shop-access-offers"><summary><Tag size={16} aria-hidden="true"/>Default shop offer & product offers</summary><p>New spares use a 5% shop-funded offer during the first 90 days when no product offer is set. A product offer replaces that default; it does not stack with it.</p>
    <label className="shop-access-switch"><input type="checkbox" checked={data.default_offer_enabled} disabled={busy||registrationTrialActive} onChange={event=>void run(async()=>{await operation('/shop/access/settings',{method:'PUT',body:JSON.stringify({default_offer_enabled:event.target.checked,expected_version:data.settings_version})},{feedback:false});setNotice('Default offer preference saved.');})}/><span>Keep the 5% default offer after the registration period</span></label>{registrationTrialActive&&<small>The registration offer stays enabled until {date(data.trial_ends_at)}.</small>}
    <form onSubmit={event=>{event.preventDefault();if(!product)return;void run(async()=>{await operation('/shop/products/'+encodeURIComponent(product.id)+'/offer',{method:'PUT',body:JSON.stringify({expected_version:product.version,active:offerActive,discount_bps:Math.round(Number(bps)*100),min_price_paise:floor?Math.round(Number(floor)*100):null})},{feedback:false});setNotice('Product offer saved. Catalogue and checkout use the same price.');});}}><label>New spare<select aria-label="Product for shop offer" value={selected} onChange={event=>setSelected(event.target.value)} disabled={busy}><option value="">Choose a product</option>{products.map(item=><option key={item.id} value={item.id}>{item.name} · {money(item.price_paise)}</option>)}</select></label>{product&&<><div className="shop-access-offer-grid"><label>Offer (%)<input aria-label="Shop offer percentage" type="number" min="0" max="25" step=".01" required value={bps} disabled={busy} onChange={event=>setBps(event.target.value)}/></label><label>Minimum selling price (₹)<input aria-label="Minimum selling price" type="number" min="0" max={product.price_paise/100} step=".01" value={floor} disabled={busy} onChange={event=>setFloor(event.target.value)}/></label></div><label className="shop-access-switch"><input type="checkbox" checked={offerActive} disabled={busy} onChange={event=>setOfferActive(event.target.checked)}/>Use this product offer</label><p>A declared floor limits the discount. Turning a product offer off restores the applicable default offer.</p><button type="submit" className="shop-access-primary" disabled={busy}><Check size={16} aria-hidden="true"/>Save product offer</button></>}</form>
   </details>
  </>}
 </section>;
}
