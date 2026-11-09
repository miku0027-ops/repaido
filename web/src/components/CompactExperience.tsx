import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowRight} from '../icons';
import './compact-experience.css';

export type StorySlide={id:string;eyebrow:string;title:string;description:string;image:string;video?:string;action?:string;onAction?:()=>void};
export function StoryCarousel({slides,label}:{slides:StorySlide[];label:string}){
 const [index,setIndex]=useState(0),touch=useRef<number|null>(null);
 const current=slides[index%Math.max(1,slides.length)];
 if(!current)return null;
 return <section className="compact-story" aria-roledescription="carousel" aria-label={label} onTouchStart={e=>{touch.current=e.touches[0].clientX;}} onTouchEnd={e=>{if(touch.current===null)return;const dx=e.changedTouches[0].clientX-touch.current;if(Math.abs(dx)>35)setIndex(i=>(i+(dx<0?1:-1)+slides.length)%slides.length);touch.current=null;}}>
  <div className="compact-story-visual"><img src={current.image} alt=""/></div>
  <div className="compact-story-copy"><small>{current.eyebrow}</small><h2>{current.title}</h2><p>{current.description}</p>{current.onAction&&<button onClick={current.onAction}>{current.action||'View details'}<ArrowRight size={14} aria-hidden="true"/></button>}</div>
  {slides.length>1&&<div className="compact-story-controls"><div role="group" aria-label={`${label} slides`}>{slides.map((s,i)=><button key={s.id} aria-label={`Slide ${i+1}: ${s.title}`} aria-pressed={index%slides.length===i} onClick={()=>setIndex(i)}><span/></button>)}</div></div>}
 </section>;
}
export function StageTrail({labels,step,onStep}:{labels:string[];step:number;onStep?:(step:number)=>void}){return <nav className="compact-stage-trail" aria-label="Form progress"><ol>{labels.map((label,i)=><li key={label} aria-current={step===i?'step':undefined}><button type="button" disabled={!onStep||i>step} onClick={()=>onStep?.(i)}><span>{i<step?'✓':i+1}</span>{label}</button></li>)}</ol></nav>;}
export function EvidenceRail({items,label}:{items:ReactNode[];label:string}){
 const rail=useRef<HTMLDivElement>(null),[index,setIndex]=useState(0);
 useEffect(()=>{const el=rail.current;if(el)el.scrollTo({left:index*el.clientWidth,behavior:'instant'});},[index]);
 if(!items.length)return null;
 return <section className="evidence-story" aria-label={label}><div ref={rail} tabIndex={0} role="group" aria-label={label+' cards'} className="evidence-story-rail">{items.map((item,i)=><article key={i}>{item}</article>)}</div>{items.length>1&&<div className="evidence-story-controls">{items.map((_,i)=><button key={i} aria-label={`${label} ${i+1}`} aria-pressed={index===i} onClick={()=>setIndex(i)}><span/></button>)}</div>}</section>;
}
