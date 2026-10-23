import './compact-controls.css';
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {ArrowRight,Check,ChevronDown,MapPin,Search,ShieldCheck,Star,Tune,Wrench,X} from '../icons';
import {InteractionMotion} from './InteractionMotion';
import {apiFetch} from '../services/api';
import {createReadCache} from '../services/readCache.mjs';
import {formatMoney,seededServices} from '../data';
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


export function QuickRepairFinder({location,accountKey,onLocation,onBook,onHome,onEvent,preferredCategory,active=true}:{location:TransportArea;accountKey:string;onLocation:()=>void;onBook:(service:Service,person?:{id:string;name:string})=>void;onHome:(service:string,person:{id:string;name:string})=>void;onEvent?:(event:DiscoveryEvent)=>void;preferredCategory?:string|null;active?:boolean}){
 const queryId=useId();
 const [query,setQuery]=useState(''),[request,setRequest]=useState({query:'',category:normalCategory(preferredCategory)}),[retry,setRetry]=useState(0);
 const [role,setRole]=useState(''),[expanded,setExpanded]=useState(false),[servicesExpanded,setServicesExpanded]=useState(false);
 const [state,setState]=useState<{key:string;data:Results|null;busy:boolean;error:string}>({key:'',data:null,busy:false,error:''});
 const touched=useRef(false),lastCategory=useRef(normalCategory(preferredCategory)),lastLoad=useRef({key:'',retry:0});
 const valid=location.confirmed&&Number.isFinite(location.lat)&&Number.isFinite(location.lng);
 const body={query:request.query,category:request.category,city:location.city||'',location:valid?{lat:location.lat,lng:location.lng}:null,radius_km:6,sort:'relevance',role};
 const key=accountKey+':'+JSON.stringify(body),shouldRead=active&&(valid||!!request.query);
 useEffect(()=>setServicesExpanded(false),[key]);
 useEffect(()=>{if(!touched.current){lastCategory.current=normalCategory(preferredCategory);setRequest({query:'',category:lastCategory.current});}},[preferredCategory]);
 useEffect(()=>{touched.current=false;lastCategory.current=normalCategory(preferredCategory);setQuery('');setRequest({query:'',category:lastCategory.current});setRole('');setState({key:'',data:null,busy:false,error:''});setExpanded(false);},[accountKey]);
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
 const chooseCategory=(category:string)=>{touched.current=true;lastCategory.current=category;setQuery('');setRequest({query:'',category});setExpanded(false);onEvent?.({kind:'category_view',category});};
 const run=(text:string,category='')=>{const next=text.trim();if(!next)return;touched.current=true;setQuery(next);setRequest({query:next,category});setRetry(n=>n+1);setExpanded(false);onEvent?.({kind:'search',query:next,...(category?{category}:{})});};
 const submit=(event:FormEvent)=>{event.preventDefault();run(query);};
 const professionals=data?.professionals||[],shown=expanded?professionals:professionals.slice(0,2);
 const label=categories.find(c=>c.id===request.category)?.label;
 const clear=()=>{setQuery('');setRequest({query:'',category:lastCategory.current});setExpanded(false);};
 const resultCount=professionals.length?`${professionals.length} professional${professionals.length===1?'':'s'} nearby`:`${data?.services.length||0} listed services`;
 const noProfessionals=role==='specialist'?'No nearby specialists':role==='technician'?'No nearby agents':'No nearby professionals';
 return <section className="quick-repair-finder" aria-label="Quick repair discovery">
  <form onSubmit={submit} className="quick-repair-search-form">
   <label htmlFor={queryId} className="sr-only">Describe the work</label>
   <div className="quick-repair-input"><Search size={18} aria-hidden="true"/>
    <input id={queryId} type="search" required maxLength={120} value={query} onChange={event=>{touched.current=true;setQuery(event.target.value);}} placeholder="Describe the work"/>
    {query&&<button className="quick-repair-clear" type="button" aria-label="Clear repair search" onClick={clear}><X size={16} aria-hidden="true"/></button>}
    <button className="quick-repair-submit" aria-label="Find help" aria-busy={current.busy&&!!request.query} disabled={!query.trim()||(current.busy&&request.query===query.trim())} type="submit">Find help<ArrowRight size={16} aria-hidden="true"/></button>
   </div>
  </form>
  <div className="quick-repair-categories" role="group" aria-label="Repair category">{categories.map(({id,label,photo})=><button key={id} aria-pressed={request.category===id} onClick={()=>chooseCategory(id)}><span className="quick-repair-category-photo" aria-hidden="true"><ServiceImage service={photo} className="quick-repair-category-image" decorative/>{request.category===id&&<span className="quick-repair-category-check"><Check size={12}/></span>}</span><span>{label}</span></button>)}</div>
  {!valid&&<button className="discovery-area-button" onClick={onLocation}><MapPin size={16} aria-hidden="true"/>Set service location<ArrowRight size={16} aria-hidden="true"/></button>}
  {valid&&<div className="quick-repair-result-header">
   <div><h3>{label||'Search results'}</h3>{data&&!current.busy&&<p className="quick-repair-result-count" role="status">{resultCount}</p>}</div>
   <details className="quick-repair-filters"><summary><Tune size={16} aria-hidden="true"/>Filters{role&&<><span className="quick-repair-filter-indicator" aria-hidden="true">1</span><span className="sr-only"> · Professional type filter active</span></>}<ChevronDown size={14} aria-hidden="true"/></summary>
    <label className="quick-repair-filter">Professional type<select className="ui-compact-select" aria-label="Professional type" value={role} onChange={e=>{touched.current=true;setRole(e.target.value);setExpanded(false);}}><option value="">All professionals</option><option value="technician">Agents</option><option value="specialist">Specialists</option></select></label>
   </details>
  </div>}
  <ContractError error={current.error} onRetry={()=>setRetry(n=>n+1)}/>
  {current.busy&&<div className="discovery-state quick-repair-loading" role="status"><InteractionMotion kind="search" active={active}/><div><strong>Finding local help</strong><p>Matching your repair with nearby professionals…</p></div></div>}
  {data&&!current.busy&&<div key={key+':'+retry} className="quick-repair-results" aria-label="Repair search results">
   {(!valid||!data.covered||!professionals.length)?<div className="quick-repair-empty">
    <span className="quick-repair-empty-art" aria-hidden="true"><Wrench size={22}/><span><Search size={12}/></span></span>
    <div><strong>{!valid?'Choose your service area':!data.covered?'Not in your city yet':noProfessionals}</strong><p>{!valid?'Set a location to find local help.':!data.covered?'Booking is not available in this city yet.':data.services.length?'Review a listed service below. Availability is confirmed after acceptance.':'Try another category or describe the work differently.'}</p></div>
   </div>:<><div className="quick-professional-grid" role="group" aria-label="Nearby repair professionals">{shown.map(person=><RepairCandidate key={person.id} person={person} data={data} onBook={onBook} onHome={onHome}/>)}</div>{professionals.length>2&&<button className="quick-repair-show-more" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'Show fewer':`See all ${professionals.length} professionals`}<ChevronDown size={16} aria-hidden="true"/></button>}<p className="quick-repair-availability"><ShieldCheck size={14} aria-hidden="true"/>Availability is confirmed when your request is accepted.</p></>}
   {!professionals.length&&data.services.length>0&&<>
    <div className="quick-repair-service-list" id={queryId+'-services'}>{(servicesExpanded?data.services:data.services.slice(0,2)).map(row=><button key={row.id} className="quick-repair-service" onClick={()=>onBook(service(row))}>
     <span className="quick-repair-service-image" aria-hidden="true"><ServiceImage service={service(row)} decorative/></span>
     <span className="quick-repair-service-copy"><span>{row.name}</span><small><strong>{formatMoney(row.price_paise)}</strong>{row.duration_minutes>0&&<span> · {row.duration_minutes} min</span>}</small></span>
     <span className="quick-repair-service-arrow"><ArrowRight size={16} aria-hidden="true"/></span>
    </button>)}</div>
    {data.services.length>2&&<button type="button" className="quick-repair-show-more" aria-expanded={servicesExpanded} aria-controls={queryId+'-services'} onClick={()=>setServicesExpanded(value=>!value)}>{servicesExpanded?'Show fewer services':`View all ${data.services.length} services`}<ChevronDown size={16} aria-hidden="true"/></button>}
   </>}
  </div>}
 </section>;
}

