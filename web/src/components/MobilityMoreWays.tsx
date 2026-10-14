import {useId} from 'react';
import {ArrowRight,CalendarDays,CarFront,ChevronRight,KeyRound,MapPin,Users} from 'lucide-react';
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

/** Service ideas use the existing booking flows; rendering them performs no reads. */
export function MobilityMoreWays({mode,area,onBook,onLocation}:{mode:TravelMode;area?:TransportArea;onBook:(mode:TravelMode)=>void;onLocation:()=>void}){
 const titleId=useId();
 const hasPickup=area?.confirmed===true&&Number.isFinite(area.lat)&&Number.isFinite(area.lng);
 return <section className="mobility-more-ways" aria-labelledby={titleId}>
  <header className="mobility-more-heading"><h3 id={titleId}>More ways to travel</h3><span>REPAIDO MOVE</span></header>
  <div className="mobility-banner-stack">
   {ideas.filter(idea=>idea.mode!==mode).map(({mode:service,label,title,body,action,Icon})=><article className="mobility-travel-banner" data-service={service} key={service}>
    <div className="mobility-banner-copy">
     <span className="mobility-banner-label"><Icon size={14} aria-hidden="true"/>{label}</span>
     <h4>{title}</h4><p>{body}</p>
     <button type="button" className="mobility-banner-action" onClick={()=>onBook(service)}>{action}<ArrowRight size={15} aria-hidden="true"/></button>
    </div>
    <div className="mobility-banner-art" aria-hidden="true"><DiscoveryScene kind={service}/></div>
   </article>)}
  </div>
  <button type="button" className="mobility-pickup-shortcut" onClick={onLocation}>
   <span className="mobility-pickup-icon" aria-hidden="true"><MapPin size={20}/></span>
   <span><strong>{hasPickup?'Your pickup area':'Make pickup simple'}</strong><span>{hasPickup?(area.address||area.city||'View your pickup pin'):'Choose your area and a clear landmark.'}</span></span>
   <ChevronRight size={17} aria-hidden="true"/>
  </button>
 </section>;
}
