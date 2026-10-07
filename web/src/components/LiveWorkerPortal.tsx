import {useSavedTab} from '../services/navigation';
import {PartnerAgreement} from './PartnerProgram';
import {HomePlans} from './HomePlans';
import {WorkerAssignmentAlerts} from './WorkerAssignmentAlerts';
import {WorkerNavigation} from './WorkerNavigation';

import {shouldRefreshPresence} from '../services/presenceRefresh.mjs';
import {apiFetch} from '../services/api';
import {LocationPickerModal} from './LocationPickerModal';
import {useEffect,useState,useRef} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {ShieldCheck,LogOut,MapPin,Download,ArrowRight,UserRound,Building2,Wrench} from 'lucide-react';
import {auth} from '../firebase';
import {sendPhoneOtp,confirmPhoneOtp,logoutUser,canContinueWithPhoneAccount,continueWithPhoneAccount,clearPhoneAccountRecovery} from '../services/repaidoService';
import {currentPosition,operation,type LiveWorker} from '../services/operations';
import RepaidoBrand from './RepaidoBrand';
import {OperationalJobs} from './OperationalJobs';
import './operations.css';
import {WorkNetworkEntry} from './WorkNetwork';
import {RepaidianBadge} from './RepaidianBadge';
import './repaidian-professional.css';
import {WorkerCalendar} from './WorkerCalendar';
import {WorkerRecords,WorkerProfileEditor} from './WorkerRecords';
import {WorkerHireRequests} from './Hiring';
import {VerificationPanel} from './VerificationPanel';
import {enableNativePush,nativeAvailable,stopNativeSession} from '../services/native';
import { ContractorPortal, AgentProjectDesk } from './ContractorPortal';

