import {useEffect,useState} from 'react';
import {ArrowRight,CalendarDays,CarFront,KeyRound,MapPin,Users} from 'lucide-react';
import {DiscoveryScene} from './DiscoveryScene';
import {auth} from '../firebase';
import {Modal} from './ui';
import {RideWizard,useBusinessRecords,BusinessRecords} from './LocalBusiness';
import {SharedRideSearch} from './SharedRides';
import {TransportRail,type TransportArea} from './TransportRail';
import './mobility-experience.css';
export type TravelMode='cab'|'shared'|'self_drive'|'rental';
export const travelModes=[{id:'cab' as const,name:'Cab',title:'Your cab. Your route.',action:'Find a cab',icon:CarFront},{id:'shared' as const,name:'Shared ride',title:'Share the road.',action:'Find a shared ride',icon:Users},{id:'self_drive' as const,name:'Self-drive',title:'Drive your own way.',action:'Find a car',icon:KeyRound},{id:'rental' as const,name:'Cab rental',title:'A driver for your day.',action:'Plan a cab rental',icon:CalendarDays}];
export function MobilityExperience({onSignIn,initialLocation,onSearch,onModeSelect,embedded=false,initialMode='cab',active=true}:{onSignIn:()=>void;initialLocation?:TransportArea;onSearch?:(mode:TravelMode)=>void;onModeSelect?:(mode:TravelMode)=>void;embedded?:boolean;initialMode?:TravelMode;active?:boolean}){
 const [mode,setMode]=useState<TravelMode>(initialMode),[booking,setBooking]=useState(false),[notice,setNotice]=useState(''),[chosen,setChosen]=useState(false);
 useEffect(()=>{if(!chosen)setMode(initialMode);},[initialMode,chosen]);
 const current=travelModes.find(item=>item.id===mode)!;
 const search=()=>onSearch?.(mode);
 return <section className={'local-business-hub mobility-experience'+(embedded?' mobility-embedded':'')} data-mode={mode} aria-label="Travel discovery">
  {!embedded&&<header className="mobility-heading"><div><small>REPAIDO MOVE</small><h2>Where to?</h2></div><MapPin size={19} aria-hidden="true"/></header>}
  <div className="mobility-mode-switch" role="group" aria-label="Transport service type">{travelModes.map(item=><button key={item.id} aria-pressed={mode===item.id} onClick={()=>{if(mode!==item.id)onModeSelect?.(item.id);setMode(item.id);setChosen(true);setNotice('');}}><span className="mobility-mode-icon"><item.icon size={21} aria-hidden="true"/></span><span>{item.name}</span><span className="mobility-mode-indicator" aria-hidden="true"/></button>)}</div>
  <div key={mode} className={'mobility-mode-intro mobility-mode-'+mode}><div className="mobility-mode-copy"><span className="mobility-type-label">{current.name}</span><h3>{current.title}</h3><p>{mode==='shared'?'A seat on a scheduled route.':mode==='self_drive'?'Your dates. Your keys.':mode==='rental'?'A return trip with a driver.':'Pickup, destination, and a clear fare.'}</p></div><div className="mobility-mode-art"><DiscoveryScene kind={mode}/></div><button className="mobility-find-button" onClick={()=>setBooking(true)}>{current.action}<ArrowRight size={17} aria-hidden="true"/></button></div>
  <TransportRail active={active} accountKey={auth.currentUser?.uid||'guest'} location={initialLocation} cabExperience={mode==='rental'?'hire':undefined} modeFilter={mode==='shared'?'shared':mode==='self_drive'?'rental':'cab'} compact onSearch={search} onSignIn={onSignIn} title={mode==='shared'?'Upcoming departures':mode==='self_drive'?'Cars near you':'Cabs near you'}/>
  {notice&&<p role="status" className="business-accepted">{notice}</p>}
  {!embedded&&<details className="mobility-booking-history"><summary>Your bookings</summary><MobilityHistory onSignIn={onSignIn}/></details>}
  {booking&&<Modal title={current.name} onClose={()=>setBooking(false)}>{mode==='shared'?<SharedRideSearch onSignIn={onSignIn} onSearch={search}/>:<RideWizard mode={mode==='self_drive'?'rental':'cab'} experience={mode==='rental'?'hire':undefined} initialLocation={initialLocation} onSignIn={onSignIn} onSearch={search} onClose={()=>setBooking(false)} onSaved={()=>{setBooking(false);setNotice('Request sent. Follow it in Bookings → Rides.');}}/>}</Modal>}
 </section>;
}

function MobilityHistory({onSignIn}:{onSignIn:()=>void}){const records=useBusinessRecords('rides');return <BusinessRecords kind="rides" records={records} onSignIn={onSignIn}/>;}
