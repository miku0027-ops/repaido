import {useEffect,useRef,useState} from 'react';
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
 promo_identity_ready?:boolean;promo_pool_ready?:boolean;salary_roster_ready?:boolean;independent_ready?:boolean;blockers?:string[];
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
type LaunchTarget='coverage'|'fares'|'routing'|'dispatch'|'roster'|'funding'|'promotion'|'activation'|'independent'|'applications';
const paidSetupReady=(p:BikeAdminPolicy)=>p.paid_ready&&p.routing_ready&&p.dispatch_ready===true&&p.geography_ready&&p.payroll_ready&&p.funding_ready;
const effectivePromotionReady=(p:BikeAdminPolicy)=>p.promo_ready&&p.promo_pool_ready!==false&&p.promo_identity_ready!==false;
const promotionSettingsValid=(p:BikeAdminPolicy)=>!p.promo_enabled||(p.promo_started_at!==null&&p.promo_started_at>0&&p.promo_terms_reviewed);
function revealLaunchSettings(root:HTMLElement|null,target:LaunchTarget){
 if(target==='applications'){
  const heading=Array.from(root?.parentElement?.querySelectorAll<HTMLElement>('h2')||[]).find(heading=>heading.textContent==='Transport & scrap reviews');
  if(heading){heading.tabIndex=-1;heading.scrollIntoView({block:'center',behavior:'instant'});heading.focus({preventScroll:true});}
  return;
 }
 const destination=root?.querySelector<HTMLElement>(`[data-bike-launch="${target}"]`);
 if(!destination)return;
 if(destination instanceof HTMLDetailsElement)destination.open=true;
 for(let parent=destination.parentElement;parent&&parent!==root;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;
 if(target==='roster'||target==='funding')destination.querySelectorAll<HTMLDetailsElement>('.bike-payroll-admin,.bike-payroll-editor').forEach(panel=>{panel.open=true;});
 if(target==='independent'){const panel=destination.querySelector<HTMLDetailsElement>('details');if(panel)panel.open=true;}
 const selector=target==='funding'?'.bike-payroll-editor input[type=number]':target==='roster'?'.bike-payroll-editor select':destination instanceof HTMLDetailsElement?'summary':null;
 const focus=selector?destination.querySelector<HTMLElement>(selector)||destination:destination;
 destination.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 focus.focus({preventScroll:true});
}
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
 const workspace=useRef<HTMLElement>(null);
 return <section ref={workspace} className="bike-admin" aria-labelledby="bike-admin-title">
  <header className="bike-admin-heading"><div><span className="ops-eyebrow">Bike operations</span><h2 id="bike-admin-title">Riders, queues & launch policy</h2></div><button type="button" disabled={resource.busy} onClick={()=>void resource.refresh()}><RefreshCw size={17} aria-hidden="true"/>{resource.busy?'Refreshing…':'Refresh bikes'}</button></header>
  {resource.error&&<div className="ops-notice" role="alert"><strong>Bike operations unavailable.</strong><p>{resource.error}</p>{data&&<p>Showing the last loaded snapshot.</p>}</div>}
  {!data&&!resource.error&&<p role="status">Loading bike operations…</p>}
  {data&&<>
   <div className="bike-admin-status"><AdminStatus value={data.policy.enabled?(paidSetupReady(data.policy)?'active':'setup_required'):'paused'}/><span>{data.policy.service_radius_metres/1000} km trips · {data.policy.pickup_radius_metres/1000} km rider search</span><small>Policy v{data.policy.version}</small></div>
   <BikeLaunchChecklist policy={data.policy} health={data.dispatch_health} hasApplications={Array.from(workspace.current?.parentElement?.querySelectorAll('h2')||[]).some(heading=>heading.textContent==='Transport & scrap reviews')} onOpen={target=>revealLaunchSettings(workspace.current,target)}/>
   <dl className="bike-admin-metrics">{[{name:'Online riders',value:data.metrics.online_riders},{name:'Active rides',value:data.metrics.active_rides},{name:'Queued next',value:data.metrics.queued_rides},{name:'Open offers',value:data.metrics.offers}].map(item=><div key={item.name}><dt>{item.name}</dt><dd>{item.value??'Unavailable'}</dd></div>)}</dl>
   <p className="bike-admin-scope">Operational snapshot; refreshes every 15 seconds while visible.{data.metrics.complete===false?' Record limits reached; these counts are partial.':''}</p>
   <BikeDispatchStatus health={data.dispatch_health}/>
   <BikePolicyEditor key={resource.uid} policy={data.policy} onRefresh={()=>resource.refresh()}/>
   <div data-bike-launch="roster" tabIndex={-1}><div data-bike-launch="funding" tabIndex={-1}><BikePayrollAdmin/></div></div>
   <div data-bike-launch="independent" tabIndex={-1}><BikeIndependentAdmin/></div>
   {data.economics&&<details className="bike-admin-panel"><summary><Payments size={18} aria-hidden="true"/>Salary coverage examples<span>Planning only</span></summary><p>Active roster: {data.economics.rider_count} riders. Total monthly salary obligations: {money(data.economics.monthly_salary_paise)}.</p><div className="bike-economics-scroll" role="region" aria-label="Salary coverage examples, scroll for columns" tabIndex={0}><table className="bike-economics-table"><caption>Salary coverage only · Other costs excluded</caption><thead><tr><th scope="col">Trip distance</th><th scope="col">Ordinary paid fare</th><th scope="col">Paid rides to cover monthly salaries</th></tr></thead><tbody>{data.economics.scenarios.map(row=><tr key={row.distance_metres}><th scope="row">{row.distance_metres/1000} km</th><td>{money(row.ordinary_fare_paise)}</td><td>{row.paid_rides_to_cover_salary_only?.toLocaleString('en-IN')??'Not calculable'}</td></tr>)}</tbody></table></div><p>{data.economics.assumptions}</p><p>Excluded: {data.economics.excluded_costs.map(cost=>cost.replaceAll('_',' ')).join(', ')}. Profit is not estimated.</p></details>}
   <BikeRideHistory key={resource.uid} latestRows={data.recent_rides} latestCursor={data.recent_rides_next_cursor} onRefresh={()=>resource.refresh()}/>
  </>}
 </section>;
}

