import {useEffect,useState} from 'react';
import {AlertCircle,CheckCircle2,Clock,RefreshCw,Settings,Payments} from '../icons';
import {useOperationResource} from '../hooks/useOperationResource';
import {money,operation} from '../services/operations';
import {AdminStatus,AdminTable} from './AdminTable';
import {BikePayrollAdmin} from './BikePayrollAdmin';
import {BikeIndependentAdmin} from './BikeIndependentAdmin';
import './bike-ride-admin.css';

export type BikeAdminPolicy={
 version:number;enabled:boolean;cash_enabled:boolean;base_paise:number;per_km_paise:number;per_minute_paise:number;minimum_paise:number;gst_bps:number;
 service_radius_metres:number;pickup_radius_metres:number;promo_enabled:boolean;promo_started_at:number|null;promo_ends_at:number|null;promo_months:number;free_distance_metres:number;weekly_free_limit:number;cooldown_hours:number;
 promo_planning_budget_paise:number;demand_surcharge_cap_bps:number;terms:string;evidence_reference:string;paid_ready:boolean;promo_ready:boolean;routing_ready:boolean;dispatch_ready:boolean;tax_reviewed:boolean;promo_terms_reviewed:boolean;service_center:{lat:number;lng:number}|null;service_area_radius_metres:number;service_area_reviewed:boolean;city:string;payroll_ready:boolean;funding_ready:boolean;geography_ready:boolean;
};
type BikeRideRecord={id:string;state:string;version:number;vehicle_name?:string;rider_name?:string;created_at:number;queued?:boolean;available_at?:number;financial_hold?:boolean;dispute_previous_state?:string;dispute_note?:string;pricing?:{free:boolean;customer_total_paise:number}};
type BikeDispatchHealth={ready:boolean;mode:string;production_ready:boolean;configured:boolean;worker_online:boolean;heartbeat_age_seconds:number|null;broker_connected:boolean;outbox_backlog:number|null;outbox_backlog_is_lower_bound?:boolean;consumer_lag:number|null;reason:string;healthy_workers?:number;degraded_workers?:number};
type BikeEconomics={rider_count:number;monthly_salary_paise:number;scenarios:{distance_metres:number;ordinary_fare_paise:number;paid_rides_to_cover_salary_only:number|null}[];profit_estimate_paise:null;excluded_costs:string[];assumptions:string};
type BikeAdminOverview={policy:BikeAdminPolicy;metrics:{online_riders:number;active_rides:number;queued_rides:number;offers:number;complete?:boolean;scope?:string};recent_rides:BikeRideRecord[];recent_rides_next_cursor?:string|null;recent_rides_scope?:string;dispatch_health?:BikeDispatchHealth;economics?:BikeEconomics};
type NumberField='base_paise'|'per_km_paise'|'per_minute_paise'|'minimum_paise'|'gst_bps'|'service_radius_metres'|'pickup_radius_metres'|'free_distance_metres'|'weekly_free_limit'|'promo_planning_budget_paise'|'demand_surcharge_cap_bps'|'service_area_radius_metres';
type Draft=Record<NumberField,string>&{cash_enabled:boolean;promo_enabled:boolean;promo_started_at:string;terms:string;evidence_reference:string;tax_reviewed:boolean;promo_terms_reviewed:boolean;service_area_reviewed:boolean;center_lat:string;center_lng:string};
const numberFields:NumberField[]=['base_paise','per_km_paise','per_minute_paise','minimum_paise','gst_bps','service_radius_metres','pickup_radius_metres','free_distance_metres','weekly_free_limit','promo_planning_budget_paise','demand_surcharge_cap_bps','service_area_radius_metres'];
const scaledFields=new Set<NumberField>(['base_paise','per_km_paise','per_minute_paise','minimum_paise','gst_bps','promo_planning_budget_paise','demand_surcharge_cap_bps']);
const dateTime=(epoch?:number|null)=>epoch?new Date(epoch*1000).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+' IST':'Not scheduled';
function draftFrom(policy:BikeAdminPolicy):Draft{
 const fields=Object.fromEntries(numberFields.map(key=>[key,String(policy[key]/(scaledFields.has(key)?100:1))])) as Record<NumberField,string>;
 // datetime-local is deliberately fixed to India's campaign calendar, independent of the admin device.
 const promo_started_at=policy.promo_started_at?new Date(policy.promo_started_at*1000+330*60000).toISOString().slice(0,16):'';
 return {...fields,cash_enabled:policy.cash_enabled,promo_enabled:policy.promo_enabled,promo_started_at,terms:policy.terms,evidence_reference:policy.evidence_reference,tax_reviewed:policy.tax_reviewed,promo_terms_reviewed:policy.promo_terms_reviewed,service_area_reviewed:policy.service_area_reviewed,center_lat:policy.service_center?String(policy.service_center.lat):'',center_lng:policy.service_center?String(policy.service_center.lng):''};
}
function policyBody(base:BikeAdminPolicy,draft:Draft,enabled=base.enabled){
 const values=Object.fromEntries(numberFields.map(key=>{
  const value=draft[key],scale=scaledFields.has(key)?100:1;
  if(!/^\d+(?:\.\d{1,2})?$/.test(value)||scale===1&&value.includes('.'))throw new Error('Enter valid amounts with up to two decimal places and whole-number distances.');
  const parsed=Math.round(Number(value)*scale);
  if(!Number.isSafeInteger(parsed))throw new Error('An amount exceeds the supported limit.');
  return [key,parsed];
 }));
 const promo_started_at=draft.promo_started_at===draftFrom(base).promo_started_at?base.promo_started_at:draft.promo_started_at?Date.parse(draft.promo_started_at+':00+05:30')/1000:null;
 if(promo_started_at!==null&&!Number.isFinite(promo_started_at))throw new Error('Choose a valid promotion start time.');
 const hasCenter=draft.center_lat!==''||draft.center_lng!=='';
 const service_center=hasCenter?{lat:Number(draft.center_lat),lng:Number(draft.center_lng)}:null;
 if(hasCenter&&(draft.center_lat===''||draft.center_lng===''||!Number.isFinite(service_center!.lat)||!Number.isFinite(service_center!.lng)||Math.abs(service_center!.lat)>90||Math.abs(service_center!.lng)>180))throw new Error('Enter both valid operating-area coordinates.');
 return {...values,per_minute_paise:0,tax_reviewed:draft.tax_reviewed,promo_terms_reviewed:draft.promo_terms_reviewed,service_area_reviewed:draft.service_area_reviewed,service_center,expected_version:base.version,enabled,cash_enabled:draft.cash_enabled,promo_enabled:draft.promo_enabled,promo_started_at,cooldown_hours:base.cooldown_hours,terms:draft.terms,evidence_reference:draft.evidence_reference};
}

