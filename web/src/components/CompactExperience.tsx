import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowRight,Pause,Play} from 'lucide-react';
import './compact-experience.css';

export type StorySlide={id:string;eyebrow:string;title:string;description:string;image:string;video?:string;action?:string;onAction?:()=>void};
export function StoryCarousel({slides,label}:{slides:StorySlide[];label:string}){
 const [index,setIndex]=useState(0),[paused,setPaused]=useState(false),[reduced,setReduced]=useState(true),[hover,setHover]=useState(false);
 const touch=useRef<number|null>(null),video=useRef<HTMLVideoElement>(null);
 useEffect(()=>{const mq=matchMedia('(prefers-reduced-motion: reduce)');const change=()=>setReduced(mq.matches);change();mq.addEventListener('change',change);return()=>mq.removeEventListener('change',change);},[]);
 const current=slides[index%Math.max(1,slides.length)];
 useEffect(()=>{if(paused||reduced||hover||slides.length<2)return;const id=setInterval(()=>{if(!document.hidden)setIndex(i=>(i+1)%slides.length);},6000);return()=>clearInterval(id);},[paused,reduced,hover,slides.length]);
 useEffect(()=>{if(!video.current)return;if(paused||reduced||hover)video.current.pause();else void video.current.play().catch(()=>{});},[index,paused,reduced,hover]);
 if(!current)return null;
 return <section className="compact-story" role="region" aria-roledescription="carousel" aria-label={label} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} onFocusCapture={()=>setHover(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setHover(false);}} onTouchStart={e=>{touch.current=e.touches[0].clientX;}} onTouchEnd={e=>{if(touch.current===null)return;const dx=e.changedTouches[0].clientX-touch.current;if(Math.abs(dx)>35){setIndex(i=>(i+(dx<0?1:-1)+slides.length)%slides.length);setPaused(true);}touch.current=null;}}>
  <div className="compact-story-visual" key={current.id}>{current.video&&!reduced?<video ref={video} src={current.video} poster={current.image} muted loop playsInline preload="metadata" aria-hidden="true"/>:<img src={current.image} alt=""/>}</div>
  <div className="compact-story-copy"><small>{current.eyebrow}</small><h2>{current.title}</h2><p>{current.description}</p>{current.onAction&&<button onClick={current.onAction}>{current.action||'Explore'}<ArrowRight size={14}/></button>}</div>
  <div className="compact-story-controls"><div role="group" aria-label={`${label} slides`}>{slides.map((s,i)=><button key={s.id} aria-label={`Slide ${i+1}: ${s.title}`} aria-pressed={index%slides.length===i} onClick={()=>{setIndex(i);setPaused(true);}}><span/></button>)}</div>{!reduced&&<button aria-label={paused?'Play slideshow':'Pause slideshow'} onClick={()=>setPaused(p=>!p)}>{paused?<Play size={13}/>:<Pause size={13}/>}</button>}</div>
 </section>;
}
export function StageTrail({labels,step,onStep}:{labels:string[];step:number;onStep?:(step:number)=>void}){return <nav className="compact-stage-trail" aria-label="Form progress"><ol>{labels.map((label,i)=><li key={label} aria-current={step===i?'step':undefined}><button type="button" disabled={!onStep||i>step} onClick={()=>onStep?.(i)}><span>{i<step?'✓':i+1}</span>{label}</button></li>)}</ol></nav>;}
export function EvidenceRail({items,label}:{items:ReactNode[];label:string}){
 const rail=useRef<HTMLDivElement>(null),[index,setIndex]=useState(0),[paused,setPaused]=useState(false);
 useEffect(()=>{if(paused||items.length<2||matchMedia('(prefers-reduced-motion: reduce)').matches)return;const timer=setInterval(()=>{if(!document.hidden)setIndex(i=>(i+1)%items.length);},6000);return()=>clearInterval(timer);},[paused,items.length]);
 useEffect(()=>{const el=rail.current;if(el)el.scrollTo({left:index*el.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});},[index]);
 if(!items.length)return null;
 return <section className="evidence-story" aria-label={label} onFocusCapture={()=>setPaused(true)} onPointerDown={()=>setPaused(true)}><div ref={rail} tabIndex={0} role="group" aria-label={label+" cards"} className="evidence-story-rail">{items.map((item,i)=><article key={i}>{item}</article>)}</div>{items.length>1&&<div className="evidence-story-controls"><button aria-label={paused?`Play ${label}`:`Pause ${label}`} onClick={()=>setPaused(p=>!p)}>{paused?<Play size={12}/>:<Pause size={12}/>}</button>{items.map((_,i)=><button key={i} aria-label={`${label} ${i+1}`} aria-pressed={index===i} onClick={()=>{setPaused(true);setIndex(i);}}><span/></button>)}</div>}</section>;
}
