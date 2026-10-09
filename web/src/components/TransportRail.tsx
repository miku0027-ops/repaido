import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {ArrowRight,Car,ChevronLeft,ChevronRight,RefreshCw} from 'lucide-react';
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

export function TransportRail({location,onLocation,onSignIn,onSearch,title='Rides near you',accountKey='guest'}:{location?:TransportArea;onLocation?:()=>void;onSignIn:()=>void;onSearch?:()=>void;title?:string;accountKey?:string}){
 const [area,setArea]=useState<TransportArea|undefined>(location),[picking,setPicking]=useState(false);
 useEffect(()=>{setArea(location);setPicking(false);},[location?.lat,location?.lng,location?.confirmed,location?.address,location?.city,accountKey]);
 const chooseArea=()=>onLocation?onLocation():setPicking(true);
 const valid=area?.confirmed!==false&&Number.isFinite(area?.lat)&&Number.isFinite(area?.lng);
 const path=valid?`/local-business/transport/nearby?lat=${area!.lat}&lng=${area!.lng}`:'';
 const key=accountKey+':'+path,rail=useRef<HTMLDivElement>(null);
 const [state,setState]=useState<{key:string;data:Nearby|null;error:string;busy:boolean}>(()=>({key,data:cache.peek(key),error:'',busy:false}));
 const [selected,setSelected]=useState<any>(null),[vehicle,setVehicle]=useState<{row:any;mode:'cab'|'rental'}|null>(null),[notice,setNotice]=useState('');
 const [revision,setRevision]=useState(0);
 useEffect(()=>{setSelected(null);setVehicle(null);setNotice('');},[key]);
 useEffect(()=>{let alive=true;
  const load=async(force=false)=>{if(!path)return;setState(old=>({key,data:old.key===key?old.data:cache.peek(key),error:'',busy:force}));
   try{const data=await cache.read(key,async()=>{const response=await apiFetch('/api/operations'+path,{}, {background:true,feedback:false});const result=await response.json();if(!response.ok)throw Error(result.detail?.message||'Nearby rides could not load. Please retry.');return result;},{freshMs:20000,force});if(alive)setState({key,data,error:'',busy:false});}
   catch(error){if(alive)setState(old=>({...old,error:(error as Error).message,busy:false}));}
  };
  void load(revision>0);const update=()=>{if(!document.hidden&&navigator.onLine)void load();};const interval=setInterval(update,30000);
  window.addEventListener('online',update);document.addEventListener('visibilitychange',update);
  return()=>{alive=false;clearInterval(interval);window.removeEventListener('online',update);document.removeEventListener('visibilitychange',update);};
 },[key,path,revision]);
 const data=state.key===key?state.data:null;
 const move=(direction:number)=>rail.current?.scrollBy({left:direction*(rail.current.clientWidth*.85),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 const signIn=()=>{setSelected(null);setVehicle(null);onSignIn();};
 return <section className="transport-discovery" aria-label={title}>
  <header><div><small>REPAIDO · MOVE</small><h2>{title}</h2></div><div className="transport-rail-controls">{valid&&<button disabled={state.busy} aria-label="Refresh nearby transport" onClick={()=>setRevision(n=>n+1)}><RefreshCw size={18}/></button>}{data&&(data.departures.length+data.vehicles.length)>1&&<><button aria-label="Previous transport options" onClick={()=>move(-1)}><ChevronLeft size={18}/></button><button aria-label="Next transport options" onClick={()=>move(1)}><ChevronRight size={18}/></button></>}</div></header>
  {!valid?<div className="transport-empty"><p>Choose your pickup area to see shared departures within 20 km and nearby vehicles.</p><button onClick={chooseArea}>Set pickup area<ArrowRight size={16}/></button></div>:<>
   <p className="transport-caption">Shared departures within 20 km · Cab pickups and rentals within 8 km</p>
   <ContractError error={state.key===key?state.error:''} onRetry={()=>setRevision(n=>n+1)}/>
   {!data&&!state.error&&<p role="status">Finding nearby rides…</p>}
   {data&&!data.departures.length&&!data.vehicles.length&&<p className="transport-empty">No published rides or available vehicles nearby yet. Check another pickup area or return later.</p>}
   <div ref={rail} className="transport-card-rail" tabIndex={0} aria-label="Nearby transport options">
    {data?.departures.map(row=><article className="transport-card" key={row.id}><span className="transport-type"><Car size={17} aria-hidden="true"/>Shared {row.vehicle_kind==='bike'?'bike':'car'} ride</span><h3>{row.origin_address} → {row.destination_address}</h3><p>{date(row.starts_at)}</p><p>{row.vehicle_name} · {row.owner_name}</p><p>{row.available_seats} seat{row.available_seats===1?'':'s'} · {(row.distance_metres/1000).toFixed(1)} km to start</p><strong className="transport-price">{money(row.price_paise)} <small>per seat</small></strong><button onClick={()=>setSelected(row)}>View ride<ArrowRight size={16}/></button></article>)}
    {data?.vehicles.flatMap(row=>row.offered_modes.map((mode:'cab'|'rental')=><article className="transport-card" key={row.id+mode}><span className="transport-type"><Car size={17} aria-hidden="true"/>{mode==='cab'?'Cab with driver':'Self-drive rental'}</span><h3>{row.name}</h3><p>{row.owner_name}</p><p>{row.seats} seats · {row.transmission} · {(row.distance_metres/1000).toFixed(1)} km nearby</p><strong className="transport-price">{money(mode==='cab'?row.per_km_paise:row.daily_paise)} <small>{mode==='cab'?'per km':'per day'}</small></strong><p className="transport-caption">{mode==='cab'?`${money(row.base_paise)} base fare. Review the full quote.`:'Check availability and terms for your dates.'}</p><button onClick={()=>setVehicle({row,mode})}>Check {mode==='cab'?'cab':'rental'}<ArrowRight size={16}/></button></article>))}
   </div>
  </>}
  {notice&&<p className="transport-confirmation" role="status">{notice}</p>}
  {selected&&<Modal title="Shared ride details" onClose={()=>setSelected(null)}><SharedRideSearch departure={selected} onSignIn={signIn} onSearch={onSearch}/></Modal>}
  {vehicle&&<Modal title={vehicle.mode==='cab'?'Book a cab':'Self-drive rental'} onClose={()=>setVehicle(null)}><Suspense fallback={<p role="status">Opening booking…</p>}><RideWizard mode={vehicle.mode} initialVehicleId={vehicle.row.id} initialLocation={area} onSignIn={signIn} onClose={()=>setVehicle(null)} onSearch={onSearch} onSaved={()=>{setVehicle(null);setNotice('Booking request sent. Follow the owner’s response in Bookings → Rides.');cache.invalidate(key);setRevision(n=>n+1);}}/></Suspense></Modal>}
  {picking&&<LocationPickerModal isOpen title="Your pickup area" onClose={()=>setPicking(false)} onConfirmLocation={pin=>{setArea({...pin,confirmed:true});setPicking(false);}}/>}
 </section>;
}
