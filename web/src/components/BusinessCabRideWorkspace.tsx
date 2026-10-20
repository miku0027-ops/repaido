import {RideBusinessRecords,type useBusinessRecords} from './LocalBusiness';
import {ResumeRide,RideWorkspace,useRideMinimized} from './RideWorkspace';

/** Owners accept cab requests; assigned drivers handle confirmed journeys.
 * Reuse the same native command/payment controls as booking records. */
export function BusinessCabRideWorkspace({records,role}:{records:ReturnType<typeof useBusinessRecords>;role:'cab_owner'|'driver'}){
 const rank:Record<string,number>={in_progress:0,on_the_way:1,reserved:2,requested:3,completion_pending:4,balance_due:5,accepted:6,disputed:7};
 const rows=records.rows.filter(row=>row.mode==='cab'&&rank[row.state]!==undefined&&row.customer_id!==records.uid&&(role==='cab_owner'?row.owner_id===records.uid||row.state==='requested':row.driver_id===records.uid||!row.driver_id&&row.owner_id===records.uid));
 const request=role==='cab_owner'?rows.find(row=>row.state==='requested'&&(!row.offer_expires_at||row.offer_expires_at>Date.now()/1000)):null;
 const ride=request||rows.sort((a,b)=>rank[a.state]-rank[b.state]||a.starts_at-b.starts_at)[0];
 const [minimized,setMinimized]=useRideMinimized(records.uid+':cab:'+(ride?.id||''));
 if(!ride)return null;
 const status=ride.state.replaceAll('_',' '),show=!!request||!minimized;
 return <>{!show&&<ResumeRide kind="cab" status={status} onOpen={()=>setMinimized(false)}/>}<RideWorkspace key={ride.id} open={show} kind="cab" title={request?'New cab request':'Your cab journey'} status={status} locked={!!request} onMinimize={()=>setMinimized(true)}><RideBusinessRecords kind="rides" records={{...records,rows:[ride]}} owner managementRole={role} embedded workspace/></RideWorkspace></>;
}
