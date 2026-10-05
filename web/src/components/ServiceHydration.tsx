import RepaidoBrand from './RepaidoBrand';
import {setLoadingInterests} from '../services/loading';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowRight,ChevronLeft,ChevronRight,Sparkles} from 'lucide-react';
import {apiFetch} from '../services/api';
import {loadServiceSuggestions} from '../services/serviceSuggestions.mjs';
import {operation,money} from '../services/operations';
import {auth} from '../firebase';
import {onIdTokenChanged} from 'firebase/auth';
import ServiceImage from './ServiceImage';
import {seededServices} from '../data';
import type {Service} from '../types';

export type DiscoveryEvent={kind:'search'|'category_view'|'service_view'|'banner_open';query?:string;category?:string;service_id?:string};
type Card={category:string;category_name:string;reason:string;personalised:boolean;service:{id:string;name:string;category:Service['category'];description:string;price_paise:number;duration_minutes:number;included:string[];excluded:string[]}};
type Feed={cards:Card[];personalised:boolean;covered:boolean;basis:string};
export function useServiceHydration(profileUid:string|undefined,city:string,active:boolean){
 const [verifiedUid,setVerifiedUid]=useState<string|undefined>();
 useEffect(()=>onIdTokenChanged(auth,user=>setVerifiedUid(user?.uid)),[]);
 // Cached display names never imply an authenticated session. Guests get the public feed.
 const uid=verifiedUid===profileUid?verifiedUid:undefined;
 const [enabled,setEnabled]=useState(false);
 const [feed,setFeed]=useState<Feed|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false),[dirty,setDirty]=useState(0);
 const generation=useRef(0),identity=useRef(uid);identity.current=uid;
 const refresh=useCallback((permission?:boolean)=>{if(typeof permission==='boolean')setEnabled(permission);setDirty(n=>n+1);},[]);
 useEffect(()=>{setFeed(null);setLoadingInterests([]);setError('');},[uid,city]);
 useEffect(()=>{let alive=true;setEnabled(false);if(uid)void operation<{enabled:boolean}>('/discovery/preferences',{}, {background:true}).then(p=>{if(alive)setEnabled(p.enabled);}).catch(()=>{});return()=>{alive=false;};},[uid]);
 useEffect(()=>{if(!active)return;const current=++generation.current;let alive=true;setPending(true);setError('');
  const load=async()=>{
   try{
    const general=async():Promise<Feed>=>{const r=await apiFetch('/api/operations/discovery/feed?city='+encodeURIComponent(city),{signal:AbortSignal.timeout(12000)},{background:true});if(!r.ok)throw Error('Suggestions could not load. Retry when you are connected.');return r.json();};
    const {feed:result,notice}=await loadServiceSuggestions(uid,general,()=>operation<Feed>('/discovery/feed/personal?city='+encodeURIComponent(city),{}, {background:true}));
    if(alive&&current===generation.current){setFeed(result);setLoadingInterests(result.personalised?result.cards.map((c:Card)=>c.category):[]);setEnabled(result.personalised);setError(notice);}
   }catch(e){if(alive){setFeed(null);setError((e as Error).message);}}
   finally{if(alive)setPending(false);}
  };void load();return()=>{alive=false;};
 },[uid,city,active,dirty]);
 const event=useCallback((body:DiscoveryEvent)=>{
  if(!uid||!enabled||auth.currentUser?.uid!==uid)return;
  void operation<{recorded:boolean}>('/discovery/events',{method:'POST',body:JSON.stringify({...body,event_id:crypto.randomUUID()})},{background:true})
   .then(result=>{if(identity.current===uid&&result.recorded){refresh();window.dispatchEvent(new Event('repaido:interests'));}}).catch(()=>{if(identity.current===uid)setError('Suggestions could not update. Browsing and booking still work.');});
 },[uid,enabled,refresh]);
 return {feed,error,pending,event,refresh,enabled,signedIn:!!uid};
}
export function HydrationControls({enabled,signedIn,error,pending,onChange,onSignIn}:{enabled:boolean;signedIn:boolean;error:string;pending:boolean;onChange:(enabled?:boolean)=>void;onSignIn:()=>void}){
 const [busy,setBusy]=useState(false),[issue,setIssue]=useState(''),[notice,setNotice]=useState('');
 const update=async(reset=false)=>{setBusy(true);setIssue('');setNotice('');try{await operation(reset?'/discovery/preferences/reset':'/discovery/preferences',{method:reset?'POST':'PUT',...(!reset?{body:JSON.stringify({enabled:!enabled,consent_version:2})}:{})});setNotice(reset?'Your suggestion history has been cleared.':enabled?'Personalisation is off. Your history has been cleared.':'Personalisation is on. Suggestions adapt as you explore.');onChange(reset?enabled:!enabled);}catch(e){setIssue((e as Error).message);}finally{setBusy(false);}};
 return <div className="hydration-controls"><details><summary><Sparkles size={15} aria-hidden="true"/> Your service suggestions</summary><p>With your permission, catalogue searches and service or category visits help choose these cards. We save category interests, not search text, precise location or form contents. Repeated visits count more; older interests fade. This does not subscribe you to marketing or change prices.</p>{signedIn?<div><button disabled={busy||pending} onClick={()=>void update()}>{enabled?'Turn off & clear interests':'Enable personalised suggestions'}</button>{enabled&&<button disabled={busy} onClick={()=>void update(true)}>Reset suggestion history</button>}</div>:<button onClick={onSignIn}>Sign in to personalise</button>}<p>Suggestions are ideas to explore, not a diagnosis. Professional availability is confirmed during booking.</p></details>{(error||issue)&&<p role="alert">{issue||error} <button onClick={()=>onChange()}>Retry suggestions</button></p>}{notice&&<p role="status">{notice}</p>}</div>;
}
export function ServiceHydration({cards,slot,onOpen}:{cards:Card[];slot:number;onOpen:(service:Service)=>void}){
 const [index,setIndex]=useState(0),[announcement,setAnnouncement]=useState(''),[paused,setPaused]=useState(false),[interacting,setInteracting]=useState(false);
 useEffect(()=>{if(paused||interacting||cards.length<2)return;const timer=setInterval(()=>{if(!document.hidden&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.documentElement.classList.contains('reduce-motion'))setIndex(i=>(i+1)%cards.length);},5000);return()=>clearInterval(timer);},[paused,interacting,cards.length]);
 const touch=useRef<{x:number;y:number}|null>(null);
 const current=index%Math.max(cards.length,1),card=cards[current];
 const move=(by:number)=>{const next=(current+by+cards.length)%cards.length;setIndex(next);setAnnouncement(`${next+1} of ${cards.length}: ${cards[next].category_name}`);};
 if(!card)return null;
 const p=card.service,art=seededServices.find(s=>s.id===p.id)||seededServices.find(s=>s.category===p.category);
 const service:Service={...p,price:p.price_paise,duration:p.duration_minutes,image:art?.image||'',imageTile:art?.imageTile,imageAlt:p.name};
 return <section className={`service-hydration hydration-tone-${slot%3}`} aria-roledescription="carousel" aria-label={`Service ideas ${slot+1}`} onMouseEnter={()=>setInteracting(true)} onMouseLeave={()=>setInteracting(false)} onFocusCapture={()=>setInteracting(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setInteracting(false);}}>
  <div className="hydration-brand"><RepaidoBrand size="sm"/></div><div className="hydration-topline"><span><Sparkles size={14} aria-hidden="true"/>Repaido · Repair Your Lifestyle</span><div><span aria-hidden="true">{current+1} / {cards.length}</span><button aria-label={`Previous service idea ${slot+1}`} disabled={cards.length<2} onClick={()=>move(-1)}><ChevronLeft size={17}/></button><button aria-label={`Next service idea ${slot+1}`} disabled={cards.length<2} onClick={()=>move(1)}><ChevronRight size={17}/></button></div></div>
  <div className="hydration-slide" key={p.id} onTouchStart={e=>{touch.current={x:e.touches[0].clientX,y:e.touches[0].clientY};}} onTouchEnd={e=>{const start=touch.current;touch.current=null;if(!start)return;const dx=e.changedTouches[0].clientX-start.x,dy=e.changedTouches[0].clientY-start.y;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5)move(dx<0?1:-1);}}>
   <div className="hydration-copy"><span className="hydration-category">{card.category_name}</span><h3>{p.name}</h3><span className="hydration-price">{money(p.price_paise)} <span>· {p.duration_minutes} min</span></span><button onClick={()=>onOpen(service)}>Explore this service <ArrowRight size={16} aria-hidden="true"/></button></div>
   <ServiceImage className="hydration-image" service={service} decorative/>
  </div><span className="sr-only" role="status" aria-live="polite">{announcement}</span>
 </section>;
}