function BikeLaunchChecklist({policy:p,health,hasApplications,onOpen}:{policy:BikeAdminPolicy;health?:BikeDispatchHealth;hasApplications:boolean;onOpen:(target:LaunchTarget)=>void}){
 const fareIssues=[!p.tax_reviewed?'Review the applicable GST rate.':'',!p.cash_enabled?'Enable the intended cash collection method.':'',!Math.max(p.base_paise,p.per_km_paise,p.minimum_paise)?'Confirm the launch tariff.':'',!p.terms.trim()?'Publish customer fare and cancellation terms.':''].filter(Boolean);
 const dispatchIssue=!health?'Refresh to load dispatch health.':!health.configured?'Connect the ordered dispatch service in deployment settings.':!health.worker_online?'Start the dispatch worker and wait for a fresh heartbeat.':!health.broker_connected?'Restore the dispatch worker’s queue connection.':'Review the dispatch health and recovery records.';
 const riderIssues=p.independent_ready?'The reviewed independent agreement is configured. Each rider still needs current approval and consent.':p.blockers?.filter(reason=>!/fund/i.test(reason)).join(' ')||'Approve a current company rider roster and its salary agreement, or review an independent rider plan.';
 const fundingIssue=p.blockers?.find(reason=>/fund/i.test(reason))||'Record and verify current-month salary funding, including earned obligations.';
 const checks:{label:string;ready:boolean;note:string;action:string;target:LaunchTarget}[]=[
  {label:'Operating area',ready:p.geography_ready,note:p.geography_ready?'The saved Balasore area is reviewed.':!p.service_center?'Choose the approved operating centre and radius, then confirm the area review.':'Confirm the saved operating-area review.',action:'Review area',target:'coverage'},
  {label:'Fares, tax & terms',ready:p.paid_ready,note:p.paid_ready?'The saved fare, tax review and collection terms are ready.':fareIssues.join(' ')||'Save the reviewed fare and collection settings.',action:'Review fares',target:'fares'},
  {label:'Road routing',ready:p.routing_ready,note:p.routing_ready?'The server route provider is connected.':'Connect the road-route provider in deployment settings, then refresh these checks.',action:'Routing details',target:'routing'},
  {label:'Live dispatch',ready:p.dispatch_ready===true,note:p.dispatch_ready?'The dispatch worker passed the server readiness check.':dispatchIssue,action:'Dispatch health',target:'dispatch'},
  {label:'Rider agreements',ready:p.payroll_ready,note:p.payroll_ready?(p.independent_ready?riderIssues:'The reviewed rider agreement and operating funding are ready.'):riderIssues,action:p.independent_ready?'Rider settings':'Company riders',target:p.independent_ready?'independent':'roster'},
  {label:'Operating funding',ready:p.funding_ready,note:p.funding_ready?(p.independent_ready&&!p.salary_roster_ready?'The paid-ride earning agreement is configured. Optional free rides need a funded launch pool.':'Current salary funding passed the server check.'):fundingIssue,action:p.independent_ready&&!p.salary_roster_ready?'Review agreement':'Review funding',target:p.independent_ready&&!p.salary_roster_ready?'independent':'funding'},
 ];
 const campaignValid=promotionSettingsValid(p),remaining=checks.filter(check=>!check.ready).length+(campaignValid?0:1),ready=remaining===0;
 const offerReady=effectivePromotionReady(p);
 const offerIssues=[!campaignValid?'Set the fixed launch date and review campaign terms, or turn off this optional offer before activation.':'',p.promo_identity_ready===false?'Connect the promotion eligibility protection in deployment settings.':'',p.promo_pool_ready===false?'Review funding for the selected rider earning plan.':'',!p.promo_ready&&campaignValid?'Check the saved six-month campaign window.':''].filter(Boolean);
 return <details className="bike-launch-checklist" open={!ready||!p.enabled}>
  <summary>{ready?<CheckCircle2 size={18} aria-hidden="true"/>:<AlertCircle size={18} aria-hidden="true"/>}<strong>Launch checklist</strong><span>{ready?'Setup ready':`${remaining} checks remaining`}</span></summary>
  <div className="bike-launch-intro"><strong>{!p.enabled?'New bookings paused':ready?'Booking setup ready':'New bookings blocked by setup'}</strong><p>Saved server checks control new bookings. Existing rides keep their agreed terms.</p></div>
  <ul className="bike-launch-steps">{checks.map(check=><li key={check.label} data-ready={check.ready}>{check.ready?<CheckCircle2 size={18} aria-hidden="true"/>:<AlertCircle size={18} aria-hidden="true"/>}<div><strong>{check.label}<small>{check.ready?'Ready':'Setup needed'}</small></strong><p>{check.note}</p>{check.target==='roster'&&!check.ready&&<p>Riders must register their profiles and bikes before company approval and roster selection.</p>}</div><button type="button" onClick={()=>onOpen(check.target)}>{check.action}</button>{check.target==='roster'&&!check.ready&&hasApplications&&<button type="button" onClick={()=>onOpen('applications')}>Review rider & bike applications</button>}</li>)}</ul>
  <div className="bike-launch-offer"><div><strong>Free-ride offer <small>{!p.promo_enabled?'Optional · off':offerReady?'Ready':'Setup needed'}</small></strong><p>{!p.promo_enabled?'Paid bookings do not require a launch promotion.':offerReady?'Eligibility and funds are checked again for each booking.':offerIssues.join(' ')||'Refresh the saved campaign and rider-funding checks.'}</p>{p.promo_enabled&&!offerReady&&campaignValid&&<p>Paid bookings can still open when the required checks pass.</p>}</div><button type="button" onClick={()=>onOpen('promotion')}>Review offer</button></div>
  <div className="bike-launch-footer"><span>{ready&&!p.enabled?'Setup passed. Review and activate new bookings.':!ready?'Complete the saved setup before activation.':'New booking availability is checked again on the server.'}</span><button type="button" onClick={()=>onOpen('activation')}>Review activation</button></div>
 </details>;
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
 const live=policy.version>=base.version?policy:base;
 const reload=async()=>{setBusy(true);setError('');setMessage('');try{const latest=await operation<BikeAdminPolicy>('/bike-rides/admin/policy',{}, {force:true});setBase(latest);setDraft(draftFrom(latest));setConflict(false);setMessage('Latest saved policy loaded.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const save=async(enabled=base.enabled)=>{setBusy(true);setError('');setMessage('');try{const saved=await operation<BikeAdminPolicy>('/bike-rides/admin/policy',{method:'PUT',body:JSON.stringify(policyBody(base,draft,enabled))});setBase(saved);setDraft(draftFrom(saved));setConflict(false);setMessage(enabled===base.enabled?'Policy saved.':'Bike bookings '+(enabled?'activated.':'paused.'));void onRefresh();}catch(e){const failed=e as Error&{status?:number};setError(failed.message);if(failed.status===409){try{const latest=await operation<BikeAdminPolicy>('/bike-rides/admin/policy',{}, {force:true});if(latest.version>base.version)setConflict(true);}catch{/* Keep the actionable server error and the unsaved draft. */}void onRefresh();}}finally{setBusy(false);}};
 const field=(key:NumberField,label:string,min=0,max?:number)=><label key={key}>{label}<input type="number" inputMode={scaledFields.has(key)?'decimal':'numeric'} min={min} max={max} step={scaledFields.has(key)?'0.01':'1'} required value={draft[key]} onChange={event=>{setDraft({...draft,[key]:event.target.value});setMessage('');}}/></label>;
 const canActivate=paidSetupReady(live)&&promotionSettingsValid(base);
 return <details className="bike-admin-panel bike-admin-policy"><summary><Settings size={18} aria-hidden="true"/>Launch & pricing policy<span>{dirty?'Unsaved changes':base.enabled?'Active':'Paused'}</span></summary>
  <div className="bike-admin-readiness" aria-label="Bike launch readiness">{[{name:'Paid settlement',ready:live.paid_ready},{name:'Road routing',ready:live.routing_ready},{name:'Dispatch engine',ready:live.dispatch_ready===true},{name:'Operating area',ready:live.geography_ready},{name:'Rider agreements',ready:live.payroll_ready},{name:'Company funding',ready:live.funding_ready},{name:'Launch offer',ready:!live.promo_enabled||effectivePromotionReady(live),optionalOff:!live.promo_enabled}].map(item=><span key={item.name} data-ready={item.ready}>{item.optionalOff?<Clock size={16} aria-hidden="true"/>:item.ready?<CheckCircle2 size={16} aria-hidden="true"/>:<AlertCircle size={16} aria-hidden="true"/>}{item.name}: {item.optionalOff?'Optional · off':item.ready?'Ready':'Setup needed'}</span>)}</div>
  <p>Readiness reflects the saved policy and server integrations. Activation is a separate action.</p>
  {stale&&<div role="alert" className="ops-notice"><strong>A newer policy is available.</strong><p>Your edits remain here. Reload the saved policy before making another change.</p><button type="button" disabled={busy} onClick={()=>void reload()}>Discard edits & reload policy</button></div>}
  {error&&<p role="alert" className="ops-error">{error}</p>}{message&&<p role="status" className="bike-admin-success">{message}</p>}
  <form onSubmit={event=>{event.preventDefault();void save();}}>
   <fieldset data-bike-launch="coverage" tabIndex={-1} disabled={busy||stale}><legend>Coverage</legend><div className="bike-admin-fields">{field('service_radius_metres','Maximum road trip · metres',1000,8000)}{field('pickup_radius_metres','Rider pickup search · metres',1000,4000)}{field('service_area_radius_metres','Operating area radius · metres',1000,50000)}<label>Service city<input readOnly value={base.city}/></label><label>Approved centre latitude<input type="number" min={-90} max={90} step="any" value={draft.center_lat} onChange={event=>setDraft({...draft,center_lat:event.target.value})}/></label><label>Approved centre longitude<input type="number" min={-180} max={180} step="any" value={draft.center_lng} onChange={event=>setDraft({...draft,center_lng:event.target.value})}/></label></div><label className="bike-admin-check"><input type="checkbox" checked={draft.service_area_reviewed} onChange={event=>setDraft({...draft,service_area_reviewed:event.target.checked})}/>I verified the approved Balasore operating area.</label><div className="bike-admin-route-status" data-bike-launch="routing" tabIndex={-1}><strong>Road-route connection · {live.routing_ready?'Connected':'Setup needed'}</strong><p>{live.routing_ready?'The server route provider is configured.':'The deployment team must connect the server route provider. Refresh bike operations after the connection is verified.'}</p></div></fieldset>
   <fieldset data-bike-launch="fares" tabIndex={-1} disabled={busy||stale}><legend>Paid fare & settlement</legend><button type="button" onClick={()=>{setDraft({...draft,base_paise:'8',per_km_paise:'5',per_minute_paise:'0'});setMessage('Launch tariff prepared. Review tax, terms and collection settings before saving.');}}>Use launch tariff · ₹8 + ₹5/km</button><div className="bike-admin-fields">{field('base_paise','Base fare · ₹')}{field('per_km_paise','Per kilometre · ₹')}<label>Per minute · ₹<input readOnly value="0"/><small>Not used for this launch.</small></label>{field('minimum_paise','Minimum fare · ₹')}{field('gst_bps','Approved GST · %',0,30)}{field('demand_surcharge_cap_bps','Maximum demand surcharge · %',0,25)}</div><label className="bike-admin-check"><input type="checkbox" checked={draft.tax_reviewed} onChange={event=>setDraft({...draft,tax_reviewed:event.target.checked})}/>I reviewed the applicable GST rate, including any zero rate.</label><label className="bike-admin-check"><input type="checkbox" checked={draft.cash_enabled} onChange={event=>setDraft({...draft,cash_enabled:event.target.checked})}/>Enable cash settlement</label></fieldset>
   <fieldset data-bike-launch="promotion" tabIndex={-1} disabled={busy||stale}><legend>Launch promotion</legend><label className="bike-admin-check"><input type="checkbox" checked={draft.promo_enabled} onChange={event=>setDraft({...draft,promo_enabled:event.target.checked})}/>Offer company-funded free rides</label><div className="bike-admin-fields"><label>Promotion starts · IST<input type="datetime-local" value={draft.promo_started_at} required={draft.promo_enabled} readOnly={base.promo_started_at!==null} onChange={event=>setDraft({...draft,promo_started_at:event.target.value})}/></label>{field('free_distance_metres','Free road trip limit · metres',1000,4000)}{field('weekly_free_limit','Free rides per ISO week · IST',1,3)}{field('promo_planning_budget_paise','Campaign planning allocation · ₹')}</div><dl className="bike-admin-rules"><div><dt>Campaign length</dt><dd>{base.promo_months} calendar months</dd></div><div><dt>Free-ride cooldown</dt><dd>{base.cooldown_hours} hours</dd></div><div><dt>Saved campaign end</dt><dd>{dateTime(base.promo_ends_at)}</dd></div></dl><label className="bike-admin-check"><input type="checkbox" checked={draft.promo_terms_reviewed} onChange={event=>setDraft({...draft,promo_terms_reviewed:event.target.checked})}/>I reviewed campaign eligibility, costs and funding terms.</label><p>The allocation is a planning figure; it does not cap spending or fund rides automatically. The launch date locks after its first save. Eligibility and first-come reservations are checked on the server. Customers review their accepted quote before booking.</p></fieldset>
   <fieldset disabled={busy||stale}><legend>Business approval</legend><label>Customer fare, cancellation & settlement terms<textarea required minLength={20} maxLength={2000} value={draft.terms} onChange={event=>setDraft({...draft,terms:event.target.value})}/></label><label>Pricing and funding approval reference<input required minLength={8} maxLength={200} value={draft.evidence_reference} onChange={event=>setDraft({...draft,evidence_reference:event.target.value})}/></label></fieldset>
   <div className="bike-admin-save"><span>{dirty?'Unsaved changes':`Saved policy v${base.version}`}</span>{dirty&&!stale&&<button type="button" disabled={busy} onClick={()=>{setDraft(draftFrom(base));setError('');setMessage('Unsaved policy changes discarded.');}}>Discard policy changes</button>}<button type="submit" className="ops-primary" disabled={busy||stale||!dirty}>{busy?'Saving…':'Save policy'}</button></div>
  </form>
  <div className="bike-admin-activation" data-bike-launch="activation" tabIndex={-1}><div><strong>{base.enabled?(paidSetupReady(live)?'Bookings are active':'New bookings need setup review'):'Bookings are paused'}</strong><p>{dirty?'Save policy changes before changing booking availability.':canActivate?'Server readiness is checked again when activation is requested.':'Complete the required setup before activation.'}</p></div><button type="button" disabled={busy||stale||dirty||(!base.enabled&&!canActivate)} onClick={()=>void save(!base.enabled)}>{base.enabled?'Pause new bookings':'Activate bike bookings'}</button></div>
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
 return <details className="bike-admin-panel" data-bike-launch="dispatch" tabIndex={-1}><summary><Clock size={18} aria-hidden="true"/>Dispatch health<span>{!health?'Unavailable':health.ready?'Ready':health.configured?'Needs attention':'Not configured'}</span></summary>{health?<><dl className="bike-admin-ledger"><div><dt>Dispatch mode</dt><dd>{health.mode==='pubsub'?'Google Cloud Pub/Sub':health.mode==='direct'?'Local test transport':health.mode||'Not provided'}</dd></div><div><dt>Healthy / degraded workers</dt><dd>{health.healthy_workers??'Unavailable'} / {health.degraded_workers??'Unavailable'}</dd></div><div><dt>Worker heartbeat</dt><dd>{health.worker_online?'Online':'Offline'}{health.heartbeat_age_seconds!=null?` · ${Math.round(health.heartbeat_age_seconds)}s ago`:''}</dd></div><div><dt>Queue connection</dt><dd>{health.broker_connected?'Connected':'Disconnected'}</dd></div><div><dt>Outbox backlog</dt><dd>{health.outbox_backlog??'Unavailable'}{health.outbox_backlog_is_lower_bound?' · sampled minimum':''}</dd></div><div><dt>Consumer lag</dt><dd>{health.consumer_lag??'Unavailable'}</dd></div><div><dt>Production readiness</dt><dd>{health.production_ready?'Ready':'Setup needed'}</dd></div></dl>{health.reason&&<p>{health.reason.replaceAll('_',' ')}</p>}<BikeDispatchIncidents/></>:<p>Dispatch health has not been returned by the server. Activation remains unavailable.</p>}</details>;
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
