import type {BookingDraft} from '../types';

type Order={payment_order_id:string;razorpay_order_id:string;key_id:string;amount_paise:number;currency:string};
type Proof={razorpay_order_id:string;razorpay_payment_id:string;razorpay_signature:string};
type Attempt={fingerprint:string;request_id:string;order?:Order};
type Api=(path:string,init?:RequestInit)=>Promise<any>;
const running=new Set<string>();

export async function openLegacyGateway(order:Order,draft:BookingDraft):Promise<Proof>{
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://checkout.razorpay.com/v1/checkout.js';
    script.onload=()=>{
      try{
        const gateway=new (window as any).Razorpay({key:order.key_id,order_id:order.razorpay_order_id,
          amount:order.amount_paise,currency:order.currency,name:'Repaido',description:'Service booking base fare',
          prefill:{name:draft.address.name,contact:draft.address.phone},handler:resolve,
          modal:{ondismiss:()=>reject(new Error('Payment was cancelled.'))}});
        gateway.open();
      }catch{reject(new Error('Payment gateway failed to open.'));}
      finally{script.remove();}
    };
    script.onerror=()=>{script.remove();reject(new Error('Payment gateway failed to load.'));};
    document.body.appendChild(script);
  });
}

export async function confirmLegacyBooking(draft:BookingDraft,dependencies:{accountId:()=>string;api:Api;loadBookings:()=>Promise<void>;storage:Storage;gateway?:(order:Order,draft:BookingDraft)=>Promise<Proof>}){
  const {accountId,api,storage,loadBookings}=dependencies;
  const uid=accountId();
  if(!uid)throw new Error('Please sign in before paying for a booking.');
  if(running.has(uid))throw new Error('Your booking payment is already being checked.');
  if(draft.items.length!==1||draft.items[0].quantity!==1)throw new Error('Book one service at a time in this checkout.');
  const guard=()=>{if(accountId()!==uid)throw new Error('Your account changed. Reopen Bookings to check this payment.');};
  const storageKey='repaido.booking-checkout:'+uid;
  const details={service_id:draft.items[0].service.id,city:draft.city,
    address:`${draft.address.name}, ${draft.address.street}, ${draft.address.area}, ${draft.address.pincode}`,
    phone:draft.address.phone,starts_at:new Date(`${draft.date}T${draft.time}:00+05:30`).toISOString()};
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(details))))).map(n=>n.toString(16).padStart(2,'0')).join('');
  guard();
  if(running.has(uid))throw new Error('Your booking payment is already being checked.');
  running.add(uid);
  try{
    // Only account-scoped references and a digest are stored, without address,
    // phone, gateway signature or a payment credential. Require durable storage
    // before opening a gateway so a refresh can recover the same attempt.
    let saved:Attempt|null=null;
    try{saved=JSON.parse(storage.getItem(storageKey)||'null');}catch{throw new Error('Saved checkout could not be read. Open Bookings to check earlier payments.');}
    if(saved&&(!/^[a-f0-9]{64}$/.test(saved.fingerprint)||typeof saved.request_id!=='string'))throw new Error('Saved checkout needs review in Bookings.');
    if(saved?.order){
      const status=await api('/operations/booking-checkout/'+encodeURIComponent(saved.order.payment_order_id)+'/check',{method:'POST'});
      guard();
      if(status.state==='fulfilled'){
        storage.removeItem(storageKey);
        await loadBookings().catch(()=>{});
        guard();return {reference:status.booking_id,mode:'live' as const};
      }
      if(status.state==='refunded'){
        storage.removeItem(storageKey);
        throw new Error('Your earlier payment was refunded. You can start a new booking when ready.');
      }
      if(status.state!=='checking_payment')throw new Error('Your earlier payment needs attention in Bookings. Do not pay again.');
    }
    if(!saved||saved.fingerprint!==fingerprint)saved={fingerprint,request_id:crypto.randomUUID()};
    storage.setItem(storageKey,JSON.stringify(saved));
    const order:Order=saved.order||await api('/checkout/booking/order',{method:'POST',body:JSON.stringify({...details,idempotency_key:saved.request_id})});
    guard();
    saved.order=order;
    storage.setItem(storageKey,JSON.stringify(saved));
    const proof=await (dependencies.gateway||openLegacyGateway)(order,draft);
    guard();
    if(proof.razorpay_order_id!==order.razorpay_order_id)throw new Error('The gateway returned a different payment order. Check this payment in Bookings.');
    const booking=await api('/checkout/booking/verify',{method:'POST',body:JSON.stringify({payment_order_id:order.payment_order_id,
      razorpay_order_id:order.razorpay_order_id,razorpay_payment_id:proof.razorpay_payment_id,razorpay_signature:proof.razorpay_signature})});
    guard();
    storage.removeItem(storageKey);
    await loadBookings().catch(()=>{});
    guard();return {reference:booking.id,mode:'live' as const};
  }finally{running.delete(uid);}
}
