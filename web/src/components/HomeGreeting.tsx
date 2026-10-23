import './home-discovery-polish.css';
import {useEffect,useState} from 'react';
import {ChevronDown,MapPin,Sparkles,ArrowUpRight,Pause,Play} from '../icons';
import type {Promotion} from './Promotions';
import {money} from '../services/operations';
import {offerExpiry,pricedPromotion} from '../services/promotionPresentation.mjs';
import {useVisibleMotion} from '../hooks/useVisibleMotion';
import {useContentRotation} from '../hooks/useContentRotation';
import './home-discovery-refresh.css';
import './home-content-motion.css';

type PosterSlide={eyebrow:string;headline:string;detail?:string;offer?:Promotion};
const highlights:PosterSlide[]=[{eyebrow:'MADE FOR',headline:'Your everyday'},{eyebrow:'REPAIDO',headline:'Home care'},{eyebrow:'REPAIDO',headline:'Repairs & more'}];

export function HomeGreeting({greeting,location,onLocation,offers=[],onOffer}:{greeting:string;location:string;onLocation:()=>void;offers?:Promotion[];onOffer?:(offer:Promotion)=>void}) {
 const {ref,active}=useVisibleMotion<HTMLDivElement>();
 const [paused,setPaused]=useState(false),[reading,setReading]=useState(false),[now,setNow]=useState(()=>Date.now()/1000);
 // Expiry runs even while the user pauses motion or the poster is off screen.
 useEffect(()=>{
  const time=Date.now()/1000,expiry=Math.min(...offers.map(card=>card.ends_at).filter(at=>at>time));
  if(!Number.isFinite(expiry))return;
  const timer=setTimeout(()=>setNow(Date.now()/1000),Math.min(2147483647,Math.max(1,(expiry-time)*1000)));
  return()=>clearTimeout(timer);
 },[offers,now]);
 const eligible=onOffer?offers.filter(card=>pricedPromotion(card,Math.max(now,Date.now()/1000))).slice(0,6):[];
 const offerSlides:PosterSlide[]=eligible.map(offer=>({offer,eyebrow:'LIVE OFFER',headline:`Save ${money(offer.discount_paise).replace('.00','')}`,detail:`Until ${offerExpiry(offer.ends_at)}`}));
 if(eligible.length===1)offerSlides.push({offer:eligible[0],eyebrow:'SPECIAL PRICE',headline:`Now ${money(eligible[0].offer_price_paise).replace('.00','')}`,detail:`Until ${offerExpiry(eligible[0].ends_at)}`});
 const slides=offerSlides.length?offerSlides:highlights;
 const signature=JSON.stringify([location,...eligible.map(card=>[card.id,card.version,card.ends_at,card.discount_paise,card.offer_price_paise])]);
 const moving=active&&!paused&&!reading;
 const {index,previous,step}=useContentRotation(signature,slides.length,moving);
 const slide=slides[index],tone=['blue','mint','peach'][index%3];
 const content=(item:PosterSlide)=><><span>{item.eyebrow}</span><strong>{item.headline.length>15?'Live offer':item.headline}</strong>{item.detail?<small>{item.detail}<ArrowUpRight size={12} aria-hidden="true"/></small>:<Sparkles size={18} aria-hidden="true"/>}</>;
 return <div ref={ref} className="home-greeting home-welcome-banner lg:hidden" data-season={tone}>
  <div className="home-welcome-copy home-welcome-playback">
   <span className="home-welcome-kicker"><Sparkles size={14} aria-hidden="true"/>A little care. Every day.</span>
   <button type="button" className="home-location-summary" aria-label={`${greeting} Change service location: ${location}`} onClick={onLocation}>
    <span className="repaido-greeting-text">{greeting}</span>
    <span className="home-location-line"><MapPin size={14} aria-hidden="true"/><span className="home-location-label">{location}</span><ChevronDown size={14} aria-hidden="true"/></span>
   </button>
   <button type="button" className="home-poster-playback" aria-label={paused?'Play home poster':'Pause home poster'} title={paused?'Play home poster':'Pause home poster'} onClick={()=>setPaused(value=>!value)}>{paused?<Play size={16} aria-hidden="true"/>:<Pause size={16} aria-hidden="true"/>}</button>
  </div>
  <div className="home-season-tag home-season-signature home-welcome-poster" data-tone={tone} data-moving={moving} role="group" aria-label="Platform offers and highlights"
   onPointerEnter={()=>setReading(true)} onPointerLeave={()=>setReading(false)} onFocusCapture={()=>setReading(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))setReading(false);}}>
   {/* Keep the original poster's intrinsic size, including at larger text sizes. */}
   <span className="home-poster-measure" aria-hidden="true">MADE FOR</span><strong className="home-poster-measure" aria-hidden="true">Your everyday</strong><Sparkles className="home-poster-measure" size={18} aria-hidden="true"/>
   <div key={signature+step} className="home-poster-frame">
    {previous!==undefined&&<span className="home-poster-previous" aria-hidden="true">{content(slides[previous])}</span>}
    {slide.offer?<button type="button" className="home-poster-current" data-entering={previous!==undefined}
     aria-label={`${slide.offer.title}. Save ${money(slide.offer.discount_paise)} on ${slide.offer.service!.name}. Valid until ${offerExpiry(slide.offer.ends_at)}. View offer`}
     onClick={()=>{if(pricedPromotion(slide.offer))onOffer?.(slide.offer!);else setNow(Date.now()/1000);}}>{content(slide)}</button>
     :<span className="home-poster-current" data-entering={previous!==undefined}>{content(slide)}</span>}
   </div>
  </div>
 </div>;
}
