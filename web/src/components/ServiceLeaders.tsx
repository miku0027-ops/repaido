import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {ArrowRight,ChevronDown,MapPin,Pause,Play,RefreshCw,VerifiedUser,Star,Trophy,User} from '../icons';
import {apiAssetUrl} from '../services/api';
import {cachedCategoryLeaders,cachedHireProfilesSnapshot,categoryLeaders,hireProfiles} from '../services/hireProfileCache';
import {categories} from '../data';
import {Modal} from './ui';
import {ProfessionalDetails,type Professional} from './Hiring';
import {ProfessionalQuickActions} from './ProfessionalQuickActions';
import './service-leaders.css';
import {RepaidianBadge} from './RepaidianBadge';
import './repaidian-professional.css';

interface Props {
  city:string;
  category:string;
  initialLocation?:{lat:number;lng:number;city:string};
  role?:'all'|'technician'|'specialist';
  radiusKm?:number;
  categoryIds?:string[];
  initiallyExpanded?:boolean;
  onSelectCategory?:(category:string)=>void;
}
type LeaderCategory={id:string;name:string;count:number;leader:Pick<Professional,'id'|'name'|'portrait_url'|'role'|'repaidianBadge'>|null};
type Leaderboard={professionals:Professional[];total:number;categories:LeaderCategory[]};

