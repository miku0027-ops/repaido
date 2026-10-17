import {useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,ChevronLeft,ChevronRight,House,Pause,Play,Star,UserRound} from '../icons';
import type {Service} from '../types';
import {apiAssetUrl} from '../services/api';
import {cachedHireProfiles,hireProfiles} from '../services/hireProfileCache';
import {money} from '../services/operations';
import type {HomeService} from './HomePlans';

const scenes=[
 {id:'living',image:'/images/puja-ready-home.jpg',alt:'A sunlit living room with a blue sofa and festive flowers',caption:'A home to come back to.'},
 {id:'care',image:'/images/family-home-care.jpg',alt:'An older adult and a companion looking through a photo album at home',caption:'Care for everyday living.'},
 {id:'planning',image:'/images/home-project-planning.jpg',alt:'A home project being planned with drawings and material samples',caption:'Room for new ideas.'},
];
const pauseKey='repaido:home-slides-paused';
function savedPause(){try{return localStorage.getItem(pauseKey)==='true';}catch{return false;}}

/** The only automatic motion is photography. Interaction keeps it paused until explicitly played. */
export function HomePhotoFrame({compact=false}:{compact?:boolean}){
 const [index,setIndex]=useState(0),[paused,setPaused]=useState(savedPause),[reduced,setReduced]=useState(true),[visible,setVisible]=useState(false),[announcement,setAnnouncement]=useState('');
 const id=useId(),scene=scenes[index],frame=useRef<HTMLDivElement>(null);
 const setPlayback=(stop:boolean)=>{setPaused(stop);try{localStorage.setItem(pauseKey,String(stop));}catch{/* A blocked preference store does not affect the controls. */}window.dispatchEvent(new CustomEvent('repaido:home-slides-playback',{detail:{paused:stop}}));};
 useEffect(()=>{
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const update=()=>setReduced(media.matches||document.documentElement.classList.contains('reduce-motion'));
  update();media.addEventListener('change',update);
  const observer=new MutationObserver(update);observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  const playback=(event:StorageEvent)=>{if(event.key===pauseKey)setPaused(event.newValue==='true');};
  const localPlayback=(event:Event)=>{const stopped=(event as CustomEvent<{paused:boolean}>).detail?.paused;if(typeof stopped==='boolean')setPaused(stopped);};
  window.addEventListener('storage',playback);window.addEventListener('repaido:home-slides-playback',localPlayback);
  return()=>{media.removeEventListener('change',update);observer.disconnect();window.removeEventListener('storage',playback);window.removeEventListener('repaido:home-slides-playback',localPlayback);};
 },[]);
 useEffect(()=>{const element=frame.current;if(!element)return;const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)),{threshold:.1});observer.observe(element);return()=>observer.disconnect();},[]);
 useEffect(()=>{if(paused||reduced||!visible)return;const timer=setInterval(()=>{const dialogs=document.querySelectorAll('dialog[open]'),top=dialogs[dialogs.length-1];if(!document.hidden&&(!top||top.contains(frame.current)))setIndex(value=>(value+1)%scenes.length);},7000);return()=>clearInterval(timer);},[paused,reduced,visible]);
 const move=(offset:number)=>{setPlayback(true);const next=(index+offset+scenes.length)%scenes.length;setIndex(next);setAnnouncement(`Photo ${next+1} of ${scenes.length}: ${scenes[next].caption}`);};
 return <div ref={frame} className={`home-photo-frame${compact?' home-photo-frame-compact':''}`} role="region" aria-roledescription="carousel" aria-label="Home inspiration" onFocusCapture={()=>setPlayback(true)} onMouseEnter={()=>setPlayback(true)}>
  <div id={id} className="home-photo-window"><img key={scene.id} src={scene.image} alt={compact?'':scene.alt} loading={compact?'eager':'lazy'}/></div>
  <div className="home-photo-footer">{!compact&&<span className="home-photo-caption">{scene.caption}<small aria-hidden="true">{index+1} / {scenes.length}</small></span>}<div className="home-photo-controls">{!compact&&<button type="button" aria-label="Previous Home photo" aria-controls={id} onClick={()=>move(-1)}><ChevronLeft size={20} aria-hidden="true"/></button>}<button type="button" aria-label={paused||reduced?'Play Home slideshow':'Pause Home slideshow'} aria-pressed={paused||reduced} aria-controls={id} disabled={reduced} onClick={()=>setPlayback(!paused)}>{paused||reduced?<Play size={20} aria-hidden="true"/>:<Pause size={20} aria-hidden="true"/>}</button><button type="button" aria-label="Next Home photo" aria-controls={id} onClick={()=>move(1)}><ChevronRight size={20} aria-hidden="true"/></button></div></div>
  <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
 </div>;
}

export const homeServiceImage=(id:string)=>id==='maid'?'/images/cleaning.jpg':id==='caretaker'?'/images/family-home-care.jpg':['floor-plan','civil-engineer','contractor'].includes(id)?'/images/home-project-planning.jpg':'/images/puja-ready-home.jpg';
export function homeSmallJobs(services:Service[]){return services.filter(s=>['cleaning','painting','carpenter','plumber','electrician','ac'].includes(s.category)&&Number.isSafeInteger(s.price)&&s.price>0).sort((a,b)=>a.price-b.price||a.name.localeCompare(b.name));}

