import {useEffect,useId,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,LocateFixed,MapPin,Search,X} from '../icons';
import {GoogleJourneyMap} from './GoogleJourneyMap';
import {currentPosition} from '../services/operations';
import {addressForRidePin,createRidePlaceSession,resolveRidePlace,suggestRidePlaces,type PlaceSuggestion,type RidePlace} from '../services/ridePlaces';
import type {BusinessLocation} from '../services/localBusiness';
import './go-location-picker.css';

type Point={lat:number;lng:number};
type Props={stop:'pickup'|'dropoff';initial?:Partial<BusinessLocation>|null;near?:Partial<BusinessLocation>|null;onConfirm:(value:BusinessLocation)=>void;onClose:()=>void};
const valid=(p?:Partial<BusinessLocation>|null):p is Partial<BusinessLocation>&Point=>!!p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat!)<=90&&Math.abs(p.lng!)<=180;

/** An inline ride workspace, never a nested dialog or a service-address form. */
export function GoLocationPicker({stop,initial,near,onConfirm,onClose}:Props){
 const title=stop==='pickup'?'Choose pickup':'Choose drop-off',id=useId(),input=useRef<HTMLInputElement>(null),root=useRef<HTMLElement>(null);
 const bias=useRef(valid(initial)?{lat:initial.lat,lng:initial.lng}:valid(near)?{lat:near.lat,lng:near.lng}:{lat:21.4934,lng:86.9135});
 const [point,setPoint]=useState<Point>(bias.current),[place,setPlace]=useState<RidePlace|null>(valid(initial)&&initial.address?{...initial,lat:initial.lat,lng:initial.lng,address:initial.address,city:initial.city||''}:null);
 const [query,setQuery]=useState(''),[suggestions,setSuggestions]=useState<PlaceSuggestion[]>([]),[index,setIndex]=useState(-1),[busy,setBusy]=useState(''),[error,setError]=useState(''),[searched,setSearched]=useState(false),[manual,setManual]=useState(false),[landmark,setLandmark]=useState(''),[accuracy,setAccuracy]=useState<number|null>(null);
 const revision=useRef(0),searchRevision=useRef(0),session=useRef<ReturnType<typeof createRidePlaceSession>|null>(null);
 useEffect(()=>{const previous=document.activeElement;input.current?.focus({preventScroll:true});root.current?.scrollIntoView({block:'nearest'});return()=>{revision.current++;searchRevision.current++;queueMicrotask(()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true});});};},[]);
 useEffect(()=>{
  const generation=++searchRevision.current;setSuggestions([]);setIndex(-1);setSearched(false);
  if(query.trim().length<2)return;
  const timer=setTimeout(async()=>{
   setBusy('search');setError('');
   try{session.current??=createRidePlaceSession();const result=await suggestRidePlaces(await session.current,query.trim(),bias.current);if(generation===searchRevision.current){setSuggestions(result);setSearched(true);}}
   catch{if(generation===searchRevision.current){session.current=null;setError('Place search is unavailable. Use your location or choose a map pin.');}}
   finally{if(generation===searchRevision.current)setBusy('');}
  },300);
  return()=>{clearTimeout(timer);searchRevision.current++;};
 },[query]);
 const clearSearch=()=>{searchRevision.current++;setQuery('');setSuggestions([]);setSearched(false);setIndex(-1);};
 const select=async(suggestion:PlaceSuggestion)=>{
  const generation=++revision.current;clearSearch();setBusy('place');setError('');setPlace(null);setManual(false);setLandmark('');setAccuracy(null);
  try{const value=await resolveRidePlace(suggestion);if(generation===revision.current){setPoint({lat:value.lat,lng:value.lng});setPlace(value);setManual(!value.city);}}
  catch{if(generation===revision.current)setError('Could not load that place. Try another result or choose a map pin.');}
  finally{session.current=null;if(generation===revision.current)setBusy('');}
 };
 const locatePin=async(value:Point,generation:number)=>{
  const pin={lat:value.lat,lng:value.lng};
  setPoint(pin);setPlace(null);setLandmark('');setManual(false);
  try{const resolved=await addressForRidePin(pin);if(generation===revision.current){setPlace(resolved);setManual(!resolved.city);}}
  catch{if(generation===revision.current){setPlace({...value,address:'',city:initial?.city||near?.city||''});setManual(true);setError('Pin selected. Add a street or landmark so your driver can find you.');}}
 };
 const pick=async(value:Point)=>{
  const generation=++revision.current;session.current=null;clearSearch();setBusy('pin');setError('');setAccuracy(null);
  await locatePin(value,generation);if(generation===revision.current)setBusy('');
 };
 const locate=async()=>{
  const generation=++revision.current;session.current=null;clearSearch();setBusy('gps');setError('');setPlace(null);setAccuracy(null);
  try{const position=await currentPosition(true);if(generation!==revision.current)return;setAccuracy(position.accuracy);await locatePin(position,generation);}
  catch(e){if(generation===revision.current)setError((e as Error).message||'Location access is unavailable. Search for a place instead.');}
  finally{if(generation===revision.current)setBusy('');}
 };
 const address=manual?landmark.trim()||place?.address||'':place?.address||'',ready=!!place&&address.length>=10&&place.city.trim().length>=2&&!busy&&!query.trim();
 return <section ref={root} className="go-location-workspace" aria-label={title} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();if(query){clearSearch();setBusy('');}else onClose();}}}>
  <header><button type="button" onClick={onClose} aria-label="Back to ride"><ArrowLeft size={20}/></button><div><small>REPAIDO GO</small><h3>{title}</h3></div><span className="go-location-step"><MapPin size={16} aria-hidden="true"/>Set your pin</span></header>
  <div className="go-place-search"><Search size={20} aria-hidden="true"/><input ref={input} role="combobox" aria-label={stop==='pickup'?'Search pickup location':'Search drop-off location'} aria-autocomplete="list" aria-expanded={suggestions.length>0} aria-controls={suggestions.length?id+'-places':undefined} aria-activedescendant={index>=0?id+'-place-'+index:undefined} autoComplete="off" placeholder="Search a place, street or landmark" maxLength={160} value={query} onChange={e=>{revision.current++;searchRevision.current++;setBusy('');setQuery(e.target.value);}} onKeyDown={event=>{if(['ArrowDown','ArrowUp'].includes(event.key)&&suggestions.length){event.preventDefault();setIndex(i=>i<0?(event.key==='ArrowDown'?0:suggestions.length-1):(i+(event.key==='ArrowDown'?1:-1)+suggestions.length)%suggestions.length);}if(event.key==='Enter'){event.preventDefault();if(suggestions[index])void select(suggestions[index]);}}}/>{query&&<button type="button" aria-label="Clear place search" onClick={()=>{clearSearch();setBusy('');input.current?.focus();}}><X size={18}/></button>}</div>
  {suggestions.length>0&&<div className="go-place-results"><ul id={id+'-places'} role="listbox" aria-label="Suggested places">{suggestions.map((s,i)=><li key={s.id} id={id+'-place-'+i} role="option" aria-selected={i===index} onMouseDown={e=>e.preventDefault()} onClick={()=>void select(s)}><MapPin size={19} aria-hidden="true"/><span><strong>{s.title}</strong><small>{s.description}</small></span>{Number.isFinite(s.distance)&&<em>{s.distance!<1000?`${Math.round(s.distance!)} m`:`${(s.distance!/1000).toFixed(1)} km`}</em>}</li>)}</ul><small className="go-google-credit">Google Maps</small></div>}
  <div className="go-place-feedback" role="status">{busy==='search'?'Searching nearby places…':busy==='place'?'Finding this place…':busy==='gps'?'Finding your location…':busy==='pin'?'Finding the address…':error||(searched&&!suggestions.length?'No places found. Try a nearby street or landmark.':'')}</div>
  <button type="button" className="go-use-location" onClick={()=>void locate()} disabled={!!busy&&busy!=='search'}><LocateFixed size={18} aria-hidden="true"/>Use my current location<ArrowRight size={16} aria-hidden="true"/></button>
  <div className="go-location-map"><GoogleJourneyMap origin={point} onPick={p=>void pick(p)} rideScreen mapLabel={`${title} map`}/><span className="go-pin-hint">Tap the map to adjust your pin</span></div>
  <div className="go-location-confirm"><div className="go-selected-place"><span aria-hidden="true"><MapPin size={21}/></span><div><small>{place?'Selected '+(stop==='pickup'?'pickup':'drop-off'):'Choose a place or tap the map'}</small><strong>{place?.name||place?.address||'Your meeting point'}</strong>{accuracy!==null&&<small>GPS accuracy: about {Math.round(accuracy)} m. Check the pin.</small>}</div></div>
   {manual&&<div className="go-manual-place"><label>Nearby street or landmark<input maxLength={500} value={landmark} onChange={e=>setLandmark(e.target.value)} placeholder={place?.address||'e.g. ITI Square, main gate, Balasore'}/></label><label>City<input maxLength={80} value={place?.city||''} onChange={e=>setPlace(p=>p?{...p,city:e.target.value}:p)}/></label></div>}
   <button type="button" className="go-confirm-place" disabled={!ready} onClick={()=>{if(ready)onConfirm({...point,address,city:place!.city.trim()});}}><Check size={18} aria-hidden="true"/>Confirm {stop==='pickup'?'pickup':'drop-off'}<ArrowRight size={18} aria-hidden="true"/></button>
  </div>
 </section>;
}