function RepairCandidate({person,data,onBook,onHome}:{person:Professional;data:Results;onBook:(s:Service,p?:{id:string;name:string})=>void;onHome:(s:string,p:{id:string;name:string})=>void}){
 const options=[...data.services.filter(s=>person.categories.includes(s.category)).map(s=>({...s,kind:'service',key:'service:'+s.id})),...data.home_services.filter(s=>person.categories.includes(s.category)).map(s=>({...s,kind:'home',key:'home:'+s.id}))];
 const [chosen,setChosen]=useState('');const choice=options.find(s=>s.key===chosen)||options[0],choiceId=useId();
 return <article className="quick-professional-card"><header><span className="repaidian-avatar-frame"><span className="quick-professional-avatar" aria-hidden="true">{person.name.split(' ').slice(0,2).map(word=>word[0]).join('')}</span><RepaidianBadge badge={person.repaidianBadge} variant="avatar"/></span><div><h3>{person.name}</h3><p>{person.role==='specialist'?'Specialist':'Agent'} · {person.distance_km} km</p></div><ShieldCheck size={18} aria-label="Approved professional"/></header><div className="quick-professional-meta"><p className="quick-professional-rating"><Star size={14} aria-hidden="true"/>{person.rating===null?'No reviews yet':person.rating+' · '+person.rating_count+(person.rating_count===1?' review':' reviews')}</p></div>{choice&&<p className="quick-professional-offering" id={choiceId}><span>{choice.name}</span><strong>{choice.kind==='home'?'Quote first':formatMoney(choice.price_paise)}</strong></p>}{(options.length>1||person.skills.length>0)&&<details className="quick-professional-service-choice"><summary>{options.length>1?'Service options':'Skills'}<ChevronDown size={14} aria-hidden="true"/></summary>{options.length>1&&<label>Work to request<select className="ui-compact-select" value={choice?.key||''} onChange={event=>setChosen(event.target.value)}>{options.map(s=><option key={s.key} value={s.key}>{s.name}{s.kind==='home'?' · Quote first':` · ${formatMoney(s.price_paise)}`}</option>)}</select></label>}{person.skills.length>0&&<p className="quick-professional-skills">{person.skills.join(' · ')}</p>}</details>}{choice?<button aria-describedby={choiceId} onClick={()=>choice.kind==='home'?onHome(choice.id,{id:person.id,name:person.name}):onBook(service(choice),{id:person.id,name:person.name})}>Request {person.name.split(' ')[0]}<ArrowRight size={16} aria-hidden="true"/></button>:<p>No matching bookable service is listed.</p>}</article>;
}
