import {MotionPage} from './MotionPage';
import {InteractionMotion} from './InteractionMotion';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,ChevronDown,History,MoreHorizontal,KeyRound,MapPin,ShieldCheck,LocalTaxi,Diversity3,EventAvailable,TwoWheeler} from '../icons';
import {DiscoveryScene} from './DiscoveryScene';
import {auth} from '../firebase';
import {Modal} from './ui';
import {RideWizard,TransportBookings} from './LocalBusiness';
import {SharedRideSearch} from './SharedRides';
import {TransportRail,type TransportArea} from './TransportRail';
import {LocationPickerModal} from './LocationPickerModal';
import {MobilityMoreWays} from './MobilityMoreWays';
import {BikeRides} from './BikeRides';
import './mobility-experience.css';
import './mobility-map-workspace.css';
import './rides-workspace.css';
export type TravelMode='cab'|'bike'|'shared'|'self_drive'|'rental';
export const travelModes=[{id:'bike' as const,name:'Bike',title:'Bike rides',action:'Find a bike',icon:TwoWheeler},{id:'cab' as const,name:'Cab',title:'Plan a cab trip',action:'Find a cab',icon:LocalTaxi},{id:'shared' as const,name:'Shared ride',title:'Find a seat on your route',action:'Find a shared ride',icon:Diversity3},{id:'self_drive' as const,name:'Self-drive',title:'Your dates, your car',action:'Find a car',icon:KeyRound},{id:'rental' as const,name:'Cab rental',title:'Keep a driver for your trip',action:'Plan a cab rental',icon:EventAvailable}];
export function MobilityExperience({onSignIn,initialLocation,onSearch,onModeSelect,embedded=false,initialMode='bike',active=true,presentation='default'}:{presentation?:'default'|'go';onSignIn:()=>void;initialLocation?:TransportArea;onSearch?:(mode:TravelMode)=>void;onModeSelect?:(mode:TravelMode)=>void;embedded?:boolean;initialMode?:TravelMode;active?:boolean}){
 const isGo=presentation==='go';
 const [moreOpen,setMoreOpen]=useState(false);
 const [mode,setMode]=useState<TravelMode>(initialMode),[booking,setBooking]=useState<TravelMode|'shared_bike'|null>(null),[notice,setNotice]=useState(''),[chosen,setChosen]=useState(false),[historyOpen,setHistoryOpen]=useState(false);
 const [area,setArea]=useState(initialLocation),[picking,setPicking]=useState(false);
 useEffect(()=>{setArea(initialLocation);setPicking(false);},[initialLocation?.lat,initialLocation?.lng,initialLocation?.confirmed,initialLocation?.address,initialLocation?.city]);
 useEffect(()=>{if(isGo||!chosen)setMode(initialMode);},[initialMode,chosen,isGo]);
 useEffect(()=>{const open=()=>{if(active){setMode('bike');setChosen(true);setBooking(null);onModeSelect?.('bike');}};window.addEventListener('repaido:open-bike-rides',open);return()=>window.removeEventListener('repaido:open-bike-rides',open);},[active,onModeSelect]);
 const modeRail=useRef<HTMLDivElement>(null);
 useEffect(()=>{const rail=modeRail.current;if(!rail)return;const reveal=()=>{const selected=rail.querySelector<HTMLElement>('[aria-pressed=true]');if(!selected)return;const r=rail.getBoundingClientRect(),b=selected.getBoundingClientRect();if(b.left<r.left+3)rail.scrollLeft+=b.left-r.left-3;else if(b.right>r.right-3)rail.scrollLeft+=b.right-r.right+3;};reveal();const observer=new ResizeObserver(reveal);observer.observe(rail);return()=>observer.disconnect();},[mode]);
 const current=travelModes.find(item=>item.id===mode)!;
 const bookingMode=booking||mode,bookingName=bookingMode==='shared_bike'?'Shared bike':travelModes.find(item=>item.id===bookingMode)!.name;
 const search=()=>onSearch?.(mode);
 const primaryModes=isGo?travelModes.filter(item=>item.id==='bike'||item.id==='cab'):travelModes;
 const modeSwitch=<div ref={modeRail} className="mobility-mode-switch mobility-mode-switch-extended" role="group" aria-label="Transport service type">{primaryModes.map(item=><button key={item.id} aria-pressed={mode===item.id} onClick={()=>{if(mode!==item.id)onModeSelect?.(item.id);setMode(item.id);setChosen(true);setNotice('');}}><span className="mobility-mode-icon"><item.icon size={23} aria-hidden="true"/></span><span className="mobility-mode-label">{item.name}</span>{isGo&&<small>{item.id==='bike'?'One passenger':'With a driver'}</small>}</button>)}{isGo&&<button type="button" className="go-more-modes" aria-label="More ride options" aria-haspopup="dialog" aria-pressed={!['bike','cab'].includes(mode)} onClick={()=>setMoreOpen(true)}><MoreHorizontal size={23} aria-hidden="true"/><span>{['bike','cab'].includes(mode)?'More':current.name}</span></button>}</div>;
 const tripPanel=<div className="mobility-trip-planner"><div className="mobility-trip-heading"><h3>{current.title}</h3><current.icon size={24} aria-hidden="true"/></div><button type="button" className="mobility-route-start" aria-label={current.action} onClick={()=>setBooking(mode)}><span className="mobility-route-dots" aria-hidden="true"><i/><i/></span><span><strong>{mode==='self_drive'?'Choose pickup & return dates':mode==='shared'?'Set your pickup & drop-off':'Plan pickup & destination'}</strong><small>{mode==='shared'?'Choose a departure time and seats':mode==='self_drive'?'Review available cars and the full quote':'Choose dates and review the full quote'}</small></span><ArrowRight size={18} aria-hidden="true"/></button><p className="mobility-trip-assurance"><ShieldCheck size={15} aria-hidden="true"/>Your fare and terms, before you request.</p></div>;
 const modeContent=<>
  {isGo&&<div className="go-bike-panel" hidden={mode!=='bike'}><BikeRides onSignIn={onSignIn} initialLocation={area} active={active&&mode==='bike'} onSearch={search}/></div>}
  {mode==='bike'?!isGo&&<BikeRides onSignIn={onSignIn} initialLocation={area} active={active} onSearch={search} onSharedBike={()=>setBooking('shared_bike')}/>:<TransportRail googleMap={isGo} mapView={!embedded} tripPanel={!embedded?tripPanel:undefined} active={active} accountKey={auth.currentUser?.uid||'guest'} location={area} onLocation={()=>setPicking(true)} cabExperience={mode==='rental'?'hire':undefined} modeFilter={mode==='shared'?'shared':mode==='self_drive'?'rental':'cab'} compact onSearch={search} onSignIn={onSignIn} title={mode==='shared'?'Upcoming departures':mode==='self_drive'?'Cars near you':'Cabs near you'}/>}
 </>;
 return <section className={'local-business-hub mobility-experience rides-workspace'+(embedded?' mobility-embedded':'')+(isGo?' go-mobility':'')} data-mode={mode} aria-label="Travel discovery">
  {!embedded&&<header className="mobility-heading"><div><h2>{isGo?'Where are we going?':'Book a ride'}</h2><button className="mobility-area-button" aria-label={`Change transport pickup area${area?.address?': '+area.address:''}`} onClick={()=>setPicking(true)}><MapPin size={16} aria-hidden="true"/><span>{area?.address?.split(',')[0]||area?.city||'Choose pickup area'}</span><ChevronDown size={14} aria-hidden="true"/></button></div>{!isGo&&<button className="mobility-history-button" aria-label="Your ride bookings" aria-haspopup="dialog" onClick={()=>setHistoryOpen(true)}><History size={19} aria-hidden="true"/><span>My rides</span></button>}</header>}
  {modeSwitch}
  {embedded&&mode!=='bike'&&<div key={mode} className={'mobility-mode-intro mobility-mode-'+mode}><div className="mobility-mode-copy"><span className="mobility-type-label">{current.name}</span><h3>{current.title}</h3><p>{mode==='shared'?'A seat on a scheduled route.':mode==='self_drive'?'Your dates. Your keys.':mode==='rental'?'A return trip with a driver.':'Pickup, destination, and a clear fare.'}</p></div><div className="mobility-mode-art"><DiscoveryScene kind={mode}/></div><button className="mobility-find-button" onClick={()=>setBooking(mode)}>{current.action}<ArrowRight size={18} aria-hidden="true"/></button></div>}
  {isGo?<MotionPage step={mode} variant="ride" className="go-mode-stage">{modeContent}</MotionPage>:modeContent}
  {notice&&<div role="status" className="discovery-state discovery-state-success"><InteractionMotion kind="success" active={active}/><p>{notice}</p></div>}
  {!embedded&&!isGo&&mode!=='bike'&&<MobilityMoreWays mode={mode} onBook={value=>{setChosen(true);if(value==='bike'){setMode('bike');onModeSelect?.('bike');}else setBooking(value);}}/>}
  {moreOpen&&<Modal title="More ways to go" className="go-options-dialog" onClose={()=>setMoreOpen(false)}><div className="go-more-options">{travelModes.filter(item=>!['bike','cab'].includes(item.id)).map(item=><button key={item.id} type="button" onClick={()=>{setMode(item.id);setChosen(true);onModeSelect?.(item.id);setMoreOpen(false);}}><item.icon size={25} aria-hidden="true"/><span><strong>{item.name}</strong><small>{item.title}</small></span><ArrowRight size={18} aria-hidden="true"/></button>)}<button type="button" onClick={()=>{setMoreOpen(false);setBooking('shared_bike');}}><TwoWheeler size={25} aria-hidden="true"/><span><strong>Shared bike</strong><small>Join a published bike journey</small></span><ArrowRight size={18} aria-hidden="true"/></button></div></Modal>}
  {historyOpen&&<Modal title="Your rides" className="mobility-booking-dialog mobility-history-dialog" onClose={()=>setHistoryOpen(false)}><TransportBookings onSignIn={()=>{setHistoryOpen(false);onSignIn();}}/></Modal>}
  {booking&&<Modal title={bookingName} className={"mobility-booking-dialog"+(isGo?" go-booking-dialog":"")} onClose={()=>setBooking(null)}>{bookingMode==='shared'||bookingMode==='shared_bike'?<SharedRideSearch initialLocation={area} vehicleKind={bookingMode==='shared_bike'?'bike':undefined} onSignIn={onSignIn} onSearch={()=>onSearch?.(bookingMode==='shared_bike'?'bike':'shared')}/>:<RideWizard mode={bookingMode==='self_drive'?'rental':'cab'} experience={bookingMode==='rental'?'hire':undefined} initialLocation={area} onSignIn={onSignIn} onSearch={()=>onSearch?.(bookingMode)} onClose={()=>setBooking(null)} onSaved={()=>{setBooking(null);setNotice('Request sent. Follow it in Bookings → Rides.');}}/>}</Modal>}
  {picking&&<LocationPickerModal isOpen title="Your pickup area" initialLat={area?.lat} initialLng={area?.lng} initialAddress={area?.address} initialCity={area?.city} onClose={()=>setPicking(false)} onConfirmLocation={value=>{setArea({...value,confirmed:true});setPicking(false);}}/>}
 </section>;
}
