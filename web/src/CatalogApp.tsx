import { useEffect, useState } from 'react';
import Discovery from './components/Discovery';
import Checkout from './components/Checkout';
import { seededServices } from './data';
import { calculateTotals } from './booking.mjs';
import type { CartItem, ConfirmBooking, Service } from './types';

/** Inject a server-backed payment adapter to use Checkout in a live application. */
const previewConfirmation:ConfirmBooking=async()=>({reference:`preview-${crypto.randomUUID()}`,mode:'preview'});
export default function CatalogApp({filter="all",search="",location="",nearbyLocation,onConfirm,onBook,services=seededServices}:{filter:string;search:string;location:string;nearbyLocation?:{lat:number;lng:number;city:string};onConfirm?:ConfirmBooking;onBook?:(service:Service)=>void;services?:Service[]}){
  const [items,setItems]=useState<CartItem[]>(()=>{try{const saved=JSON.parse(sessionStorage.getItem('repaido.cart')||'[]');return saved.flatMap((i:{id:string;quantity:number})=>{const service=seededServices.find(s=>s.id===i.id);return service&&Number.isInteger(i.quantity)&&i.quantity>0&&i.quantity<=5?[{service,quantity:i.quantity}]:[];});}catch{return [];}});
  useEffect(()=>{sessionStorage.setItem('repaido.cart',JSON.stringify(items.map(i=>({id:i.service.id,quantity:i.quantity}))));},[items]);
  const [city,setCity]=useState(location);
  useEffect(()=>setCity(location),[location]);
  const [checkout,setCheckout]=useState(false);
  const [announcement,setAnnouncement]=useState('');
  const add=(service:Service)=>{if(onBook){onBook(service);return;}setItems(current=>{const found=current.find(i=>i.service.id===service.id);return found?current.map(i=>i.service.id===service.id?{...i,quantity:Math.min(5,i.quantity+1)}:i):[...current,{service,quantity:1}];});setAnnouncement(`${service.name} added to your booking`);};
  const change=(id:string,delta:number)=>{setItems(current=>current.map(i=>i.service.id===id?{...i,quantity:Math.min(5,i.quantity+delta)}:i).filter(i=>i.quantity>0));};
  const go=(value:boolean)=>{setCheckout(value);window.scrollTo({top:0,behavior:'instant'});};
  useEffect(()=>{if(checkout&&!items.length){setCheckout(false);setAnnouncement('Your booking is empty. Choose a service to continue.');}},[items,checkout]);
  
  const confirmation = onConfirm || previewConfirmation;
  return <><a href="#main-content" className="sr-only fixed left-4 top-4 z-50 rounded-xl bg-accent px-6 py-4 text-white focus:not-sr-only">Skip to content</a><div className="sr-only" aria-live="polite" role="status">{announcement}</div>{checkout&&!onBook?<Checkout items={items} city={city} onChange={change} onBack={()=>go(false)} onConfirm={confirmation} preview={!onConfirm}/>:<Discovery nearbyLocation={nearbyLocation} initialCategory={filter} initialQuery={search} services={services} items={onBook?[]:items} city={city} onCity={setCity} onAdd={add} onChange={change} onProceed={()=>{if(onBook&&items[0])onBook(items[0].service);else go(true);}} subtotal={onBook?0:calculateTotals(items).subtotal} preview={!onConfirm}/>}</>;
}