export function BoutiqueHomeEntry({onOpen,city,services=[]}:{onOpen:()=>void;city?:string;services?:Service[]}){
 const lowest=homeSmallJobs(services)[0];
 return <section className="home-entry-premium home-boutique" aria-label="Repaido Home"><div className="home-entry-composition"><HomePhotoFrame compact/><button className="home-entry" onClick={onOpen} aria-haspopup="dialog"><span className="home-entry-copy"><span className="home-specialty"><House size={14} aria-hidden="true"/>A Repaido specialty</span><strong>Repaido Home</strong><span className="home-entry-tagline">A little care.<br/>A better home.</span><span className="home-entry-detail">Daily help · family care · home projects</span><span className="home-entry-invitation">Explore Home<ArrowRight size={14} aria-hidden="true"/></span></span></button></div><div className="home-entry-footnote"><span>{city?`For your home in ${city}`:'For the place you call home'}</span><span>{lowest?`Small jobs from ${money(lowest.price)}`:'Plans & projects · quote first'}</span></div></section>;
}

export function HomeSmallJobs({services,onService}:{services:Service[];onService?:(id:string)=>void}){
 const choices=homeSmallJobs(services).filter((service,index,all)=>all.findIndex(row=>row.category===service.category)===index).slice(0,3);
 if(!choices.length||!onService)return null;
 return <section className="home-small-jobs" aria-label="Published home service fees"><div className="home-boutique-heading"><div><span className="home-eyebrow">A SMALL START</span><h3>Little fixes, listed fees.</h3></div></div><div className="home-small-job-list">{choices.map(service=><button key={service.id} onClick={()=>onService(service.id)}><span><strong>{service.name}</strong><small>Published service fee · {service.duration} min</small></span><span className="home-published-price">{money(service.price)}<ArrowRight size={14} aria-hidden="true"/></span></button>)}</div><p>Open a service to review its scope, taxes and any extras before booking. Home plans receive a separate written quote.</p></section>;
}

type HomeProfessional={id:string;name:string;role:string;portrait_url?:string;rating:number|null;review_count:number;home_services?:string[];skills:string[]};
type HomePeople={professionals:HomeProfessional[]};
const professionalRole=(role:string)=>role==='specialist'?'Specialist':role==='technician'?'Technician':role==='contractor'?'Contractor':'Professional';
export function HomeRatedPeople({city,services,onChoose}:{city:string;services:HomeService[];onChoose:(service:HomeService,person:{id:string;name:string})=>void}){
 const [serviceId,setServiceId]=useState(services[0]?.id||'');
 const selectedService=services.find(service=>service.id===serviceId)||services[0];
 const filterId=useId();
 const body={city,location:null,category:selectedService?'home:'+selectedService.id:'',role:'all',sort:'rating',min_rating:4.5};
 const key=JSON.stringify(body),[retry,setRetry]=useState(0),[state,setState]=useState<{key:string;data:HomePeople|null;busy:boolean;error:boolean}>({key:'',data:null,busy:false,error:false}),lastLoad=useRef({key:'',retry:0});
 useEffect(()=>{
  if(!city||!services.length)return;let alive=true;
  const force=lastLoad.current.key===key&&lastLoad.current.retry!==retry;lastLoad.current={key,retry};
  const cached=force?null:cachedHireProfiles<HomePeople>(body);setState({key,data:cached,busy:!cached,error:false});
  void hireProfiles<HomePeople>(body,force).then(data=>{if(alive)setState({key,data,busy:false,error:false});}).catch(()=>{if(alive)setState({key,data:cached,busy:false,error:true});});
  return()=>{alive=false;};
 },[key,retry,services.length]);
 const current=state.key===key?state:{data:null,busy:true,error:false};
 const people=(current.data?.professionals||[]).filter(p=>p.rating!==null&&p.rating>=4.5&&p.review_count>0&&p.home_services?.includes(selectedService.id)).slice(0,3);
 if(!city||!services.length)return null;
 return <section className="home-rated-people" aria-label="Highly rated Home professionals"><div className="home-boutique-heading"><div><span className="home-eyebrow">PEOPLE BEHIND THE CARE</span><h3>Highly rated for their work.</h3></div><span className="home-city-note">{city}</span></div><label className="home-people-service-filter" htmlFor={filterId}>Home service<select id={filterId} value={selectedService.id} onChange={event=>setServiceId(event.target.value)}>{services.map(service=><option key={service.id} value={service.id}>{service.name}</option>)}</select></label>{current.busy&&<p role="status">Finding reviewed Home professionals…</p>}{current.error&&<p role="status">Reviewed professionals could not refresh.<button type="button" onClick={()=>setRetry(value=>value+1)}>Retry profiles</button></p>}{!current.busy&&!current.error&&!people.length&&<p>No professionals rated 4.5 or above with completed-work reviews were found for this Home service. You can still request a plan for the team to review.</p>}<div className="home-people-grid">{people.map(person=><article className="home-person-card" key={person.id}><div className="home-person-heading"><span className="home-person-portrait">{person.portrait_url?<img src={apiAssetUrl(person.portrait_url)} alt="" loading="lazy"/>:<UserRound size={20} aria-hidden="true"/>}</span><div><h4>{person.name}</h4><span>{professionalRole(person.role)} · Home services</span></div></div><p className="home-person-rating"><Star size={14} aria-hidden="true"/><strong>{person.rating?.toFixed(1)}</strong><span>overall · {person.review_count} {person.review_count===1?'review':'reviews'}</span></p><p className="home-person-service">{selectedService.name}</p><button type="button" onClick={()=>onChoose(selectedService,{id:person.id,name:person.name})}>Request with {person.name.split(' ')[0]}<ArrowRight size={14} aria-hidden="true"/></button></article>)}</div>{!!people.length&&<p>Ratings come from completed work across services. Your preferred professional and full schedule need confirmation before a plan starts.</p>}</section>;
}
