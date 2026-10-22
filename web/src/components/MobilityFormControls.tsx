import {useId} from 'react';
import {ArrowUpRight,CalendarDays,MapPin,Minus,Plus,Flag,EventSeat} from '../icons';
import type {BusinessLocation} from '../services/localBusiness';
import './mobility-forms.css';

export const mobilityLocalTime=(time:number)=>new Date(time-new Date(time).getTimezoneOffset()*60000).toISOString().slice(0,16);

export function RideLocationButton({label,value,onClick,stop='pickup'}:{label:string;value:BusinessLocation|null;onClick:()=>void;stop?:'pickup'|'dropoff'}){
 return <button type="button" className="business-location ride-location-control" data-stop={stop} data-selected={!!value} onClick={onClick}>
  <span className="ride-location-marker" aria-hidden="true">{stop==='dropoff'?<Flag size={18}/>:<MapPin size={18}/>}</span>
  <span className="ride-location-copy"><small>{label}</small><strong>{value?.address||value?.city||'Choose on the map'}</strong>{value?.address&&value.city&&!value.address.toLowerCase().includes(value.city.toLowerCase())&&<small>{value.city}</small>}</span>
  <ArrowUpRight size={16} aria-hidden="true"/>
 </button>;
}

export function RideDateTimeField({label,name,value,onChange,min,disabled=false}:{label:string;name?:string;value:string;onChange:(value:string)=>void;min?:string;disabled?:boolean}){
 const id=useId();
 const chosen=value&&Number.isFinite(new Date(value).getTime())?new Date(value).toLocaleString(undefined,{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}):'';
 return <div className="ride-date-control"><label htmlFor={id}><CalendarDays size={16} aria-hidden="true"/>{label}</label><input id={id} name={name} type="datetime-local" required disabled={disabled} value={value} min={min} onChange={e=>onChange(e.target.value)}/>{chosen&&<span className="ride-date-readable" aria-hidden="true">{chosen}</span>}</div>;
}

export function RideSeatControl({value,onChange}:{value:number;onChange:(value:number)=>void}){
 const id=useId();
 return <div className="ride-seats-control"><label htmlFor={id}><EventSeat size={16} aria-hidden="true"/>Passenger seats</label><div><button type="button" aria-label="Remove one passenger seat" disabled={value<=1} onClick={()=>onChange(Math.max(1,value-1))}><Minus size={18} aria-hidden="true"/></button><input id={id} type="number" min={1} max={12} value={value} onChange={e=>onChange(Number(e.target.value))} required/><button type="button" aria-label="Add one passenger seat" disabled={value>=12} onClick={()=>onChange(Math.min(12,value+1))}><Plus size={18} aria-hidden="true"/></button></div></div>;
}
