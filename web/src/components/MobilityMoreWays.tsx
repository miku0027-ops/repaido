import {useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,ChevronLeft,ChevronRight,KeyRound,LocalTaxi,Diversity3,EventAvailable,TwoWheeler} from '../icons';
import type {TravelMode} from './MobilityExperience';
import './mobility-more-ways.css';

const ideas = [
 {mode:'bike',label:'Bike',body:'Short city trips',action:'Find a bike',Icon:TwoWheeler},
 {mode:'shared',label:'Shared ride',body:'Seats on a route',action:'Find a shared ride',Icon:Diversity3},
 {mode:'self_drive',label:'Self-drive',body:'Keep the keys',action:'Find a self-drive car',Icon:KeyRound},
 {mode:'rental',label:'Cab rental',body:'Driver for the trip',action:'Plan a cab rental',Icon:EventAvailable},
 {mode:'cab',label:'Cab',body:'Your own route',action:'Find a cab',Icon:LocalTaxi},
] satisfies {mode:TravelMode;label:string;body:string;action:string;Icon:typeof Diversity3}[];

/** Compact shortcuts open native booking flows without fetching or inventing availability. */
export function MobilityMoreWays({mode,onBook}:{mode:TravelMode;onBook:(mode:TravelMode)=>void}){
 const titleId=useId(),track=useRef<HTMLDivElement>(null),[edges,setEdges]=useState({previous:false,next:false});
 useEffect(()=>{
  const element=track.current;if(!element)return;
  const measure=()=>setEdges({previous:element.scrollLeft>2,next:element.scrollLeft+element.clientWidth<element.scrollWidth-2});
  const observer=new ResizeObserver(measure);observer.observe(element);element.addEventListener('scroll',measure,{passive:true});measure();
  return()=>{observer.disconnect();element.removeEventListener('scroll',measure);};
 },[mode]);
 const move=(direction:number)=>track.current?.scrollBy({left:direction*track.current.clientWidth*.85,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 return <section className="mobility-more-ways" aria-labelledby={titleId}>
  <header className="mobility-more-heading"><h3 id={titleId}>More ways to travel</h3><div><button type="button" aria-label="Previous travel options" disabled={!edges.previous} onClick={()=>move(-1)}><ChevronLeft size={18} aria-hidden="true"/></button><button type="button" aria-label="Next travel options" disabled={!edges.next} onClick={()=>move(1)}><ChevronRight size={18} aria-hidden="true"/></button></div></header>
  <div className="mobility-alternative-rail" ref={track} role="region" aria-label="Other ways to travel" tabIndex={0} onKeyDown={event=>{if(event.target!==event.currentTarget)return;if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();if(event.key==='Home'||event.key==='End')event.currentTarget.scrollTo({left:event.key==='Home'?0:event.currentTarget.scrollWidth,behavior:'instant'});else move(event.key==='ArrowLeft'?-1:1);}}}>
   {ideas.filter(idea=>idea.mode!==mode).map(({mode:service,label,body,action,Icon})=><button key={service} className="mobility-alternative" data-service={service} aria-label={action} onClick={()=>onBook(service)}><span className="mobility-alternative-icon"><Icon size={24} aria-hidden="true"/></span><strong>{label}</strong><span>{body}</span><ArrowRight size={17} aria-hidden="true"/></button>)}
  </div>
 </section>;
}
