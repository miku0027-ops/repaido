import {InteractionMotion} from './InteractionMotion';
import {lazy,Suspense,useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,Car,ChevronDown,ChevronLeft,ChevronRight,RefreshCw} from 'lucide-react';
import {apiFetch} from '../services/api';
import {createReadCache} from '../services/readCache.mjs';
import {money} from '../services/operations';
import {SharedRideSearch} from './SharedRides';
import {ContractError} from './customContractUI';
import {Modal} from './ui';
import {LocationPickerModal} from './LocationPickerModal';
import './transport-rail.css';

const RideWizard=lazy(()=>import('./LocalBusiness').then(module=>({default:module.RideWizard})));
const cache=createReadCache({maxEntries:12});
export type TransportArea={lat?:number;lng?:number;confirmed?:boolean;address?:string;city?:string};
type Nearby={departures:any[];vehicles:any[];radius_km:number};
const date=(time:number)=>new Date(time*1000).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

export function TransportRail({location,onLocation,onSignIn,onSearch,title='Rides near you',accountKey='guest',modeFilter='all',compact=false,cabExperience,active=true}:{cabExperience?:'hire';modeFilter?:'all'|'cab'|'rental'|'shared';compact?:boolean;location?:TransportArea;onLocation?:()=>void;onSignIn:()=>void;onSearch?:()=>void;title?:string;accountKey?:string;active?:boolean}){
 const panelId=useId();const [expanded,setExpanded]=useState(true);
 const [area,setArea]=useState<TransportArea|undefined>(location),[picking,setPicking]=useState(false);
 useEffect(()=>{setArea(location);setPicking(false);},[location?.lat,location?.lng,location?.confirmed,location?.address,location?.city,accountKey]);
 const chooseArea=()=>onLocation?onLocation():setPicking(true);
 const valid=area?.confirmed!==false&&Number.isFinite(area?.lat)&&Number.isFinite(area?.lng);
 const path=valid?`/local-business/transport/nearby?lat=${area!.lat}&lng=${area!.lng}`:'';
 const key=accountKey+':'+path,rail=useRef<HTMLDivElement>(null);
 const [state,setState]=useState<{key:string;data:Nearby|null;error:string;busy:boolean}>(()=>({key,data:cache.peek(key),error:'',busy:false}));
 const [selected,setSelected]=useState<any>(null),[vehicle,setVehicle]=useState<{row:any;mode:'cab'|'rental'}|null>(null),[notice,setNotice]=useState('');
 const [revision,setRevision]=useState(0),lastLoad=useRef({key:'',revision:0});
 useEffect(()=>{setSelected(null);setVehicle(null);setNotice('');},[key,modeFilter,cabExperience]);
 useEffect(()=>{if(!active||!expanded)return;let alive=true;
  const load=async(force=false)=>{if(!path)return;setState(old=>({key,data:old.key===key?old.data:cache.peek(key),error:'',busy:force||!(old.key===key?old.data:cache.peek(key))}));
   try{const data=await cache.read(key,async()=>{const response=await apiFetch('/api/operations'+path,{}, {background:true,feedback:false});const result=await response.json();if(!response.ok)throw Error(result.detail?.message||'Nearby rides could not load. Please retry.');return result;},{freshMs:20000,force});if(alive)setState({key,data,error:'',busy:false});}
   catch(error){if(alive)setState(old=>({...old,error:(error as Error).message,busy:false}));}
  };
  const force=lastLoad.current.key===key&&lastLoad.current.revision!==revision;lastLoad.current={key,revision};
  void load(force);const update=()=>{if(!document.hidden&&navigator.onLine)void load();};const interval=setInterval(update,30000);
  window.addEventListener('online',update);document.addEventListener('visibilitychange',update);
  return()=>{alive=false;clearInterval(interval);window.removeEventListener('online',update);document.removeEventListener('visibilitychange',update);};
 },[key,path,revision,active,expanded]);
 const data=state.key===key?state.data:null;
 const departures=(modeFilter==='all'||modeFilter==='shared')?data?.departures||[]:[];const vehicles=(data?.vehicles||[]).filter(row=>row.offered_modes.some((m:string)=>modeFilter==='all'||m===modeFilter));
 const optionCount=departures.length+vehicles.reduce((sum:number,row:any)=>sum+row.offered_modes.filter((mode:string)=>modeFilter==='all'||mode===modeFilter).length,0);
 const move=(direction:number)=>rail.current?.scrollBy({left:direction*(rail.current.clientWidth*.85),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 const signIn=()=>{setSelected(null);setVehicle(null);onSignIn();};
 return <section className="transport-discovery" data-expanded={expanded} data-option-count={optionCount} aria-label={title}>
  <header><div>{!compact&&<small>REPAIDO · MOVE</small>}<h2>{compact?<button className="transport-panel-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={()=>setExpanded(value=>!value)}><Car size={16} aria-hidden="true"/>{title}{optionCount>0&&<span className="transport-count">{optionCount}</span>}<ChevronDown size={15} aria-hidden="true"/></button>:title}</h2></div><div className="transport-rail-controls">{valid&&expanded&&<button disabled={state.busy} aria-label="Refresh nearby transport" onClick={()=>setRevision(n=>n+1)}><RefreshCw size={17} className={state.busy?'transport-refreshing':''} aria-hidden="true"/></button>}{expanded&&optionCount>1&&<><button aria-label="Previous transport options" onClick={()=>move(-1)}><ChevronLeft size={18}/></button><button aria-label="Next transport options" onClick={()=>move(1)}><ChevronRight size={18}/></button></>}</div></header>
  <div id={panelId} hidden={compact&&!expanded} className="transport-panel-body" aria-busy={state.key===key&&state.busy}>
  {!valid?<div className="transport-empty discovery-state"><InteractionMotion kind="location" active={active&&expanded}/><div><p>Choose a pickup area.</p><button onClick={chooseArea}>Set pickup area<ArrowRight size={16}/></button></div></div>:<>
   {!compact&&<p className="transport-caption">Shared departures within 20 km · Cab pickups and rentals within 8 km</p>}
   <ContractError error={state.key===key?state.error:''} onRetry={()=>setRevision(n=>n+1)}/>
   {!data&&!state.error&&<div className="transport-loading"><div className="discovery-state" role="status"><InteractionMotion kind="search" active={active&&expanded}/><p>Finding nearby rides…</p></div><div className="transport-skeleton" aria-hidden="true"><span/><span/><span/></div></div>}
   {data&&!departures.length&&!vehicles.length&&<div className="transport-empty transport-empty-illustrated"><div className="transport-empty-route" aria-hidden="true"><span/><Car size={30}/><span/></div><div><strong>{modeFilter==='shared'?'No departures here yet.':'No vehicles here yet.'}</strong><button onClick={chooseArea}>Try another pickup area<ArrowRight size={14} aria-hidden="true"/></button></div></div>}
   <div hidden={!departures.length&&!vehicles.length} ref={rail} className="transport-card-rail" tabIndex={0} aria-label="Nearby transport options">
    {departures.map(row=><article className="transport-card" key={row.id}><span className="transport-type"><Car size={17} aria-hidden="true"/>Shared {row.vehicle_kind==='bike'?'bike':'car'} ride</span><h3>{row.origin_address} → {row.destination_address}</h3><p>{date(row.starts_at)}</p><p>{row.vehicle_name} · {row.owner_name}</p><p>{row.available_seats} seat{row.available_seats===1?'':'s'} · {(row.distance_metres/1000).toFixed(1)} km to start</p><strong className="transport-price">{money(row.price_paise)} <small>per seat</small></strong><button onClick={()=>setSelected(row)}>View ride<ArrowRight size={16}/></button></article>)}
    {vehicles.flatMap(row=>row.offered_modes.filter((m:string)=>modeFilter==='all'||m===modeFilter).map((mode:'cab'|'rental')=><article className="transport-card" key={row.id+mode}><span className="transport-type"><Car size={17} aria-hidden="true"/>{mode==='cab'?(cabExperience==='hire'?'Cab rental':'Cab with driver'):'Self-drive rental'}</span><h3>{row.name}</h3><p>{row.owner_name}</p><p>{row.seats} seats · {row.transmission} · {(row.distance_metres/1000).toFixed(1)} km nearby</p><strong className="transport-price">{money(mode==='cab'?row.per_km_paise:row.daily_paise)} <small>{mode==='cab'?'per km':'per day'}</small></strong><p className="transport-caption">{mode==='cab'?`${money(row.base_paise)} base fare. Review the full quote.`:'Check availability and terms for your dates.'}</p><button onClick={()=>setVehicle({row,mode})}>Check {mode==='cab'&&cabExperience!=='hire'?'cab':'rental'}<ArrowRight size={16}/></button></article>))}
   </div>
  </>}
  </div>
  {notice&&<div className="discovery-state discovery-state-success" role="status"><InteractionMotion kind="success" active={active}/><p>{notice}</p></div>}
  {selected&&<Modal title="Shared ride details" onClose={()=>setSelected(null)}><SharedRideSearch departure={selected} onSignIn={signIn} onSearch={onSearch}/></Modal>}
  {vehicle&&<Modal title={vehicle.mode==='cab'?(cabExperience==='hire'?'Cab rental':'Book a cab'):'Self-drive rental'} onClose={()=>setVehicle(null)}><Suspense fallback={<p role="status">Opening booking…</p>}><RideWizard mode={vehicle.mode} experience={cabExperience} initialVehicleId={vehicle.row.id} initialLocation={area} onSignIn={signIn} onClose={()=>setVehicle(null)} onSearch={onSearch} onSaved={()=>{setVehicle(null);setNotice('Booking request sent. Follow the owner’s response in Bookings → Rides.');cache.invalidate(key);setRevision(n=>n+1);}}/></Suspense></Modal>}
  {picking&&<LocationPickerModal isOpen title="Your pickup area" onClose={()=>setPicking(false)} onConfirmLocation={pin=>{setArea({...pin,confirmed:true});setPicking(false);}}/>}
 </section>;
}
