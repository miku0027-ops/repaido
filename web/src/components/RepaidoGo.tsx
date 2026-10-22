import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,Bell,ChevronDown,History,MapPin} from '../icons';
import {GoVehicleArt} from './GoVehicleArt';
import {useVisibleMotion} from '../hooks/useVisibleMotion';
import {homeBikePolicy} from '../services/homeBikePolicy';
import {bikeOfferText} from '../services/bikeOffer.mjs';
import type {BikePolicy} from '../services/bike-rides-api';
import {LocationPickerModal} from './LocationPickerModal';
import {RideNotificationControl} from './RideNotificationControl';
import {nativeAvailable} from '../services/native';
import {MobilityExperience,type TravelMode} from './MobilityExperience';
import type {TransportArea} from './TransportRail';
import './repaido-go.css';

/** A compact home entry with current public offers; discovery starts inside Go. */
export function RepaidoGoEntry({onOpen,city=''}:{onOpen:()=>void;city?:string}){
 const {ref,active,visible}=useVisibleMotion<HTMLButtonElement>(),[policy,setPolicy]=useState<BikePolicy|null>(null),[clock,setClock]=useState(Date.now);
 useEffect(()=>{
  if(!visible||city.trim().toLowerCase()!=='balasore')return;
  let live=true;
  const read=()=>{setClock(Date.now());void homeBikePolicy().then(value=>{if(live)setPolicy(value);}).catch(()=>{if(live)setPolicy(null);});};
  read();const timer=setInterval(read,60000);return()=>{live=false;clearInterval(timer);};
 },[visible,city]);
 useEffect(()=>{if(!policy?.promo_ends_at)return;const delay=policy.promo_ends_at*1000-Date.now();if(delay<=0)return;const timer=setTimeout(()=>setClock(Date.now()),Math.min(delay+1,2147483647));return()=>clearTimeout(timer);},[policy,clock]);
 const offer=bikeOfferText(policy,city,Math.max(clock,Date.now())/1000);
 return <button ref={ref} type="button" className="repaido-go-entry" data-animated={active} onClick={onOpen}>
  <span className="go-entry-symbol" aria-hidden="true"><span className="go-entry-car"><GoVehicleArt kind="cab"/></span><span className="go-entry-bike"><GoVehicleArt kind="bike"/></span></span>
  <span className="go-entry-copy"><strong>Repaido <b>Go</b></strong><span>Bike & cab rides. One place to go.</span>{offer&&<small className="go-entry-offer">{offer}</small>}</span>
  <span className="go-entry-arrow" aria-hidden="true"><ArrowRight size={20}/></span>
 </button>;
}

export function RepaidoGo({location,onSignIn,onHome,onBookings,onModeSelect,onSearch,initialMode='bike',active=true}:{location:TransportArea;onSignIn:()=>void;onHome:()=>void;onBookings:()=>void;onModeSelect:(mode:TravelMode)=>void;onSearch:(mode:TravelMode)=>void;initialMode?:TravelMode;active?:boolean}){
 const [area,setArea]=useState(location),[picking,setPicking]=useState(false);
 useEffect(()=>setArea(location),[location.lat,location.lng,location.confirmed,location.address,location.city]);
 return <section className="repaido-go" aria-label="Repaido Go">
  <header className="go-header">
   <button type="button" className="go-back" aria-label="Back to Repaido home" onClick={onHome}><ArrowLeft size={21} aria-hidden="true"/></button>
   <div className="go-wordmark"><h1>repaido <span>Go</span><i aria-hidden="true">.</i></h1><button type="button" className="go-header-area" aria-label={`Change transport pickup area: ${area?.city||area?.address||'Choose pickup area'}`} onClick={()=>setPicking(true)}><MapPin size={13} aria-hidden="true"/><span>{area?.city||area?.address?.split(',')[0]||'Choose pickup area'}</span><ChevronDown size={13} aria-hidden="true"/></button></div>
   <button type="button" className="go-history" onClick={onBookings}><History size={20} aria-hidden="true"/><span>My rides</span></button>
  </header>
  {nativeAvailable()&&<details className="go-alerts-menu"><summary><Bell size={17} aria-hidden="true"/>Ride alerts</summary><RideNotificationControl onSignIn={onSignIn}/></details>}
  <MobilityExperience presentation="go" active={active} initialMode={initialMode} initialLocation={area} onLocationChange={setArea} onSignIn={onSignIn} onModeSelect={onModeSelect} onSearch={onSearch}/>
  {picking&&<LocationPickerModal isOpen className="go-location-dialog" title="Your pickup area" initialLat={area?.lat} initialLng={area?.lng} initialAddress={area?.address} initialCity={area?.city} onClose={()=>setPicking(false)} onConfirmLocation={value=>{setArea({...value,confirmed:true});setPicking(false);}}/>}
 </section>;
}
