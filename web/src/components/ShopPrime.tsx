import {useEffect,useState} from 'react';
import {BadgeCheck,RotateCcw} from 'lucide-react';
import {operation,money} from '../services/operations';
import {loadCheckout} from './PaymentPanel';
import type {Refurbishment,ShopPrimeStatus} from '../types';
import './shop-prime.css';

export function PrimeBadge({prime}:{prime?:ShopPrimeStatus}) {
  const [now,setNow]=useState(Date.now()/1000);
  useEffect(()=>{if(!prime?.active)return;const timer=setInterval(()=>setNow(Date.now()/1000),30000);return()=>clearInterval(timer);},[prime?.active]);
  return prime?.active&&prime.ends_at&&prime.ends_at>now?<span className="shop-prime-badge"><BadgeCheck size={15} aria-hidden="true"/>Repaido Verified <span>Prime · paid</span></span>:null;
}
export function RefurbishmentDetails({details:r,legacy}:{details?:Refurbishment|null;legacy?:string}) {
  if(!r)return <section className="refurb-detail-block"><h3>Refurbishment details</h3><p>{legacy||'The shop has not supplied structured inspection details yet.'}</p><p>Ask the shop to confirm condition, tests, warranty and returns before buying.</p></section>;
  const rows=[['Shop-declared grade',r.grade],['Cosmetic condition',r.cosmetic_condition],['Tested on',r.tested_on],['Functions tested & results',r.tested_functions],['Repairs & replaced parts',r.repairs],['Known defects',r.known_defects],['Included accessories',r.accessories],...(r.battery_health_percent==null?[]:[['Battery health',`${r.battery_health_percent}% (shop measured)`]]),['Shop warranty',`${r.warranty_days?`${r.warranty_days} days`:'No shop warranty'} · ${r.warranty_terms}`],['Shop return policy',`${r.return_days?`${r.return_days} days`:'No shop returns'} · ${r.return_terms}`]];
  return <section className="refurb-detail-block"><h3><RotateCcw size={18} aria-hidden="true"/>Condition & cover</h3><p>Information supplied by the shop for this product.</p><dl>{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>;
}
type Membership={shop_id:string;shop_name:string;amount:number;active:boolean;ends_at?:number;payments_ready:boolean;payment_status?:string;history:{id:string;status:string;amount_paise:number;payment_id?:string;created_at:number}[]};
export function ShopPrime() {
  const [data,setData]=useState<Membership|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[agreed,setAgreed]=useState(false),[message,setMessage]=useState('');
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const refresh=async(check=false)=>{setData(await operation<Membership>('/shop/prime'+(check?'/check':''),check?{method:'POST'}:{},{background:true}));};
  useEffect(()=>{void run(()=>refresh());},[]);
  const pay=()=>run(async()=>{
    const order=await operation<{settled?:boolean;key_id:string;order_id:string;amount:number;currency:string;shop_id:string}>('/shop/prime/order',{method:'POST'},{background:true});
    if(order.settled){await refresh();return;}
    await loadCheckout();
    await new Promise<void>((resolve,reject)=>{
      const widget=new window.Razorpay!({key:order.key_id,order_id:order.order_id,amount:order.amount,currency:order.currency,name:'Repaido',description:`Shop Prime · one month · ${order.shop_id}`,
        handler:()=>{void refresh(true).then(()=>{setMessage('Payment checked with Razorpay. See your membership status below.');resolve();}).catch(reject);},
        modal:{ondismiss:()=>{setMessage('Checkout closed. Check payment status before paying again.');resolve();}}});
      widget.on('payment.failed',()=>reject(new Error('Payment not confirmed. Check payment status; retry uses the same order.')));
      widget.open();
    });
  });
  return <section className="shop-prime-panel" aria-labelledby="prime-title"><div className="prime-plan-heading"><BadgeCheck size={32} aria-hidden="true"/><div><span className="prime-eyebrow">Your shop. More visibility.</span><h2 id="prime-title">Repaido Shop Prime</h2></div></div>
    <p className="prime-plan-price">₹1,499 <span>/ month</span></p><p>One calendar month from activation. Manual renewal after expiry; no automatic debit.</p>
    <ul><li>Repaido Verified · Prime badge on your reviewed shop and its live products.</li><li>Paid priority in Featured marketplace results within the customer’s selected category.</li><li>New and refurbished products stay in their own sections.</li></ul>
    <p>Membership promotes your shop. It does not guarantee sales, a fixed rank, or certify product inspections. Shop approval and accurate product disclosures remain required.</p>
    {error&&<p className="ops-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {!data&&!error&&<p role="status">Loading your shop membership…</p>}
    {data&&<><div className="prime-shop-identity"><strong>{data.shop_name}</strong><span>Shop ID: {data.shop_id}</span><b>{data.active?'Prime active':data.payment_status==='refunded'?'Prime payment refunded':'Prime inactive'}</b>{data.ends_at&&<span>{data.active?'Active until':'Previous period ended'} {new Date(data.ends_at*1000).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST</span>}</div>
      {!data.active&&<><label className="prime-consent"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>I agree to pay ₹1,499 for one month for this shop ID, including the paid placement and badge terms above.</label><button className="ops-primary" disabled={busy||!agreed||!data.payments_ready} onClick={()=>void pay()}>{busy?'Checking payment…':'Pay ₹1,499 for one month'}</button>{!data.payments_ready&&<p role="status">Prime payments are not connected yet. Membership cannot be purchased until the payment service is available.</p>}</>}
      <button disabled={busy} onClick={()=>void run(()=>refresh(true))}>Check payment status</button>
      {data.history.length>0&&<details><summary>Payment history for this shop</summary>{data.history.map(h=><article key={h.id}><p>{money(h.amount_paise)} · {h.status} · {new Date(h.created_at*1000).toLocaleDateString('en-IN')}</p><small>Reference: {h.payment_id||h.id}</small></article>)}</details>}
    </>}{!data&&error&&<button disabled={busy} onClick={()=>void run(()=>refresh())}>Retry membership</button>}
  </section>;
}
