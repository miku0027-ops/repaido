import {useEffect,useState,useSyncExternalStore} from 'react';
import {Modal} from './ui';
import {Bell,TwoWheeler} from '../icons';
import {bindTransportBell,enableTransportBell,startPickupAlarm,subscribeTransportBell,transportBellEnabled} from '../services/transportBell';
import type {BikeRide} from '../services/bike-rides-api';
export function BikePickupAlert({rides,uid,active,onOpen}:{rides:BikeRide[];uid:string;active:boolean;onOpen:(id:string)=>void}){
 const [seen,setSeen]=useState<string[]>(()=>{try{return JSON.parse(sessionStorage.getItem('bike-pickups:'+uid)||'[]');}catch{return [];}}),[error,setError]=useState('');
 const sound=useSyncExternalStore(subscribeTransportBell,transportBellEnabled,()=>false);
 const ride=active?rides.find(row=>row.state==='arrived'&&!seen.includes(row.id)):undefined;
 useEffect(()=>{bindTransportBell(uid);},[uid]);
 useEffect(()=>{if(ride&&sound)return startPickupAlarm(uid);},[ride?.id,sound,uid]);
 const acknowledge=()=>{if(!ride)return;setSeen(current=>{const next=[...current,ride.id].slice(-100);try{sessionStorage.setItem('bike-pickups:'+uid,JSON.stringify(next));}catch{}return next;});onOpen(ride.id);};
 if(!ride)return null;
 return <Modal title="Your rider is at pickup" onClose={acknowledge}><div className="bike-pickup-alert"><span className="bike-arrival-pulse" aria-hidden="true"><TwoWheeler size={40}/></span><h3>Your rider is waiting</h3><p>{ride.rider_name} · {ride.vehicle_name}</p><p>Meet your rider at {ride.pickup_address}. Share the pickup code only when you meet.</p>{!sound&&<button className="bike-soft-button" onClick={()=>void enableTransportBell(uid).catch(cause=>setError(cause.message))}><Bell size={20}/>Enable ringing</button>}{sound&&<p role="status">Ringing until you acknowledge</p>}{error&&<p role="status">{error}</p>}<button className="bike-primary" onClick={acknowledge}>Got it · view pickup</button></div></Modal>;
}
