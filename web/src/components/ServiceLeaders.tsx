import {useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,ChevronDown,MapPin,ShieldCheck,Star,User} from 'lucide-react';
import {apiAssetUrl} from '../services/api';
import {cachedHireProfiles,hireProfiles} from '../services/hireProfileCache';
import {categories} from '../data';
import {Modal} from './ui';
import {ProfessionalDetails,type Professional} from './Hiring';
import './service-leaders.css';

interface Props {
  city:string;
  category:string;
  initialLocation?:{lat:number;lng:number;city:string};
  role?:'all'|'technician'|'specialist';
  radiusKm?:number;
}

/** Category-specific, approved public profiles. Browsing never creates a booking. */
export default function ServiceLeaders({city,category,initialLocation,role='all',radiusKm=6}:Props){
  const [open,setOpen]=useState(false),[selected,setSelected]=useState<Professional|null>(null);
  const [result,setResult]=useState<{key:string;rows:Professional[];total:number}|null>(null);
  const [error,setError]=useState(''),[retry,setRetry]=useState(0);
  const lastRetry=useRef(0);
  const id=useId();
  const location=initialLocation?.city===city?initialLocation:undefined;
  const requestKey=JSON.stringify([category,city,location?.lat,location?.lng,role,radiusKm,retry]);
  const rows=result?.key===requestKey?result.rows:[];
  const loading=result?.key!==requestKey&&!error;
  const name=categories.find(c=>c.id===category)?.name||category.replaceAll('-',' ');
  useEffect(()=>{
    if(!category||category==='all')return;
    let active=true;setError('');setSelected(null);
    const force=retry!==lastRetry.current;
    lastRetry.current=retry;
    const body={city,category,role,location:location?{lat:location.lat,lng:location.lng}:null,radius_km:radiusKm};
    type Result={professionals:Professional[];total:number};
    const cached=force?null:cachedHireProfiles<Result>(body);
    if(cached){setResult({key:requestKey,rows:cached.professionals.filter(p=>p.categories.includes(category)),total:cached.total});}
    else {
      setResult(null);
      void hireProfiles<Result>(body,force).then(data=>{
        if(active)setResult({key:requestKey,rows:data.professionals.filter(p=>p.categories.includes(category)),total:data.total});
      }).catch(error=>{if(active)setError(error.message);});
    }
    return()=>{active=false;};
  },[requestKey]);
  if(!category||category==='all')return null;
  const count=result?.key===requestKey?result.total:0;
  return <section className="catalog-professionals" aria-label={`${name} professionals`}>
    <button type="button" className="catalog-professionals-toggle" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(v=>!v)}>
      <span className="catalog-professionals-icon" aria-hidden="true"><ShieldCheck size={18}/></span>
      <span className="catalog-professionals-copy"><strong>{name} professionals</strong><span>{loading?'Checking listed profiles…':error?'Profiles temporarily unavailable':`${count} ${count===1?'reviewed profile':'reviewed profiles'} · ${location?`up to ${radiusKm} km`:city}`}</span></span>
      <ChevronDown size={18} className="catalog-professionals-chevron" aria-hidden="true"/>
    </button>
    {open&&<div id={id} className="catalog-professionals-panel" aria-busy={loading}>
      <p className="catalog-professionals-note"><MapPin size={13} aria-hidden="true"/>{location?'Within your selected radius and each professional’s service range.':'City listings. Choose your location to check service coverage.'} Availability is confirmed when requesting.</p>
      {loading&&<p role="status">Loading {name.toLowerCase()} profiles…</p>}
      {error&&<div role="alert"><p>{error}</p><button className="catalog-professionals-retry" onClick={()=>setRetry(v=>v+1)}>Retry</button></div>}
      {!loading&&!error&&!rows.length&&<p className="catalog-professionals-empty">No matching professionals are listed here yet. You can still review the services below.</p>}
      <div className="catalog-professionals-list">{rows.map(p=>{
        const record=p.category_records?.find(r=>r.category===category);
        const reviewCount=record?.review_count||0;
        const rating=record?.rating;
        return <article className="catalog-professional" key={p.id}>
          <div className="catalog-professional-avatar" aria-hidden="true"><User size={24}/>{p.portrait_url&&<img src={apiAssetUrl(p.portrait_url)} alt="" loading="lazy" onError={e=>{e.currentTarget.hidden=true;}}/>}</div>
          <div className="catalog-professional-info"><h3>{p.name}</h3><p>{p.role==='specialist'?'Specialist':'Technician'}{p.experience_years!=null?` · ${p.experience_years} years’ experience`:''}</p>
            <div className="catalog-professional-badges"><span><ShieldCheck size={12} aria-hidden="true"/>Team-reviewed</span>{!!p.rank&&reviewCount>0&&<span>Category rank #{p.rank}</span>}</div>
            <p className="catalog-professional-record">{reviewCount>0&&rating!=null?<><Star size={12} aria-hidden="true"/>{rating.toFixed(1)} · {reviewCount} category reviews</>:'No category reviews yet'}{record?.completed?` · ${record.completed} completed`:''}</p>
          </div>
          <button className="catalog-professional-open" onClick={()=>setSelected(p)} aria-label={`View ${p.name}’s profile`}>Profile<ArrowRight size={14} aria-hidden="true"/></button>
        </article>;
      })}</div>
      {count>rows.length&&<p className="catalog-professionals-note">Showing {rows.length} of {count}. Use the Hire directory to search more profiles.</p>}
      {!!rows.length&&<p className="catalog-professionals-footnote">Category ranks reflect verified completed-work reviews. New professionals are listed without a rank.</p>}
    </div>}
    {selected&&<Modal title={selected.name} className="hire-profile-modal catalog-professional-dialog" onClose={()=>setSelected(null)}><ProfessionalDetails p={selected}/><p className="catalog-professionals-note">Review a service below to request work. The booking flow confirms availability and assignment.</p></Modal>}
  </section>;
}
