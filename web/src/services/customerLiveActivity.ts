/** Home is a summary of participant records, never a second booking engine. */
export type LiveActivityTarget={kind:'bike'|'ride'|'shared'|'job';id:string;bookingKind?:'hiring'|'visits'};
export type ActivityRecord=Record<string,any>;
export type ActivitySource={rows:ActivityRecord[];receivedAt:number;serverTime:number;error?:string};
export type ActivitySources=Partial<Record<'bike'|'ride'|'shared'|'job',ActivitySource>>;
export type CustomerActivity={key:string;target:LiveActivityTarget;type:string;status:string;detail:string;destination:string;mode:'moving'|'waiting'|'arrival';priority:number;startsAt:number;stale:boolean};
const number=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const text=(value:unknown,fallback='')=>typeof value==='string'&&value.trim()?value.trim():fallback;
const own=(row:ActivityRecord,uid:string)=>row.customer_id===uid;
const closed=new Set(['completed','cancelled','declined','expired','unavailable','released']);
const physical=new Set(['on_the_way','en_route','arrived','in_progress']);
function sourceClock(source:ActivitySource,now:number){return source.serverTime+Math.max(0,now-source.receivedAt);}
function nearTime(row:ActivityRecord,now:number){
 const start=number(row.starts_at)?row.starts_at:number(row.starts_epoch)?row.starts_epoch:NaN;
 const end=number(row.ends_at)?row.ends_at:start+Math.max(3600,(row.duration_minutes||60)*60);
 return number(start)&&now>=start-3600&&now<=end+1800;
}
function inside(stop:ActivityRecord|undefined,now:number){return stop?.status==='inside'&&number(stop.valid_until)&&stop.valid_until>=now;}
function freshBike(row:ActivityRecord,now:number){const p=row.position;return p&&number(p.lat)&&number(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180&&number(p.received_at)&&now-p.received_at>=-5&&now-p.received_at<=75;}
function make(kind:LiveActivityTarget['kind'],row:ActivityRecord,source:ActivitySource,now:number,values:Partial<CustomerActivity>&Pick<CustomerActivity,'type'|'status'|'mode'|'priority'>):CustomerActivity{
 return {key:kind+':'+row.id,target:{kind,id:row.id},detail:'Open for the latest details',destination:text(row.dropoff_address||row.destination_address||row.service_name,'Your confirmed booking'),startsAt:row.starts_at||row.starts_epoch||row.created_at||0,stale:!!source.error||now-source.receivedAt>35,...values};
}
export function selectCustomerLiveActivity(sources:ActivitySources,uid:string,now=Date.now()/1000):CustomerActivity[]{
 if(!uid||!number(now))return [];
 const result:CustomerActivity[]=[];
 for(const [kind,source] of Object.entries(sources) as [keyof ActivitySources,ActivitySource][]){
  if(!source||!Array.isArray(source.rows))continue;
  const current=sourceClock(source,now),stale=!!source.error||now-source.receivedAt>35;
  for(const row of source.rows){
   if(!row||!text(row.id)||closed.has(row.state))continue;
   if(kind==='bike'){
    if(!own(row,uid)||!['dispatch_pending','offered','queued','accepted','on_the_way','arrived','in_progress'].includes(row.state))continue;
    if(['dispatch_pending','offered','queued','accepted'].includes(row.state)&&number(row.expires_at)&&row.expires_at<=current)continue;
    const atPickup=!stale&&['arrived','on_the_way'].includes(row.state)&&freshBike(row,current)&&inside(row.stop_status?.pickup,current);
    const atDrop=!stale&&row.state==='in_progress'&&freshBike(row,current)&&inside(row.stop_status?.destination,current);
    const status=atDrop?'Your drop-off is close':atPickup?'Your rider is at pickup':({dispatch_pending:'Finding your rider',offered:'Waiting for rider acceptance',queued:row.accepted_by_driver?'Your next slot is accepted':'Next slot requested',accepted:'Your rider is confirmed',on_the_way:'Your rider is on the way',arrived:'Pickup reached · check your ride',in_progress:'Your bike ride is in progress'} as Record<string,string>)[row.state];
    result.push(make('bike',row,source,now,{type:'Bike ride',status,mode:atPickup||atDrop?'arrival':physical.has(row.state)&&row.state!=='arrived'?'moving':'waiting',priority:atPickup||atDrop?0:row.state==='in_progress'?1:row.state==='queued'?6:3,detail:row.state==='queued'?'The rider is finishing another trip. Timing can change.':row.state==='dispatch_pending'?'No rider is reserved until matching completes.':row.state==='offered'?'Your rider still needs to accept.':row.state==='arrived'&&!atPickup?'Open the ride to check the latest pickup location.':text(row.rider_name,'Open your ride for pickup details')}));
   }else if(kind==='ride'){
    if(!own(row,uid)||!['requested','accepted','reserved','on_the_way','in_progress'].includes(row.state))continue;
    if(!physical.has(row.state)&&!nearTime(row,current))continue;
    if(row.state==='requested'&&number(row.offer_expires_at)&&row.offer_expires_at<=current)continue;
    const rental=row.mode==='rental';
    const status=({requested:'Waiting for owner acceptance',accepted:'Advance needed to reserve',reserved:rental?'Your car pickup is coming up':'Your cab pickup is coming up',on_the_way:'Your cab is on the way',in_progress:rental?'Your rental is in progress':'Your cab ride is in progress'} as Record<string,string>)[row.state];
    result.push(make('ride',row,source,now,{type:rental?'Self-drive':'Cab ride',status,detail:text(row.quote?.vehicle?.name||row.vehicle_name,'Open your confirmed trip'),mode:physical.has(row.state)?'moving':'waiting',priority:row.state==='in_progress'?1:4}));
   }else if(kind==='shared'){
    if(row.owner_id===uid||row.driver_id===uid||!['scheduled','in_progress'].includes(row.state))continue;
    const mine=Array.isArray(row.passengers)?row.passengers.find((p:ActivityRecord)=>p.customer_id===uid&&['requested','accepted','boarded'].includes(p.state)):undefined;
    if(!mine||mine.state!=='boarded'&&!nearTime(row,current))continue;
    const stop=row.stop_status?.passengers?.[mine.id],arrival=!stale&&inside(stop,current);
    const status=arrival?(mine.state==='boarded'?'Your shared drop-off is close':'Driver near your pickup'):mine.state==='boarded'?(row.state==='in_progress'?'Your shared ride is in progress':'You’re on board'):mine.state==='accepted'?'Waiting for your shared pickup':'Waiting for the owner’s reply';
    result.push(make('shared',row,source,now,{type:row.vehicle_kind==='bike'?'Shared bike':'Shared ride',status,mode:arrival?'arrival':mine.state==='boarded'?'moving':'waiting',priority:arrival?0:mine.state==='boarded'?1:5,detail:mine.state==='requested'?'Your seat is confirmed only after acceptance.':text(row.vehicle_name,'Open your agreed pickup'),destination:text(row.destination_address,'Your agreed drop-off')}));
   }else if(kind==='job'){
    if(!own(row,uid)||!['searching','offered','accepted','follow_up_scheduled','en_route','on_the_way','arrived','in_progress','collecting_parts','stop_requested'].includes(row.state))continue;
    const ongoing=physical.has(row.state)||['collecting_parts','stop_requested'].includes(row.state);
    if(row.state==='follow_up_scheduled'&&!number(row.starts_epoch))continue;
    if(!ongoing&&!nearTime(row,current))continue;
    const hiring=!!row.hourly_hire||text(row.service_id).startsWith('day-hire-');
    const status=({searching:'Finding your professional',offered:'Waiting for acceptance',accepted:'Your professional is confirmed',follow_up_scheduled:'Your follow-up visit is scheduled',en_route:'Your professional is on the way',on_the_way:'Your professional is on the way',arrived:'Your professional has arrived',in_progress:row.hire_break?.state==='active'?'Your professional is on a break':'Work is in progress',collecting_parts:'Your professional is collecting parts',stop_requested:'Work stop requested'} as Record<string,string>)[row.state];
    result.push(make('job',row,source,now,{target:{kind:'job',id:row.id,bookingKind:hiring?'hiring':'visits'},type:hiring?'Personal hire':'Service visit',status,mode:row.state==='arrived'&&!stale?'arrival':physical.has(row.state)?'moving':'waiting',priority:row.state==='arrived'?0:ongoing?2:7,detail:row.state==='collecting_parts'?'Open your booking for approved parts and next steps.':row.state==='stop_requested'?'Open your booking to review the work pause.':text(row.worker_name,'Open your booking for the latest update'),destination:text(row.service_name,'Your service booking')}));
   }
  }
 }
 return result.sort((a,b)=>a.priority-b.priority||a.startsAt-b.startsAt||a.key.localeCompare(b.key));
}
