import {useEffect,useId,useRef,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {Gift,Ticket,ArrowRight} from 'lucide-react';
import {auth} from '../firebase';
import {operation,money} from '../services/operations';
import {Modal} from './ui';
import {couponSavings,couponAppliesTo} from '../services/rewardPresentation.mjs';
import './coupons.css';
export type Coupon={id:string;code:string;family:string;scope:string;bps:number;title:string;terms:string;expires_at:number|null;cap_paise?:number|null;funded_by?:string;level?:string};
const days=(c:Coupon)=>Math.max(0,Math.ceil(((c.expires_at||Date.now()/1000)-Date.now()/1000)/86400));
export function CouponField({scope,base=0,value,onChange,disabled=false}:{scope:string;base?:number;value:Coupon|null;onChange:(c:Coupon|null)=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false),[rows,setRows]=useState<Coupon[]>([]),[code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const id=useId(),sequence=useRef(0),gate=useRef(false),change=useRef(onChange);change.current=onChange;
 useEffect(()=>{let previous=auth.currentUser?.uid;return onIdTokenChanged(auth,u=>{if(previous!==u?.uid){sequence.current++;gate.current=false;setRows([]);setCode('');setError('');setNotice('');setBusy(false);setOpen(false);change.current(null);}previous=u?.uid;});},[]);
 useEffect(()=>{sequence.current++;gate.current=false;setRows([]);setError('');setBusy(false);setOpen(false);},[scope]);
 const load=async()=>{
  const uid=auth.currentUser?.uid,request=++sequence.current;if(!uid){setError('Sign in to check your coupons.');return;}
  setBusy(true);setError('');
  try{const d=await operation<{coupons:Coupon[]}>('/coupons/wallet',{}, {background:true,feedback:false});if(uid===auth.currentUser?.uid&&request===sequence.current)setRows(d.coupons.filter(c=>couponAppliesTo(c,scope)));}
  catch(problem){if(uid===auth.currentUser?.uid&&request===sequence.current)setError((problem as Error).message);}
  finally{if(request===sequence.current)setBusy(false);}
 };
 const apply=async(text:string)=>{
  if(gate.current)return;const uid=auth.currentUser?.uid;if(!uid){setError('Sign in to apply a coupon.');return;}
  const request=++sequence.current;gate.current=true;setBusy(true);setError('');
  try{const c=await operation<Coupon>('/coupons/check',{method:'POST',body:JSON.stringify({code:text.trim(),scope})},{background:true,feedback:false});if(uid===auth.currentUser?.uid&&request===sequence.current){onChange(c);setNotice(c.code+' applied. Your final saving is confirmed with the booking.');setOpen(false);}}
  catch(problem){if(uid===auth.currentUser?.uid&&request===sequence.current)setError((problem as Error).message);}
  finally{if(request===sequence.current){gate.current=false;setBusy(false);}}
 };
 const saving=value?couponSavings(base,value):0;
 return <section className="coupon-field" aria-label="Booking offers">
  <button type="button" disabled={disabled||busy} onClick={()=>{setOpen(!open);if(!open)void load();else{sequence.current++;setBusy(false);}}} aria-expanded={open} aria-controls={open?id:undefined}><Ticket size={17} aria-hidden="true"/><span>{value?`${value.code} · ${value.bps/100}% off${saving?' · −'+money(saving):''}`:'Offers & earned coupons'}</span><ArrowRight size={16} aria-hidden="true"/></button>
  {disabled&&<small>Choose one offer for this booking.</small>}
  {value&&<div className="coupon-selected"><small>{value.funded_by==='repaido'?'Your Captain reward is funded by Repaido. ':''}{value.cap_paise!=null?`Maximum saving ${money(value.cap_paise)}. `:''}{scope==='home'?'First quoted billing period only.':'Eligible base charge only.'}{value.expires_at?` Valid until ${new Date(value.expires_at*1000).toLocaleDateString('en-IN')}.`:''}</small><button type="button" disabled={busy} onClick={()=>{onChange(null);setNotice('Coupon removed.');}}>Remove coupon</button></div>}
  {open&&<div id={id} className="coupon-options"><div className="coupon-input"><input aria-label="Promo code" autoCapitalize="characters" autoComplete="off" maxLength={30} value={code} placeholder="Enter code" onChange={e=>setCode(e.target.value.toUpperCase())}/><button type="button" disabled={busy||!code.trim()} onClick={()=>void apply(code)}>Apply</button></div>
   {busy&&<small role="status">Checking your offers…</small>}{!busy&&!rows.length&&!error&&<small>No eligible coupons for this booking.</small>}
   {rows.map(c=><button type="button" key={c.code} disabled={busy} onClick={()=>void apply(c.code)}><span><strong>{c.title}</strong><small>{c.family==='captain'?`${c.level||'Gold'} reward · `:''}{c.cap_paise!=null?`Up to ${money(c.cap_paise)} · `:''}{c.expires_at?`${days(c)} days left · `:''}{c.code}</small></span><ArrowRight size={15} aria-hidden="true"/></button>)}
   <details><summary>Coupon terms</summary><p>Choose one offer per booking. Discounts apply to the eligible base charge; tax, travel, delivery, parts and deposits are excluded. Captain rewards require active Gold membership and have a rupee cap. Each Captain offer can be reserved once per 30 days. Check the selected offer for its funding and expiry.</p></details>{error&&<p role="alert">{error}</p>}
  </div>}{notice&&<small role="status">{notice}</small>}
 </section>;
}
export function CouponWelcome({onExplore}:{onExplore:(scope:string)=>void}){
 const [data,setData]=useState<Coupon[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let alive=true,timer:ReturnType<typeof setTimeout>|undefined,account='';const tryShow=async()=>{if(!account||document.hidden||document.querySelector('dialog[open]'))return;const uid=account;try{const d=await operation<{show:boolean;coupons:Coupon[]}>('/coupons/launch',{method:'POST'},{background:true});if(alive&&uid===auth.currentUser?.uid&&d.show)setData(d.coupons);}catch{/* Never block app entry on promotional network failure. */}};const off=onIdTokenChanged(auth,u=>{account=u?.uid||'';setData([]);clearTimeout(timer);timer=setTimeout(()=>void tryShow(),8500);});const focus=()=>{clearTimeout(timer);timer=setTimeout(()=>void tryShow(),1200);};window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);return()=>{alive=false;off();clearTimeout(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};},[]);
 if(!data.length)return null;const choice=data.some(c=>c.family==='return_choice');
 return <Modal title={choice?'A little thank-you, your choice':'Your first Repaido perks'} className="coupon-welcome" onClose={()=>setData([])}><div className="coupon-gift"><Gift size={30}/><span>REPAIDO REWARDS</span></div><p>{choice?'Choose one 10% thank-you coupon. Your choice is saved to your account.':'Choose an eligible offer at checkout. Your service and rental welcome offers are separate.'}</p><div className="coupon-welcome-cards">{data.map(c=><button key={c.code} disabled={busy} onClick={()=>{if(c.family==='return_choice'){setBusy(true);void operation('/coupons/choose',{method:'POST',body:JSON.stringify({code:c.code})},{background:true}).then(()=>{setData([]);onExplore(c.scope);}).catch(e=>setError(e.message)).finally(()=>setBusy(false));}else{setData([]);onExplore(c.scope);}}}><strong>{c.bps/100}% <small>OFF</small></strong><span>{c.title}</span><b>{c.code}</b><small>{days(c)} days left · ends {new Date((c.expires_at||0)*1000).toLocaleDateString('en-IN')}</small><ArrowRight size={16}/></button>)}</div><details><summary>What’s included</summary><p>{data[0].terms}</p><p>No automatic charge. Welcome service offers include day hiring and the first quoted Home-plan period. Rental savings exclude deposits and delivery. Refurbished savings apply only to qualifying items with a declared tax breakdown.</p></details>{error&&<p role="alert">{error}</p>}<button type="button" onClick={()=>setData([])}>Maybe later</button></Modal>;
}
