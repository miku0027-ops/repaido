import {ChevronDown,MapPin,Sparkles,ArrowUpRight} from '../icons';
import type {Promotion} from './Promotions';
import {money} from '../services/operations';
import {offerExpiry,pricedPromotion} from '../services/promotionPresentation.mjs';
import './home-discovery-refresh.css';

export function HomeGreeting({greeting,location,onLocation,offers=[],onOffer}:{greeting:string;location:string;onLocation:()=>void;offers?:Promotion[];onOffer?:(offer:Promotion)=>void}) {
 const offer=offers.find(card=>pricedPromotion(card));
 return <div className="home-greeting home-welcome-banner lg:hidden" data-season={offer?.tone||'blue'}>
  <div className="home-welcome-copy">
   <span className="home-welcome-kicker"><Sparkles size={14} aria-hidden="true"/>{offer?.event_name||'A little care. Every day.'}</span>
   <button type="button" className="home-location-summary" aria-label={`${greeting} Change service location: ${location}`} onClick={onLocation}>
    <span className="repaido-greeting-text">{greeting}</span>
    <span className="home-location-line"><MapPin size={14} aria-hidden="true"/><span className="home-location-label">{location}</span><ChevronDown size={14} aria-hidden="true"/></span>
   </button>
  </div>
  {offer&&onOffer?<button className="home-season-tag" onClick={()=>onOffer(offer)} aria-label={`${offer.title}. Save ${money(offer.discount_paise)} on ${offer.service!.name}. View offer`}>
   <span>REPAIDO SPECIAL</span><strong>Save {money(offer.discount_paise).replace('.00','')}</strong><small>Until {offerExpiry(offer.ends_at)} <ArrowUpRight size={14} aria-hidden="true"/></small>
  </button>:<span className="home-season-tag home-season-signature" aria-hidden="true"><span>MADE FOR</span><strong>Your everyday</strong><Sparkles size={18}/></span>}
 </div>;
}
