import {lazy,Suspense,useEffect,useState} from 'react';
import {operation,type Job} from '../services/operations';
const Map=lazy(()=>import('./PickupMap'));
type Tracking={phase:string;status:string;position:null|{lat:number;lng:number;accuracy:number;received_at:number};server_time:number};
export function taskMessage(job:Job){
 const role=job.worker_role==='specialist'?'specialist':'technician';
 if(job.state==='searching'||job.state==='offered')return 'Searching for a nearby professional';
 if(job.state==='accepted')return job.reminder_ack_at?`Visit acknowledged · waiting for your ${role} to leave for your location`:`Your ${role} accepted · waiting for visit acknowledgement`;
 if(job.state==='en_route')return `Your ${role} has left for your location`;
 return '';
}
export function CustomerTaskProgress({job}:{job:Job}){
 const [tracking,setTracking]=useState<Tracking|null>(null),[error,setError]=useState(''),[showMap,setShowMap]=useState(false),[retry,setRetry]=useState(0);
 const active=['en_route','arrived','in_progress','collecting_parts'].includes(job.state);
 useEffect(()=>{setTracking(null);if(!active)return;let stopped=false,running=false;
 const refresh=async()=>{if(document.hidden||running)return;running=true;try{const data=await operation<Tracking>(`/jobs/${job.id}/tracking`);if(!stopped){setTracking(data);setError('');}}catch(e){if(!stopped){setTracking(null);setError((e as Error).message);}}finally{running=false;}};
 void refresh();const timer=setInterval(()=>void refresh(),15000);document.addEventListener('visibilitychange',refresh);return()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};},[job.id,job.state,active,retry]);
 const index=({searching:0,offered:0,accepted:1,en_route:2,arrived:3,in_progress:4,collecting_parts:4,completion_pending:5,completed:6} as Record<string,number>)[job.state];
 const steps=['Finding help','Accepted','On the way','Arrived','Working','Your review','Completed'];
 const phase=tracking?.phase==='travelling_to_shop'?'Travelling to the shop':tracking?.phase==='returning_from_shop'?'Returning with your parts':job.state==='en_route'?'Travelling to your location':'At your service visit';
 return <section className="task-progress" aria-label="Task progress"><h3>Your visit, step by step</h3>{taskMessage(job)&&<p role="status">{taskMessage(job)}</p>}
 {index!==undefined?<ol>{steps.map((label,i)=><li key={label} aria-current={i===index?'step':undefined} className={i<=index?'is-reached':''}><span aria-hidden="true">{i<index?'✓':i+1}</span>{label}</li>)}</ol>:<p>{job.state.replaceAll('_',' ')} · Check the task updates below.</p>}
 {job.reminder_ack_at&&<p className="ops-help">Visit acknowledged on {new Date(job.reminder_ack_at*1000).toLocaleString('en-IN')}.</p>}
 {active&&<div className="task-tracking"><h4>{phase}</h4><p className="ops-help">Location refreshes every 15 seconds while open. GPS may be delayed; this is not a route or arrival-time estimate.</p>
 {error?<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>Retry tracking</button></p>:tracking?.position?<><p>Updated {new Date(tracking.position.received_at*1000).toLocaleTimeString()} · accuracy ±{Math.round(tracking.position.accuracy)} m</p><button aria-expanded={showMap} onClick={()=>setShowMap(v=>!v)}>{showMap?'Hide live map':'Show live map'}</button>{showMap&&<Suspense fallback={<p>Loading map…</p>}><Map position={tracking.position}/></Suspense>}</>:<p role="status">{tracking?.status==='stale'?'Location is out of date. Waiting for a fresh reading.':tracking?.status==='not_sharing'?'The professional is not sharing location. Task updates remain available.':'Waiting for a device location…'}</p>}</div>}
 </section>;
}
