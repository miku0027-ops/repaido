import './market-refinement.css';
import {lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {Gavel,Building2,GraduationCap,Hotel,House,HeartPulse,Store,Factory,Warehouse,Truck,HardHat,Zap,Wrench,Droplets,AirVent,Sun,Radio,Shield,TreePine,Waves,Paintbrush,BriefcaseBusiness,MapPin,Users,Clock,ArrowUpRight,ChevronRight,Search,Calculator,LockKeyhole,Trophy,Boxes,RefreshCw,SlidersHorizontal,X,FileText,CalendarDays,Plus} from 'lucide-react';
import {apiFetch} from '../services/api';
import {auth} from '../firebase';
import {onIdTokenChanged} from 'firebase/auth';
import {Modal} from './ui';
import {BusinessPageHeader,InlineNotice,BusinessEmptyState} from './BusinessUI';
import {PrivateProjectForm} from './PrivateProjectForm';
import {PrivateWorkOpportunities} from './PrivateWorkOpportunities';
import {ContractorPortal} from './ContractorPortal';
import {ContractRecommendations,ContractWatch} from './ContractWatch';
import './contract-work.css';
import './tender-market.css';
const MatchedContractTenders=lazy(()=>import('./ContractOpportunities').then(module=>({default:module.MatchedContractTenders})));

const sectors=[
 {name:'All sectors',Icon:Gavel,copy:'Find published work across industries.'},
 {name:'Real estate',Icon:Building2,copy:'Coordinate property maintenance, fit-outs and handover work.'},
 {name:'Education',Icon:GraduationCap,copy:'Plan campus repairs, electrical upkeep and facility maintenance.'},
 {name:'Hospitality',Icon:Hotel,copy:'Build teams for property refreshes and recurring facility support.'},
 {name:'Home services',Icon:House,copy:'Organise long-term maintenance for homes and residential communities.'},
 {name:'Healthcare',Icon:HeartPulse,copy:'Plan non-clinical facility maintenance and fit-outs for healthcare properties.'},
 {name:'Retail',Icon:Store,copy:'Coordinate shop fit-outs, repairs and multi-location maintenance.'},
 {name:'Office spaces',Icon:BriefcaseBusiness,copy:'Organise office interiors, workspace repairs and recurring upkeep.'},
 {name:'Manufacturing',Icon:Factory,copy:'Explore industrial facility maintenance and installation scopes.'},
 {name:'Warehousing',Icon:Warehouse,copy:'Plan warehouse fit-outs, storage-area maintenance and facility repairs.'},
 {name:'Logistics',Icon:Truck,copy:'Coordinate depot facilities, loading areas and logistics-site maintenance.'},
 {name:'Construction',Icon:HardHat,copy:'Prepare teams for civil works, site execution and construction milestones.'},
 {name:'Electrical',Icon:Zap,copy:'Explore wiring, lighting, electrical installation and maintenance scopes.'},
 {name:'Plumbing',Icon:Droplets,copy:'Plan plumbing installations, pipe repairs and drainage maintenance.'},
 {name:'HVAC',Icon:AirVent,copy:'Coordinate cooling, ventilation and air-conditioning maintenance contracts.'},
 {name:'Solar energy',Icon:Sun,copy:'Explore solar installation, inspection and scheduled maintenance scopes.'},
 {name:'Telecom',Icon:Radio,copy:'Plan structured cabling, connectivity infrastructure and site support.'},
 {name:'Security systems',Icon:Shield,copy:'Coordinate CCTV, access-control installation and system maintenance.'},
 {name:'Landscaping',Icon:TreePine,copy:'Organise garden development, groundskeeping and outdoor maintenance.'},
 {name:'Water systems',Icon:Waves,copy:'Plan water storage, pumping, filtration and treatment-system maintenance.'},
 {name:'Interior design',Icon:Paintbrush,copy:'Explore interior planning, finishing, furnishing and renovation scopes.'},
];

type Phase='all'|'upcoming'|'bidding'|'decision';
type Tender={id:string;title:string;city:string;sector:string;status:string;phase?:Exclude<Phase,'all'>;scope?:string;site?:string;budget_paise:number;manpower_needed:number;bids_count?:number;opens_at:number;deadline:number;starts_at:number;ends_at:number;terms?:string};
type Overview={contracts:{id:string;title:string;sector:string;city:string;status:string}[];leaders:{id:string;name:string;city:string;completed:number}[]};
type Published={tenders:Tender[];total:number|null;has_more:boolean;next_cursor:string|null;server_time:number};
const money=(paise:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:0,maximumFractionDigits:2}).format(paise/100);
const date=(time:number)=>new Date(time*1000).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short',timeZone:'Asia/Kolkata'});
const shortDate=(time:number)=>new Date(time*1000).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});
const actorScope=()=>auth.currentUser?.uid||localStorage.getItem('repaido.token')||'';
const stage=(t:Tender,now:number)=>t.status!=='open'?t.status:now<t.opens_at?'Upcoming':now<t.deadline?'Bidding open':'Awaiting decision';
async function publicRead<T>(path:string,signal?:AbortSignal):Promise<T>{
 const response=await apiFetch('/api/operations/contractor'+path,{signal},{background:true});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.detail?.message||'Opportunities could not load. Check your connection and retry.');
 return data as T;
}

