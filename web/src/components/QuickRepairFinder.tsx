import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowRight,Check,ChevronDown,MapPin,Search,ShieldCheck,Star,Wrench} from 'lucide-react';
import {InteractionMotion} from './InteractionMotion';
import {apiFetch} from '../services/api';
import {createReadCache} from '../services/readCache.mjs';
import {seededServices} from '../data';
import type {Service} from '../types';
import type {TransportArea} from './TransportRail';
import type {DiscoveryEvent} from './ServiceHydration';
import {ContractError} from './customContractUI';
import {RepaidianBadge,type RepaidianBadgeMetadata} from './RepaidianBadge';
import ServiceImage from './ServiceImage';
import './home-elastic-discovery.css';

const cache=createReadCache({maxEntries:24});
type Professional={id:string;name:string;categories:string[];skills:string[];rating:number|null;rating_count:number;distance_km:number;role:string;repaidianBadge?:RepaidianBadgeMetadata|null};
type Results={services:any[];home_services:any[];professionals:Professional[];covered:boolean};
function repairResults(value:unknown):Results{
 const row=value as Results|null,record=(item:any)=>item&&typeof item==='object'&&!Array.isArray(item);
 const text=(item:unknown)=>typeof item==='string'&&item.trim().length>0;
 const nonnegative=(item:unknown)=>typeof item==='number'&&Number.isFinite(item)&&item>=0;
 const textList=(items:unknown)=>Array.isArray(items)&&items.every(text);
 const offering=(item:any)=>record(item)&&text(item.id)&&text(item.name)&&text(item.category);
 if(!record(row)||typeof row!.covered!=='boolean'||!Array.isArray(row!.services)||!Array.isArray(row!.home_services)||!Array.isArray(row!.professionals)
  ||!row!.services.every(item=>offering(item)&&nonnegative(item.price_paise)&&nonnegative(item.duration_minutes))
  ||!row!.home_services.every(offering)
  ||!row!.professionals.every(person=>record(person)&&text(person.id)&&text(person.name)&&textList(person.categories)&&textList(person.skills)
   &&['technician','specialist'].includes(person.role)&&nonnegative(person.distance_km)&&nonnegative(person.rating_count)&&Number.isInteger(person.rating_count)
   &&(person.rating===null||nonnegative(person.rating)&&person.rating<=5)))throw Error('Professional matches could not load.');
 return row!;
}
function service(row:any):Service{const art=seededServices.find(s=>s.id===row.id)||seededServices.find(s=>s.category===row.category);return {...row,price:row.price_paise,duration:row.duration_minutes,image:art?.image||'',imageTile:art?.imageTile,imageAlt:row.name};}
// Category photography illustrates the work; professional cards always use API records.
const categories=[{id:'ac',label:'AC & appliances',imageId:'ac-service'},{id:'plumber',label:'Plumbing',imageId:'plumbing'},{id:'electrician',label:'Electrical',imageId:'electrical'},{id:'cleaning',label:'Cleaning',imageId:'home-clean'},{id:'carpenter',label:'Carpentry',imageId:'carpentry'},{id:'car',label:'Car repair',imageId:'car-repair'}].map(item=>({...item,photo:seededServices.find(service=>service.id===item.imageId)!}));
const normalCategory=(value?:string|null)=>categories.some(c=>c.id===value)?value!:'ac';
const examples=[{category:'ac',label:'AC not cooling',query:'AC not cooling'},{category:'plumber',label:'Leaking tap',query:'leaking tap'},{category:'electrician',label:'Electrical repair',query:'electrical repair'},{category:'carpenter',label:'Door repair',query:'door repair'}];

