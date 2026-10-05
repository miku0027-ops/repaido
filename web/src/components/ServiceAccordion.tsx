import {useEffect,useRef,useState} from 'react';
import {ChevronDown,Clock,IndianRupee,CheckCheck,Star,ArrowRight,ClipboardList} from 'lucide-react';
import type {Service} from '../types';
import ServiceImage from './ServiceImage';
import {formatMoney} from '../data';
import {PromotionRail,type Promotion} from './Promotions';
import './service-accordion.css';
export function ServiceAccordion({service,city,onPreview,onOffer}:{service:Service;city:string;onPreview:()=>void;onOffer:(offer:Promotion)=>void}){
 const [open,setOpen]=useState(false),[index,setIndex]=useState(0),[interacting,setInteracting]=useState(false);
 const root=useRef<HTMLDetailsElement>(null);
 const facts=[{icon:ClipboardList,text:service.included[0]||service.description},{icon:CheckCheck,text:service.included[1]||'Review the scope before booking'},{icon:Star,text:service.reviewCount&&service.rating!==undefined?`${service.rating.toFixed(1)}/5 · ${service.reviewCount} verified reviews`:'New service · no reviews yet'}];
 useEffect(()=>{if(open||interacting)return;const timer=setInterval(()=>{if(document.hidden||document.querySelector('dialog[open],[role="dialog"]')||matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('reduce-motion'))return;const box=root.current?.getBoundingClientRect();if(box&&box.bottom>0&&box.top<innerHeight)setIndex(i=>(i+1)%3);},3200);return()=>clearInterval(timer);},[open,interacting]);
 const fact=facts[index],Icon=fact.icon;
 return <details ref={root} className="service-preview-accordion" onToggle={e=>setOpen(e.currentTarget.open)} onMouseEnter={()=>setInteracting(true)} onMouseLeave={()=>setInteracting(false)} onFocusCapture={()=>setInteracting(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setInteracting(false);}}>
  <summary><ServiceImage service={service} className="service-accordion-photo" decorative/><span className="service-accordion-copy"><strong>{service.name}</strong><span className="service-accordion-price"><span><Clock size={12} aria-hidden="true"/>{service.duration} min</span><b>{formatMoney(service.price)}</b></span><span className="service-accordion-fact" aria-hidden="true"><span key={index}><Icon size={12}/><span>{fact.text}</span></span></span></span><ChevronDown size={16} aria-hidden="true"/></summary>
  <div className="service-preview-body"><p>{service.description}</p><p>{facts[2].text}</p><ul className="service-accordion-included">{service.included.map((item,i)=><li key={i}><CheckCheck size={13} aria-hidden="true"/>{item}</li>)}</ul><span><IndianRupee size={14} aria-hidden="true"/>Service price · {formatMoney(service.price)}</span>{service.excluded.length>0&&<details><summary>Not included</summary><ul>{service.excluded.map((item,i)=><li key={i}>{item}</li>)}</ul></details>}{open&&<PromotionRail city={city} placement="explore" serviceId={service.id} onOpen={onOffer}/>}<button onClick={onPreview}>Full service preview <ArrowRight size={14} aria-hidden="true"/></button></div>
 </details>;
}
