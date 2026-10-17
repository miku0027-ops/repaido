import {useId,useRef} from 'react';
import {ArrowLeft,ArrowRight,ChevronDown,Category,Sparkles} from '../icons';
import {categories} from '../data';
import type {CategoryId,Service} from '../types';
import ServiceImage from './ServiceImage';
import './home-discovery-refresh.css';
import './catalogue-controls.css';

/** A manual, keyboard-accessible story rail. Every item opens a real category. */
export default function ServiceStories({services,selected='all',onSelect,title='Explore services',compact=false,sort='recommended',onSort}:{services:Service[];selected?:string;onSelect:(category:CategoryId)=>void;title?:string;compact?:boolean;sort?:string;onSort?:(sort:string)=>void}){
 const rail=useRef<HTMLDivElement>(null),id=useId();
 const groups=categories.filter(c=>c.id==='all'||c.id===selected||services.some(s=>s.category===c.id));
 if(compact)return <section className="service-stories service-controls-compact" aria-labelledby={id}>
  <h2 id={id} className="sr-only">{title}</h2>
  <div className="catalogue-dropdown-strip" role="group" aria-label="Service categories and sorting">
   <label><span>Service category</span><select aria-label="Service category" value={selected} onChange={event=>onSelect(event.target.value as CategoryId)}>{groups.map(c=><option key={c.id} value={c.id}>{c.id==='all'?'All services':c.name}</option>)}</select><ChevronDown size={14} aria-hidden="true"/></label>
   <label><span>Sort by</span><select aria-label="Sort catalogue services" value={sort} onChange={event=>onSort?.(event.target.value)}><option value="recommended">Recommended</option><option value="price-low">Price: low first</option><option value="price-high">Price: high first</option><option value="rating">Top rated</option><option value="duration">Shortest visit</option></select><ChevronDown size={14} aria-hidden="true"/></label>
  </div>
 </section>;
 return <section className="service-stories" aria-labelledby={id}>
  <div className="stories-heading"><div className="stories-title"><span><Sparkles size={14} aria-hidden="true"/> REPAIDO PICKS</span><h2 id={id}>{title}</h2></div><div><button aria-label="Scroll service categories left" onClick={()=>rail.current?.scrollBy({left:-(rail.current.clientWidth*.75)})}><ArrowLeft size={20}/></button><button aria-label="Scroll service categories right" onClick={()=>rail.current?.scrollBy({left:rail.current.clientWidth*.75})}><ArrowRight size={20}/></button></div></div>
  <div className="stories-rail" ref={rail} role="group" aria-label="Service categories">
   {groups.map(c=>{const service=services.find(s=>s.category===c.id);return <button key={c.id} className="service-story" aria-pressed={selected===c.id} onClick={event=>{if(selected!==c.id)onSelect(c.id);event.currentTarget.scrollIntoView({block:'nearest',inline:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('reduce-motion')?'instant':'smooth'});}}>
    <span className="story-ring"><span className="story-art">{service?<ServiceImage service={service} decorative className="story-photo"/>:<Category size={24} aria-hidden="true"/>}</span></span>
    <span className="story-label">{c.id==='all'?'All services':c.name}</span>
   </button>;})}
  </div>
 </section>;
}
