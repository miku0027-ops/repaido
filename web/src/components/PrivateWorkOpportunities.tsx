import {useEffect,useRef,useState} from 'react';
import {House,MapPin,ArrowRight} from 'lucide-react';
import {auth} from '../firebase';
import {workJobs,subscribeWorkReads,clearWorkReads} from '../services/repaidiansWorkService';
import type {WorkJob,WorkJobsPage} from '../types/repaidiansWork';
import {Modal} from './ui';
import {ProjectDetail} from './WorkNetwork';
import {networkMoney} from './workNetworkApi';

/** Private customer work shares genuine hiring records, without exposing its site or budget. */
export function PrivateWorkOpportunities({query,sector}:{query:string;sector:string}){
 const account=auth.currentUser?.uid||localStorage.getItem('repaido.token')||'';
 const [data,setData]=useState<WorkJobsPage|null>(null),[selected,setSelected]=useState<WorkJob|null>(null),[error,setError]=useState(''),[cursor,setCursor]=useState(''),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false);
 const generation=useRef(0);
 useEffect(()=>subscribeWorkReads(()=>setRevision(value=>value+1)),[]);
 useEffect(()=>{setCursor('');setData(null);setSelected(null);},[account,query,sector]);
 useEffect(()=>{const current=++generation.current,controller=new AbortController();setBusy(true);setError('');void workJobs(account,{workType:'private_request',query,sector,limit:4,cursor},false,controller.signal).then(result=>{if(current===generation.current)setData(result);}).catch(error=>{if(!controller.signal.aborted&&current===generation.current)setError(error.message);}).finally(()=>{if(current===generation.current)setBusy(false);});return()=>{generation.current++;controller.abort();};},[account,query,sector,cursor,revision]);
 return <section className="contract-private-opportunities" aria-label="Private customer work"><div className="tender-section-heading"><h2><House size={16}/>Private work</h2><span>Customer projects</span></div>{error?<details><summary>Private opportunities could not load</summary><p>{error}</p><button onClick={()=>setRevision(value=>value+1)}>Retry</button></details>:busy&&!data?<p role="status">Finding relevant private work…</p>:!data?.items.length?<p>No matching private work requests are open yet.</p>:<div className="contract-private-cards">{data.items.map(job=><article key={job.id}><span className="contract-chip">Private work request</span><h3>{job.title}</h3><p><MapPin size={14}/>{job.city} · {job.ownerName}</p><strong>{networkMoney(job.dailyRatePaise)}<small>/day · offered role rate</small></strong><p>{job.skills.slice(0,3).join(' · ')}</p>{job.application&&<span className="contract-chip">Application · {job.application.status.replaceAll('_',' ')}</span>}<small>Apply by {new Date(job.deadline).toLocaleDateString('en-IN',{day:'numeric',month:'short',timeZone:'Asia/Kolkata'})}</small><button onClick={()=>setSelected(job)}>Work & joining terms<ArrowRight size={16}/></button></article>)}</div>}<div className="contract-private-pages">{cursor&&<button disabled={busy} onClick={()=>setCursor('')}>First requests</button>}{data?.nextCursor&&<button disabled={busy} onClick={()=>setCursor(data.nextCursor!)}>More private work</button>}</div>{selected&&<Modal title={selected.title} className="work-network-sheet wn-nested contract-hiring-dialog" onClose={()=>setSelected(null)}><ProjectDetail project={selected.details} onApplied={()=>{clearWorkReads();setSelected(null);setRevision(value=>value+1);}}/></Modal>}</section>;
}