/** Category-specific, approved public profiles. Browsing never creates a booking. */
export default function ServiceLeaders({city,category,initialLocation,role='all',radiusKm=6,categoryIds,initiallyExpanded=false,onSelectCategory}:Props){
  const overview=category==='all';
  const ambient=useRef<HTMLElement>(null);
  const [motionPaused,setMotionPaused]=useState(false),[motionVisible,setMotionVisible]=useState(false),[reducedMotion,setReducedMotion]=useState(false);
  useEffect(()=>{
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const sync=()=>setReducedMotion(media.matches||document.documentElement.classList.contains('reduce-motion'));
    const visibility=()=>{if(document.hidden)setMotionVisible(false);else if(ambient.current){const r=ambient.current.getBoundingClientRect();setMotionVisible(r.bottom>0&&r.top<innerHeight);}};
    sync();media.addEventListener('change',sync);document.addEventListener('visibilitychange',visibility);
    const mutation=new MutationObserver(sync);mutation.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
    const observer=new IntersectionObserver(rows=>setMotionVisible(!document.hidden&&!!rows[0]?.isIntersecting));if(ambient.current)observer.observe(ambient.current);
    return()=>{media.removeEventListener('change',sync);document.removeEventListener('visibilitychange',visibility);mutation.disconnect();observer.disconnect();};
  },[overview]);
  const [open,setOpen]=useState(initiallyExpanded),[selected,setSelected]=useState<Professional|null>(null);
  const [result,setResult]=useState<{key:string;rows:Professional[];total:number;categories:LeaderCategory[];updatedAt:number|null}|null>(null);
  const [error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [refreshing,setRefreshing]=useState(false);
  const lastRetry=useRef(0);
  const id=useId();
  const location=initialLocation?.city===city?initialLocation:undefined;
  const requestKey=JSON.stringify([category,city,location?.lat,location?.lng,role,radiusKm]);
  const body=useMemo(()=>({city,category:overview?'':category,role,location:location?{lat:location.lat,lng:location.lng}:null,radius_km:radiusKm}),[requestKey]);
  // Read the bounded in-memory snapshot during render. A remount or quick
  // category switch should not flash a loading panel before an effect runs.
  const warm=useMemo(()=>overview?cachedCategoryLeaders<Leaderboard>(body):cachedHireProfilesSnapshot<Leaderboard>(body),[body]);
  const current=result?.key===requestKey?result:warm?{key:requestKey,rows:warm.value.professionals,total:warm.value.total,categories:warm.value.categories,updatedAt:warm.updatedAt}:null;
  const rows=current?.rows||[];
  const loading=!current&&!error;
  const name=categories.find(c=>c.id===category)?.name||category.replaceAll('-',' ');
  useEffect(()=>{
    if(!category)return;
    let active=true;setError('');setSelected(null);
    const force=retry!==lastRetry.current;
    lastRetry.current=retry;
    const apply=(data:Leaderboard,updatedAt:number|null)=>setResult({key:requestKey,rows:data.professionals.filter(p=>overview||p.categories?.includes(category)||(category.startsWith('home:')&&p.home_services?.includes(category.slice(5)))),total:data.total,categories:data.categories,updatedAt});
    const cached=overview?cachedCategoryLeaders<Leaderboard>(body):cachedHireProfilesSnapshot<Leaderboard>(body);
    if(cached){apply(cached.value,cached.updatedAt);}
    else setResult(null);
    let sequence=0;
    const load=async(fresh=false)=>{
      const current=++sequence;setRefreshing(true);
      try{const data=await (overview?categoryLeaders<Leaderboard>(body,fresh):hireProfiles<Leaderboard>(body,fresh));if(active&&current===sequence){const received=overview?cachedCategoryLeaders<Leaderboard>(body):cachedHireProfilesSnapshot<Leaderboard>(body);apply(data,received?.updatedAt??Date.now());setError('');}}
      catch(error){if(active&&current===sequence)setError((error as Error).message);}
      finally{if(active&&current===sequence)setRefreshing(false);}
    };
    void load(force);
    const refresh=()=>{if(!document.hidden)void load(true);};
    const timer=setInterval(refresh,30000);
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);window.addEventListener('repaido:operations-updated',refresh);
    return()=>{active=false;sequence++;clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('repaido:operations-updated',refresh);};
  },[requestKey,retry]);
  if(!category)return null;
  const count=current?.total||0;
  const refreshButton=<button type="button" className="catalog-leaders-refresh" disabled={refreshing} aria-label="Refresh category leaders" onClick={()=>setRetry(v=>v+1)}><RefreshCw size={20} aria-hidden="true"/></button>;
  if(overview){
    const allowed=new Set(categoryIds?.length?categoryIds:categories.map(c=>c.id));
    const leaders=(current?.categories||[]).filter(c=>allowed.has(c.id)&&c.count>0);
    return <section ref={ambient} data-animated={motionVisible&&!motionPaused&&!reducedMotion} className="catalog-professionals catalog-leaders-overview" aria-label="Category leaders" aria-busy={loading}>
      <header className="catalog-leaders-heading"><span className="catalog-professionals-icon" aria-hidden="true"><Trophy size={20}/></span><div className="catalog-professionals-copy"><h2>Category leaders</h2><p>{city} · Verified reviews</p></div><button type="button" className="catalog-leaders-motion" aria-label={motionPaused?'Play leader effects':'Pause leader effects'} onClick={()=>setMotionPaused(v=>!v)}>{motionPaused?<Play size={20}/>:<Pause size={20}/>}</button>{refreshButton}</header>
      {error&&<p className="catalog-leaders-status" role="alert">{leaders.length?'Showing last received results. ':''}Leaders could not refresh. <button className="catalog-professionals-retry" onClick={()=>setRetry(v=>v+1)}>Retry</button></p>}
      {loading?<p className="catalog-leaders-status" role="status">Checking category leaders…</p>:!error&&!leaders.length?<p className="catalog-leaders-status">No matching professionals are listed here yet.</p>:null}
      {!!leaders.length&&<nav className="catalog-leaders-rail" aria-label="Category leaderboards">{leaders.map(c=><button type="button" className="catalog-leader-preview" key={c.id} onClick={()=>onSelectCategory?.(c.id)} aria-label={`View ${c.name} leaderboard`}>
        <span className="repaidian-avatar-frame catalog-repaidian-avatar"><span className="catalog-professional-avatar" aria-hidden="true"><User size={20}/>{c.leader?.portrait_url&&<img src={apiAssetUrl(c.leader.portrait_url)} alt="" loading="lazy" onError={e=>{e.currentTarget.hidden=true;}}/>}</span><RepaidianBadge badge={c.leader?.repaidianBadge} variant="avatar"/></span>
        <span className="catalog-leader-preview-copy"><strong>{c.name}</strong><span>{c.leader?.name||'No ranked leader yet'}</span><small>{c.leader?'Category leader':`${c.count} listed · awaiting reviews`}</small></span><ArrowRight size={14} aria-hidden="true"/>
      </button>)}</nav>}
      <p className="sr-only">{current?.updatedAt?`Updated ${new Date(current.updatedAt).toLocaleTimeString()}. `:''}Leaderboards refresh every 30 seconds while this page is visible. Rankings use verified completed-work reviews. Unreviewed profiles are not assigned a rank.</p>
    </section>;
  }
  return <section className="catalog-professionals" aria-label={`${name} professionals`}>
    <div className="catalog-professionals-heading">
    <button type="button" className="catalog-professionals-toggle" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(v=>!v)}>
      <span className="catalog-professionals-icon" aria-hidden="true"><Trophy size={20}/></span>
      <span className="catalog-professionals-copy"><strong>{name} leaderboard</strong><span>{loading?'Checking listed profiles…':error?'Profiles temporarily unavailable':`${count} ${count===1?'reviewed profile':'reviewed profiles'} · ${location?`up to ${radiusKm} km`:city}`}</span></span>
      <ChevronDown size={18} className="catalog-professionals-chevron" aria-hidden="true"/>
    </button>
    {refreshButton}</div>
    {open&&<div id={id} className="catalog-professionals-panel" aria-busy={loading}>
      <p className="catalog-professionals-note"><MapPin size={14} aria-hidden="true"/>{location?`Within ${radiusKm} km and their service range.`:`${city} listings.`} Confirm availability when requesting.</p>
      {loading&&<p role="status">Loading {name.toLowerCase()} profiles…</p>}
      {error&&<div role="alert"><p>{error}</p><button className="catalog-professionals-retry" onClick={()=>setRetry(v=>v+1)}>Retry</button></div>}
      {!loading&&!error&&!rows.length&&<p className="catalog-professionals-empty">No matching professionals are listed here yet. You can still review the services below.</p>}
      <div className="catalog-professionals-list">{rows.map(p=>{
        const record=p.category_records?.find(r=>r.category===category);
        const reviewCount=record?.review_count||0;
        const rating=record?.rating;
        return <article className="catalog-professional" key={p.id}>
          <span className="catalog-professional-avatar" aria-hidden="true"><User size={24}/>{p.portrait_url&&<img src={apiAssetUrl(p.portrait_url)} alt="" loading="lazy" onError={e=>{e.currentTarget.hidden=true;}}/>}</span>
          <div className="catalog-professional-info"><h3>{p.name}</h3><p>{p.role==='specialist'?'Specialist':'Technician'}{p.experience_years!=null?` · ${p.experience_years} years’ experience`:''}</p>
            <div className="catalog-professional-badges"><span><VerifiedUser size={14} aria-hidden="true"/>Profile reviewed</span>{!!p.rank&&reviewCount>0&&<span className="catalog-professional-rank"><Trophy size={13} aria-hidden="true"/>Rank #{p.rank}</span>}<RepaidianBadge badge={p.repaidianBadge}/></div>
          </div>
          <div className="catalog-professional-footer"><p className="catalog-professional-record">{reviewCount>0&&rating!=null?<><Star size={14} aria-hidden="true"/><strong>{rating.toFixed(1)}</strong><span>{reviewCount} category reviews{record?.completed?` · ${record.completed} completed`:''}</span></>:<span>No category reviews yet</span>}</p><button className="catalog-professional-open" onClick={()=>setSelected(p)} aria-label={`View ${p.name}’s profile`}>View profile<ArrowRight size={15} aria-hidden="true"/></button></div>
        </article>;
      })}</div>
      {count>rows.length&&<p className="catalog-professionals-note">Showing {rows.length} of {count}. Use the Hire directory to search more profiles.</p>}
      {!!rows.length&&<details className="catalog-professionals-footnote"><summary>How rankings work</summary><p>Category ranks use verified completed-work reviews. Professionals without category reviews are listed without a rank.</p></details>}
    </div>}
    {selected&&<Modal title={selected.name} className="hire-profile-modal catalog-professional-dialog" onClose={()=>setSelected(null)}><ProfessionalDetails p={selected} category={category} renderActions={p=><ProfessionalQuickActions p={p} category={category} onNavigate={()=>setSelected(null)}/>}/></Modal>}
  </section>;
}
