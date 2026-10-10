import {useEffect,useState} from 'react';
import {Bell,ArrowRight} from 'lucide-react';
import {bindTransportBell,transportBellEnabled,subscribeTransportBell,repeatTransportBell,receiveTransportNotes} from '../services/transportBell';
import {TransportNotificationSettings} from './TransportNotificationSettings';
import {useOperationResource} from '../hooks/useOperationResource';

/** A pending request stays visible until its native state changes. Audio is opt-in. */
export function SharedRideRequestAlerts({rows,accountKey,onOpen,driver=false,settings=false}:{rows:any[];accountKey:string;onOpen:(row:any)=>void;driver?:boolean;settings?:boolean}){
 const [enabled,setEnabled]=useState(false),[silenced,setSilenced]=useState<string[]>([]);const notes=useOperationResource<{notifications:any[]}>('/notifications',10000);
 const pending=rows.filter(row=>row.state==='scheduled').flatMap(row=>row.passengers.filter((passenger:any)=>passenger.state==='requested').map((passenger:any)=>({row,passenger})));
 const sounding=pending.filter(({passenger})=>!silenced.includes(passenger.id)).map(({passenger})=>passenger.id).sort().join(',');
 useEffect(()=>{bindTransportBell(accountKey);setEnabled(transportBellEnabled());setSilenced([]);return subscribeTransportBell(()=>setEnabled(transportBellEnabled()));},[accountKey]);
 useEffect(()=>{if(enabled&&sounding)return repeatTransportBell();},[enabled,sounding,accountKey]);
 useEffect(()=>{if(notes.data)receiveTransportNotes(notes.data.notifications,accountKey);},[notes.data,accountKey]);
 return <>{settings&&<div className="suite-card"><TransportNotificationSettings accountKey={accountKey}/></div>}{pending.length>0&&<div className="suite-request-cue has-requests">
  {pending.length>0&&<div className="suite-request-summary"><Bell size={23} aria-hidden="true"/><div><strong role="status">{pending.length} shared-ride join request{pending.length===1?'':'s'}</strong><p>{driver?'Review passenger details. The owner confirms seats.':'Review the pickup and passenger before accepting.'}</p></div><button onClick={()=>onOpen(pending[0].row)}>Review request<ArrowRight size={16}/></button></div>}
  {enabled&&sounding&&<button onClick={()=>setSilenced(pending.map(({passenger})=>passenger.id))}>Silence this alert</button>}
 </div>}</>;
}
