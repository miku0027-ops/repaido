import CustomerBookingCard from './CustomerBookingCard';
import {customerNeedsAction,customerOnSite} from '../services/customerBookings.mjs';
import {startTaskBell} from '../services/taskBell.mjs';
import {useEffect,useRef,useState} from 'react';
import {Bell,RefreshCw,ArrowRight,BadgeCheck,ChevronLeft,ChevronRight} from 'lucide-react';
import {apiFetch} from '../services/api';
import {auth} from '../firebase';
import {jobCommand,currentPosition,money,operation,operationSnapshot,type Job} from '../services/operations';
import {nativeAvailable,nativeCall} from '../services/native';
import {AgentTaskWorkspace} from './AgentTaskWorkspace';
import {LiveTrackingView} from './LiveTrackingView';
import {TaskReport} from './WorkerRecords';
import {Modal} from './ui';
import './operations.css';
const labels:Record<string,string>={offered:'Response needed',accepted:'Accepted',en_route:'On the way',arrived:'At site',in_progress:'Working',collecting_parts:'Collecting parts',follow_up_scheduled:'Next visit booked',completion_pending:'Customer review',completed:'Completed',cancelled:'Cancelled',disputed:'Under review',searching:'Finding a professional',stop_requested:'Work paused'};

export function JobSummaryCard({job,worker,onOpen,onRebook}:{job:Job;worker:boolean;onOpen:()=>void;onRebook?:()=>void}) {
  if(!worker)return <CustomerBookingCard job={job} onOpen={onOpen} onRebook={onRebook}/>;
  const achieved=worker&&job.state==='completed';
  return <button type="button" className={`agent-job-card${achieved?' agent-job-card--completed':''}`} onClick={onOpen}>
    {achieved?<span className="agent-achievement"><span className="agent-achievement-icon"><BadgeCheck size={24} aria-hidden="true"/></span><span><strong>Task completed</strong><small>Nice work!</small></span></span>:<span className="ops-badge">{labels[job.state]||job.state.replaceAll('_',' ')}</span>}
    <strong>{job.service_name}</strong>
    <span>{new Date(job.starts_at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} · {job.city}</span>
    <span>Customer bill {money(job.total_paise)}</span>{job.coupon&&<small>{job.coupon.code} · professional-funded saving {money(job.vendor_discount_paise||0)}</small>}
    <span className="agent-open-task">{achieved?'View completion report':`Open ${worker?'task':'booking'}`}<ArrowRight size={17} aria-hidden="true"/></span>
  </button>;
}

export function TaskSlideshowRail({
  jobs,
  worker,
  onRebook,
  onOpenReport,
  onOpenJob
}: {
  jobs: Job[];
  worker: boolean;
  onRebook?: (draft: {service_id: string; category: string; city: string}) => void;
  onOpenReport: (jobId: string) => void;
  onOpenJob: (jobId: string) => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{x: number; y: number; time: number} | null>(null);
  const isDragging = useRef(false);
  const hasSwiped = useRef(false);
  const pointerStart = useRef<{x: number; scrollLeft: number} | null>(null);

  useEffect(() => {
    setCurrentIndex(0);
    if (railRef.current) {
      railRef.current.scrollTo({ left: 0, behavior: 'auto' });
    }
  }, [jobs.map(job=>job.id).join('|')]);

  const scrollToCard = (index: number) => {
    if (!railRef.current) return;
    const rail = railRef.current;
    const cards = rail.children;
    const targetIdx = Math.max(0, Math.min(jobs.length - 1, index));
    if (cards[targetIdx]) {
      const card = cards[targetIdx] as HTMLElement;
      const targetScroll = card.offsetLeft - rail.offsetLeft - (rail.clientWidth - card.clientWidth) / 2;
      rail.scrollTo({
        left: Math.max(0, targetScroll),
        behavior: 'smooth'
      });
      setCurrentIndex(targetIdx);
    }
  };

  const handleScroll = () => {
    if (!railRef.current || isDragging.current) return;
    const rail = railRef.current;
    const cards = rail.children;
    if (!cards.length) return;
    const scrollLeft = rail.scrollLeft;
    let closestIndex = 0;
    let minDistance = Infinity;
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i] as HTMLElement;
      const distance = Math.abs((card.offsetLeft - rail.offsetLeft) - scrollLeft);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = i;
      }
    }
    if (closestIndex !== currentIndex) {
      setCurrentIndex(closestIndex);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    isDragging.current = true;
    hasSwiped.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = touch.clientY - touchStart.current.y;
    if (Math.abs(dx) > 8) {
      hasSwiped.current = true;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = touch.clientY - touchStart.current.y;
    // Swipe left (next) or right (prev)
    if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy) * 1.1) {
      if (dx < 0 && currentIndex < jobs.length - 1) {
        scrollToCard(currentIndex + 1);
      } else if (dx > 0 && currentIndex > 0) {
        scrollToCard(currentIndex - 1);
      } else {
        scrollToCard(currentIndex);
      }
    }
    touchStart.current = null;
    isDragging.current = false;
    setTimeout(() => {
      hasSwiped.current = false;
    }, 150);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && railRef.current) {
      pointerStart.current = { x: e.clientX, scrollLeft: railRef.current.scrollLeft };
      hasSwiped.current = false;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (pointerStart.current && railRef.current) {
      const dx = e.clientX - pointerStart.current.x;
      if (Math.abs(dx) > 6) {
        hasSwiped.current = true;
        railRef.current.scrollLeft = pointerStart.current.scrollLeft - dx;
      }
    }
  };

  const handlePointerUp = () => {
    if (pointerStart.current) {
      pointerStart.current = null;
      setTimeout(() => {
        hasSwiped.current = false;
      }, 150);
    }
  };

  const handleCardOpen = (job: Job) => {
    if (hasSwiped.current) return;
    if (worker && job.state === 'completed') {
      onOpenReport(job.id);
    } else {
      onOpenJob(job.id);
    }
  };

  return (
    <div className="agent-jobs-rail-container">
      {jobs.length > 1 && (
        <div className="task-slideshow-header">
          <span className="task-slide-counter">
            <span>{worker ? 'Task' : 'Booking'} {currentIndex + 1} of {jobs.length}</span>
            <small>· Slide cards</small>
          </span>
          <div className="task-slide-nav">
            <button
              type="button"
              className="task-slide-nav-btn prev"
              onClick={() => scrollToCard(currentIndex - 1)}
              disabled={currentIndex === 0}
              aria-label={worker ? 'Previous task card' : 'Previous booking card'}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="task-slide-nav-btn next"
              onClick={() => scrollToCard(currentIndex + 1)}
              disabled={currentIndex === jobs.length - 1}
              aria-label={worker ? 'Next task card' : 'Next booking card'}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      <div
        ref={railRef}
        className="agent-jobs-rail"
        role="region"
        aria-roledescription="carousel"
        aria-label={worker ? 'Assigned tasks slideshow' : 'Bookings slideshow'}
        tabIndex={0}
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' && currentIndex > 0) {
            scrollToCard(currentIndex - 1);
          } else if (e.key === 'ArrowRight' && currentIndex < jobs.length - 1) {
            scrollToCard(currentIndex + 1);
          }
        }}
      >
        {jobs.map((j) => (
          <JobSummaryCard
            key={j.id}
            job={j}
            worker={worker}
            onRebook={!worker && onRebook ? () => onRebook({ service_id: j.service_id, category: j.category, city: j.city }) : undefined}
            onOpen={() => handleCardOpen(j)}
          />
        ))}
      </div>

      {jobs.length > 1 && (
        <div className="task-slide-dots" role="group" aria-label="Slideshow pages">
          {jobs.map((j, i) => ({j,i})).slice(Math.max(0,Math.min(currentIndex-1,jobs.length-3)),Math.max(0,Math.min(currentIndex-1,jobs.length-3))+3).map(({j,i}) => (
            <button
              key={j.id}
              type="button"
              aria-pressed={i === currentIndex}
              aria-label={`${worker ? 'Task' : 'Booking'} ${i + 1}: ${j.service_name}`}
              className={`task-slide-dot ${i === currentIndex ? 'active' : ''}`}
              onClick={() => scrollToCard(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
export function OperationalJobs({worker=false,onSignIn,onRebook,initialJobId,visible=true,kind='all'}:{kind?:'all'|'hiring'|'visits';visible?:boolean;worker?:boolean;onSignIn?:()=>void;onRebook?:(draft:{service_id:string;category:string;city:string})=>void;initialJobId?:string}) {
  const [refreshing,setRefreshing]=useState(false);
  const [reportId,setReportId]=useState<string|null>(null);
  const [jobs,setJobs]=useState<Job[]>(()=>operationSnapshot<{jobs:Job[]}>('/jobs')?.jobs.filter(j=>!worker||j.worker_id===auth.currentUser?.uid).filter(j=>kind==='all'||(j.service_id?.startsWith('day-hire-')?kind==='hiring':kind==='visits'))||[]),[error,setError]=useState(''),[loading,setLoading]=useState(!operationSnapshot('/jobs')),[busy,setBusy]=useState('');
  const [filter,setFilter]=useState('active'),[selected,setSelected]=useState<string|null>(initialJobId||null),[sound,setSound]=useState(false),[muted,setMuted]=useState<string[]>([]);
  const audio=useRef<AudioContext|null>(null), watch=useRef<number|null>(null), locationBusy=useRef(false), currentJobs=useRef(jobs);
  currentJobs.current=jobs;
  useEffect(()=>{if(initialJobId)setSelected(initialJobId);},[initialJobId]);
  const mounted=useRef(true),loads=useRef(0);
  const load=async(_background=true,force=false)=>{
    const id=++loads.current;
    try {
      const data=await operation<{jobs:Job[]}>('/jobs',{}, {background:true,force});
      if(!mounted.current||id!==loads.current)return;
      setError('');setJobs(previous=>data.jobs.filter(j=>!worker||j.worker_id===auth.currentUser?.uid).filter(j=>kind==='all'||(j.service_id?.startsWith('day-hire-')?kind==='hiring':kind==='visits')).map(j=>previous.find(p=>p.id===j.id&&p.version>j.version)||j));
    }catch(e){if(mounted.current&&id===loads.current)setError((e as Error).message);}
    finally{if(mounted.current&&id===loads.current)setLoading(false);}
  };
  useEffect(()=>{
    mounted.current=true;void load();
    const refresh=()=>{if(visible&&!document.hidden)void load(true);};
    const timer=setInterval(refresh,15000);
    window.addEventListener('repaido:operations-updated',refresh);window.addEventListener('focus',refresh);
    return()=>{mounted.current=false;loads.current++;clearInterval(timer);window.removeEventListener('repaido:operations-updated',refresh);window.removeEventListener('focus',refresh);};
  },[kind,worker,visible]);
  useEffect(()=>()=>{if(watch.current!==null)navigator.geolocation.clearWatch(watch.current);void audio.current?.close();},[]);
  const attention=jobs.find(j=>worker?j.state==='offered'||j.allowed_actions.includes('ack_reminder'):j.state==='arrived');
  const alertKey=attention?`${attention.id}:${attention.visit_id}:${attention.state}:${attention.allowed_actions.includes('ack_reminder')}`:'';
  useEffect(()=>{if(worker&&attention&&!muted.includes(alertKey))setSelected(attention.id);},[alertKey]);
  useEffect(()=>{
    if(!sound||!attention||muted.includes(alertKey))return;
    return startTaskBell(audio.current);
  },[sound,alertKey,muted]);
  const enableSound=async()=>{audio.current ||= new AudioContext();await audio.current.resume();setSound(s=>!s);};
  useEffect(()=>{if(!worker)return;const unlock=()=>{audio.current ||= new AudioContext();void audio.current.resume().then(()=>setSound(audio.current?.state==='running')).catch(()=>{});};document.addEventListener('pointerdown',unlock,{once:true,capture:true});document.addEventListener('keydown',unlock,{once:true,capture:true});return()=>{document.removeEventListener('pointerdown',unlock,true);document.removeEventListener('keydown',unlock,true);};},[]);
  const run=async(job:Job,action:string,payload:object={})=>{setBusy(job.id);setError('');try {const updated=await jobCommand(job,action,payload);if(updated.state==='released'){setJobs(list=>list.filter(j=>j.id!==job.id));setSelected(null);}else setJobs(list=>list.map(j=>j.id===job.id?updated:j));return updated;}catch(e){setError((e as Error).message);}finally{setBusy('');}};
  const stopWatch=()=>{if(watch.current!==null)navigator.geolocation.clearWatch(watch.current);watch.current=null;};
  const share=async(job:Job)=>{
    setBusy(job.id);
    try{const session=await operation<{token:string}>(`/jobs/${job.id}/tracking-session`,{method:'POST',body:JSON.stringify({consent:true})});
      if(nativeAvailable()){try{await nativeCall('startTracking',{token:session.token});}catch(e){await run(job,'stop_tracking');throw e;}return;}
      stopWatch();let sequence=0,sentAt=0;
      const send=async(p:{lat:number;lng:number;accuracy:number;captured_at:number})=>{
        const response=await apiFetch('/api/operations/tracking/position',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.token}`},body:JSON.stringify({...p,sequence:++sequence}),signal:AbortSignal.timeout(12000)});
        if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.detail?.message||'Location could not be sent. Enable precise GPS and retry sharing.');}
      };
      await send(await currentPosition());await load();sentAt=Date.now();
      watch.current=navigator.geolocation.watchPosition(async p=>{if(locationBusy.current||Date.now()-sentAt<15000)return;const latest=currentJobs.current.find(j=>j.id===job.id);if(!latest?.allowed_actions.includes('position')){stopWatch();return;}locationBusy.current=true;sentAt=Date.now();try{await send({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,captured_at:p.timestamp/1000});await load();}catch(e){setError((e as Error).message);}finally{locationBusy.current=false;}},()=>{stopWatch();setError('Live location stopped. Retry location sharing when GPS is available.');},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
    }catch(e){setError((e as Error).message);}finally{setBusy('');}
  };
  useEffect(()=>{if(!jobs.some(j=>j.allowed_actions.includes('position')))stopWatch();},[jobs]);
  const detail=jobs.find(j=>j.id===selected);
  const active=jobs.filter(j=>!['completed','cancelled'].includes(j.state));
  const history=jobs.filter(j=>['completed','cancelled'].includes(j.state));
  const attentionJobs=jobs.filter(j=>worker?(j.state==='offered'||j.allowed_actions.includes('ack_reminder')):customerNeedsAction(j));
  const inProgressJobs=jobs.filter(j=>worker?['en_route','arrived','in_progress','collecting_parts'].includes(j.state):customerOnSite(j));

  const filteredJobs = () => {
    if (filter === 'active') return active;
    if (filter === 'attention') return attentionJobs;
    if (filter === 'in_progress') return inProgressJobs;
    if (filter === 'history') return history;
    return active;
  };

  return <section className={`operations ${worker?'agent-job-list':'reference-bookings'}`} aria-label={worker?'Assigned tasks':'Live bookings'}>
    <div className="ops-heading"><h2>{worker?'Your tasks':'Your bookings'}</h2><div className="ops-actions"><button aria-label={worker?"Refresh tasks":"Refresh bookings"} disabled={loading||refreshing||!!busy} onClick={async()=>{setRefreshing(true);try{await load(true,true);}finally{setRefreshing(false);}}}><RefreshCw size={17} className={refreshing?"booking-refreshing":""}/></button>{worker&&<button onClick={()=>void enableSound()} aria-pressed={sound}><Bell size={17}/>{sound?'Sound on':'Enable alerts'}</button>}</div></div>
    <div className="agent-list-filters">{[{id:'active',title:'Active',count:active.length},{id:'attention',title:'Needs you',count:attentionJobs.length},{id:'in_progress',title:'On site',count:inProgressJobs.length},{id:'history',title:'History',count:history.length}].map(f=><button key={f.id} data-filter={f.id} aria-pressed={filter===f.id} onClick={()=>setFilter(f.id)}>{f.title}<strong>{f.count}</strong></button>)}</div>
    {error&&!detail&&<p role="alert" className="ops-error">{error}<button onClick={()=>void load()}>Retry</button>{onSignIn&&<button onClick={onSignIn}>Sign in</button>}</p>}
    {loading?<p role="status">{worker?'Loading tasks…':'Loading bookings…'}</p>:!filteredJobs().length&&!error?<div className="ops-empty">{worker?`No ${filter==='history'?'past':'matching'} tasks. New assignments appear here when available.`:filter==='attention'?'All clear. No booking needs your response right now.':filter==='in_progress'?'No visits at your location right now. Travelling agents appear under Active.':filter==='history'?'Your completed and cancelled bookings will appear here.':'No active bookings. Your next service visit will appear here.'}</div>:!filteredJobs().length?null:<TaskSlideshowRail jobs={filteredJobs()} worker={worker} onRebook={!worker&&onRebook?onRebook:undefined} onOpenReport={(id)=>setReportId(id)} onOpenJob={(id)=>setSelected(id)}/>}
    {reportId&&visible&&<Modal title="Completion report" className="agent-tool-sheet" onClose={()=>setReportId(null)}><TaskReport jobId={reportId}/></Modal>}
    {detail&&worker&&visible&&<AgentTaskWorkspace key={detail.id+detail.visit_id} job={detail} busy={!!busy} error={error} onClose={()=>{setMuted(m=>[...m,alertKey]);setSelected(null);}} onRefresh={load} onRun={(a,p)=>run(detail,a,p)} onShare={()=>share(detail)} onStop={async()=>{stopWatch();if(nativeAvailable())await nativeCall('stopTracking').catch(e=>setError((e as Error).message));await run(detail,'stop_tracking');}}/>}
    {detail&&!worker&&<div className="live-tracking-overlay" onClick={e=>{if(e.target===e.currentTarget)setSelected(null);}}><LiveTrackingView job={detail} worker={false} onClose={()=>setSelected(null)} onRefresh={load}/></div>}
  </section>;
}
