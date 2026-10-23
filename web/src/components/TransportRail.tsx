import {InteractionMotion} from './InteractionMotion';
import {lazy,Suspense,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {ArrowRight,Car,ChevronDown,ChevronLeft,ChevronRight,RefreshCw,Diversity3,KeyRound,EventAvailable,LocalTaxi,MapPin,Users} from '../icons';
import {apiFetch} from '../services/api';
import {createReadCache} from '../services/readCache.mjs';
import {money} from '../services/operations';
import {SharedRideSearch} from './SharedRides';
import {ContractError} from './customContractUI';
import {Modal} from './ui';
import {LocationPickerModal} from './LocationPickerModal';
import {usePublicCabAreas} from '../hooks/usePublicCabAreas';
import './transport-rail.css';

const PickupAreaMap=lazy(()=>import('./PickupAreaMap'));
const GooglePickupAreaMap=lazy(()=>import('./GooglePickupAreaMap'));
const RideWizard=lazy(()=>import('./LocalBusiness').then(module=>({default:module.RideWizard})));
const cache=createReadCache({maxEntries:12});
export type TransportArea={lat?:number;lng?:number;confirmed?:boolean;address?:string;city?:string};
type Nearby={departures:any[];vehicles:any[];radius_km:number;vehicle_radius_km?:number;receivedAt?:number};
const date=(time:number)=>new Date(time*1000).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

export function TransportRail({location,onLocation,onSignIn,onSearch,title='Rides near you',accountKey='guest',modeFilter='all',compact=false,smallCards=false,cabExperience,active=true,mapView=false,tripPanel,googleMap=false}:{googleMap?:boolean;mapView?:boolean;tripPanel?:ReactNode;cabExperience?:'hire';modeFilter?:'all'|'cab'|'rental'|'shared';compact?:boolean;smallCards?:boolean;location?:TransportArea;onLocation?:()=>void;onSignIn:()=>void;onSearch?:()=>void;title?:string;accountKey?:string;active?:boolean}){
 const panelId=useId();const [expanded,setExpanded]=useState(true),[online,setOnline]=useState(navigator.onLine),[clock,setClock]=useState(Date.now());
 useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);const timer=setInterval(()=>{if(!document.hidden)setClock(Date.now());},30000);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);clearInterval(timer);};},[]);
 const [area,setArea]=useState<TransportArea|undefined>(location),[picking,setPicking]=useState(false);
 useEffect(()=>{setArea(location);setPicking(false);},[location?.lat,location?.lng,location?.confirmed,location?.address,location?.city,accountKey]);
 const chooseArea=()=>onLocation?onLocation():setPicking(true);
 const valid=area?.confirmed!==false&&Number.isFinite(area?.lat)&&Number.isFinite(area?.lng);
 const path=valid?`/local-business/transport/nearby?lat=${area!.lat}&lng=${area!.lng}`:'';
 const key=accountKey+':'+path,rail=useRef<HTMLDivElement>(null);
 const [state,setState]=useState<{key:string;data:Nearby|null;error:string;busy:boolean}>(()=>({key,data:cache.peek(key),error:'',busy:false}));
 const [selected,setSelected]=useState<any>(null),[vehicle,setVehicle]=useState<{row:any;mode:'cab'|'rental'}|null>(null),[notice,setNotice]=useState('');
 const [revision,setRevision]=useState(0),lastLoad=useRef({key:'',revision:0});
 const publicCabs=usePublicCabAreas(area,active&&mapView&&modeFilter==='cab',accountKey,revision);
 useEffect(()=>{setSelected(null);setVehicle(null);setNotice('');},[key,modeFilter,cabExperience]);
 useEffect(()=>{if(!active||!expanded)return;let alive=true;
  const load=async(force=false)=>{if(!path)return;setState(old=>({key,data:old.key===key?old.data:cache.peek(key),error:'',busy:force||!(old.key===key?old.data:cache.peek(key))}));
   try{const data=await cache.read(key,async()=>{const response=await apiFetch('/api/operations'+path,{}, {background:true,feedback:false});const result=await response.json();if(!response.ok)throw Error(result.detail?.message||'Nearby rides could not load. Please retry.');return {...result,receivedAt:Date.now()};},{freshMs:20000,force});if(alive)setState({key,data,error:'',busy:false});}
   catch(error){if(alive)setState(old=>({...old,error:(error as Error).message,busy:false}));}
  };
  const force=lastLoad.current.key===key&&lastLoad.current.revision!==revision;lastLoad.current={key,revision};
  void load(force);const update=()=>{if(!document.hidden&&navigator.onLine)void load();};const interval=setInterval(update,30000);
  window.addEventListener('online',update);document.addEventListener('visibilitychange',update);
  return()=>{alive=false;clearInterval(interval);window.removeEventListener('online',update);document.removeEventListener('visibilitychange',update);};
 },[key,path,revision,active,expanded]);
 const data=state.key===key?state.data:null;
 const stale=Boolean(data?.receivedAt&&clock-data.receivedAt>60000);
 const refreshLabel=!online?'Offline · reconnect to update':!active||!expanded?'Availability paused · expand to update':state.key===key&&state.busy?'Updating availability…':state.key===key&&state.error?'Could not refresh · results may have changed':stale?'Results may have changed · refresh to check':data?'Availability refreshes every 30 seconds':'';
 const departures=(modeFilter==='all'||modeFilter==='shared')?data?.departures||[]:[];const vehicles=(data?.vehicles||[]).filter(row=>row.offered_modes.some((m:string)=>modeFilter==='all'||m===modeFilter));
 const optionCount=departures.length+vehicles.reduce((sum:number,row:any)=>sum+row.offered_modes.filter((mode:string)=>modeFilter==='all'||mode===modeFilter).length,0);
 const [edges,setEdges]=useState({previous:false,next:false});
 useEffect(()=>{
  if(!smallCards||!expanded)return;const element=rail.current;if(!element)return;
  const measure=()=>setEdges({previous:element.scrollLeft>2,next:element.scrollLeft+element.clientWidth<element.scrollWidth-2});
  measure();const observer=new ResizeObserver(measure);observer.observe(element);element.addEventListener('scroll',measure,{passive:true});
  return()=>{observer.disconnect();element.removeEventListener('scroll',measure);};
 },[smallCards,expanded,key,optionCount]);
 const move=(direction:number)=>rail.current?.scrollBy({left:direction*(rail.current.clientWidth*.85),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 const signIn=()=>{setSelected(null);setVehicle(null);onSignIn();};
 const content=<>
  <header><div>{!compact&&!smallCards&&<small>REPAIDO · MOVE</small>}<h2>{compact?<button className="transport-panel-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={()=>setExpanded(value=>!value)}>{modeFilter==='shared'?<Diversity3 size={18} aria-hidden="true"/>:modeFilter==='rental'?<KeyRound size={18} aria-hidden="true"/>:<LocalTaxi size={18} aria-hidden="true"/>}{title}{optionCount>0&&<span className="transport-count">{optionCount}</span>}<ChevronDown size={16} aria-hidden="true"/></button>:title}</h2></div><div className="transport-rail-controls">{smallCards&&!valid&&<button className="transport-area-shortcut" onClick={chooseArea}>Set pickup area<ArrowRight size={16} aria-hidden="true"/></button>}{valid&&expanded&&<button disabled={state.busy} aria-label="Refresh nearby transport" onClick={()=>setRevision(n=>n+1)}><RefreshCw size={18} className={state.busy?'transport-refreshing':''} aria-hidden="true"/></button>}{expanded&&optionCount>1&&<><button disabled={smallCards&&!edges.previous} aria-label="Previous transport options" onClick={()=>move(-1)}><ChevronLeft size={18}/></button><button disabled={smallCards&&!edges.next} aria-label="Next transport options" onClick={()=>move(1)}><ChevronRight size={18}/></button></>}</div></header>
  {mapView&&valid&&<p className="transport-availability-status" role="status">{refreshLabel}</p>}
  <div id={panelId} hidden={compact&&!expanded} className="transport-panel-body" aria-busy={state.key===key&&state.busy}>
  {!valid?(smallCards?null:<div className="transport-empty discovery-state"><InteractionMotion kind="location" active={active&&expanded}/><div><p>Choose a pickup area.</p><button onClick={chooseArea}>Set pickup area<ArrowRight size={16}/></button></div></div>):<>
   {!compact&&<p className="transport-caption">{smallCards?'Shared · 20 km · Cabs & rentals · 8 km':'Shared departures within 20 km · Cab pickups and rentals within 8 km'}</p>}
   <ContractError error={state.key===key?state.error:''} onRetry={()=>setRevision(n=>n+1)}/>
   {!data&&!state.error&&<div className="transport-loading"><div className="discovery-state" role="status"><InteractionMotion kind="search" active={active&&expanded}/><p>Finding nearby rides…</p></div><div className="transport-skeleton" aria-hidden="true"><span/><span/><span/></div></div>}
   {data&&!departures.length&&!vehicles.length&&<div className="transport-empty transport-empty-illustrated"><div className="transport-empty-route" aria-hidden="true"><span/><Car size={32}/><span/></div><div><strong>{modeFilter==='shared'?'No departures here yet.':'No vehicles here yet.'}</strong><button onClick={chooseArea}>Try another pickup area<ArrowRight size={14} aria-hidden="true"/></button></div></div>}
   <div hidden={!departures.length&&!vehicles.length} ref={rail} className="transport-card-rail" role="region" tabIndex={0} aria-label="Nearby transport options" onKeyDown={event=>{if(!smallCards||event.target!==event.currentTarget)return;if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();if(event.key==='Home'||event.key==='End')event.currentTarget.scrollTo({left:event.key==='Home'?0:event.currentTarget.scrollWidth,behavior:'instant'});else move(event.key==='ArrowLeft'?-1:1);}}}>
    {departures.map(row=>smallCards?<SmallRideCard key={row.id} kind="shared" type={'Shared '+(row.vehicle_kind==='bike'?'bike':'car')+' ride'} title={row.origin_address+' → '+row.destination_address} owner={row.owner_name} distance={row.distance_metres} facts={date(row.starts_at)} note={row.available_seats+(row.available_seats===1?' seat · ':' seats · ')+row.vehicle_name} price={row.price_paise} unit="per seat" action="View ride" onOpen={()=>setSelected(row)}/>:<DepartureCard key={row.id} row={row} onOpen={()=>setSelected(row)}/>)}
    {vehicles.flatMap(row=>row.offered_modes.filter((m:string)=>modeFilter==='all'||m===modeFilter).map((mode:'cab'|'rental')=>smallCards?<SmallRideCard key={row.id+mode} kind={mode} type={mode==='cab'?'Cab with driver':'Self-drive rental'} title={row.name} owner={row.owner_name} distance={row.distance_metres} facts={row.seats+' seats · '+row.transmission} note={mode==='cab'?money(row.base_paise)+' base fare':'Pick dates for a full quote'} price={mode==='cab'?row.per_km_paise:row.daily_paise} unit={mode==='cab'?'per km':'per day'} action={mode==='cab'?'Check cab':'Check rental'} onOpen={()=>setVehicle({row,mode})}/>:<VehicleCard key={row.id+mode} row={row} mode={mode} cabExperience={cabExperience} onOpen={()=>setVehicle({row,mode})}/>))}
   </div>
  </>}
  </div>
  {notice&&<div className="discovery-state discovery-state-success" role="status"><InteractionMotion kind="success" active={active}/><p>{notice}</p></div>}
 </>;
 return <section className={'transport-discovery'+(mapView?' transport-map-discovery':'')+(smallCards?' transport-discovery-small':'')} data-expanded={expanded} data-option-count={optionCount} aria-label={title}>
  {mapView?<><Suspense fallback={<div className="mobility-pickup-map mobility-map-loading" role="status">Opening pickup map…</div>}>{googleMap?<GooglePickupAreaMap cabAreas={publicCabs.areas} cabStatus={modeFilter==='cab'?publicCabs.status:undefined} area={area} departures={departures} shared={modeFilter==='shared'} onLocation={chooseArea}/>:<PickupAreaMap cabAreas={publicCabs.areas} cabStatus={modeFilter==='cab'?publicCabs.status:undefined} area={area} departures={departures} radiusKm={modeFilter==='shared'?data?.radius_km||20:data?.vehicle_radius_km||8} shared={modeFilter==='shared'} active={active} onLocation={chooseArea}/>}</Suspense><div className="mobility-trip-sheet">{tripPanel}{content}</div></>:content}
  {selected&&<Modal title="Shared ride details" className="ride-dialog-sheet" onClose={()=>setSelected(null)}><SharedRideSearch departure={selected} onSignIn={signIn} onSearch={onSearch}/></Modal>}
  {vehicle&&<Modal title={vehicle.mode==='cab'?(cabExperience==='hire'?'Cab rental':'Book a cab'):'Self-drive rental'} onClose={()=>setVehicle(null)}><Suspense fallback={<p role="status">Opening booking…</p>}><RideWizard mode={vehicle.mode} experience={cabExperience} initialVehicleId={vehicle.row.id} initialLocation={area} onSignIn={signIn} onClose={()=>setVehicle(null)} onSearch={onSearch} onSaved={()=>{setVehicle(null);setNotice('Booking request sent. Follow the owner’s response in Bookings → Rides.');cache.invalidate(key);setRevision(n=>n+1);}}/></Suspense></Modal>}
  {picking&&<LocationPickerModal isOpen title="Your pickup area" onClose={()=>setPicking(false)} onConfirmLocation={pin=>{setArea({...pin,confirmed:true});setPicking(false);}}/>}
 </section>;
}

function SmallRideCard({kind,type,title,owner,distance,facts,note,price,unit,action,onOpen}:{kind:'shared'|'cab'|'rental';type:string;title:string;owner:string;distance:number;facts:string;note:string;price:number;unit:string;action:string;onOpen:()=>void}){
 const Icon=kind==='shared'?Diversity3:kind==='rental'?KeyRound:LocalTaxi;
 return <article className="transport-card transport-mini-card" data-transport-kind={kind}>
  <div className="transport-mini-top"><span className="transport-mini-symbol"><Icon size={19} aria-hidden="true"/></span><span className="transport-type">{type}</span></div>
  <h3 title={title}>{title}</h3><p className="transport-mini-owner" title={owner}>{owner}</p>
  <div className="transport-mini-facts"><p>{facts}</p><p className="transport-mini-note">{note}</p></div>
  <div className="transport-mini-distance">{(distance/1000).toFixed(1)} km {kind==='shared'?'to start':'nearby'}</div>
  <div className="transport-mini-action"><strong className="transport-price">{money(price)}<small>{unit}</small></strong><button onClick={onOpen} aria-label={action} title={action+' · '+title}>{action==='View ride'?'View':'Check'}<ArrowRight size={15} aria-hidden="true"/></button></div>
 </article>;
}


function DepartureCard({row,onOpen}:{row:any;onOpen:()=>void}){
 return <article className="transport-card transport-option-card"><span className="transport-type"><Diversity3 size={18} aria-hidden="true"/>Shared {row.vehicle_kind==='bike'?'bike':'car'} ride</span><h3 className="transport-option-route" aria-label={`${row.origin_address} to ${row.destination_address}`}><span>{row.origin_address}</span><ArrowRight size={17} aria-hidden="true"/><span>{row.destination_address}</span></h3><p className="transport-option-time">{date(row.starts_at)}</p><p>{row.vehicle_name} · {row.owner_name}</p><div className="transport-option-facts"><span><Users size={16} aria-hidden="true"/>{row.available_seats} seat{row.available_seats===1?'':'s'}</span><span><MapPin size={16} aria-hidden="true"/>{(row.distance_metres/1000).toFixed(1)} km to start</span></div><div className="transport-option-footer"><strong className="transport-price">{money(row.price_paise)} <small>per seat</small></strong><button onClick={onOpen}>View ride<ArrowRight size={16} aria-hidden="true"/></button></div></article>;
}

function VehicleCard({row,mode,cabExperience,onOpen}:{row:any;mode:'cab'|'rental';cabExperience?:'hire';onOpen:()=>void}){
 const Icon=mode==='rental'?KeyRound:cabExperience==='hire'?EventAvailable:LocalTaxi;
 return <article className="transport-card transport-option-card"><span className="transport-type"><Icon size={18} aria-hidden="true"/>{mode==='rental'?'Self-drive':cabExperience==='hire'?'Cab rental':'Cab with driver'}</span><div className="transport-option-vehicle"><span className="transport-option-symbol" aria-hidden="true"><Car size={28}/></span><div><h3>{row.name}</h3><p>{row.owner_name}</p></div></div><div className="transport-option-facts"><span><Users size={16} aria-hidden="true"/>{row.seats} seats</span><span>{row.transmission}</span><span><MapPin size={16} aria-hidden="true"/>{(row.distance_metres/1000).toFixed(1)} km away</span></div><div className="transport-option-footer"><strong className="transport-price">{money(mode==='cab'?row.per_km_paise:row.daily_paise)} <small>{mode==='cab'?'per km':'per day'}</small></strong><button onClick={onOpen}>Check {mode==='cab'&&cabExperience!=='hire'?'cab':'rental'}<ArrowRight size={16} aria-hidden="true"/></button></div><p className="transport-option-note">{mode==='cab'?`${money(row.base_paise)} base · Review full quote`:'Choose dates to check availability'}</p></article>;
}