export default function LiveWorkerPortal({onBack,onOpenB2BMarket}:{onBack:()=>void;onOpenB2BMarket?:()=>void}) {
  const [loginRole, setLoginRole] = useState<'technician' | 'contractor'>(() => {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search).get('mode');
      if (q === 'contractor') return 'contractor';
      if (q === 'technician') return 'technician';
      try {
        return (localStorage.getItem('repaido.agent_login_role') as any) || 'technician';
      } catch {}
    }
    return 'technician';
  });
  const [accountConflict,setAccountConflict]=useState(false);
  const [editing,setEditing]=useState(false);
  const [alertJob,setAlertJob]=useState<string|undefined>(),[locationError,setLocationError]=useState('');
  useEffect(()=>()=>clearPhoneAccountRecovery(),[]);
  const [phone,setPhone]=useState(''),[otp,setOtp]=useState(''),[codeSent,setCodeSent]=useState(false);
  const [signedIn,setSignedIn]=useState(false),[ready,setReady]=useState(false),[worker,setWorker]=useState<LiveWorker|null>(null),[checked,setChecked]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[tab,setTab]=useSavedTab<string>('repaido.worker.tab',['Home','Active Task','Calendar','Earnings','Profile'] as const,'Home',new URLSearchParams(location.search).get('tab')==='projects'?'Profile':new URLSearchParams(location.search).has('home-plan')?'Calendar':new URLSearchParams(location.search).get('tab')==='wallet'?'Earnings':new URLSearchParams(location.search).get('tab')==='hire'?'Active Task':undefined);
  const [profileProgress,setProfileProgress]=useState<{percent:number;verified:boolean;missing:{id:string;label:string;target:string}[]} | null>(null);
  const [profileSection,setProfileSection]=useState<string|null>(null),[locationRetry,setLocationRetry]=useState(0),[presenceLocating,setPresenceLocating]=useState(false);
  const lastLocationAttempt=useRef(0);
  const loadProgress=()=>operation<any>('/worker/profile-progress',{}, {background:true}).then(setProfileProgress).catch(()=>{});
  useEffect(()=>{if(worker?.id)void loadProgress();else setProfileProgress(null);},[worker?.id,worker?.status,tab]);
  const completeProfile=()=>{const target=profileProgress?.missing[0]?.target||null;if(target==='application'&&worker?.status!=='approved'){setEditing(true);return;}setProfileSection(target);setTab('Profile');};
  const [taskCounts,setTaskCounts]=useState({active:0,attention:0});
  const refreshTaskCounts=async()=>{
    try{
      const res=await operation<{jobs:any[]}>('/jobs',{}, {background:true});
      const myJobs=res.jobs.filter((j:any)=>j.worker_id===auth.currentUser?.uid);
      const active=myJobs.filter((j:any)=>!['completed','cancelled'].includes(j.state));
      const attention=myJobs.filter((j:any)=>j.state==='offered'||j.allowed_actions?.includes('ack_reminder'));
      setTaskCounts({active:active.length,attention:attention.length});
    }catch{}
  };
  useEffect(()=>{
    if(!signedIn||worker?.status!=='approved')return;
    void refreshTaskCounts();
    const onJobUpdated=()=>void refreshTaskCounts();
    window.addEventListener('repaido:job-updated',onJobUpdated);
    const timer=setInterval(()=>{if(!document.hidden)void refreshTaskCounts();},15000);
    return()=>{window.removeEventListener('repaido:job-updated',onJobUpdated);clearInterval(timer);};
  },[signedIn,worker?.status]);
  const load=async()=>{setBusy(true);setError('');try{const result=await operation<{worker:LiveWorker|null}>('/worker/me');setWorker(result.worker);setChecked(true);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  useEffect(()=>onIdTokenChanged(auth,u=>{setReady(false);setChecked(false);if(!u){setSignedIn(false);setWorker(null);setReady(true);return;}void u.getIdTokenResult().then(()=>{const verified=!!u.phoneNumber;setSignedIn(verified);setReady(true);if(verified){void load();if(nativeAvailable()&&localStorage.getItem('repaido.push-device'))void enableNativePush().catch(()=>{});}else setWorker(null);}).catch(e=>{setError(e.message);setSignedIn(!!u.phoneNumber);setReady(true);});}),[]);
  useEffect(()=>{if(!worker||worker.status==='approved'||editing)return;const timer=setInterval(()=>{if(!document.hidden)void operation<{worker:LiveWorker|null}>('/worker/me',{}, {background:true}).then(r=>setWorker(r.worker)).catch(()=>{});},30000);return()=>clearInterval(timer);},[worker?.id,worker?.status,editing]);
  useEffect(()=>{
    if(!worker?.online||loginRole!=='technician')return;
    let cancelled=false,running=false,denied=false;
    const refresh=async(manual=false)=>{
      if(!shouldRefreshPresence({hidden:document.hidden,running,denied,lastAttempt:lastLocationAttempt.current,now:Date.now(),manual}))return;
      running=true;setPresenceLocating(true);lastLocationAttempt.current=Date.now();
      try{
        if(!manual&&navigator.permissions){
          const permission=await navigator.permissions.query({name:'geolocation'}).catch(()=>null);
          if(permission&&permission.state!=='granted'){denied=true;throw new Error('Allow location in device settings, then tap Set location.');}
        }
        const position=await currentPosition(true);
        if(position.accuracy>1000)throw new Error('Enable precise location and retry near a window.');
        if(cancelled)return;
        const result=await operation<{worker:LiveWorker}>('/worker/availability',{method:'POST',body:JSON.stringify({online:true,position,heartbeat:true})},{background:true});
        if(!cancelled){setWorker(result.worker);setLocationError('');}
      }catch(e){if(!cancelled){const message=(e as Error).message;denied=denied||message.includes('permission is off');setLocationError(message);}}
      finally{running=false;if(!cancelled)setPresenceLocating(false);}
    };
    void refresh(locationRetry>0);
    const timer=setInterval(()=>void refresh(),180000),focus=()=>void refresh();
    window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
    return()=>{cancelled=true;setPresenceLocating(false);clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
  },[worker?.id,worker?.online,loginRole,locationRetry]);
  const submit=async(task:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await task();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const readPresenceLocation=async()=>{try{const position=await currentPosition(true);if(position.accuracy>1000)throw new Error('Enable precise location and retry near a window.');setLocationError('');return position;}catch(e){setLocationError((e as Error).message);return null;}};
  const toggleAvailability=()=>submit(async()=>{if(!worker)return;const position=worker.online?undefined:await readPresenceLocation();if(!worker.online&&!position)return;const result=await operation<{worker:LiveWorker}>('/worker/availability',{method:'POST',body:JSON.stringify({online:!worker.online,position})});lastLocationAttempt.current=Date.now();setWorker(result.worker);setLocationError('');window.dispatchEvent(new Event('repaido:job-updated'));});
  const accountTools=<WorkerAccountTools busy={busy} onSignOut={()=>void submit(async()=>{await stopNativeSession();await logoutUser();setWorker(null);setSignedIn(false);})} onNotifications={()=>void submit(()=>enableNativePush())}/>;
  return <main className="operations ops-worker">
    <header className="ops-heading"><RepaidoBrand size="sm"/><div className="worker-header-actions"><button onClick={onBack}>Customer app</button><button className="text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded-lg border border-slate-300 transition-colors" onClick={()=>{const next=loginRole==='technician'?'contractor':'technician';setLoginRole(next);try{localStorage.setItem('repaido.agent_login_role',next);}catch{}}}>{loginRole==='technician'?<><Building2 size={15}/>Contractor desk</>:<><Wrench size={15}/>Technician desk</>}</button>{loginRole==='technician'&&worker?.status==='approved'&&<button className={`worker-presence ${worker.online?'is-online':''}`} role="switch" aria-checked={worker.online} aria-label="Available for new task requests" disabled={busy} onClick={()=>void toggleAvailability()}><span aria-hidden="true" className="presence-dot"/>{busy?'Updating…':worker.online?'Online':'Go online'}</button>}</div></header>
    {signedIn&&worker?.status==='approved'&&<WorkNetworkEntry/>}
    {error&&<div className="ops-error" role="alert">{error}{signedIn&&!checked&&<button onClick={()=>void load()}>Retry connection</button>}</div>}
    {signedIn&&!checked&&<button onClick={()=>void submit(()=>logoutUser())}>Use another phone number</button>}
    {!ready?<p role="status">Checking your sign-in…</p>:!signedIn?
      <>
        <div className="auth-bg-motion"><div className="orb orb-1"/><div className="orb orb-2"/><div className="orb orb-3"/></div>
        <div className="relative z-10 p-6 flex flex-col min-h-screen">
          <div className="mb-10 mt-8">
            <h1 style={{fontSize: '1.5rem', fontWeight: 900, background: 'linear-gradient(to right, #0f306e, #2563eb)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: 1.1, marginBottom: 16}}>
              Your Repaido workday
            </h1>
            <p style={{fontSize: '.9375rem', color: '#334155', fontWeight: 500, lineHeight: 1.6}}>
              Manage requests, visits, work records and earnings in one place.
            </p>
          </div>
          <section className="ops-card" style={{border: 'none', background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(16px)', boxShadow: '0 20px 40px -10px rgba(0,0,0,0.1)', borderRadius: 32}}>
            {/* Dual Login Selection Tab */}
            <div className="repaido-login-switch">
              <button
                type="button"
                className={`repaido-login-switch-btn ${loginRole === 'technician' ? 'active' : ''}`}
                onClick={() => {
                  setLoginRole('technician');
                  try { localStorage.setItem('repaido.agent_login_role', 'technician'); } catch {}
                }}
              >
                <span>🛠️</span> Technician / Specialist
              </button>
              <button
                type="button"
                className={`repaido-login-switch-btn ${loginRole === 'contractor' ? 'active' : ''}`}
                onClick={() => {
                  setLoginRole('contractor');
                  try { localStorage.setItem('repaido.agent_login_role', 'contractor'); } catch {}
                }}
              >
                <span>🏢</span> Contractor / Manager
              </button>
            </div>

            <span className="ops-eyebrow">
              {loginRole === 'technician' ? 'Technician & Specialist Access' : 'Contractor & Engineering Team Access'}
            </span>
            <h2 className="mt-2 mb-2 text-2xl font-bold">
              {loginRole === 'technician' ? 'Secure Sign-in' : 'Contractor Sign-in & Command'}
            </h2>
            <p className="text-slate-600 mb-6">
              {loginRole === 'technician'
                ? 'Sign in with your mobile number to manage your doorstep tasks or create a new partner profile for review.'
                : 'Sign in with your registered contractor mobile number to manage project teams, work records, and contract tenders.'}
            </p>



            <form onSubmit={e=>{e.preventDefault();void submit(async()=>{if(codeSent){try{await confirmPhoneOtp(otp);setAccountConflict(false);}catch(e){setAccountConflict(canContinueWithPhoneAccount());throw e;}}else{setAccountConflict(false);await sendPhoneOtp(phone,'worker-recaptcha',true);setCodeSent(true);}});}}>
              <label>Mobile number<input type="tel" inputMode="tel" autoComplete="tel" required value={phone} disabled={codeSent} placeholder="+91 XXXXX XXXXX" onChange={e=>setPhone(e.target.value)}/></label>
              {codeSent&&<label>6-digit code from SMS<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required value={otp} onChange={e=>setOtp(e.target.value)} maxLength={6}/></label>}
              <button className="ops-primary" disabled={busy||accountConflict} style={{marginTop: 20}}>{busy?'Please wait…':codeSent?'Verify code':'Send code'}</button>
              {codeSent&&<button type="button" className="ops-secondary" disabled={busy} onClick={()=>{clearPhoneAccountRecovery();setAccountConflict(false);setError('');setCodeSent(false);setOtp('');}} style={{marginTop: 12}}>Change number or resend code</button>}
            </form>
            {accountConflict&&<div className="ops-notice mt-6"><p>This switches your sign-in to the verified mobile account. It does not transfer bookings, documents or wallet balances.</p><button className="ops-primary" disabled={busy} onClick={()=>void submit(async()=>{try{await continueWithPhoneAccount();}finally{setAccountConflict(false);setCodeSent(false);setOtp('');}})}>Continue with this mobile account</button></div>}
            <div id="worker-recaptcha"/>
            {!nativeAvailable() && (
              <div style={{marginTop: 20, padding: '16px 20px', borderRadius: 20, background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)', border: '1px solid #bae6fd', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12}}>
                <div style={{flex: 1, minWidth: 200}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '0.9rem', color: '#0369a1'}}>
                    <span>📲</span> Repaido Agent Android App
                  </div>
                  <p style={{fontSize: '0.8rem', color: '#0284c7', margin: '4px 0 0', lineHeight: 1.4}}>
                    Get siren task dispatch alerts, background GPS tracking & dedicated camera.
                  </p>
                </div>
                <a href="/downloads/repaido-agent.apk" download className="ops-primary" style={{fontSize: '0.8rem', padding: '8px 14px', textDecoration: 'none', whiteSpace: 'nowrap'}}>
                  Download agent app
                </a>
              </div>
            )}
            {auth.currentUser&&<button className="ops-secondary mt-6" disabled={busy} onClick={()=>void submit(()=>logoutUser())}>Sign out to use a different account</button>}
          </section>
        </div>
      </>
    :loginRole==='contractor'?<ContractorPortal initialTenderId={new URLSearchParams(location.search).get('tender')||undefined} initialTab={new URLSearchParams(location.search).has('tender')?'Tenders':undefined} accountControls={accountTools} onBackToCustomer={onBack} onPartnerProfile={()=>{setLoginRole('technician');setTab('Profile');}} onOpenB2BMarket={onOpenB2BMarket}/>:!checked?<section className="ops-card"><h1>Connecting your worker account</h1><p>{busy?'Loading your profile…':'Your profile could not be loaded. Retry to continue.'}</p><button onClick={()=>void load()} disabled={busy}>Retry</button></section>:(!worker||editing)?<WorkerOnboarding initial={worker||undefined} onCancel={worker?()=>setEditing(false):undefined} onLogin={()=>void submit(()=>logoutUser())} busy={busy} onSubmit={async body=>{setBusy(true);setError('');try{await operation('/worker/onboarding',{method:'POST',body:JSON.stringify(body)});setEditing(false);await load();}finally{setBusy(false);}}}/>:<>
      {worker.status==='approved'&&<WorkerAssignmentAlerts onOpen={id=>{if(!id.startsWith('hire:'))setAlertJob(id);setTab('Active Task');}}/>}
      {locationError&&<div className="worker-location-notice" role="status"><MapPin size={17}/><span>Set location for nearby tasks</span><button disabled={busy||presenceLocating} onClick={()=>{if(worker.online)setLocationRetry(n=>n+1);else void submit(()=>readPresenceLocation());}}>{presenceLocating?'Locating…':'Set location'}</button><details><summary aria-label="Location help">Help</summary><p>{locationError}</p><button onClick={()=>{setTab('Profile');setProfileSection('verification');}}>Profile & service area</button></details></div>}
      {tab==='Home'&&<><section className="worker-welcome-compact"><div><span className="work-kicker">Your workday</span><div className="repaidian-professional-name"><h1>Hello, {worker.name.split(' ')[0]}</h1><RepaidianBadge badge={worker.repaidianBadge}/></div></div><div className="worker-profile-status">{profileProgress?.verified?<span className="worker-verified"><ShieldCheck size={13}/>Verified</span>:<button onClick={completeProfile}><UserRound size={13}/>{profileProgress?`${profileProgress.percent}% profile`:'Your profile'}<ArrowRight size={13}/></button>}{profileProgress?.verified&&<small>100% complete</small>}{profileProgress&&!profileProgress.verified&&<small>{profileProgress.percent===100?'Review pending':'Complete profile'}</small>}</div></section><AgentProjectDesk/>
        {worker.status==='approved'&&(
          <div className="agent-button-grid" role="region" aria-label="Task metrics and quick actions">
            <button type="button" className={`agent-grid-btn ${taskCounts.active>0?'is-selected':''}`} onClick={()=>setTab('Active Task')}>
              <div className="agent-grid-header">
                <span className="agent-grid-title">Active Tasks</span>
                <span className={`agent-badge-pill ${taskCounts.active>0?'badge-live':'badge-neutral'}`}>
                  <span className="agent-ping-dot"/> {taskCounts.active>0?`${taskCounts.active} LIVE`:'IDLE'}
                </span>
              </div>
              <strong className="agent-grid-num">{taskCounts.active}</strong>
            </button>

            <button type="button" className={`agent-grid-btn ${taskCounts.attention>0?'has-urgent-pulse':''}`} onClick={()=>setTab('Active Task')}>
              <div className="agent-grid-header">
                <span className="agent-grid-title">Pending Action</span>
                <span className={`agent-badge-pill ${taskCounts.attention>0?'badge-urgent':'badge-neutral'}`}>
                  {taskCounts.attention>0?`${taskCounts.attention} DUE`:'ALL CLEAR'}
                </span>
              </div>
              <strong className="agent-grid-num" style={{color:taskCounts.attention>0?'#ef4444':'inherit'}}>{taskCounts.attention}</strong>
              <span className="agent-grid-sub">{taskCounts.attention>0?'Response required':'Up to date'}</span>
            </button>

            <button type="button" className="agent-grid-btn" onClick={()=>setTab('Active Task')}>
              <div className="agent-grid-header">
                <span className="agent-grid-title">Completed</span>
                <span className="agent-badge-pill badge-emerald">
                  RECORDED
                </span>
              </div>
              <strong className="agent-grid-num">{worker.completed_tasks}</strong>
            </button>

            <button type="button" className="agent-grid-btn" onClick={()=>setTab('Profile')}>
              <div className="agent-grid-header">
                <span className="agent-grid-title">Performance</span>
                <span className="agent-badge-pill badge-cyan">
                  {worker.points} PTS
                </span>
              </div>
              <strong className="agent-grid-num">{worker.rating_count?`${(worker.rating_sum/worker.rating_count).toFixed(1)} ★`:'New'}</strong>
              <span className="agent-grid-sub">{worker.rating_count} verified reviews</span>
            </button>
          </div>
        )}
        {worker.status!=='approved'&&<button className="ops-secondary" onClick={()=>setEditing(true)}>Edit saved profile details</button>}
        {worker.status!=='approved'&&<VerificationPanel onUpdated={()=>void load()}/>}
        
        {worker.status==='approved'&&<><button className={`ops-primary worker-active-cta ${taskCounts.active>0?'has-active-tasks':''}`} onClick={()=>setTab('Active Task')}><span className="presence-dot"/>{taskCounts.active>0?`${taskCounts.active} active task${taskCounts.active===1?'':'s'}`:'Open tasks'}<ArrowRight size={17}/></button><WorkerCalendar compact onActive={()=>setTab('Active Task')}/></>}
      </>}
      {worker.status==='approved'&&<div hidden={tab!=='Active Task'}><WorkerHireRequests onTask={id=>{setAlertJob(id);setTab('Active Task');}}/><OperationalJobs worker visible={tab==='Active Task'} initialJobId={alertJob}/></div>}
      {tab==='Active Task'&&worker.status!=='approved'&&<div className="ops-notice"><h2>Complete onboarding first</h2><p>Your application must be approved before you can receive tasks.</p><button onClick={()=>setTab('Home')}>Continue your application</button></div>}
      {tab==='Calendar'&&<><WorkerCalendar onActive={()=>setTab('Active Task')}/><details className="work-accordion"><summary>Home plan visits</summary><HomePlans worker onJob={id=>{setAlertJob(id);setTab('Active Task');}}/></details></>}
      {tab==='Earnings'&&<WorkerRecords/>}
      {tab==='Profile'&&<><section className="worker-completion"><strong>{profileProgress?.percent??'—'}% profile complete</strong><progress max={100} value={profileProgress?.percent||0} aria-label="Profile completion"/>{profileProgress?.missing.map(item=><button key={item.id} onClick={()=>{if(item.target==='application'&&worker.status!=='approved')setEditing(true);else setProfileSection(item.target==='application'?'verification':item.target);}}>{item.label}<ArrowRight size={15}/></button>)}{profileProgress?.verified&&<span className="worker-verified"><ShieldCheck size={14}/>Verified profile</span>}</section><WorkerProfileEditor worker={worker} initialSection={profileSection==='application'?'verification':profileSection} onSectionClose={()=>setProfileSection(null)} onEditPrivate={()=>setEditing(true)} onRefresh={()=>{void load();void loadProgress();}}/><AgentProjectDesk/>{accountTools}</>}
      <WorkerNavigation tab={tab} onChange={setTab}/>
    </>}
  </main>;
}
function VerificationState({reason}:{reason?:string}){return <div className="ops-notice"><h3>Private verification required</h3><p>After saving your profile, upload identity, PAN, address proof and tools photos privately. The Repaido team reviews your documents and identity. Joining approval is required before you receive work. Bank verification is separate and required before payouts. Do not send documents or bank passwords in chat.</p>{reason&&<p>Review note: {reason}</p>}</div>;}

const DEFAULT_WORKER_CITIES = ['Balasore', 'Bhadrak', 'Jajpur', 'Bhubaneswar', 'Cuttack', 'Puri', 'Berhampur', 'Rourkela', 'Sambalpur', 'Bengaluru', 'Mumbai', 'Delhi', 'Hyderabad', 'Pune', 'Chennai'];

function WorkerOnboarding({busy,onSubmit,onLogin,initial,onCancel}:{busy:boolean;onSubmit:(body:object)=>Promise<void>;onLogin:()=>void;initial?:LiveWorker;onCancel?:()=>void}) {
  const [partner,setPartner]=useState({version:'',sections:[] as string[]});
  const [latitude,setLatitude]=useState(initial?.location?String(initial.location.lat):''),[longitude,setLongitude]=useState(initial?.location?String(initial.location.lng):''),[error,setError]=useState(''),[locating,setLocating]=useState(false),[mapOpen,setMapOpen]=useState(false);
  const [cities,setCities]=useState<string[]>(DEFAULT_WORKER_CITIES),[citiesLoading,setCitiesLoading]=useState(false),[citiesError,setCitiesError]=useState(''),[cityAttempt,setCityAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setCitiesError('');
    void apiFetch('/api/catalog',{signal:controller.signal}).then(async response=>{
      if(!response.ok) return;
      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        // If response is HTML or non-JSON, keep DEFAULT_WORKER_CITIES safely
        return;
      }
      if(Array.isArray(data.cities)&&data.cities.length&&data.cities.every((city:unknown)=>typeof city==='string')){
        setCities(data.cities);
      }
    }).catch(()=>{
      // Keep DEFAULT_WORKER_CITIES active without showing JSON parse error
    }).finally(()=>{
      if(!controller.signal.aborted)setCitiesLoading(false);
    });
    return()=>controller.abort();
  },[cityAttempt]);
  const setPin=(p:{lat:number;lng:number})=>{setLatitude(String(p.lat));setLongitude(String(p.lng));};
  return <section className="ops-card worker-setup"><span className="ops-eyebrow">Step 1 of 3 · Your profile</span><h1>{initial?'Update your saved profile':'Let’s get you ready for work'}</h1><p>Your mobile number is verified. Complete your profile, upload your documents, then send it to our team.</p><ol className="worker-setup-steps" aria-label="Joining steps"><li aria-current="step"><strong>1</strong>Profile</li><li><strong>2</strong>Documents</li><li><strong>3</strong>Team review</li></ol>{onCancel&&<button type="button" onClick={onCancel}>Back to saved application</button>}<p>Already have a worker account? <button type="button" disabled={busy} onClick={onLogin}>Log in with your registered mobile number</button></p><form onSubmit={e=>{e.preventDefault();if(!latitude.trim()||!longitude.trim()||!Number.isFinite(Number(latitude))||!Number.isFinite(Number(longitude))){setError('Set the location you travel from before saving your profile.');return;}const f=new FormData(e.currentTarget);setError('');void onSubmit({name:f.get('name'),dob:f.get('dob'),city:f.get('city'),home_address:f.get('home_address'),location:{lat:Number(latitude),lng:Number(longitude)},requested_role:f.get('role'),categories:[f.get('category')],skills:String(f.get('skills')).split(',').map(v=>v.trim()).filter(Boolean),tools:String(f.get('tools')).split(',').map(v=>v.trim()).filter(Boolean),experience_years:Number(f.get('experience')),radius_km:Number(f.get('radius')),terms_version:'field-service-v1',partner_policy_version:partner.version,partner_policy_sections:partner.sections}).catch(e=>setError((e as Error).message));}}>
    <h2 className="setup-section-title">About you</h2><label>Full legal name<input defaultValue={initial?.name} name="name" required minLength={2} autoComplete="name"/></label><label>Date of birth<input type="date" defaultValue={initial?.dob} name="dob" required autoComplete="bday"/></label>
    <div className="ops-grid"><label>Apply as<select name="role" defaultValue={initial?.requested_role||'technician'}><option value="technician">Technician</option><option value="specialist">Specialist (review required)</option></select></label><label>Years of experience<input name="experience" type="number" min={0} max={60} required defaultValue={initial?.experience_years||0}/></label></div>
    <h2 className="setup-section-title">Your skills & tools</h2><label>Main service<select name="category" defaultValue={initial?.categories[0]}>{[['ac','AC & appliances'],['plumber','Plumbing'],['electrician','Electrical'],['cleaning','Cleaning'],['carpenter','Carpentry'],['painting','Painting'],['pest','Pest control'],['salon','Salon'],['care','Non-medical care'],['interiors','Interiors & decor'],['renovation','Renovation'],['civil','Civil engineering'],['construction','Construction']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    <label>Skills (separate with commas)<input defaultValue={initial?.skills.join(', ')} name="skills" required placeholder="Leak diagnosis, tap replacement"/></label><label>Your tools (separate with commas)<textarea defaultValue={initial?.tools.join(', ')} name="tools" required/></label>
    <h2 className="setup-section-title">Where you work</h2><label>Address you travel from<textarea defaultValue={initial?.home_address} name="home_address" required minLength={10} autoComplete="street-address"/></label><label>Service city<select key={cities.join('|')} name="city" required defaultValue={initial?.city||cities[0]||'Balasore'} aria-describedby="worker-city-help"><option value="" disabled>Choose your service city</option>{cities.map(city=><option key={city} value={city}>{city}</option>)}</select></label><p id="worker-city-help" className="ops-help">Select the city where you will work. Enter your neighbourhood and full address above.</p>{citiesError&&<div role="alert" className="ops-error">{citiesError}<button type="button" onClick={()=>setCityAttempt(n=>n+1)}>Retry city list</button></div>}
    <button type="button" disabled={locating} onClick={async()=>{setLocating(true);setError('');try{const p=await currentPosition(true);setPin(p);}catch(e){setError((e as Error).message);}finally{setLocating(false);}}}>{locating?'Finding your location…':'Use my current location'}</button>
    <button type="button" onClick={()=>setMapOpen(true)}>Choose location on map</button>
    <p className="ops-help">Choose the place you travel from. If location permission is off, use the map or enter both coordinates. This does not record arrival at a job.</p>
    <div className="ops-grid"><label>Latitude<input type="number" step="any" min={-90} max={90} required value={latitude} onChange={e=>setLatitude(e.target.value)}/></label><label>Longitude<input type="number" step="any" min={-180} max={180} required value={longitude} onChange={e=>setLongitude(e.target.value)}/></label></div>
    <label>Maximum travel distance (km)<input name="radius" type="number" min={1} max={6} defaultValue={initial?.radius_km||6} required/></label>
    <PartnerAgreement onChange={(version,sections)=>setPartner({version,sections})}/>
    <VerificationState/>
    <details><summary>Response and attendance rules</summary><p>Accept or decline offers within 15 minutes. A reminder is due 2 hours before the visit; acknowledge within 10 minutes. Depart at least 30 minutes before the appointment.</p><p>A missed reminder creates an assessment of 10% of this task’s eligible earnings and 20% of the next task’s eligible earnings. Late departure creates a 20% assessment. Assessments require settlement review; no bank deduction occurs here. GPS sharing is optional, but automated arrival and start require an accurate reading within 100 m. Manual review is needed if GPS fails.</p></details>
    <label className="ops-check"><input type="checkbox" required/>I agree to the field-service-v1 terms and consent to storing this profile for registration.</label>
    {error&&<p role="alert" className="ops-error">{error}</p>}<button className="ops-primary" disabled={busy||citiesLoading||!!citiesError||partner.sections.length!==4}>{busy?'Saving…':'Save & continue to documents'}</button>
  </form><LocationPickerModal isOpen={mapOpen} title="Where do you travel from?" subtitle="Choose your home or work base. Confirm the pin before saving." onClose={()=>setMapOpen(false)} onConfirmLocation={p=>{setPin(p);setError('');}}/></section>;
}

function WorkerAccountTools({busy,onSignOut,onNotifications}:{busy:boolean;onSignOut:()=>void;onNotifications:()=>void}){
 return <section className="worker-account-tools" aria-label="Account settings"><h3>App & account</h3>{!nativeAvailable()?<a href="/downloads/repaido-agent.apk" download className="worker-download"><Download size={16}/>Android app<span>Download</span></a>:<button disabled={busy} onClick={onNotifications}>Task notifications <ArrowRight size={16}/></button>}<button disabled={busy} onClick={onSignOut}><LogOut size={16}/>Sign out</button></section>;
}
