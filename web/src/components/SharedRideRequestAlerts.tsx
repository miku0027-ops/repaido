import {useEffect,useRef,useState} from 'react';
import {Bell,BellOff,ArrowRight} from 'lucide-react';
import {startTaskBell} from '../services/taskBell.mjs';

/** A pending request stays visible until its native state changes. Audio is opt-in. */
export function SharedRideRequestAlerts({rows,accountKey,onOpen,driver=false}:{rows:any[];accountKey:string;onOpen:(row:any)=>void;driver?:boolean}){
 const context=useRef<AudioContext|null>(null),[enabled,setEnabled]=useState(false),[silenced,setSilenced]=useState<string[]>([]),[issue,setIssue]=useState('');
 const pending=rows.filter(row=>row.state==='scheduled').flatMap(row=>row.passengers.filter((passenger:any)=>passenger.state==='requested').map((passenger:any)=>({row,passenger})));
 const sounding=pending.filter(({passenger})=>!silenced.includes(passenger.id)).map(({passenger})=>passenger.id).sort().join(',');
 useEffect(()=>{setEnabled(false);setSilenced([]);setIssue('');return()=>{void context.current?.close();context.current=null;};},[accountKey]);
 useEffect(()=>{if(enabled&&sounding)return startTaskBell(context.current);},[enabled,sounding,accountKey]);
 const enable=async()=>{try{if(!context.current)context.current=new AudioContext();await context.current.resume();if(context.current.state!=='running')throw Error();setEnabled(true);setSilenced([]);setIssue('');}catch{setIssue('Sound could not start. The request banner will stay visible.');}};
 return <div className={'suite-request-cue'+(pending.length?' has-requests':'')}>
  {pending.length>0&&<div className="suite-request-summary"><Bell size={23} aria-hidden="true"/><div><strong role="status">{pending.length} shared-ride join request{pending.length===1?'':'s'}</strong><p>{driver?'Review passenger details. The owner confirms seats.':'Review the pickup and passenger before accepting.'}</p></div><button onClick={()=>onOpen(pending[0].row)}>Review request<ArrowRight size={16}/></button></div>}
  <div className="suite-bell-controls">{!enabled?<button onClick={()=>void enable()}><Bell size={16} aria-hidden="true"/>Enable request bell</button>:<><span>Request bell on</span>{sounding&&<button onClick={()=>setSilenced(pending.map(({passenger})=>passenger.id))}><BellOff size={16} aria-hidden="true"/>Silence bell</button>}{!sounding&&pending.length>0&&<button onClick={()=>setSilenced([])}>Ring again</button>}<button onClick={()=>{setEnabled(false);void context.current?.suspend();}}>Turn bell off</button></>}{issue&&<p role="alert">{issue}</p>}</div>
 </div>;
}
