import './compact-controls.css';
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
/** Photos change only when the user chooses another one. */
export function HomePhotoFrame({compact=false,onSceneChange}:{compact?:boolean;onSceneChange?:(index:number)=>void}){
 const [index,setIndex]=useState(0),[announcement,setAnnouncement]=useState('');
 const id=useId(),scene=scenes[index];
 useEffect(()=>onSceneChange?.(index),[index,onSceneChange]);
 const move=(offset:number)=>{const next=(index+offset+scenes.length)%scenes.length;setIndex(next);setAnnouncement(`Photo ${next+1} of ${scenes.length}: ${scenes[next].caption}`);};
 return <div data-scene={scene.id} className={`home-photo-frame${compact?' home-photo-frame-compact':''}`} role="region" aria-roledescription="carousel" aria-label="Home inspiration">
  <div id={id} className="home-photo-window"><img key={scene.id} src={scene.image} alt={compact?'':scene.alt} loading={compact?'eager':'lazy'}/></div>
  <div className="home-photo-footer">{!compact&&<span className="home-photo-caption">{scene.caption}<small aria-hidden="true">{index+1} / {scenes.length}</small></span>}<div className="home-photo-controls"><button type="button" aria-label="Previous Home photo" aria-controls={id} onClick={()=>move(-1)}><ChevronLeft size={20} aria-hidden="true"/></button><button type="button" aria-label="Next Home photo" aria-controls={id} onClick={()=>move(1)}><ChevronRight size={20} aria-hidden="true"/></button></div></div>
  <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
 </div>;
}

export const homeServiceImage=(id:string)=>id==='maid'?'/images/cleaning.jpg':id==='caretaker'?'/images/family-home-care.jpg':['floor-plan','civil-engineer','contractor'].includes(id)?'/images/home-project-planning.jpg':'/images/puja-ready-home.jpg';
export function homeSmallJobs(services:Service[]){return services.filter(s=>['cleaning','painting','carpenter','plumber','electrician','ac'].includes(s.category)&&Number.isSafeInteger(s.price)&&s.price>0).sort((a,b)=>a.price-b.price||a.name.localeCompare(b.name));}

export function BoutiqueHomeEntry({onOpen,city,services=[]}:{onOpen:()=>void;city?:string;services?:Service[]}){
 const lowest=homeSmallJobs(services)[0];
 return <button className="home-entry" onClick={onOpen} aria-haspopup="dialog"><img src="/images/puja-ready-home.jpg" alt=""/><span className="home-entry-copy"><strong>Home help and projects</strong><span>Daily help, family care and home projects{city?` in ${city}`:''}</span>{lowest&&<small>Small jobs from {money(lowest.price)}. Plans and projects need a quote.</small>}</span><ArrowRight size={18} aria-hidden="true"/></button>;
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
 return <section className="home-rated-people" aria-label="Highly rated Home professionals"><div className="home-boutique-heading"><div><h3>Reviewed professionals</h3></div><span className="home-city-note">{city}</span></div><label className="home-people-service-filter" htmlFor={filterId}>Home service<select className="ui-compact-select" id={filterId} value={selectedService.id} onChange={event=>setServiceId(event.target.value)}>{services.map(service=><option key={service.id} value={service.id}>{service.name}</option>)}</select></label>{current.busy&&<p role="status">Finding reviewed Home professionals…</p>}{current.error&&<p role="status">Reviewed professionals could not refresh.<button type="button" onClick={()=>setRetry(value=>value+1)}>Retry profiles</button></p>}{!current.busy&&!current.error&&!people.length&&<p>No professionals rated 4.5+ for this service yet. You can still request a plan.</p>}<div className="home-people-grid">{people.map(person=><article className="home-person-card" key={person.id}><div className="home-person-heading"><span className="home-person-portrait">{person.portrait_url?<img src={apiAssetUrl(person.portrait_url)} alt="" loading="lazy"/>:<UserRound size={20} aria-hidden="true"/>}</span><div><h4>{person.name}</h4><span>{professionalRole(person.role)} · Home services</span></div></div><p className="home-person-rating"><Star size={14} aria-hidden="true"/><strong>{person.rating?.toFixed(1)}</strong><span>overall · {person.review_count} {person.review_count===1?'review':'reviews'}</span></p><p className="home-person-service">{selectedService.name}</p><button type="button" onClick={()=>onChoose(selectedService,{id:person.id,name:person.name})}>Request with {person.name.split(' ')[0]}<ArrowRight size={14} aria-hidden="true"/></button></article>)}</div>{!!people.length&&<p>Your preferred professional and schedule need confirmation.</p>}<details className="home-profile-criteria"><summary>How profiles are selected<ChevronRight size={14} aria-hidden="true"/></summary><p>Shown for your selected Home service, with a rating of 4.5 or above and completed-work reviews. Ratings include work across services.</p></details></section>;
}
