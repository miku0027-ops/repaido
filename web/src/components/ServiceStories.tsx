import {useId,useRef,useEffect,useState,type CSSProperties} from 'react';
import {ArrowLeft,ArrowRight,Grid2X2} from 'lucide-react';
import {categories} from '../data';
import type {CategoryId,Service} from '../types';
import ServiceImage from './ServiceImage';

function RailLabel({text}:{text:string}) {
 const ref=useRef<HTMLSpanElement>(null),[overflow,setOverflow]=useState(0);
 useEffect(()=>{const el=ref.current;if(!el)return;const measure=()=>setOverflow(Math.max(0,(el.firstElementChild?.scrollWidth||0)-el.clientWidth));measure();const observer=new ResizeObserver(measure);observer.observe(el);if(el.firstElementChild)observer.observe(el.firstElementChild);return()=>observer.disconnect();},[text]);
 return <span ref={ref} className="story-label" title={text} data-overflow={overflow>0} style={{'--label-travel':`${-overflow}px`} as CSSProperties}><span>{text}</span></span>;
}

/** A manual, keyboard-accessible story rail. Every item opens a real category. */
export default function ServiceStories({services,selected='all',onSelect,title='Explore services'}:{services:Service[];selected?:string;onSelect:(category:CategoryId)=>void;title?:string}){
 const rail=useRef<HTMLDivElement>(null),id=useId();
 const groups=categories.filter(c=>c.id==='all'||services.some(s=>s.category===c.id));
 return <section className="service-stories" aria-labelledby={id}>
  <div className="stories-heading"><h2 id={id}>{title}</h2><div><button aria-label="Scroll service categories left" onClick={()=>rail.current?.scrollBy({left:-(rail.current.clientWidth*.75)})}><ArrowLeft size={17}/></button><button aria-label="Scroll service categories right" onClick={()=>rail.current?.scrollBy({left:rail.current.clientWidth*.75})}><ArrowRight size={17}/></button></div></div>
  <div className="stories-rail" ref={rail} role="group" aria-label="Service categories">
   {groups.map(c=>{const service=services.find(s=>s.category===c.id);return <button key={c.id} className="service-story" aria-pressed={selected===c.id} onClick={()=>onSelect(c.id)}>
    <span className="story-ring"><span className="story-art">{service?<ServiceImage service={service} decorative className="story-photo"/>:<Grid2X2 size={30} aria-hidden="true"/>}</span></span>
    <RailLabel text={c.id==='all'?'All services':c.name}/>
   </button>;})}
  </div>
 </section>;
}