export function QuickRepairFinder({location,accountKey,onLocation,onBook,onHome,onEvent,preferredCategory,active=true}:{location:TransportArea;accountKey:string;onLocation:()=>void;onBook:(service:Service,person?:{id:string;name:string})=>void;onHome:(service:string,person:{id:string;name:string})=>void;onEvent?:(event:DiscoveryEvent)=>void;preferredCategory?:string|null;active?:boolean}){
 const [query,setQuery]=useState(''),[request,setRequest]=useState({query:'',category:normalCategory(preferredCategory)}),[retry,setRetry]=useState(0);
 const [role,setRole]=useState(''),[expanded,setExpanded]=useState(false);
 const [state,setState]=useState<{key:string;data:Results|null;busy:boolean;error:string}>({key:'',data:null,busy:false,error:''});
 const touched=useRef(false),lastLoad=useRef({key:'',retry:0});
 const valid=location.confirmed&&Number.isFinite(location.lat)&&Number.isFinite(location.lng);
 const body={query:request.query,category:request.category,city:location.city||'',location:valid?{lat:location.lat,lng:location.lng}:null,radius_km:6,sort:'relevance',role};
 const key=accountKey+':'+JSON.stringify(body),shouldRead=active&&(valid||!!request.query);
 useEffect(()=>{if(!touched.current)setRequest({query:'',category:normalCategory(preferredCategory)});},[preferredCategory]);
 useEffect(()=>{touched.current=false;setQuery('');setRequest({query:'',category:normalCategory(preferredCategory)});setRole('');setState({key:'',data:null,busy:false,error:''});setExpanded(false);},[accountKey]);
 useEffect(()=>{
  if(!shouldRead)return;
  let alive=true;const force=lastLoad.current.key===key&&lastLoad.current.retry!==retry;lastLoad.current={key,retry};
  const cached=force?null:cache.peek(key,30000) as Results|null,earlier=cache.peek(key,300000) as Results|null;
  setState({key,data:cached,busy:!cached,error:''});
  void cache.read(key,async()=>{const response=await apiFetch('/api/operations/discovery/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)},{background:true,feedback:false});if(!response.ok)throw Error('Professionals could not load. Please try again.');return repairResults(await response.json());},{freshMs:30000,force})
   .then(data=>{if(alive)setState({key,data,busy:false,error:''});}).catch(()=>{if(alive)setState({key,data:earlier,busy:false,error:earlier?'Matches could not refresh. Showing earlier results; availability may have changed.':'Professional matches could not load. Check your connection and try again.'});});
  return()=>{alive=false;};
 },[key,shouldRead,retry]);
 const snapshot=state.key!==key&&shouldRead?cache.peek(key,30000) as Results|null:null;
 const current=state.key===key?state:{key,data:snapshot,busy:shouldRead&&!snapshot,error:''},data=current.data;
 const chooseCategory=(category:string)=>{touched.current=true;setQuery('');setRequest({query:'',category});setExpanded(false);onEvent?.({kind:'category_view',category});};
 const run=(text:string,category='')=>{const next=text.trim();if(!next)return;touched.current=true;setQuery(next);setRequest({query:next,category});setRetry(n=>n+1);setExpanded(false);onEvent?.({kind:'search',query:next,...(category?{category}:{})});};
 const submit=(event:FormEvent)=>{event.preventDefault();run(query);};
 const professionals=data?.professionals||[],shown=expanded?professionals:professionals.slice(0,2);
 const label=categories.find(c=>c.id===request.category)?.label;
 return <section className="quick-repair-finder" aria-label="Quick repair discovery">
  <div className="quick-repair-intro"><p>Choose a service or describe the work.</p></div>
  <div className="quick-repair-categories" role="group" aria-label="Repair category">{categories.map(({id,label,photo})=><button key={id} aria-pressed={request.category===id} onClick={()=>chooseCategory(id)}><span className="quick-repair-category-photo" aria-hidden="true"><ServiceImage service={photo} className="quick-repair-category-image" decorative/>{request.category===id&&<span className="quick-repair-category-check"><Check size={12}/></span>}</span><span>{label}</span></button>)}</div>
  <form onSubmit={submit}><label htmlFor="quick-repair-query" className="sr-only">Describe the work</label><div className="quick-repair-input"><Wrench size={18} aria-hidden="true"/><input id="quick-repair-query" type="search" required maxLength={120} value={query} onChange={event=>{touched.current=true;setQuery(event.target.value);}} placeholder="Describe your repair"/><button aria-label="Find help" aria-busy={current.busy&&!!request.query} type="submit"><Search size={17} aria-hidden="true"/><span>Find help</span></button></div></form>
  <details className="quick-repair-ideas"><summary>Try a quick search<ChevronDown size={14} aria-hidden="true"/></summary><div className="quick-repair-examples" role="group" aria-label="Repair ideas">{examples.map(item=><button key={item.category} aria-pressed={request.query===item.query} onClick={()=>run(item.query,item.category)}>{item.label}<ArrowRight size={14} aria-hidden="true"/></button>)}</div></details>
  {!valid&&<button className="discovery-area-button" onClick={onLocation}><MapPin size={16} aria-hidden="true"/>Set service location<ArrowRight size={15} aria-hidden="true"/></button>}
  {valid&&<div className="quick-repair-result-header"><h3>{label||'Matching professionals'}</h3><div className="quick-repair-role" role="group" aria-label="Professional type">{[{id:'',label:'All'},{id:'technician',label:'Agents'},{id:'specialist',label:'Specialists'}].map(item=><button key={item.id} aria-pressed={role===item.id} onClick={()=>{touched.current=true;setRole(item.id);setExpanded(false);}}>{item.label}</button>)}</div></div>}
  <ContractError error={current.error} onRetry={()=>setRetry(n=>n+1)}/>
  {current.busy&&<div className="discovery-state" role="status"><InteractionMotion kind="search" active={active}/><p>Finding nearby professionals…</p></div>}
  {data&&!current.busy&&<div className="quick-repair-results" aria-label="Repair search results">
   <p className="quick-repair-result-count" role="status">{professionals.length?`${professionals.length} professional${professionals.length===1?'':'s'} nearby`:data.services.length?`${data.services.length} listed services`:'No matching results'}</p>
   {!valid?<p>Choose your area to see nearby professionals.</p>:!data.covered?<p>Booking is not available in this city yet.</p>:!professionals.length?<p>No {role==='specialist'?'specialists':role==='technician'?'agents':'professionals'} available here right now.</p>:<><div className="quick-professional-grid" role="group" aria-label="Nearby repair professionals" tabIndex={0}>{shown.map(person=><RepairCandidate key={person.id} person={person} data={data} onBook={onBook} onHome={onHome}/>)}</div>{professionals.length>2&&<button className="quick-repair-show-more" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'Show fewer':`See all ${professionals.length} professionals`}<ChevronDown size={15} aria-hidden="true"/></button>}<p className="quick-repair-availability">Availability is confirmed when your request is accepted.</p></>}
   {!professionals.length&&data.services.slice(0,2).map(row=><button key={row.id} className="quick-repair-service" onClick={()=>onBook(service(row))}>{row.name}<ArrowRight size={16} aria-hidden="true"/></button>)}
   {!professionals.length&&!data.services.length&&<p>Try another repair category or search.</p>}
  </div>}
 </section>;
}

function RepairCandidate({person,data,onBook,onHome}:{person:Professional;data:Results;onBook:(s:Service,p?:{id:string;name:string})=>void;onHome:(s:string,p:{id:string;name:string})=>void}){
 const options=[...data.services.filter(s=>person.categories.includes(s.category)).map(s=>({...s,kind:'service',key:'service:'+s.id})),...data.home_services.filter(s=>person.categories.includes(s.category)).map(s=>({...s,kind:'home',key:'home:'+s.id}))];
 const [chosen,setChosen]=useState('');const choice=options.find(s=>s.key===chosen)||options[0];
 return <article className="quick-professional-card"><header><span className="repaidian-avatar-frame"><span className="quick-professional-avatar" aria-hidden="true">{person.name.split(' ').slice(0,2).map(word=>word[0]).join('')}</span><RepaidianBadge badge={person.repaidianBadge} variant="avatar"/></span><div><h3>{person.name}</h3><p>{person.role==='specialist'?'Specialist':'Agent'} · {person.distance_km} km</p></div><ShieldCheck size={17} aria-label="Approved professional"/></header><div className="quick-professional-meta"><p className="quick-professional-rating"><Star size={13} aria-hidden="true"/>{person.rating===null?'No reviews yet':person.rating+' · '+person.rating_count+' reviews'}</p><p className="quick-professional-skills">{person.skills.slice(0,3).join(' · ')}</p></div>{options.length>1&&<details className="quick-professional-service-choice"><summary>Service options<ChevronDown size={14} aria-hidden="true"/></summary><label>Work to request<select value={choice?.key||''} onChange={event=>setChosen(event.target.value)}>{options.map(s=><option key={s.key} value={s.key}>{s.name}</option>)}</select></label></details>}{choice?<button onClick={()=>choice.kind==='home'?onHome(choice.id,{id:person.id,name:person.name}):onBook(service(choice),{id:person.id,name:person.name})}>Request {person.name.split(' ')[0]}<ArrowRight size={15} aria-hidden="true"/></button>:<p>No matching bookable service is listed.</p>}</article>;
}
