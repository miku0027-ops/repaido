import {useEffect,useState} from 'react';
import {ChevronDown,MapPin,Sparkles,ArrowUpRight} from '../icons';
import type {Promotion} from './Promotions';
import {money} from '../services/operations';
import {offerExpiry,pricedPromotion} from '../services/promotionPresentation.mjs';
import './home-discovery-refresh.css';

export function HomeGreeting({greeting,location,onLocation,offers=[],onOffer}:{greeting:string;location:string;onLocation:()=>void;offers?:Promotion[];onOffer?:(offer:Promotion)=>void}) {
 const [now,setNow]=useState(()=>Date.now()/1000);
 useEffect(()=>{const expiry=Math.min(...offers.map(card=>card.ends_at).filter(at=>at>Date.now()/1000));if(!Number.isFinite(expiry))return;const timer=setTimeout(()=>setNow(Date.now()/1000),Math.min(2147483647,Math.max(1,expiry*1000-Date.now())));return()=>clearTimeout(timer);},[offers,now]);
 const offer=offers.find(card=>pricedPromotion(card,Math.max(now,Date.now()/1000)));
 return <div className="home-greeting home-welcome-banner lg:hidden" data-season={offer?.tone||'blue'}>
  <div className="home-welcome-copy">
   <span className="home-welcome-kicker">{offer?.event_name||'Repaido'}</span>
   <button type="button" className="home-location-summary" aria-label={`${greeting} Change service location: ${location}`} onClick={onLocation}>
    <span className="repaido-greeting-text">{greeting}</span>
    <span className="home-location-line"><MapPin size={13} aria-hidden="true"/><span className="home-location-label">{location}</span><ChevronDown size={13} aria-hidden="true"/></span>
   </button>
  </div>
  {offer&&onOffer?<button className="home-season-tag" onClick={()=>onOffer(offer)} aria-label={`${offer.title}. Save ${money(offer.discount_paise)} on ${offer.service!.name}. View offer`}>
   <span>REPAIDO SPECIAL</span><strong>Save {money(offer.discount_paise).replace('.00','')}</strong><small>Until {offerExpiry(offer.ends_at)} <ArrowUpRight size={12} aria-hidden="true"/></small>
  </button>:null}
 </div>;
}
