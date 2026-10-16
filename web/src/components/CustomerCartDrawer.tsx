import {RetailOrderResolution} from './RetailResolutions';
import {useEffect,useRef,useState} from 'react';
import {ShoppingBag,Minus,Plus,Trash2,Package,CheckCircle2} from 'lucide-react';
import {onIdTokenChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {cartService,type CartItem} from '../services/cartService';
import {operation,money} from '../services/operations';
import {CouponField,type Coupon} from './Coupons';
import {loadCheckout} from './PaymentPanel';
import {Modal} from './ui';
import './customer-cart.css';
type Quote={subtotal_paise:number;discount_paise:number;eligible_base_paise:number;total_paise:number};
type RetailOrder=Quote&{id:string;order_id?:string;key_id?:string;state:string;received_at?:number;delivery_address:string;items:{product_id:string;name:string;quantity:number;total_paise:number;discount_paise:number}[]};
interface Props{initialOrderId?:string;isOpen:boolean;onClose:()=>void;onExploreMore?:()=>void;customerName?:string;customerPhone?:string;defaultAddress?:string;defaultCity?:string;}
export function CustomerCartDrawer({initialOrderId,isOpen,onClose,onExploreMore,customerName='',customerPhone='',defaultAddress='',defaultCity=''}:Props){
 const [items,setItems]=useState<CartItem[]>(cartService.getItems()),[coupon,setCoupon]=useState<Coupon|null>(null),[quote,setQuote]=useState<Quote|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[quoting,setQuoting]=useState(false),[orders,setOrders]=useState<RetailOrder[]>([]),[user,setUser]=useState(auth.currentUser?.uid||'');
 const [name,setName]=useState(customerName),[phone,setPhone]=useState(customerPhone),[address,setAddress]=useState([defaultAddress,defaultCity].filter(Boolean).join(', '));
 const ordersRegion=useRef<HTMLElement>(null),openedOrder=useRef('');
 const request=useRef<{payload:string;key:string}|null>(null),locked=useRef(false),mounted=useRef(true),accountEpoch=useRef(0),accountId=useRef(auth.currentUser?.uid||'');
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;accountEpoch.current++;};},[]);
 useEffect(()=>cartService.subscribe(()=>setItems(cartService.getItems())),[]);
 useEffect(()=>onIdTokenChanged(auth,u=>{if(accountId.current!==(u?.uid||'')){accountEpoch.current++;accountId.current=u?.uid||'';}setUser(u?.uid||'');setOrders([]);setCoupon(null);request.current=null;}),[]);
 const refresh=()=>{const uid=auth.currentUser?.uid;return operation<{orders:RetailOrder[]}>('/retail/orders',{}, {background:true}).then(d=>{if(uid===auth.currentUser?.uid)setOrders(d.orders.sort((a,b)=>b.id.localeCompare(a.id)));});};
 useEffect(()=>{if(isOpen&&user)void refresh().catch(e=>setError(e.message));},[isOpen,user]);
 useEffect(()=>{if(!isOpen){openedOrder.current='';return;}if(!initialOrderId||openedOrder.current===initialOrderId)return;const row=Array.from(ordersRegion.current?.querySelectorAll<HTMLDetailsElement>('details[data-order-id]')||[]).find(node=>node.dataset.orderId===initialOrderId);if(row){row.open=true;openedOrder.current=initialOrderId;row.scrollIntoView({block:'nearest',behavior:'instant'});}},[isOpen,initialOrderId,orders]);
 const basket=JSON.stringify({items:items.map(i=>({product_id:i.id,quantity:i.quantity})),coupon_code:coupon?.code||null});
 useEffect(()=>{setQuote(null);if(!isOpen||!items.length||!user){setQuoting(false);return;}let alive=true;setQuoting(true);setError('');const timer=setTimeout(()=>void operation<Quote>('/retail/quote',{method:'POST',body:basket},{background:true}).then(q=>{if(alive)setQuote(q);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setQuoting(false);}),250);return()=>{alive=false;clearTimeout(timer);};},[basket,isOpen,user]);
 const pay=async(existing?:RetailOrder)=>{
  if(locked.current)return;locked.current=true;setBusy(true);setError('');
  try{
   let order=existing;
   if(!order){
    if(!quote)throw Error('Wait for your current cart total before paying.');
    if(name.trim().length<2||! /^[6-9]\d{9}$/.test(phone.replace(/\D/g,''))||address.trim().length<10)throw Error('Add your name, 10-digit mobile number and full delivery address.');
    const payload=JSON.stringify({...JSON.parse(basket),expected_total_paise:quote.total_paise,recipient_name:name.trim(),recipient_phone:phone.replace(/\D/g,''),delivery_address:address.trim()});
    if(request.current?.payload!==payload){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(user+payload)))).map(n=>n.toString(16).padStart(2,'0')).join('');const keyName='repaido.retail.retry.'+hash;const key=sessionStorage.getItem(keyName)||crypto.randomUUID();sessionStorage.setItem(keyName,key);request.current={payload,key};}
    order=await operation<RetailOrder>('/retail/orders',{method:'POST',body:JSON.stringify({...JSON.parse(payload),request_id:request.current.key})});await refresh();
   }else order=await operation<RetailOrder>(`/retail/orders/${order.id}/payment`,{method:'POST'});
   if(order.state==='paid'){await refresh();return;}
   await loadCheckout();const confirmed=order;
   const payment=await new Promise<{razorpay_payment_id:string}>((resolve,reject)=>{const widget=new window.Razorpay!({key:confirmed.key_id,order_id:confirmed.order_id,amount:confirmed.total_paise,currency:'INR',name:'Repaido',description:'Shop items',handler:resolve,modal:{ondismiss:()=>reject(Error('Payment window closed. Your saved order can be resumed below.'))}});widget.on('payment.failed',()=>reject(Error('Payment was not confirmed. Check the saved order before retrying.')));widget.open();});
   await operation(`/retail/orders/${order.id}/verify`,{method:'POST',body:JSON.stringify({payment_id:payment.razorpay_payment_id})});
   if(!existing){items.forEach(i=>cartService.removeItem(i.id));setCoupon(null);request.current=null;}await refresh();
  }catch(e){setError((e as Error).message);void refresh().catch(()=>{});}finally{locked.current=false;setBusy(false);}
 };
 const reorder=async(id:string)=>{
  if(locked.current||!user||user!==auth.currentUser?.uid)return;
  const actor=user,epoch=accountEpoch.current;locked.current=true;setBusy(true);setError('');
  const current=()=>mounted.current&&actor===auth.currentUser?.uid&&epoch===accountEpoch.current;
  try{
   const result=await operation<{items:CartItem[];unavailable:string[]}>(`/retail/orders/${id}/reorder`);
   if(!current())return;
   result.items.forEach(item=>cartService.addItem(item,item.quantity));setCoupon(null);
   if(result.unavailable.length)setError(`Unavailable: ${result.unavailable.join(', ')}. Available items were added at current prices.`);
  }catch(e){if(current())setError((e as Error).message);}finally{locked.current=false;if(mounted.current)setBusy(false);}
 };
 if(!isOpen)return null;
 return <Modal title="Your cart & orders" className="retail-checkout" onClose={onClose}><div className="retail-checkout-content">
 {!user&&<p role="status">Sign in to check current prices, offers and orders. Your cart is saved on this device.</p>}
 {items.length?<><div className="retail-items">{items.map(i=><article key={i.id}>{i.image_url?<img src={i.image_url} alt=""/>:<Package size={28}/>}<div><strong>{i.title}</strong><small>{i.shop_name} · {i.condition==='refurbished'?'Refurbished':'New'}</small><b>{money(i.price_paise*i.quantity)}</b><div className="retail-quantity"><button disabled={busy} aria-label={`Decrease ${i.title}`} onClick={()=>cartService.updateQuantity(i.id,-1)}><Minus size={13}/></button><span>{i.quantity}</span><button disabled={busy} aria-label={`Increase ${i.title}`} onClick={()=>cartService.updateQuantity(i.id,1)}><Plus size={13}/></button><button disabled={busy} aria-label={`Remove ${i.title}`} onClick={()=>cartService.removeItem(i.id)}><Trash2 size={14}/></button></div></div></article>)}</div>
 <CouponField scope="refurbished" base={quote?.eligible_base_paise||0} value={coupon} onChange={setCoupon}/>
 <div className="retail-contact"><label>Recipient<input autoComplete="name" value={name} onChange={e=>setName(e.target.value)} maxLength={80}/></label><label>Mobile<input inputMode="tel" autoComplete="tel-national" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={10}/></label><label className="retail-address">Delivery address<textarea autoComplete="street-address" value={address} onChange={e=>setAddress(e.target.value)} maxLength={500} rows={2}/></label></div>
 <div className="retail-total">{quoting?<p role="status">Checking current prices…</p>:quote?<><span>Items · listed prices include tax<strong>{money(quote.subtotal_paise)}</strong></span>{quote.discount_paise>0&&<span>Coupon savings<strong>−{money(quote.discount_paise)}</strong></span>}<span><b>Total to pay</b><b>{money(quote.total_paise)}</b></span></>:<p>Current total unavailable.</p>}<small>Shop confirmation is required for fulfilment. Any delivery charge requires your separate approval. Product-specific warranty and condition apply.</small></div>
 <button className="ops-primary" disabled={busy||quoting||!quote||!user} onClick={()=>void pay()}>{busy?'Checking payment…':`Pay securely${quote?' · '+money(quote.total_paise):''}`}</button></>:<div className="retail-empty"><ShoppingBag size={30}/><p>Your cart is empty.</p><button onClick={()=>{onClose();onExploreMore?.();}}>Explore marketplace</button></div>}
 {error&&<p className="ops-error" role="alert">{error}</p>}
 {orders.length>0&&<section className="retail-orders" ref={ordersRegion}><h3>Your shop orders</h3>{orders.map(o=><details key={o.id} data-order-id={o.id}><summary><span>{o.state==='refunded'?'Refund confirmed':o.received_at?'Items received':o.state==='paid'?'Paid · awaiting fulfilment':o.state==='creating'?'Payment setup pending':'Payment pending'}</span><strong>{money(o.total_paise)}</strong></summary><small>#{o.id.slice(0,12)}</small><button disabled={busy} onClick={()=>void reorder(o.id)}>Add available items to cart again</button>{o.items.map((i,n)=><p key={n}>{i.quantity} × {i.name} · {money(i.total_paise-i.discount_paise)}</p>)}<p>{o.delivery_address}</p>{o.state==='refunded'?<p>Payment refunded. Open returns and support for the confirmed receipt.</p>:o.state==='paid'?o.received_at?<p><CheckCircle2 size={14}/> Receipt confirmed.</p>:<><p>Confirm only after inspecting and receiving all items. This makes the order ready for shop payment review.</p><button disabled={busy} onClick={()=>{setBusy(true);void operation(`/retail/orders/${o.id}/received`,{method:'POST'}).then(refresh).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>I received all items</button></>:<><button disabled={busy} onClick={()=>void pay(o)}>Check payment / resume</button><p>Use this saved order after an interrupted payment; do not place a duplicate.</p></>}{['paid','refunded'].includes(o.state)&&<RetailOrderResolution key={user+o.id} orderId={o.id} items={o.items}/>}</details>)}</section>}
 </div></Modal>;
}
export default CustomerCartDrawer;
