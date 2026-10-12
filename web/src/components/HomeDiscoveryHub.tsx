import {useEffect,useState} from 'react';
import {CarFront,MapPin,Sparkles,Wrench} from 'lucide-react';
import {discoveryFocus,typeDiscoveryIntent} from '../services/discoveryFocus.mjs';
import type {Service} from '../types';
import type {DiscoveryEvent} from './ServiceHydration';
import type {TransportArea} from './TransportRail';
import {MobilityExperience,type TravelMode} from './MobilityExperience';
import {QuickRepairFinder} from './QuickRepairFinder';
type Focus='transport'|'repair';
export function HomeDiscoveryHub({location,accountKey,onLocation,onSignIn,onBook,onHome,onEvent,personalised=false,transportInterest=false,repairInterest=false,transportMode,preferredFocus,repairCategory}:{location:TransportArea;accountKey:string;onLocation:()=>void;onSignIn:()=>void;onBook:(s:Service,p?:{id:string;name:string})=>void;onHome:(s:string,p:{id:string;name:string})=>void;onEvent:(e:DiscoveryEvent)=>void;personalised?:boolean;transportInterest?:boolean;repairInterest?:boolean;transportMode?:TravelMode;preferredFocus?:Focus|null;repairCategory?:string|null}){
 const [manual,setManual]=useState<Focus|null>(null),[now,setNow]=useState(new Date()),[held,setHeld]=useState<Focus|null>(null);
 const [intent,setIntent]=useState<Focus|null>(null),[announcement,setAnnouncement]=useState('');
 useEffect(()=>{setManual(null);setHeld(null);setIntent(null);setAnnouncement('');},[accountKey]);
 useEffect(()=>{if(!personalised)setIntent(null);},[personalised]);
 useEffect(()=>{const timer=setInterval(()=>{if(!held&&!document.hidden)setNow(new Date());},60000);return()=>clearInterval(timer);},[held]);
 useEffect(()=>{
  const updated=(event:Event)=>{const detail=(event as CustomEvent).detail;
   if(personalised&&detail?.accountKey===accountKey){const next=typeDiscoveryIntent(detail.categories);if(next)setIntent(next.focus);}
  };
  window.addEventListener('repaido:discovery-intent',updated);return()=>window.removeEventListener('repaido:discovery-intent',updated);
 },[accountKey,personalised]);
 const proposed=discoveryFocus({now,personalised,transportInterest,repairInterest,preferredFocus:intent||preferredFocus});
 const focus=manual||held||proposed;
 const choose=(next:Focus)=>{setManual(next);setHeld(next);setAnnouncement(next==='transport'?'Rides selected.':'Repairs selected.');};
 return <section className="home-discovery-hub" data-focus={focus} aria-label="Quick discovery" onFocusCapture={()=>setHeld(focus)} onPointerDown={()=>setHeld(focus)}>
  <header className="home-discovery-heading"><div><span className="discovery-eyebrow">YOUR EVERYDAY, CONNECTED</span><h2>{focus==='transport'?'Make your next move.':'What needs fixing?'}</h2></div><button className="discovery-location-chip" onClick={onLocation}><MapPin size={15} aria-hidden="true"/>{location.confirmed?location.city||'Your area':'Choose your area'}</button></header>
  <div className="home-discovery-navigation"><div className="home-discovery-switch" role="group" aria-label="Quick discovery type"><button aria-pressed={focus==='transport'} aria-controls="home-rides-panel" onClick={()=>choose('transport')}><CarFront size={18} aria-hidden="true"/>Rides</button><button aria-pressed={focus==='repair'} aria-controls="home-repairs-panel" onClick={()=>choose('repair')}><Wrench size={18} aria-hidden="true"/>Repairs</button></div>{manual&&<button className="discovery-suggested-button" aria-label="Use suggested discovery" title="Use suggested discovery" onClick={()=>{setManual(null);setHeld(null);setNow(new Date());setAnnouncement('Suggested discovery selected.');}}><Sparkles size={17} aria-hidden="true"/></button>}</div>
  {/* Preserve drafts on switches; hidden transport pauses its network work. */}
  <div id="home-rides-panel" className="home-discovery-panel" hidden={focus!=='transport'}><MobilityExperience key={accountKey} embedded active={focus==='transport'} initialMode={transportMode} initialLocation={location} onSignIn={onSignIn} onModeSelect={mode=>onEvent({kind:'category_view',category:'transport_'+mode})} onSearch={mode=>onEvent({kind:'search',category:'transport_'+mode})}/></div>
  <div id="home-repairs-panel" className="home-discovery-panel" hidden={focus!=='repair'}><QuickRepairFinder key={accountKey} active={focus==='repair'} location={location} accountKey={accountKey} preferredCategory={personalised?repairCategory:undefined} onLocation={onLocation} onBook={onBook} onHome={onHome} onEvent={onEvent}/></div>
  <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
 </section>;
}
