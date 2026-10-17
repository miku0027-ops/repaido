import {InteractionMotion} from './InteractionMotion';
import {useEffect,useState} from 'react';
import {ArrowRight,CalendarDays,CarFront,ChevronDown,KeyRound,MapPin,ShieldCheck,Users} from 'lucide-react';
import {DiscoveryScene} from './DiscoveryScene';
import {auth} from '../firebase';
import {Modal} from './ui';
import {RideWizard,useBusinessRecords,BusinessRecords} from './LocalBusiness';
import {SharedRideSearch} from './SharedRides';
import {TransportRail,type TransportArea} from './TransportRail';
import {LocationPickerModal} from './LocationPickerModal';
import {MobilityMoreWays} from './MobilityMoreWays';
import './mobility-experience.css';
import './mobility-map-workspace.css';
export type TravelMode='cab'|'shared'|'self_drive'|'rental';
export const travelModes=[{id:'cab' as const,name:'Cab',title:'Your cab. Your route.',action:'Find a cab',icon:CarFront},{id:'shared' as const,name:'Shared ride',title:'Share the road.',action:'Find a shared ride',icon:Users},{id:'self_drive' as const,name:'Self-drive',title:'Drive your own way.',action:'Find a car',icon:KeyRound},{id:'rental' as const,name:'Cab rental',title:'A driver for your day.',action:'Plan a cab rental',icon:CalendarDays}];
export function MobilityExperience({onSignIn,initialLocation,onSearch,onModeSelect,embedded=false,initialMode='cab',active=true}:{onSignIn:()=>void;initialLocation?:TransportArea;onSearch?:(mode:TravelMode)=>void;onModeSelect?:(mode:TravelMode)=>void;embedded?:boolean;initialMode?:TravelMode;active?:boolean}){
 const [mode,setMode]=useState<TravelMode>(initialMode),[booking,setBooking]=useState<TravelMode|null>(null),[notice,setNotice]=useState(''),[chosen,setChosen]=useState(false),[historyOpen,setHistoryOpen]=useState(false);
 const [area,setArea]=useState(initialLocation),[picking,setPicking]=useState(false);
 useEffect(()=>{setArea(initialLocation);setPicking(false);},[initialLocation?.lat,initialLocation?.lng,initialLocation?.confirmed,initialLocation?.address,initialLocation?.city]);
 useEffect(()=>{if(!chosen)setMode(initialMode);},[initialMode,chosen]);
 const current=travelModes.find(item=>item.id===mode)!;
 const bookingMode=booking||mode,bookingName=travelModes.find(item=>item.id===bookingMode)!.name;
 const search=()=>onSearch?.(mode);
 const modeSwitch=<div className="mobility-mode-switch" role="group" aria-label="Transport service type">{travelModes.map(item=><button key={item.id} aria-pressed={mode===item.id} onClick={()=>{if(mode!==item.id)onModeSelect?.(item.id);setMode(item.id);setChosen(true);setNotice('');}}><span className="mobility-mode-icon"><item.icon size={21} aria-hidden="true"/></span><span>{item.name}</span><span className="mobility-mode-indicator" aria-hidden="true"/></button>)}</div>;
 const tripPanel=<div className="mobility-trip-planner"><div className="mobility-sheet-grip" aria-hidden="true"/>{modeSwitch}<div className="mobility-trip-heading"><div><small>{current.name}</small><h3>{current.title}</h3></div><current.icon size={24} aria-hidden="true"/></div><button type="button" className="mobility-route-start" aria-label={current.action} onClick={()=>setBooking(mode)}><span className="mobility-route-dots" aria-hidden="true"><i/><i/></span><span><strong>{mode==='self_drive'?'Choose your dates':mode==='rental'?'Plan your return trip':'Where are you going?'}</strong><small>{mode==='self_drive'?'Pickup, return & available cars':'Set pickup & destination'}</small></span><ArrowRight size={18} aria-hidden="true"/></button><p className="mobility-trip-assurance"><ShieldCheck size={14} aria-hidden="true"/>Review the route, terms and fare before requesting.</p></div>;
 return <section className={'local-business-hub mobility-experience'+(embedded?' mobility-embedded':'')} data-mode={mode} aria-label="Travel discovery">
  {!embedded&&<header className="mobility-heading"><div><small>REPAIDO MOVE</small><h2>Where to?</h2></div><button className="mobility-area-button" aria-label={`Change transport pickup area${area?.address?': '+area.address:''}`} onClick={()=>setPicking(true)}><MapPin size={16} aria-hidden="true"/><span>{area?.address?.split(',')[0]||area?.city||'Pickup area'}</span><ChevronDown size={14} aria-hidden="true"/></button></header>}
  {embedded&&<>{modeSwitch}<div key={mode} className={'mobility-mode-intro mobility-mode-'+mode}><div className="mobility-mode-copy"><span className="mobility-type-label">{current.name}</span><h3>{current.title}</h3><p>{mode==='shared'?'A seat on a scheduled route.':mode==='self_drive'?'Your dates. Your keys.':mode==='rental'?'A return trip with a driver.':'Pickup, destination, and a clear fare.'}</p></div><div className="mobility-mode-art"><DiscoveryScene kind={mode}/></div><button className="mobility-find-button" onClick={()=>setBooking(mode)}>{current.action}<ArrowRight size={17} aria-hidden="true"/></button></div></>}
  <TransportRail mapView={!embedded} tripPanel={!embedded?tripPanel:undefined} active={active} accountKey={auth.currentUser?.uid||'guest'} location={area} onLocation={()=>setPicking(true)} cabExperience={mode==='rental'?'hire':undefined} modeFilter={mode==='shared'?'shared':mode==='self_drive'?'rental':'cab'} compact onSearch={search} onSignIn={onSignIn} title={mode==='shared'?'Upcoming departures':mode==='self_drive'?'Cars near you':'Cabs near you'}/>
  {notice&&<div role="status" className="discovery-state discovery-state-success"><InteractionMotion kind="success" active={active}/><p>{notice}</p></div>}
  {!embedded&&<details className="mobility-booking-history" onToggle={event=>setHistoryOpen(event.currentTarget.open)}><summary>Your bookings</summary>{historyOpen&&<MobilityHistory onSignIn={onSignIn}/>}</details>}
  {!embedded&&<MobilityMoreWays mode={mode} area={area} onBook={value=>{setChosen(true);setBooking(value);}} onLocation={()=>setPicking(true)}/>}
  {booking&&<Modal title={bookingName} onClose={()=>setBooking(null)}>{bookingMode==='shared'?<SharedRideSearch onSignIn={onSignIn} onSearch={()=>onSearch?.(bookingMode)}/>:<RideWizard mode={bookingMode==='self_drive'?'rental':'cab'} experience={bookingMode==='rental'?'hire':undefined} initialLocation={area} onSignIn={onSignIn} onSearch={()=>onSearch?.(bookingMode)} onClose={()=>setBooking(null)} onSaved={()=>{setBooking(null);setNotice('Request sent. Follow it in Bookings → Rides.');}}/>}</Modal>}
  {picking&&<LocationPickerModal isOpen title="Your pickup area" initialLat={area?.lat} initialLng={area?.lng} initialAddress={area?.address} initialCity={area?.city} onClose={()=>setPicking(false)} onConfirmLocation={value=>{setArea({...value,confirmed:true});setPicking(false);}}/>}
 </section>;
}

function MobilityHistory({onSignIn}:{onSignIn:()=>void}){const records=useBusinessRecords('rides');return <BusinessRecords kind="rides" records={records} onSignIn={onSignIn}/>;}
