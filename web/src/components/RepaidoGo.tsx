import {useEffect,useId,useRef,useState,type CSSProperties} from 'react';
import {ArrowLeft,ArrowRight,Bell,ChevronDown,History,MapPin,Pause,Play} from '../icons';
import {GoVehicleArt} from './GoVehicleArt';
import {useVisibleMotion} from '../hooks/useVisibleMotion';
import {homeBikePolicy} from '../services/homeBikePolicy';
import {bikeOfferText} from '../services/bikeOffer.mjs';
import type {BikePolicy} from '../services/bike-rides-api';
import {RideNotificationControl} from './RideNotificationControl';
import {nativeAvailable} from '../services/native';
import {MobilityExperience,type TravelMode} from './MobilityExperience';
import type {TransportArea} from './TransportRail';
import './repaido-go.css';
import './go-entry-offer.css';

/** A compact home entry with current public offers; discovery starts inside Go. */
export function RepaidoGoEntry({onOpen,city=''}:{onOpen:()=>void;city?:string}){
 const {ref,active,visible}=useVisibleMotion<HTMLButtonElement>(),[policy,setPolicy]=useState<BikePolicy|null>(null),[clock,setClock]=useState(Date.now);
 const [paused,setPaused]=useState(false),[ticker,setTicker]=useState({duration:20,distance:0,copies:2}),track=useRef<HTMLSpanElement>(null),offerId=useId();
 useEffect(()=>{
  if(!visible||city.trim().toLowerCase()!=='balasore')return;
  let live=true;
  const read=()=>{setClock(Date.now());void homeBikePolicy().then(value=>{if(live)setPolicy(value);}).catch(()=>{if(live)setPolicy(null);});};
  read();const timer=setInterval(read,60000);return()=>{live=false;clearInterval(timer);};
 },[visible,city]);
 useEffect(()=>{if(!policy?.promo_ends_at)return;const delay=policy.promo_ends_at*1000-Date.now();if(delay<=0)return;const timer=setTimeout(()=>setClock(Date.now()),Math.min(delay+1,2147483647));return()=>clearTimeout(timer);},[policy,clock]);
 const offer=bikeOfferText(policy,city,Math.max(clock,Date.now())/1000);
 useEffect(()=>{
  const segment=track.current?.firstElementChild,viewport=track.current?.parentElement;if(!segment||!viewport)return;
  // Keep a calm, consistent reading speed as fonts and offer lengths change.
  const measure=()=>{
   const distance=segment.getBoundingClientRect().width;if(!distance)return;
   const duration=Math.max(16,distance/26),copies=Math.max(2,Math.ceil(viewport.clientWidth/distance)+1);
   setTicker(current=>current.distance===distance&&current.copies===copies?current:{duration,distance,copies});
  };
  measure();const observer=new ResizeObserver(measure);observer.observe(segment);observer.observe(viewport);return()=>observer.disconnect();
 },[offer]);
 return <div className="go-entry-card" data-has-offer={!!offer} data-running={active&&!paused} data-offer-paused={paused}>
 <button ref={ref} type="button" className="repaido-go-entry" data-animated={active&&!paused} onClick={onOpen}>
  <span className="go-entry-symbol" aria-hidden="true"><span className="go-entry-car"><GoVehicleArt kind="cab"/></span><span className="go-entry-bike"><GoVehicleArt kind="bike"/></span></span>
  <span className="go-entry-copy"><strong>Repaido <b>Go</b></strong><span>Bike & cab rides. One place to go.</span>{offer&&<small id={offerId} className="go-entry-offer"><span className="sr-only">{offer}</span><span ref={track} className="go-entry-offer-track" aria-hidden="true" style={{animationDuration:`${ticker.duration}s`,'--go-offer-distance':`${-ticker.distance}px`} as CSSProperties}>{Array.from({length:ticker.copies},(_,index)=><span key={index}>{offer}</span>)}</span></small>}</span>
  <span className="go-entry-arrow" aria-hidden="true"><ArrowRight size={20}/></span>
 </button>
 {offer&&<button type="button" className="go-entry-playback" aria-controls={offerId} aria-pressed={paused} aria-label={paused?'Play Go offer':'Pause Go offer'} title={paused?'Play Go offer':'Pause Go offer'} onClick={()=>setPaused(value=>!value)}>{paused?<Play size={14} aria-hidden="true"/>:<Pause size={14} aria-hidden="true"/>}</button>}
 </div>;
}

export function RepaidoGo({location,onSignIn,onHome,onBookings,onModeSelect,onSearch,initialMode='bike',active=true}:{location:TransportArea;onSignIn:()=>void;onHome:()=>void;onBookings:()=>void;onModeSelect:(mode:TravelMode)=>void;onSearch:(mode:TravelMode)=>void;initialMode?:TravelMode;active?:boolean}){
 const [area,setArea]=useState(location),[pickupRequest,setPickupRequest]=useState(0);
 useEffect(()=>setArea(location),[location.lat,location.lng,location.confirmed,location.address,location.city]);
 return <section className="repaido-go" aria-label="Repaido Go">
  <header className="go-header">
   <button type="button" className="go-back" aria-label="Back to Repaido home" onClick={onHome}><ArrowLeft size={21} aria-hidden="true"/></button>
   <div className="go-wordmark"><h1>repaido <span>Go</span><i aria-hidden="true">.</i></h1><button type="button" className="go-header-area" aria-label={`Change transport pickup area: ${area?.city||area?.address||'Choose pickup area'}`} onClick={()=>setPickupRequest(n=>n+1)}><MapPin size={13} aria-hidden="true"/><span>{area?.city||area?.address?.split(',')[0]||'Choose pickup area'}</span><ChevronDown size={13} aria-hidden="true"/></button></div>
   <button type="button" className="go-history" aria-label="My rides" title="My rides" onClick={onBookings}><History size={20} aria-hidden="true"/><span>My rides</span></button>
  </header>
  {nativeAvailable()&&<details className="go-alerts-menu"><summary><Bell size={17} aria-hidden="true"/>Ride alerts</summary><RideNotificationControl onSignIn={onSignIn}/></details>}
  <MobilityExperience pickupRequest={pickupRequest} presentation="go" active={active} initialMode={initialMode} initialLocation={area} onLocationChange={setArea} onSignIn={onSignIn} onModeSelect={onModeSelect} onSearch={onSearch}/>
 </section>;
}
