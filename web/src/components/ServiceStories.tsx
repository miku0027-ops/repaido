import {useId,useRef} from 'react';
import {ArrowLeft,ArrowRight,Grid2X2,Sparkles} from 'lucide-react';
import {categories} from '../data';
import type {CategoryId,Service} from '../types';
import ServiceImage from './ServiceImage';
import './home-discovery-refresh.css';

/** A manual, keyboard-accessible story rail. Every item opens a real category. */
export default function ServiceStories({services,selected='all',onSelect,title='Explore services'}:{services:Service[];selected?:string;onSelect:(category:CategoryId)=>void;title?:string}){
 const rail=useRef<HTMLDivElement>(null),id=useId();
 const groups=categories.filter(c=>c.id==='all'||services.some(s=>s.category===c.id));
 return <section className="service-stories" aria-labelledby={id}>
  <div className="stories-heading"><div className="stories-title"><span><Sparkles size={12} aria-hidden="true"/> REPAIDO PICKS</span><h2 id={id}>{title}</h2></div><div><button aria-label="Scroll service categories left" onClick={()=>rail.current?.scrollBy({left:-(rail.current.clientWidth*.75)})}><ArrowLeft size={17}/></button><button aria-label="Scroll service categories right" onClick={()=>rail.current?.scrollBy({left:rail.current.clientWidth*.75})}><ArrowRight size={17}/></button></div></div>
  <div className="stories-rail" ref={rail} role="group" aria-label="Service categories">
   {groups.map(c=>{const service=services.find(s=>s.category===c.id);return <button key={c.id} className="service-story" aria-pressed={selected===c.id} onClick={event=>{if(selected!==c.id)onSelect(c.id);event.currentTarget.scrollIntoView({block:'nearest',inline:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('reduce-motion')?'instant':'smooth'});}}>
    <span className="story-ring"><span className="story-art">{service?<ServiceImage service={service} decorative className="story-photo"/>:<Grid2X2 size={30} aria-hidden="true"/>}</span></span>
    <span className="story-label">{c.id==='all'?'All services':c.name}</span>
   </button>;})}
  </div>
 </section>;
}
