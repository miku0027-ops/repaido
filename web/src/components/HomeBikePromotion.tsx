import {useEffect,useState} from 'react';
import {ArrowRight,TwoWheeler,X} from '../icons';
import {bikePolicy,type BikePolicy} from '../services/bike-rides-api';
import {bikePromotionSlot,canAdvertiseBike} from '../services/bikePromotionPlacement.mjs';
import './home-bike-promotion.css';

function placement(){
 try{
  if(sessionStorage.getItem('repaido:bike-promo-dismissed')==='1')return false;
  let seed=sessionStorage.getItem('repaido:bike-promo-session');
  if(!seed){seed=crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(8,'0');sessionStorage.setItem('repaido:bike-promo-session',seed);}
  return bikePromotionSlot(seed);
 }catch{return false;}
}

export function HomeBikePromotion({onOpen,city}:{onOpen:()=>void;city:string}){
 const [selected]=useState(placement),[policy,setPolicy]=useState<BikePolicy|null>(null),[dismissed,setDismissed]=useState(false);
 useEffect(()=>{
  if(!selected||city.trim().toLowerCase()!=='balasore')return;
  const abort=new AbortController();
  void bikePolicy(abort.signal).then(value=>{
   // Avoid inserting a marketing panel above somebody already reading below it.
   if(!abort.signal.aborted&&window.scrollY<80&&canAdvertiseBike(value))setPolicy(value);
  }).catch(()=>{});
  return()=>abort.abort();
 },[selected,city]);
 if(city.trim().toLowerCase()!=='balasore'||!policy||dismissed||!canAdvertiseBike(policy))return null;
 const offer=policy.promo_enabled&&policy.promo_ready;
 return <aside className="home-bike-promotion" aria-label="Discover Repaido bike rides">
  <span className="home-bike-promotion-icon" aria-hidden="true"><TwoWheeler size={25}/></span>
  <div><small>REPAIDO BIKE · BALASORE</small><strong>A little ride. A simpler day.</strong><p>{offer?`Up to ${policy.weekly_free_limit} launch rides a week on eligible trips within ${policy.free_distance_metres/1000} km.`:`Bike trips within ${policy.service_radius_metres/1000} km. Check your total before booking.`}</p><button type="button" onClick={onOpen}>{offer?'Check ride eligibility':'Explore bike rides'}<ArrowRight size={15} aria-hidden="true"/></button></div>
  <button type="button" className="home-bike-dismiss" aria-label="Dismiss bike ride suggestion" onClick={()=>{setDismissed(true);try{sessionStorage.setItem('repaido:bike-promo-dismissed','1');}catch{/* Session-only display still closes. */}}}><X size={17} aria-hidden="true"/></button>
 </aside>;
}
