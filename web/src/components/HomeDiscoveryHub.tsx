import {useEffect,useState} from 'react';
import {CarFront,Wrench} from 'lucide-react';
import {discoveryFocus} from '../services/discoveryFocus.mjs';
import type {Service} from '../types';
import type {DiscoveryEvent} from './ServiceHydration';
import type {TransportArea} from './TransportRail';
import {MobilityExperience,type TravelMode} from './MobilityExperience';
import {QuickRepairFinder} from './QuickRepairFinder';
export function HomeDiscoveryHub({location,accountKey,onLocation,onSignIn,onBook,onHome,onEvent,personalised=false,transportInterest=false,repairInterest=false,transportMode}:{location:TransportArea;accountKey:string;onLocation:()=>void;onSignIn:()=>void;onBook:(s:Service,p?:{id:string;name:string})=>void;onHome:(s:string,p:{id:string;name:string})=>void;onEvent:(e:DiscoveryEvent)=>void;personalised?:boolean;transportInterest?:boolean;repairInterest?:boolean;transportMode?:TravelMode}){
 const [manual,setManual]=useState<'transport'|'repair'|null>(null),[now,setNow]=useState(new Date()),[engaged,setEngaged]=useState(false);
 useEffect(()=>{setManual(null);setEngaged(false);},[accountKey]);
 useEffect(()=>{const timer=setInterval(()=>{if(!engaged&&!document.hidden)setNow(new Date());},60000);return()=>clearInterval(timer);},[engaged]);
 const [held,setHeld]=useState<'transport'|'repair'|null>(null);
 const proposed=discoveryFocus({now,personalised,transportInterest,repairInterest});
 const focus=manual||(engaged?held||proposed:proposed);
 return <section className="home-discovery-hub" aria-label="Quick discovery" onFocusCapture={()=>{setHeld(focus);setEngaged(true);}} onPointerDown={()=>{setHeld(focus);setEngaged(true);}}><header className="home-discovery-heading"><div><span>REPAIDO</span><h2>{focus==='transport'?'Make your next move.':'What needs fixing?'}</h2></div><div className="home-discovery-switch" role="group" aria-label="Quick discovery type"><button aria-pressed={focus==='transport'} onClick={()=>setManual('transport')}><CarFront size={17} aria-hidden="true"/>Rides</button><button aria-pressed={focus==='repair'} onClick={()=>setManual('repair')}><Wrench size={17} aria-hidden="true"/>Repairs</button></div></header>{focus==='transport'?<MobilityExperience embedded initialMode={transportMode} initialLocation={location} onSignIn={onSignIn} onSearch={mode=>onEvent({kind:'search',category:'transport_'+mode})}/>:<QuickRepairFinder location={location} accountKey={accountKey} onLocation={onLocation} onBook={onBook} onHome={onHome} onEvent={onEvent}/>}</section>;
}
