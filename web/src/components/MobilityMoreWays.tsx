import {useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,CalendarDays,CarFront,ChevronRight,KeyRound,MapPin,Pause,Play,Users} from 'lucide-react';
import {DiscoveryScene} from './DiscoveryScene';
import type {TravelMode} from './MobilityExperience';
import type {TransportArea} from './TransportRail';
import './mobility-more-ways.css';

const ideas = [
 {mode:'shared',label:'Shared rides',title:'A seat on your next route.',body:'Explore published departures and available seats.',action:'Find a shared ride',Icon:Users},
 {mode:'self_drive',label:'Self-drive',title:'Your plans. Your keys.',body:'Choose your dates and find a car to drive.',action:'Find a self-drive car',Icon:KeyRound},
 {mode:'rental',label:'Cab rental',title:'A driver for the whole plan.',body:'Plan a return trip with a car and driver.',action:'Plan a cab rental',Icon:CalendarDays},
 {mode:'cab',label:'Cab with driver',title:'From here to your next stop.',body:'Set your route and review the owner’s quote.',action:'Find a cab',Icon:CarFront},
] satisfies {mode:TravelMode;label:string;title:string;body:string;action:string;Icon:typeof Users}[];

function TravelIdea({idea,paused,onBook}:{idea:typeof ideas[number];paused:boolean;onBook:(mode:TravelMode)=>void}){
 const card=useRef<HTMLElement>(null);
 const {mode:service,label,title,body,action,Icon}=idea;
 useEffect(()=>{
  const node=card.current;if(!node)return;
  let visible=false;
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const sync=()=>{
   const reduced=media.matches||!!node.closest('.reduce-motion,[data-reduced-motion="true"]');
   node.dataset.motion=reduced?'reduced':paused||document.hidden||!visible||!!node.closest('[hidden]')?'paused':'playing';
  };
  const intersection=new IntersectionObserver(entries=>{visible=!!entries[0]?.isIntersecting;sync();},{threshold:.1});
  intersection.observe(node);
  const preferences=new MutationObserver(sync);
  for(let ancestor=node.parentElement;ancestor;ancestor=ancestor.parentElement)preferences.observe(ancestor,{attributes:true,attributeFilter:['class','hidden','data-reduced-motion']});
  media.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);sync();
  return()=>{intersection.disconnect();preferences.disconnect();media.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);};
 },[paused]);
 return <article ref={card} className="mobility-travel-banner" data-service={service} data-motion="paused">
  <div className="mobility-banner-copy">
   <span className="mobility-banner-label"><Icon size={14} aria-hidden="true"/>{label}</span>
   <h4>{title}</h4><p>{body}</p>
   <button type="button" className="mobility-banner-action" onClick={()=>onBook(service)}>{action}<ArrowRight size={15} aria-hidden="true"/></button>
  </div>
  <div className="mobility-banner-art" aria-hidden="true"><DiscoveryScene kind={service}/></div>
 </article>;
}

/** Service ideas use the existing booking flows; rendering them performs no reads. */
export function MobilityMoreWays({mode,area,onBook,onLocation}:{mode:TravelMode;area?:TransportArea;onBook:(mode:TravelMode)=>void;onLocation:()=>void}){
 const titleId=useId();
 const [paused,setPaused]=useState(false);
 const hasPickup=area?.confirmed===true&&Number.isFinite(area.lat)&&Number.isFinite(area.lng);
 return <section className="mobility-more-ways" aria-labelledby={titleId}>
  <header className="mobility-more-heading"><div><span>REPAIDO MOVE</span><h3 id={titleId}>More ways to travel</h3></div><button type="button" className="mobility-banner-motion" aria-label={paused?'Play travel animations':'Pause travel animations'} onClick={()=>setPaused(value=>!value)}>{paused?<Play size={14} aria-hidden="true"/>:<Pause size={14} aria-hidden="true"/>}<span>{paused?'Play':'Pause'}</span></button></header>
  <div className="mobility-banner-stack">
   {ideas.filter(idea=>idea.mode!==mode).map(idea=><TravelIdea key={idea.mode} idea={idea} paused={paused} onBook={onBook}/>)}
  </div>
  <button type="button" className="mobility-pickup-shortcut" onClick={onLocation}>
   <span className="mobility-pickup-icon" aria-hidden="true"><MapPin size={20}/></span>
   <span><strong>{hasPickup?'Your pickup area':'Make pickup simple'}</strong><span>{hasPickup?(area.address||area.city||'View your pickup pin'):'Choose your area and a clear landmark.'}</span></span>
   <ChevronRight size={17} aria-hidden="true"/>
  </button>
 </section>;
}