export function BikeRideAdmin(){
 const resource=useOperationResource<BikeAdminOverview>('/bike-rides/admin/overview',15000),data=resource.data;
 return <section className="bike-admin" aria-labelledby="bike-admin-title">
  <header className="bike-admin-heading"><div><span className="ops-eyebrow">Bike operations</span><h2 id="bike-admin-title">Riders, queues & launch policy</h2></div><button type="button" disabled={resource.busy} onClick={()=>void resource.refresh()}><RefreshCw size={17} aria-hidden="true"/>{resource.busy?'Refreshing…':'Refresh bikes'}</button></header>
  {resource.error&&<div className="ops-notice" role="alert"><strong>Bike operations unavailable.</strong><p>{resource.error}</p>{data&&<p>Showing the last loaded snapshot.</p>}</div>}
  {!data&&!resource.error&&<p role="status">Loading bike operations…</p>}
  {data&&<>
   <div className="bike-admin-status"><AdminStatus value={data.policy.enabled?'active':'paused'}/><span>{data.policy.service_radius_metres/1000} km trips · {data.policy.pickup_radius_metres/1000} km rider search</span><small>Policy v{data.policy.version}</small></div>
   <dl className="bike-admin-metrics">{[{name:'Online riders',value:data.metrics.online_riders},{name:'Active rides',value:data.metrics.active_rides},{name:'Queued next',value:data.metrics.queued_rides},{name:'Open offers',value:data.metrics.offers}].map(item=><div key={item.name}><dt>{item.name}</dt><dd>{item.value??'Unavailable'}</dd></div>)}</dl>
   <p className="bike-admin-scope">Operational snapshot; refreshes every 15 seconds while visible.{data.metrics.complete===false?' Record limits reached; these counts are partial.':''}</p>
   <BikeDispatchStatus health={data.dispatch_health}/>
   <BikePolicyEditor key={resource.uid} policy={data.policy} onRefresh={()=>resource.refresh()}/>
   <BikePayrollAdmin/>
   <BikeIndependentAdmin/>
   {data.economics&&<details className="bike-admin-panel"><summary><Payments size={18} aria-hidden="true"/>Salary coverage examples<span>Planning only</span></summary><p>Active roster: {data.economics.rider_count} riders. Total monthly salary obligations: {money(data.economics.monthly_salary_paise)}.</p><div className="bike-economics-scroll" role="region" aria-label="Salary coverage examples, scroll for columns" tabIndex={0}><table className="bike-economics-table"><caption>Salary coverage only · Other costs excluded</caption><thead><tr><th scope="col">Trip distance</th><th scope="col">Ordinary paid fare</th><th scope="col">Paid rides to cover monthly salaries</th></tr></thead><tbody>{data.economics.scenarios.map(row=><tr key={row.distance_metres}><th scope="row">{row.distance_metres/1000} km</th><td>{money(row.ordinary_fare_paise)}</td><td>{row.paid_rides_to_cover_salary_only?.toLocaleString('en-IN')??'Not calculable'}</td></tr>)}</tbody></table></div><p>{data.economics.assumptions}</p><p>Excluded: {data.economics.excluded_costs.map(cost=>cost.replaceAll('_',' ')).join(', ')}. Profit is not estimated.</p></details>}
   <BikeRideHistory key={resource.uid} latestRows={data.recent_rides} latestCursor={data.recent_rides_next_cursor} onRefresh={()=>resource.refresh()}/>
  </>}
 </section>;
}

