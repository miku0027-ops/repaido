import {useEffect,useState,type FormEvent} from 'react';
import {Navigation,Clock3} from 'lucide-react';
import {useOperationResource} from '../hooks/useOperationResource';
import {business} from '../services/localBusiness';
import {currentPosition} from '../services/operations';
import {ContractError,useCustomContractAction} from './customContractUI';

export const sharedDate=(t:number)=>new Date(t*1000).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
const indiaInput=(t:number)=>new Date((t+19800)*1000).toISOString().slice(0,16);
export function RescheduleDeparture({row,busy,error,onSubmit}:{row:any;busy:boolean;error:string;onSubmit:(details:object)=>void}){
 const minimum=Math.ceil(Math.max(Date.now()/1000+300,row.starts_at+60)/60)*60;
 const [start,setStart]=useState(indiaInput(Math.max(minimum,row.starts_at+900)));
 const parsed=new Date(start+'+05:30').getTime()/1000,arrival=parsed+row.ends_at-row.starts_at;
 const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const form=new FormData(e.currentTarget);onSubmit({starts_at:parsed,ends_at:arrival,reason:String(form.get('reason')).trim()});};
 return <form className="compact-wizard shared-reschedule-form" onSubmit={submit}><p>Current departure: <strong>{sharedDate(row.starts_at)}</strong></p><label>New departure · India time<input required name="start" type="datetime-local" min={indiaInput(minimum)} value={start} onChange={e=>setStart(e.target.value)}/></label><p>Expected arrival: <strong>{Number.isFinite(arrival)?sharedDate(arrival):'Choose a departure time'}</strong></p><label>Reason for passengers<textarea required name="reason" minLength={10} maxLength={300} placeholder="For example, waiting for the remaining seats to fill."/></label><p>Passengers receive the new time and reason. Their seats and fares stay the same; no approval is needed.</p><ContractError error={error}/><button disabled={busy} aria-busy={busy} className="ops-primary">{busy?'Updating departure…':'Reschedule & notify passengers'}</button></form>;
}
export function SharedDepartureNotice({row,operate,boarded,onReschedule}:{row:any;operate:boolean;boarded:boolean;onReschedule:()=>void}){
 const [now,setNow]=useState(Date.now()/1000);useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()/1000),15000);return()=>clearInterval(timer);},[]);
 const close=row.state==='scheduled'&&row.starts_at-900<=now&&now<=row.starts_at+900;
 return <>{row.reschedule&&<aside className="shared-time-change"><strong>Departure changed · {sharedDate(row.starts_at)}</strong><p>Previously {sharedDate(row.reschedule.previous_starts_at)}. {row.reschedule.reason}</p>{!operate&&<small>Your seat and fare stay the same. No response is needed.</small>}</aside>}{operate&&close&&<aside className="shared-departure-cue"><Clock3 size={18} aria-hidden="true"/><div><strong>{row.starts_at>now?'Departure is coming up':'Scheduled departure time reached'}</strong><p>{row.available_seats>0?`${row.available_seats} seats are still available.`:'All seats are reserved.'} Check boarding and keep the cab’s location live.</p></div>{row.available_seats>0&&!boarded&&<button onClick={onReschedule}>Reschedule departure</button>}</aside>}</>;
}
export function SharedPassengerArrival({row}:{row:any}){
 const source=useOperationResource<any>('/local-business/shared/'+row.id+'/arrival',10000),action=useCustomContractAction();
 const [sharing,setSharing]=useState(false),[issue,setIssue]=useState(''),[check,setCheck]=useState<any>(null),[clock,setClock]=useState(Date.now()/1000);
 useEffect(()=>{setCheck(null);setSharing(false);setIssue('');},[row.id]);
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()/1000),10000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{if(!sharing)return;let alive=true,running=false;const send=async()=>{if(running||document.hidden||Date.now()/1000>=row.starts_at)return;running=true;try{const position=await currentPosition(true);if(alive){const result=await business('/shared/'+row.id+'/arrival-position',position);if(alive){setCheck(result);setIssue('');}}}catch(e){if(alive)setIssue((e as Error).message);}finally{running=false;}};const timer=setInterval(()=>void send(),20000);return()=>{alive=false;clearInterval(timer);};},[sharing,row.id,row.starts_at]);
 const value=check&&(!source.data||check.server_time>source.data.server_time)?check:source.data;
 const pin=value?.cab_position&&clock-value.cab_position.received_at<=75?value.cab_position:null;
 const status=value&&clock-value.server_time<=75?value.location_status:'unknown';
 return <aside className="shared-passenger-arrival" aria-label="Find your cab"><strong>Departure · {sharedDate(row.starts_at)}</strong><p role="status">{status==='inside'?'You are within 300 m of the cab. Wait for the driver to record boarding.':status==='outside'?'You are outside the cab’s 300 m arrival area. Follow directions to reach it.':'Check the cab’s current location before heading to pickup.'}</p>{pin?<a className="shared-cab-directions" href={`https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}`} target="_blank" rel="noreferrer"><Navigation size={16} aria-hidden="true"/>Directions to the cab</a>:<p className="shared-location-waiting">Waiting for the cab’s live location. The agreed pickup pin is available below.</p>}{row.starts_at-3600<=clock&&clock<row.starts_at&&<button disabled={action.busy} aria-pressed={sharing} onClick={()=>void action.run(async()=>{if(sharing){setSharing(false);return;}const position=await currentPosition(true);setCheck(await business('/shared/'+row.id+'/arrival-position',position));setSharing(true);})}>{action.busy?'Checking arrival…':sharing?'Stop arrival check':'Check my arrival location'}</button>}<small>Arrival checks use precise location while this page is open. Readings stop at departure; only you can see your arrival status.</small><ContractError error={source.error||issue||action.error}/></aside>;
}
