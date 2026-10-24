import {useEffect,useId,useRef,useState} from 'react';
import {MapPin,Search,X} from '../icons';
import {createRidePlaceSession,suggestRidePlaces,resolveRidePlace,type PlaceSuggestion,type RidePlace} from '../services/ridePlaces';
import './place-search.css';

type Props={near?:{lat:number;lng:number};label?:string;disabled?:boolean;onSelect:(place:RidePlace)=>void;onInteraction?:()=>void;onPending?:(pending:boolean)=>void};
/** Shared Google search for service entrances, delivery addresses and discovery.
 * Search alone never saves a location: only resolving a selected result does. */
export function PlaceSearch({near,label='Search a place, street or landmark',disabled=false,onSelect,onInteraction,onPending}:Props){
 const id=useId(),input=useRef<HTMLInputElement>(null);
 const [query,setQuery]=useState(''),[results,setResults]=useState<PlaceSuggestion[]>([]),[active,setActive]=useState(-1),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 const session=useRef<ReturnType<typeof createRidePlaceSession>|null>(null),request=useRef<AbortController|null>(null),generation=useRef(0);
 const callbacks=useRef({onSelect,onInteraction,onPending});callbacks.current={onSelect,onInteraction,onPending};
 const lat=near?.lat??21.4934,lng=near?.lng??86.9135;
 const invalidate=()=>{generation.current++;request.current?.abort();request.current=null;};
 useEffect(()=>{input.current?.setCustomValidity(query.trim()?'Choose a search result or clear the search to keep your address.':'');},[query]);
 useEffect(()=>()=>{invalidate();callbacks.current.onPending?.(false);},[]);
 useEffect(()=>{
  invalidate();const revision=generation.current;
  setResults([]);setActive(-1);setFailed(false);setMessage('');setBusy(false);
  callbacks.current.onPending?.(!disabled&&query.trim().length>0);
  if(disabled||query.trim().length<2)return;
  const controller=new AbortController();request.current=controller;
  const timer=setTimeout(async()=>{
   setBusy(true);
   try{
    session.current??=createRidePlaceSession();
    const values=await suggestRidePlaces(await session.current,query,{lat,lng},controller.signal);
    if(revision!==generation.current)return;
    setResults(values);setMessage(values.length?`${values.length} ${values.length===1?'place':'places'} found.`:'No places found. Try a nearby street or landmark.');
   }catch(error){if(revision===generation.current&&!controller.signal.aborted){session.current=null;setFailed(true);setMessage('Place search couldn’t connect. Retry or use the map.');}}
   finally{if(revision===generation.current)setBusy(false);}
  },300);
  return()=>{clearTimeout(timer);controller.abort();generation.current++;};
 },[query,lat,lng,retry,disabled]);
 const clear=()=>{invalidate();setQuery('');setResults([]);setBusy(false);setMessage('');setFailed(false);callbacks.current.onPending?.(false);input.current?.focus();};
 const choose=async(suggestion:PlaceSuggestion)=>{
  invalidate();const revision=generation.current,controller=new AbortController();request.current=controller;
  setResults([]);setActive(-1);setBusy(true);setFailed(false);setMessage('Finding this place…');callbacks.current.onInteraction?.();callbacks.current.onPending?.(true);
  try{
   const place=await resolveRidePlace(suggestion,controller.signal);
   if(revision!==generation.current)return;
   setQuery('');setMessage('');callbacks.current.onSelect(place);callbacks.current.onPending?.(false);
  }catch{if(revision===generation.current){setFailed(true);setMessage('Could not load this place. Try again or use the map.');}}
  finally{session.current=null;if(revision===generation.current)setBusy(false);}
 };
 return <div className="place-search" aria-busy={busy}>
  <label htmlFor={id}>{label}</label>
  <div className="place-search-input"><Search size={19} aria-hidden="true"/><input id={id} ref={input} role="combobox" aria-autocomplete="list" aria-expanded={results.length>0} aria-controls={results.length?id+'-results':undefined} aria-activedescendant={active>=0?id+'-'+active:undefined} autoComplete="off" placeholder="Place, street or landmark" maxLength={160} disabled={disabled} value={query} onChange={event=>{invalidate();callbacks.current.onInteraction?.();setQuery(event.target.value);}} onKeyDown={event=>{
   if(event.key==='Escape'&&query){event.preventDefault();event.stopPropagation();clear();}
   if(['ArrowDown','ArrowUp'].includes(event.key)&&results.length){event.preventDefault();setActive(index=>(index+(event.key==='ArrowDown'?1:results.length-1)+results.length)%results.length);}
   if(event.key==='Enter'){event.preventDefault();if(results[active])void choose(results[active]);}
  }}/>{query&&<button type="button" aria-label="Clear place search" disabled={disabled} onClick={clear}><X size={18}/></button>}</div>
  {results.length>0&&<><ul id={id+'-results'} role="listbox" aria-label="Suggested places">{results.map((result,index)=><li key={result.id} id={id+'-'+index} role="option" aria-selected={index===active} onMouseDown={event=>event.preventDefault()} onClick={()=>void choose(result)}><MapPin size={18} aria-hidden="true"/><span><strong>{result.title}</strong><small>{result.description}</small></span></li>)}</ul><small className="place-search-credit">Google Maps</small></>}
  <div role="status" className="place-search-status">{(busy||message)&&<span>{busy?'Finding places…':message}</span>}{failed&&<button type="button" disabled={disabled||busy} onClick={()=>setRetry(value=>value+1)}>Try again</button>}</div>
 </div>;
}