function BikeRideHistory({latestRows,latestCursor,onRefresh}:{latestRows:BikeRideRecord[];latestCursor?:string|null;onRefresh:()=>Promise<void>}){
 const [rows,setRows]=useState(latestRows),[cursor,setCursor]=useState(latestCursor),[paged,setPaged]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 // Preserve an explicitly loaded history snapshot during overview polling.
 // A deliberate refresh returns to the latest page and its current cursor.
 useEffect(()=>{if(!paged){setRows(latestRows);setCursor(latestCursor);}},[latestRows,latestCursor,paged]);
 const refresh=async()=>{setBusy(true);setError('');setPaged(false);try{await onRefresh();}finally{setBusy(false);}};
 const older=async()=>{if(!cursor||busy)return;setBusy(true);setError('');try{const result=await operation<{rides:BikeRideRecord[];next_cursor:string|null;scope:string}>('/bike-rides/admin/bookings?after='+encodeURIComponent(cursor),{}, {background:true,force:true,feedback:false});setRows(prior=>{const found=new Map(prior.map(row=>[row.id,row]));for(const row of result.rides){const old=found.get(row.id);if(!old||row.version>=old.version)found.set(row.id,row);}return Array.from(found.values());});setCursor(result.next_cursor);setPaged(true);}catch(e){setError((e as Error).message);if([401,403].includes((e as Error&{status?:number}).status||0))void onRefresh();}finally{setBusy(false);}};
 return <section aria-label="Bike ride history"><div className="bike-admin-heading"><div><h3>Ride history</h3><p>Active and closed bookings. {paged?'Showing loaded pages; refresh to return to the latest records.':'Latest bookings first. Load older pages when needed.'}</p></div><button type="button" disabled={busy} onClick={()=>void refresh()}>Refresh ride history</button></div>
   {error&&<div className="ops-notice" role="alert"><strong>Older ride history unavailable.</strong><p>{error}</p><p>The loaded records are unchanged.</p></div>}
   <AdminTable label="Bike ride records" rows={rows} rowKey={ride=>ride.id} rowLabel={ride=>'Bike ride '+ride.id.slice(0,8)} empty="No bike ride records in this snapshot." initialSort={{key:'created',direction:'desc'}} columns={[
    {key:'ref',label:'Ride / vehicle',value:ride=>ride.id,render:ride=><><strong>#{ride.id.slice(0,8)}</strong><small>{ride.vehicle_name||'Awaiting vehicle'}</small></>},
    {key:'state',label:'Stage',value:ride=>ride.state,render:ride=><><AdminStatus value={ride.state}/>{ride.queued&&<small>Next in rider queue</small>}</>},
    {key:'rider',label:'Rider',value:ride=>ride.rider_name||'Unassigned'},
    {key:'created',label:'Requested · IST',value:ride=>ride.created_at,render:ride=>dateTime(ride.created_at)},
    {key:'available',label:'Expected availability · IST',value:ride=>ride.available_at||0,render:ride=>ride.available_at?dateTime(ride.available_at):'Not provided'},
   ]} renderDetail={ride=>ride.state==='disputed'?<BikeAdminResolution key={ride.id+':'+ride.version} identifier={ride.id} version={ride.version} amount={ride.pricing?.customer_total_paise} free={ride.pricing?.free} note={ride.dispute_note} onRefresh={refresh}/>:<p>Ride #{ride.id}. Version {ride.version}. No operator resolution is available at this stage.</p>}/>
   {cursor&&<button type="button" disabled={busy} onClick={()=>void older()}>{busy?'Loading history…':error?'Retry older rides':'Load older rides'}</button>}{paged&&!cursor&&<p role="status">All available history pages have been loaded for this snapshot.</p>}
 </section>;
}

function BikePolicyEditor({policy,onRefresh}:{policy:BikeAdminPolicy;onRefresh:()=>Promise<void>}){
 const [base,setBase]=useState(policy),[draft,setDraft]=useState(()=>draftFrom(policy)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[conflict,setConflict]=useState(false);
 const dirty=JSON.stringify(draft)!==JSON.stringify(draftFrom(base));
 useEffect(()=>{if(policy.version>base.version&&!dirty){setBase(policy);setDraft(draftFrom(policy));}},[policy,base.version,dirty]);
 const stale=conflict||policy.version>base.version;
 const reload=async()=>{setBusy(true);setError('');setMessage('');try{const latest=await operation<BikeAdminPolicy>('/bike-rides/admin/policy',{}, {force:true});setBase(latest);setDraft(draftFrom(latest));setConflict(false);setMessage('Latest saved policy loaded.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const save=async(enabled=base.enabled)=>{setBusy(true);setError('');setMessage('');try{const saved=await operation<BikeAdminPolicy>('/bike-rides/admin/policy',{method:'PUT',body:JSON.stringify(policyBody(base,draft,enabled))});setBase(saved);setDraft(draftFrom(saved));setConflict(false);setMessage(enabled===base.enabled?'Policy saved.':'Bike bookings '+(enabled?'activated.':'paused.'));void onRefresh();}catch(e){const failed=e as Error&{status?:number};setError(failed.message);if(failed.status===409){try{const latest=await operation<BikeAdminPolicy>('/bike-rides/admin/policy',{}, {force:true});if(latest.version>base.version)setConflict(true);}catch{/* Keep the actionable server error and the unsaved draft. */}void onRefresh();}}finally{setBusy(false);}};
 const field=(key:NumberField,label:string,min=0,max?:number)=><label key={key}>{label}<input type="number" inputMode={scaledFields.has(key)?'decimal':'numeric'} min={min} max={max} step={scaledFields.has(key)?'0.01':'1'} required value={draft[key]} onChange={event=>{setDraft({...draft,[key]:event.target.value});setMessage('');}}/></label>;
 const canActivate=base.paid_ready&&base.routing_ready&&base.dispatch_ready===true&&base.geography_ready&&base.payroll_ready&&base.funding_ready&&(!base.promo_enabled||base.promo_ready);
 return <details className="bike-admin-panel bike-admin-policy"><summary><Settings size={18} aria-hidden="true"/>Launch & pricing policy<span>{dirty?'Unsaved changes':base.enabled?'Active':'Paused'}</span></summary>
  <div className="bike-admin-readiness" aria-label="Bike launch readiness">{[{name:'Paid settlement',ready:base.paid_ready},{name:'Road routing',ready:base.routing_ready},{name:'Dispatch engine',ready:base.dispatch_ready===true},{name:'Operating area',ready:base.geography_ready},{name:'Rider agreements',ready:base.payroll_ready},{name:'Company funding',ready:base.funding_ready},{name:'Promotion window',ready:base.promo_ready}].map(item=><span key={item.name} data-ready={item.ready}>{item.ready?<CheckCircle2 size={16} aria-hidden="true"/>:<AlertCircle size={16} aria-hidden="true"/>}{item.name}: {item.ready?'Ready':'Setup needed'}</span>)}</div>
  <p>Readiness reflects the saved policy and server integrations. Activation is a separate action.</p>
  {stale&&<div role="alert" className="ops-notice"><strong>A newer policy is available.</strong><p>Your edits remain here. Reload the saved policy before making another change.</p><button type="button" disabled={busy} onClick={()=>void reload()}>Discard edits & reload policy</button></div>}
  {error&&<p role="alert" className="ops-error">{error}</p>}{message&&<p role="status" className="bike-admin-success">{message}</p>}
  <form onSubmit={event=>{event.preventDefault();void save();}}>
   <fieldset disabled={busy||stale}><legend>Coverage</legend><div className="bike-admin-fields">{field('service_radius_metres','Maximum road trip · metres',1000,8000)}{field('pickup_radius_metres','Rider pickup search · metres',1000,4000)}{field('service_area_radius_metres','Operating area radius · metres',1000,50000)}<label>Service city<input readOnly value={base.city}/></label><label>Approved centre latitude<input type="number" min={-90} max={90} step="any" value={draft.center_lat} onChange={event=>setDraft({...draft,center_lat:event.target.value})}/></label><label>Approved centre longitude<input type="number" min={-180} max={180} step="any" value={draft.center_lng} onChange={event=>setDraft({...draft,center_lng:event.target.value})}/></label></div><label className="bike-admin-check"><input type="checkbox" checked={draft.service_area_reviewed} onChange={event=>setDraft({...draft,service_area_reviewed:event.target.checked})}/>I verified the approved Balasore operating area.</label></fieldset>
   <fieldset disabled={busy||stale}><legend>Paid fare & settlement</legend><div className="bike-admin-fields">{field('base_paise','Base fare · ₹')}{field('per_km_paise','Per kilometre · ₹')}<label>Per minute · ₹<input readOnly value="0"/><small>Not used for this launch.</small></label>{field('minimum_paise','Minimum fare · ₹')}{field('gst_bps','Approved GST · %',0,30)}{field('demand_surcharge_cap_bps','Maximum demand surcharge · %',0,25)}</div><label className="bike-admin-check"><input type="checkbox" checked={draft.tax_reviewed} onChange={event=>setDraft({...draft,tax_reviewed:event.target.checked})}/>I reviewed the applicable GST rate, including any zero rate.</label><label className="bike-admin-check"><input type="checkbox" checked={draft.cash_enabled} onChange={event=>setDraft({...draft,cash_enabled:event.target.checked})}/>Enable cash settlement</label></fieldset>
   <fieldset disabled={busy||stale}><legend>Launch promotion</legend><label className="bike-admin-check"><input type="checkbox" checked={draft.promo_enabled} onChange={event=>setDraft({...draft,promo_enabled:event.target.checked})}/>Offer company-funded free rides</label><div className="bike-admin-fields"><label>Promotion starts · IST<input type="datetime-local" value={draft.promo_started_at} required={draft.promo_enabled} readOnly={base.promo_started_at!==null} onChange={event=>setDraft({...draft,promo_started_at:event.target.value})}/></label>{field('free_distance_metres','Free road trip limit · metres',1000,4000)}{field('weekly_free_limit','Free rides per ISO week · IST',1,3)}{field('promo_planning_budget_paise','Campaign planning allocation · ₹')}</div><dl className="bike-admin-rules"><div><dt>Campaign length</dt><dd>{base.promo_months} calendar months</dd></div><div><dt>Free-ride cooldown</dt><dd>{base.cooldown_hours} hours</dd></div><div><dt>Saved campaign end</dt><dd>{dateTime(base.promo_ends_at)}</dd></div></dl><label className="bike-admin-check"><input type="checkbox" checked={draft.promo_terms_reviewed} onChange={event=>setDraft({...draft,promo_terms_reviewed:event.target.checked})}/>I reviewed campaign eligibility, costs and funding terms.</label><p>The allocation is a planning figure; it does not cap spending or fund rides automatically. The launch date locks after its first save. Eligibility and first-come reservations are checked on the server. Customers review their accepted quote before booking.</p></fieldset>
   <fieldset disabled={busy||stale}><legend>Business approval</legend><label>Customer fare, cancellation & settlement terms<textarea required minLength={20} maxLength={2000} value={draft.terms} onChange={event=>setDraft({...draft,terms:event.target.value})}/></label><label>Pricing and funding approval reference<input required minLength={8} maxLength={200} value={draft.evidence_reference} onChange={event=>setDraft({...draft,evidence_reference:event.target.value})}/></label></fieldset>
   <div className="bike-admin-save"><span>{dirty?'Unsaved changes':`Saved policy v${base.version}`}</span>{dirty&&!stale&&<button type="button" disabled={busy} onClick={()=>{setDraft(draftFrom(base));setError('');setMessage('Unsaved policy changes discarded.');}}>Discard policy changes</button>}<button type="submit" className="ops-primary" disabled={busy||stale||!dirty}>{busy?'Saving…':'Save policy'}</button></div>
  </form>
  <div className="bike-admin-activation"><div><strong>{base.enabled?'Bookings are active':'Bookings are paused'}</strong><p>{dirty?'Save policy changes before changing booking availability.':canActivate?'Server readiness is checked again when activation is requested.':'Complete the required setup before activation.'}</p></div><button type="button" disabled={busy||stale||dirty||(!base.enabled&&!canActivate)} onClick={()=>void save(!base.enabled)}>{base.enabled?'Pause new bookings':'Activate bike bookings'}</button></div>
  <p className="bike-admin-retained"><Clock size={15} aria-hidden="true"/>Confirmed rides retain their accepted fare and promotion terms.</p>
 </details>;
}

function BikeAdminResolution({identifier,version,amount,free=false,note,onRefresh}:{identifier:string;version:number;amount?:number;free?:boolean;note?:string;onRefresh:()=>Promise<void>}){
 const [action,setAction]=useState(''),[reference,setReference]=useState(''),[decision,setDecision]=useState(''),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const validAmount=Number.isSafeInteger(amount)&&Number(amount)>=0;
 return <form className="bike-admin-resolution" onSubmit={async event=>{event.preventDefault();if(!action||!checked||saved)return;setBusy(true);setError('');try{await operation('/bike-rides/admin/bookings/'+encodeURIComponent(identifier)+'/resolve',{method:'POST',body:JSON.stringify({expected_version:version,action,reference,note:decision,amount_paise:action==='cancel'||free?0:amount})});setSaved(true);await onRefresh();}catch(e){setError((e as Error).message);void onRefresh();}finally{setBusy(false);}}}>
  <h3>Review disputed ride</h3>
  {note&&<p>{note}</p>}
  <p>Review ride and collection evidence before resolving. Cancellation with a reported collection remains subject to refund review.</p>
  <fieldset disabled={busy||saved}>
   <label>Resolution<select aria-label="Resolution" required value={action} onChange={event=>{setAction(event.target.value);setChecked(false);}}><option value="">Choose a resolution</option><option value="cancel">Cancel disputed ride</option><option value="complete" disabled={!free&&!validAmount}>Confirm verified completion</option></select></label>
   {action==='complete'&&<p>{free?'Promotion ride · customer fare ₹0':`Exact customer collection to verify: ${validAmount?money(amount!):'Unavailable'}`}</p>}
   <label>External evidence / transfer reference<input required minLength={8} maxLength={200} value={reference} onChange={event=>setReference(event.target.value)}/></label>
   <label>Review decision and evidence<textarea required minLength={10} maxLength={1500} value={decision} onChange={event=>setDecision(event.target.value)}/></label>
   <label className="bike-admin-check"><input type="checkbox" required checked={checked} onChange={event=>setChecked(event.target.checked)}/>I reviewed the ride and any collection evidence.</label>
  </fieldset>
  {error&&<p role="alert" className="ops-error">{error}</p>}{saved&&<p role="status">Resolution recorded. The server ledger has been refreshed.</p>}
  <button type="submit" disabled={busy||saved||!checked||!action}>{busy?'Recording…':'Record resolution'}</button>
 </form>;
}

function BikeDispatchStatus({health}:{health?:BikeDispatchHealth}){
 return <details className="bike-admin-panel"><summary><Clock size={18} aria-hidden="true"/>Dispatch health<span>{!health?'Unavailable':health.ready?'Ready':health.configured?'Needs attention':'Not configured'}</span></summary>{health?<><dl className="bike-admin-ledger"><div><dt>Dispatch mode</dt><dd>{health.mode==='pubsub'?'Google Cloud Pub/Sub':health.mode==='direct'?'Local test transport':health.mode||'Not provided'}</dd></div><div><dt>Healthy / degraded workers</dt><dd>{health.healthy_workers??'Unavailable'} / {health.degraded_workers??'Unavailable'}</dd></div><div><dt>Worker heartbeat</dt><dd>{health.worker_online?'Online':'Offline'}{health.heartbeat_age_seconds!=null?` · ${Math.round(health.heartbeat_age_seconds)}s ago`:''}</dd></div><div><dt>Queue connection</dt><dd>{health.broker_connected?'Connected':'Disconnected'}</dd></div><div><dt>Outbox backlog</dt><dd>{health.outbox_backlog??'Unavailable'}{health.outbox_backlog_is_lower_bound?' · sampled minimum':''}</dd></div><div><dt>Consumer lag</dt><dd>{health.consumer_lag??'Unavailable'}</dd></div><div><dt>Production readiness</dt><dd>{health.production_ready?'Ready':'Setup needed'}</dd></div></dl>{health.reason&&<p>{health.reason.replaceAll('_',' ')}</p>}<BikeDispatchIncidents/></>:<p>Dispatch health has not been returned by the server. Activation remains unavailable.</p>}</details>;
}

function BikeDispatchIncidents(){
 const [open,setOpen]=useState(false);
 return <details className="bike-earning-subpanel" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Riders awaiting automatic recovery</summary>{open&&<BikeDispatchIncidentRecords/>}</details>;
}
function BikeDispatchIncidentRecords(){
 const [cursor,setCursor]=useState('');
 const resource=useOperationResource<{items:{id:string;rider_id:string;error_code:string;attempts:number;updated_at:number}[];next_cursor:string|null}>('/bike-rides/admin/dispatch/incidents'+(cursor?'?cursor='+encodeURIComponent(cursor):''),15000);
 return <section><p>Only the affected rider is held from new offers. The durable event retries automatically; successful replay clears the hold.</p><button disabled={resource.busy} onClick={()=>void resource.refresh()}>Refresh recovery records</button>{resource.error&&<p role="alert" className="ops-error">{resource.error}</p>}{resource.data&&<><AdminTable label="Bike dispatch recovery records" rows={resource.data.items} rowKey={row=>row.id} rowLabel={row=>'recovery '+row.rider_id} empty="No riders are awaiting dispatch recovery in this page." columns={[
  {key:'rider',label:'Rider reference',value:row=>row.rider_id},
  {key:'reason',label:'Retry reason',value:row=>row.error_code.replaceAll('_',' ')},
  {key:'attempts',label:'Recorded retries',value:row=>row.attempts,numeric:true},
  {key:'updated',label:'Last retry · IST',value:row=>row.updated_at,render:row=>dateTime(row.updated_at)},
 ]}/>{cursor&&<button onClick={()=>setCursor('')}>First recovery page</button>}{resource.data.next_cursor&&<button onClick={()=>setCursor(resource.data!.next_cursor!)}>Next recovery page</button>}</>}</section>;
}
