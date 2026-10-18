// Local-only preview: actual UI, commands and API; disposable identities only.
import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import {HireRequests,Hiring,WorkerMembership} from '../src/components/Hiring';
import {HourlyHirePanel,HireAvailabilityBadge,type HireAvailability} from '../src/components/HourlyHire';
import {AgentTaskWorkspace} from '../src/components/AgentTaskWorkspace';
import {LiveTrackingView} from '../src/components/LiveTrackingView';
import {operation,jobCommand,type Job} from '../src/services/operations';
import '../src/styles.css';import '../src/design-system.css';import '../src/components/operations.css';import '../src/customer-layout.css';
const worker=new URLSearchParams(location.search).has('worker');
function Preview(){
 const [job,setJob]=useState<Job|null>(null),[id,setId]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[screen,setScreen]=useState('requests'),[availability,setAvailability]=useState<HireAvailability|null>(null);
 const load=async()=>{if(id)setJob(await operation<Job>('/jobs/'+id,{}, {force:true}));};
 useEffect(()=>{void load().catch(e=>setError(e.message));},[id]);
 useEffect(()=>{void fetch('/api/operations/hiring/availability/worker').then(r=>r.json()).then(d=>setAvailability(d.availability));},[]);
 const act=async(action:string,payload={})=>{if(!job)return;setBusy(true);try{const j=await jobCommand(job,action,payload);setJob(j);return j;}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <main className="repaido-customer-shell operations" style={{maxWidth:800,margin:'auto',padding:16}}><h1>Local hourly hiring QA</h1><p>Disposable records only · no real payment.</p><button onClick={()=>setScreen(screen==='requests'?'directory':'requests')}>Toggle directory</button><HireAvailabilityBadge workerId="worker" initial={availability} live/>{error&&<p role="alert">{error}</p>}{screen==='directory'?<Hiring city="Balasore" onSignIn={()=>{}} onBooking={setId} onRequests={()=>setScreen('requests')}/>:<><HireRequests worker={worker} onBooking={setId}/>{worker&&<WorkerMembership/>}</>}{job&&(worker?<AgentTaskWorkspace job={job} busy={busy} error={error} onClose={()=>{setJob(null);setId('');}} onRefresh={load} onRun={act} onShare={async()=>{}} onStop={async()=>{}}/>:<LiveTrackingView job={job} onClose={()=>{setJob(null);setId('');}} onRefresh={load}/>)}</main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
