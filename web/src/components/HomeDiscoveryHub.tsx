import './home-discovery-polish.css';
import {useEffect,useState} from 'react';
import {CarFront,ChevronDown,MapPin,Tune,Storefront,Sparkles,HomeRepair} from '../icons';
import {discoveryFocus,typeDiscoveryIntent} from '../services/discoveryFocus.mjs';
import type {Service} from '../types';
import type {DiscoveryEvent} from './ServiceHydration';
import type {TransportArea} from './TransportRail';
import {MobilityExperience,type TravelMode} from './MobilityExperience';
import {QuickRepairFinder} from './QuickRepairFinder';
import {MarketplaceDiscovery,type MarketplaceMode,type MarketplaceDestination} from './MarketplaceDiscovery';
import type {QuickMarket} from './HomeQuickActions';
import './home-discovery-refresh.css';
import './home-discovery-photo.css';
import './quick-discovery-refined.css';
export type DiscoveryFocus='transport'|'repair'|'marketplace';
type Focus=DiscoveryFocus;
export function HomeDiscoveryHub({location,accountKey,onLocation,onSignIn,onBook,onHome,onEvent,onMarket,onPreferences,personalised=false,transportInterest=false,repairInterest=false,transportMode,preferredFocus,repairCategory,suggestedFocus,marketMode,separateTransport=false}:{location:TransportArea;accountKey:string;onLocation:()=>void;onSignIn:()=>void;onBook:(s:Service,p?:{id:string;name:string})=>void;onHome:(s:string,p:{id:string;name:string})=>void;onEvent:(e:DiscoveryEvent)=>void;onMarket?:(section:MarketplaceDestination,options?:QuickMarket)=>void;onPreferences?:()=>void;personalised?:boolean;transportInterest?:boolean;repairInterest?:boolean;transportMode?:TravelMode;preferredFocus?:Focus|null;repairCategory?:string|null;suggestedFocus?:Focus;marketMode?:MarketplaceMode;separateTransport?:boolean}){
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
 const selected=manual||held||suggestedFocus||proposed;
 const available=selected==='transport'&&separateTransport?'repair':selected;
 const focus=available==='marketplace'&&!onMarket?(separateTransport?'repair':'transport'):available;
 const choose=(next:Focus)=>{setManual(next);setHeld(next);setAnnouncement(next==='transport'?'Rides selected.':next==='repair'?'Repairs selected.':'Marketplace selected.');};
 return <section className="home-discovery-hub discovery-polished discovery-refined" data-focus={focus} aria-label="Quick discovery" onFocusCapture={()=>setHeld(focus)} onPointerDown={()=>setHeld(focus)}>
  <header className="home-discovery-heading"><div className="discovery-heading-copy"><span className="discovery-eyebrow">Discover nearby</span><h2>{focus==='transport'?'Where to next?':focus==='repair'?'What needs fixing?':'Find a little more.'}</h2></div><div className="discovery-heading-actions"><button className="discovery-location-chip" onClick={onLocation}><MapPin size={16} aria-hidden="true"/><span>{location.confirmed?location.city||'Your area':'Choose your area'}</span><ChevronDown size={14} aria-hidden="true"/></button>{onPreferences&&<button className="discovery-settings-button" aria-label="Discovery settings" aria-haspopup="dialog" onClick={onPreferences}><Tune size={20} aria-hidden="true"/></button>}</div></header>
  <div className="home-discovery-navigation"><div className="home-discovery-switch" role="group" aria-label="Quick discovery type">{!separateTransport&&<button aria-pressed={focus==='transport'} aria-controls="home-rides-panel" onClick={()=>choose('transport')}><CarFront size={20} aria-hidden="true"/>Rides</button>}<button aria-pressed={focus==='repair'} aria-controls="home-repairs-panel" onClick={()=>choose('repair')}><HomeRepair size={20} aria-hidden="true"/>Repairs</button>{onMarket&&<button aria-pressed={focus==='marketplace'} aria-controls="home-market-panel" onClick={()=>choose('marketplace')}><Storefront size={20} aria-hidden="true"/>Market</button>}</div>{manual&&<button className="discovery-suggested-button" aria-label="Use suggested discovery" title="Use suggested discovery" onClick={()=>{setManual(null);setHeld(null);setNow(new Date());setAnnouncement('Suggested discovery selected.');}}><Sparkles size={20} aria-hidden="true"/></button>}</div>
  {/* Preserve drafts on switches; hidden transport pauses its network work. */}
  {!separateTransport&&<div id="home-rides-panel" className="home-discovery-panel" hidden={focus!=='transport'}><MobilityExperience key={accountKey} embedded active={focus==='transport'} initialMode={transportMode} initialLocation={location} onSignIn={onSignIn} onModeSelect={mode=>onEvent({kind:'category_view',category:'transport_'+mode})} onSearch={mode=>onEvent({kind:'search',category:'transport_'+mode})}/></div>}
  <div id="home-repairs-panel" className="home-discovery-panel" hidden={focus!=='repair'}><QuickRepairFinder key={accountKey} active={focus==='repair'} location={location} accountKey={accountKey} preferredCategory={personalised?repairCategory:undefined} onLocation={onLocation} onBook={onBook} onHome={onHome} onEvent={onEvent}/></div>
  {onMarket&&<div id="home-market-panel" className="home-discovery-panel" hidden={focus!=='marketplace'}><MarketplaceDiscovery key={accountKey} active={focus==='marketplace'} location={location} accountKey={accountKey} suggestedMode={marketMode} onMarket={onMarket} onEvent={onEvent} onLocation={onLocation}/></div>}
  <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
 </section>;
}