export function TendersPlatform({onOpenContractorPortal,onOpenB2BMarket,initialTenderId}:{onOpenContractorPortal:(tenderId?:string)=>void;onOpenB2BMarket?:()=>void;initialTenderId?:string}){
 const [suggestionsOpen,setSuggestionsOpen]=useState(false),[phaseOpen,setPhaseOpen]=useState(false);
 const [showSectors,setShowSectors]=useState(false),[savedSectors,setSavedSectors]=useState<string[]>([]);
 const [rows,setRows]=useState<Tender[]>([]),[privateState,setPrivateState]=useState<{actor:string;rows:Tender[];allowed:boolean}>({actor:'',rows:[],allowed:false}),[total,setTotal]=useState<number|null>(null),[cursor,setCursor]=useState<string|null>(null);
 const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[sector,setSector]=useState('All sectors'),[phase,setPhase]=useState<Phase>('all');
 const [error,setError]=useState(''),[busy,setBusy]=useState(true),[moreBusy,setMoreBusy]=useState(false),[accessPending,setAccessPending]=useState(true),[accessError,setAccessError]=useState(''),[selected,setSelected]=useState<Tender|null>(null);
 const [overview,setOverview]=useState<Overview>({contracts:[],leaders:[]}),[overviewError,setOverviewError]=useState(''),[revision,setRevision]=useState(0);
 const [estimate,setEstimate]=useState(false),[quote,setQuote]=useState(''),[cost,setCost]=useState(''),[reserve,setReserve]=useState(''),[intentError,setIntentError]=useState('');
 const [privateForm,setPrivateForm]=useState(false),[privateProject,setPrivateProject]=useState<string|null>(null);
 const [clock,setClock]=useState({server:Date.now()/1000,at:performance.now()}),[tick,setTick]=useState(0);
 const sawFirebase=useRef(!!auth.currentUser);
 const currentActor=()=>auth.currentUser?.uid||(!sawFirebase.current?localStorage.getItem('repaido.token')||'':'');
 const [actor,setActor]=useState(actorScope),[authRevision,setAuthRevision]=useState(0);
 const privateGeneration=useRef(0),filterContext=useRef(''),lastAuthActor=useRef(actorScope());
 const privateRows=privateState.actor===actor&&actor===currentActor()?privateState.rows:[];
 const access=privateState.actor===actor&&actor===currentActor()&&privateState.allowed;
 const sectorRail=useRef<HTMLElement>(null);
 const generation=useRef(0),handledTenderId=useRef<string|undefined>(undefined);
 useEffect(()=>{
  if(showSectors)return;const rail=sectorRail.current,button=rail?.querySelector<HTMLElement>('[aria-pressed=true]');if(!rail||!button)return;
  const bounds=rail.getBoundingClientRect(),selectedBounds=button.getBoundingClientRect();
  if(selectedBounds.left<bounds.left+4)rail.scrollTo({left:rail.scrollLeft+selectedBounds.left-bounds.left-4,behavior:'instant'});
  else if(selectedBounds.right>bounds.right-4)rail.scrollTo({left:rail.scrollLeft+selectedBounds.right-bounds.right+4,behavior:'instant'});
 },[sector,showSectors]);
 const now=clock.server+(performance.now()-clock.at)/1000;
 useEffect(()=>{const timer=setInterval(()=>setTick(v=>v+1),30000);return()=>clearInterval(timer);},[]);
 void tick;
 useEffect(()=>{
  const changed=()=>{const nextActor=currentActor();if(nextActor!==lastAuthActor.current){setPrivateForm(false);setPrivateProject(null);lastAuthActor.current=nextActor;}privateGeneration.current++;setPrivateState({actor:'',rows:[],allowed:false});setAccessError('');setAccessPending(true);if(auth.currentUser)sawFirebase.current=true;setActor(currentActor());setAuthRevision(value=>value+1);};
  const unsubscribe=onIdTokenChanged(auth,changed);
  const storage=(event:StorageEvent)=>{if(event.key==='repaido.token'||event.key===null)changed();};
  window.addEventListener('storage',storage);window.addEventListener('repaido:identity-changed',changed);
  return()=>{unsubscribe();window.removeEventListener('storage',storage);window.removeEventListener('repaido:identity-changed',changed);};
 },[]);
 useEffect(()=>{const timer=setTimeout(()=>setSearch(query.trim()),250);return()=>clearTimeout(timer);},[query]);
 useEffect(()=>{
  const controller=new AbortController();let active=true;
  void publicRead<{sectors:string[]}>('/sectors',controller.signal).then(d=>{if(active)setSavedSectors(d.sectors);}).catch(()=>{});
  void publicRead<Overview>('/overview',controller.signal).then(d=>{if(active){setOverview(d);setOverviewError('');}}).catch(e=>{if(active)setOverviewError(e.message);});
  return()=>{active=false;controller.abort();};
 },[revision]);
 useEffect(()=>{
  const controller=new AbortController(),current=++privateGeneration.current,captured=actor;
  const valid=()=>!controller.signal.aborted&&current===privateGeneration.current&&captured===currentActor();
  setAccessPending(true);setAccessError('');setPrivateState({actor:captured,rows:[],allowed:false});
  void(async()=>{
   try{
    await auth.authStateReady();if(!valid())return;
    const token=auth.currentUser?await auth.currentUser.getIdToken():localStorage.getItem('repaido.token');
    if(!valid()||!token)return;
    const response=await apiFetch('/api/operations/contractor/opportunities',{signal:controller.signal,headers:{Authorization:`Bearer ${token}`}},{background:true});
    if(!valid())return;
    if(response.ok){const d=await response.json();if(valid())setPrivateState({actor:captured,rows:d.tenders,allowed:true});}
    else if(![401,403].includes(response.status))setAccessError('Contractor access could not be checked. Retry to load your full scope.');
   }catch{if(valid())setAccessError('Contractor access could not be checked. Retry to load your full scope.');}
   finally{if(valid())setAccessPending(false);}
  })();
  return()=>controller.abort();
 },[actor,authRevision,revision]);
 const requestPage=useCallback((nextCursor?:string,signal?:AbortSignal)=>{
  const params=new URLSearchParams({limit:'24',phase,query:search});
  if(sector!=='All sectors')params.set('sector',sector);
  if(nextCursor)params.set('cursor',nextCursor);
  return publicRead<Published>('/published?'+params.toString(),signal);
 },[sector,phase,search]);
 useEffect(()=>{
  const current=++generation.current,controller=new AbortController();
  const context=JSON.stringify([sector,phase,search]);if(filterContext.current!==context){setRows([]);setTotal(0);setCursor(null);filterContext.current=context;}
  setBusy(true);setError('');setMoreBusy(false);
  void requestPage(undefined,controller.signal).then(d=>{if(current===generation.current){setRows(d.tenders);setTotal(d.total);setCursor(d.next_cursor);setClock({server:d.server_time,at:performance.now()});}}).catch(e=>{if(!controller.signal.aborted&&current===generation.current)setError(e.message);}).finally(()=>{if(current===generation.current)setBusy(false);});
  return()=>controller.abort();
 },[requestPage,revision]);
 const loadMore=async()=>{
  if(!cursor||moreBusy)return;const current=generation.current;setMoreBusy(true);setError('');
  try{const d=await requestPage(cursor);if(current===generation.current){setRows(previous=>[...previous,...d.tenders.filter(row=>!previous.some(p=>p.id===row.id))]);setTotal(d.total);setCursor(d.next_cursor);setClock({server:d.server_time,at:performance.now()});}}
  catch(e){if(current===generation.current)setError((e as Error).message);}finally{if(current===generation.current)setMoreBusy(false);}
 };
 useEffect(()=>{
  if(!initialTenderId){handledTenderId.current=undefined;setIntentError('');return;}
  if(handledTenderId.current===initialTenderId)return;handledTenderId.current=initialTenderId;
  let active=true;void publicRead<{tender:Tender}>('/published/'+encodeURIComponent(initialTenderId)).then(d=>{if(active)setSelected(d.tender);}).catch(e=>{if(active)setIntentError(e.message);});
  return()=>{active=false;};
 },[initialTenderId]);
 const detail=selected&&(privateRows.find(row=>row.id===selected.id)||selected);
 const extraSectors=[...new Set([...savedSectors,...rows.map(t=>t.sector)])].filter(s=>!sectors.some(c=>c.name===s));
 const contracts=overview.contracts.filter(p=>sector==='All sectors'||p.sector===sector);
 const amount=Number(quote)-Number(cost)-Number(reserve),valid=quote!==''&&cost!==''&&[quote,cost,reserve||'0'].every(v=>Number.isFinite(Number(v)))&&Number(quote)>0&&Number(cost)>=0&&Number(reserve)>=0;
 const reset=()=>{setQuery('');setSearch('');setSector('All sectors');setPhase('all');};
 return <section className="tender-market" aria-label="Contracts marketplace">
  <BusinessPageHeader eyebrow="Repaido contracts" title="Your next project starts here." icon={<Gavel size={16} aria-hidden="true"/>} actions={<button className="contract-primary" onClick={()=>onOpenContractorPortal(initialTenderId)}>Workspace<ArrowUpRight size={15}/></button>}/>
  <div className="tender-quick-actions" aria-label="Contract tools">{actor&&<button onClick={()=>setSuggestionsOpen(true)}>For you</button>}<button onClick={()=>setPrivateForm(true)}><Plus size={16}/>Private work request</button><button onClick={()=>setEstimate(true)}><Calculator size={16}/>Bid planner</button>{onOpenB2BMarket&&<button onClick={onOpenB2BMarket}><Boxes size={16}/>Materials</button>}<button onClick={()=>setRevision(v=>v+1)} disabled={busy} aria-label="Refresh opportunities"><RefreshCw size={16}/></button></div>
  {actor&&suggestionsOpen&&<Modal title="Your opportunity suggestions" onClose={()=>setSuggestionsOpen(false)}><ContractRecommendations key={actor} sector={sector==='All sectors'?'':sector} query={search} onOpen={id=>{void publicRead<{tender:Tender}>('/published/'+encodeURIComponent(id)).then(data=>setSelected(data.tender)).catch(error=>setIntentError(error.message));}}/></Modal>}
  {access&&<Suspense fallback={<p role="status">Finding matched customer contracts…</p>}><MatchedContractTenders key={actor} accountKey={actor} authenticated onOpenProject={id=>setPrivateProject(id)}/></Suspense>}
  <section className="tender-discovery" aria-labelledby="tender-discovery-title">
   <div className="tender-section-heading"><div><h2 id="tender-discovery-title">Explore opportunities</h2><p>Choose a sector or search for work near you.</p></div><button aria-expanded={showSectors} aria-controls="contract-sector-options" onClick={()=>setShowSectors(v=>!v)}><SlidersHorizontal size={17}/>{showSectors?'Compact view':'All sectors'}</button></div>
   <nav ref={sectorRail} id="contract-sector-options" className={`tender-sector-rail ${showSectors?'tender-sector-grid':''}`} aria-label="Contract sectors">{sectors.map(({name,Icon})=><button key={name} aria-pressed={sector===name} onClick={()=>setSector(name)}><Icon size={18} aria-hidden="true"/><span>{name}</span></button>)}{extraSectors.map(name=><button key={name} aria-pressed={sector===name} onClick={()=>setSector(name)}><Gavel size={18} aria-hidden="true"/><span>{name}</span></button>)}</nav>
   <div className="tender-sector-note">{sectors.find(s=>s.name===sector)?.copy||'Explore published opportunities for this trade.'}</div>
   <div className="tender-filter-bar"><label className="tender-search"><Search size={18} aria-hidden="true"/><input type="search" aria-label="Search contract opportunities" placeholder="Project, city or sector" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="Clear contract search" onClick={()=>setQuery('')}><X size={18}/></button>}</label><button className="market-info-button" aria-label="Filter bidding stage" aria-pressed={phase!=='all'} onClick={()=>setPhaseOpen(true)}><SlidersHorizontal size={18}/></button>{phaseOpen&&<Modal title="Bidding stage" onClose={()=>setPhaseOpen(false)}><label className="tender-phase-filter">Bidding stage<select value={phase} onChange={e=>setPhase(e.target.value as Phase)}><option value="all">All published</option><option value="bidding">Bidding open</option><option value="upcoming">Upcoming</option><option value="decision">Awaiting decision</option></select></label><button className="ops-primary" onClick={()=>setPhaseOpen(false)}>Apply filter</button></Modal>}</div>
   {intentError&&<InlineNotice tone="error">{intentError}</InlineNotice>}
   {error&&<InlineNotice tone="error" action={<button onClick={()=>setRevision(v=>v+1)}>Retry</button>}>{error}</InlineNotice>}
   <div className="tender-results-heading"><span role="status">{busy?'Loading opportunities…':total==null?`${rows.length} ${rows.length===1?'opportunity':'opportunities'} loaded${cursor?' · more available':''}`:`${total} published ${total===1?'opportunity':'opportunities'}`}</span>{(sector!=='All sectors'||search||phase!=='all')&&<button onClick={reset}>Clear filters</button>}</div>
   <div className="tender-cards" aria-busy={busy}>{rows.map(t=>{const Icon=sectors.find(s=>s.name===t.sector)?.Icon||Gavel;return <article className="tender-opportunity" key={t.id}><div className="tender-card-heading"><span className="tender-category-icon"><Icon size={23} aria-hidden="true"/></span><span className="contract-chip" data-phase={stage(t,now)}>{stage(t,now)}</span></div><p className="tender-card-sector">{t.sector}</p><h3>{t.title}</h3><p className="tender-location"><MapPin size={16}/>{t.city}</p><div className="tender-budget"><small>Published budget</small><strong>{money(t.budget_paise)}</strong></div><dl className="tender-card-facts"><div><dt><Users size={16}/>Required team</dt><dd>{t.manpower_needed} {t.manpower_needed===1?'agent':'agents'}</dd></div><div><dt><Clock size={16}/>{now<t.opens_at?'Bidding opens':'Bidding closes'}</dt><dd>{shortDate(now<t.opens_at?t.opens_at:t.deadline)}</dd></div></dl><button className="tender-card-action" onClick={()=>setSelected(t)}>View opportunity<ChevronRight size={18}/></button></article>;})}</div>
   {!busy&&!error&&!rows.length&&<BusinessEmptyState icon={<Gavel size={28}/>} title={cursor?'More opportunities to check':search||sector!=='All sectors'||phase!=='all'?'No matching opportunities':'No tenders published yet'} description={cursor?'No matches in this set. Load the next set to continue your search.':search||sector!=='All sectors'||phase!=='all'?'Try another sector, stage or city. Only actual published tenders appear here.':'Project owners can publish a tender from their workspace. New opportunities will appear here when available.'} action={!cursor&&<button onClick={search||sector!=='All sectors'||phase!=='all'?reset:()=>onOpenContractorPortal()}>{search||sector!=='All sectors'||phase!=='all'?'Clear filters':'Open workspace'}<ArrowUpRight size={17}/></button>}/>}
   {cursor&&!busy&&<div className="tender-load-more"><span>{rows.length} loaded{total==null?'':` of ${total}`} · more available</span><button disabled={moreBusy} onClick={()=>void loadMore()}>{moreBusy?'Loading…':'Load more opportunities'}</button></div>}
  </section>
  {actor&&<PrivateWorkOpportunities key={actor} query={search} sector={sector==='All sectors'?'':sector}/>}
  {!access&&!accessPending&&!accessError&&<InlineNotice action={<button onClick={()=>onOpenContractorPortal(initialTenderId)}>Complete profile<ArrowUpRight size={17}/></button>}><strong>Ready to bid?</strong><p>A verified mobile number and contractor approval unlock private scope, team planning and bid submission. Browsing summaries is open to everyone.</p></InlineNotice>}
  {accessError&&<InlineNotice tone="error" action={<button onClick={()=>setRevision(v=>v+1)}>Retry access check</button>}>{accessError}</InlineNotice>}
  <details className="tender-process"><summary><FileText size={16}/>From opportunity to an accepted team</summary><ol>{[['Find & plan','Compare sector, location, deadlines and requirements.'],['Prepare & bid','Plan your crew and submit a proposal if a tender requires one.'],['Publish roles','Open a project, then publish skills, dates and joining terms.'],['Review & offer','Compare relevant skills and application order; shortlist, hold or send an offer.'],['Accept & deliver','The agent accepts the terms before joining. Track work and milestones together.']].map(([label,copy],index)=><li key={label}><span>{index+1}</span><div><strong>{label}</strong><p>{copy}</p></div></li>)}</ol></details>
  <div className="tender-records-grid"><section><div className="tender-section-heading"><h2>Recorded contracts</h2><span>{contracts.length}</span></div>{overviewError?<InlineNotice tone="error" action={<button onClick={()=>setRevision(v=>v+1)}>Retry</button>}>{overviewError}</InlineNotice>:contracts.length?contracts.map(p=><article className="tender-record" key={p.id}><div><h3>{p.title}</h3><p>{p.sector} · {p.city}</p></div><span className="contract-chip">{p.status}</span></article>):<p className="tender-record-empty">Awarded project updates appear here after an owner records a decision.</p>}</section><section className="tender-leaders"><div className="tender-section-heading"><h2><Trophy size={19}/>Completed contracts</h2></div><p>Contractors ranked by completed contracts awarded through Repaido.</p>{overview.leaders.map((p,i)=><div className="tender-leader" key={p.id}><b aria-label={`Rank ${i+1}`}>#{i+1}</b><span><strong>{p.name}</strong><small>{p.city}</small></span><span><strong>{p.completed}</strong><small>completed</small></span></div>)}{!overview.leaders.length&&<p className="tender-record-empty">{overviewError?'Completed contract records could not load. Use Retry above.':'No completed awarded contracts have been recorded yet.'}</p>}</section></div>
  {estimate&&<Modal title="Bid planner" className="tender-modal" onClose={()=>setEstimate(false)}><div className="contract-form"><p>Use your own estimates before you submit a proposal.</p>{[['Your quote (₹)',quote,setQuote],['Estimated total costs (₹)',cost,setCost],['Contingency reserve (₹)',reserve,setReserve]].map(([label,value,setter])=><label key={label as string}>{label as string}<input type="number" min="0" step="0.01" max="500000000" value={value as string} onChange={e=>(setter as (v:string)=>void)(e.target.value)}/></label>)}{valid&&<output className="tender-estimate"><small>Quote − costs − contingency</small><strong>{money(Math.round(amount*100))}</strong><span>{(amount/Number(quote)*100).toFixed(1)}% of your quote</span></output>}<p className="contract-fineprint">Include applicable taxes, materials, fees and delivery costs. This calculation does not submit a bid or guarantee profit.</p></div></Modal>}
  {detail&&<Modal title={detail.title} className="tender-modal contract-dialog" onClose={()=>setSelected(null)}><div className="contract-detail"><div className="contract-detail-summary"><span className="contract-chip" data-phase={stage(detail,now)}>{stage(detail,now)}</span><p><MapPin size={17}/>{detail.city} · {detail.sector}</p><div className="tender-budget"><small>Published budget · owner estimate</small><strong>{money(detail.budget_paise)}</strong></div></div><dl className="tender-detail-facts"><div><dt>Required team</dt><dd>{detail.manpower_needed} agents required</dd></div><div><dt>Bidding opens</dt><dd>{date(detail.opens_at)}</dd></div><div><dt>Bidding closes</dt><dd>{date(detail.deadline)}</dd></div><div><dt>Work starts</dt><dd>{date(detail.starts_at)}</dd></div><div><dt>Work ends</dt><dd>{date(detail.ends_at)}</dd></div></dl>{actor&&<ContractWatch key={actor+detail.id} tenderId={detail.id}/>}<details className="tender-dates"><summary><CalendarDays size={16}/>Important dates & project timeline</summary><ol>{[["Bidding opens",detail.opens_at],["Applications close",detail.deadline],["Work starts",detail.starts_at],["Work ends",detail.ends_at]].map(([label,at])=><li key={String(label)}><strong>{String(label)}</strong><time dateTime={new Date(Number(at)*1000).toISOString()}>{date(Number(at))}</time></li>)}</ol></details>{detail.scope?<><details open><summary><FileText size={18}/>Scope & site</summary><p>{detail.scope}</p><p>{detail.site}</p></details><details><summary>Eligibility & terms</summary><p>{detail.terms}</p></details></>:accessPending?<p role="status" className="contract-loading">Checking your contractor access…</p>:accessError?<InlineNotice tone="error" action={<button onClick={()=>setRevision(v=>v+1)}>Retry</button>}>{accessError}</InlineNotice>:<InlineNotice><LockKeyhole size={18}/><strong>Full scope is available to approved contractors</strong><p>Complete your profile and verify your mobile number to view the site, evaluation terms and bid requirements.</p></InlineNotice>}<p className="contract-fineprint">The published budget is an owner estimate. An accepted invitation or submitted bid does not mean the contract has been awarded.</p><div className="contract-actions"><button className="contract-primary" onClick={()=>onOpenContractorPortal(detail.id)}>{detail.phase==='decision'||now>=detail.deadline?'Open tender workspace':access?'Prepare team & bid':'Review contractor access'}<ArrowUpRight size={17}/></button>{onOpenB2BMarket&&<button onClick={()=>{setSelected(null);onOpenB2BMarket();}}><Boxes size={18}/>Source materials</button>}</div></div></Modal>}
  {privateForm&&<PrivateProjectForm onClose={()=>setPrivateForm(false)} onCreated={id=>{setPrivateForm(false);setPrivateProject(id);}}/>}
  {privateProject&&<Modal title="Your private work request" className="contract-dialog" onClose={()=>setPrivateProject(null)}><ContractorPortal initialTab="Hiring" initialProjectId={privateProject}/></Modal>}
 </section>;
}
export default TendersPlatform;
