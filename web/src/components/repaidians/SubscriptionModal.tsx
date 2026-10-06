import {useState} from 'react';
import {Check,Infinity,LockKeyhole,ShieldCheck} from 'lucide-react';
import {Modal} from '../ui';
import {activateMockPro,PRO_PRICE_RUPEES} from '../../services/repaidiansService';
export function SubscriptionModal({account,reason,onClose,onActivated}:{account:string;reason:string;onClose:()=>void;onActivated:()=>void}) {
  const [method,setMethod]=useState('UPI'),[error,setError]=useState('');
  return <Modal title="Repaidians Pro" className="rp-dialog rp-upgrade" onClose={onClose}>
    <span className="rp-kicker"><LockKeyhole size={14}/> A little more room to grow</span><h3>Your work. Your community.</h3>
    <p>{reason}</p><div className="rp-price"><strong>₹{PRO_PRICE_RUPEES}</strong><span>/ month</span></div>
    <ul className="rp-benefits">{['Unlimited browsing','Posts, work reels and 24h stories','Tender bids and contact details','Direct message previews'].map(text=><li key={text}><Check size={17}/>{text}</li>)}</ul>
    <fieldset className="rp-payment"><legend>Preview checkout method</legend>{['UPI','Razorpay'].map(value=><label key={value}><input type="radio" name="demo-payment" checked={method===value} onChange={()=>setMethod(value)}/>{value}</label>)}</fieldset>
    <p className="rp-notice"><ShieldCheck size={18}/><span><strong>Demo checkout</strong>No money is charged. This unlocks the local preview on this device for one month, with no renewal.</span></p>
    {error&&<p role="alert">{error}</p>}
    <button className="rp-primary" onClick={()=>{try{activateMockPro(account);onActivated();}catch(e){setError((e as Error).message);}}}><Infinity size={18}/>Simulate ₹199 checkout</button>
    <small className="rp-fine">Pro access here is a browser prototype, not a paid Repaido entitlement.</small>
  </Modal>;
}
