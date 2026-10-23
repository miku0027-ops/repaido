import {useState} from 'react';
import {useVisibleMotion} from '../hooks/useVisibleMotion';
import {useContentRotation} from '../hooks/useContentRotation';
import './home-content-motion.css';

export function ServiceDiscoveryHeading({city,paused}:{city?:string;paused:boolean}){
 const messages=[city?`A little help in ${city}`:'A little help, nearby','Cleaning, repairs & more','Review the work & price'];
 const {ref,active}=useVisibleMotion<HTMLHeadingElement>();
 const [reading,setReading]=useState(false);
 const moving=active&&!paused&&!reading;
 const {index,previous,step}=useContentRotation(city||'',messages.length,moving);
 return <h2 ref={ref} className="service-discovery-heading" data-moving={moving} onPointerEnter={()=>setReading(true)} onPointerLeave={()=>setReading(false)}>
  <span className="sr-only">{city?`Home services in ${city}`:'Home services nearby'}</span>
  <span className="service-heading-frame" aria-hidden="true">
   {messages.map(message=><span key={message} className="service-heading-sizer">{message}</span>)}
   <span key={step} className="service-heading-swap">
    {previous!==undefined&&<span className="service-heading-previous">{messages[previous]}</span>}
    <span className="service-heading-current" data-entering={previous!==undefined}>{messages[index]}</span>
   </span>
  </span>
 </h2>;
}
