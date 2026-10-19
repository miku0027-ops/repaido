import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowRight,Check,Clock,LocateFixed,Navigation,Phone,RefreshCw,ShieldCheck,TwoWheeler,Volume2,VolumeX,Wallet} from '../icons';
import {currentPosition,money,operation} from '../services/operations';
import {assertBikePosition,bikeActionLabels,bikeAllowedActions,bikeArrivalCueKeys,bikeCollectionSummary,bikeRiderSections,riderIsOnline} from '../services/bikeRiderState.mjs';
import {Modal} from './ui';
import {JourneyMap} from './JourneyTracking';
import {BikeIndependentEarnings} from './BikeIndependentEarnings';
import {pollDelay} from '../services/resilientReads.mjs';
import './bike-rider-workspace.css';

export interface BikeRiderPosition {lat:number;lng:number;accuracy:number;captured_at:number;received_at?:number}
export interface BikeRiderVehicle {id:string;name:string;status:string;active:boolean;vehicle_kind:string;valid_until?:number}
export interface BikeDriverAvailability {vehicle_id:string;online:boolean;position?:BikeRiderPosition;updated_at:number}
export interface BikeRiderRide {
 id:string;state:string;version:number;vehicle_name?:string;passenger_name?:string;passenger_phone?:string;
 pickup?:{lat:number;lng:number};dropoff?:{lat:number;lng:number};pickup_address?:string;dropoff_address?:string;
 pricing?:{customer_total_paise?:number;free?:boolean};
 earnings_offer?:{model:string;amount_paise:number;terms?:string};route?:{points:{lat:number;lng:number}[]};position?:BikeRiderPosition|null;
 queued?:boolean;accepted_by_driver?:boolean;available_at?:number;created_at?:number;expires_at?:number;
 allowed_actions?:string[];stop_status?:{pickup?:BikeRiderStop;destination?:BikeRiderStop};
 payment_status?:string;company_cash_held_paise?:number;company_collection_status?:string;blockers?:string[];
}
interface BikeRiderStop {status:'inside'|'outside'|'unknown';distance_metres?:number;radius_metres?:number;valid_until?:number}
interface AvailabilityResponse {rider_approved?:boolean;vehicles:BikeRiderVehicle[];availability:BikeDriverAvailability|null;server_time:number;dispatch_ready:boolean;service_ready:boolean;availability_reason?:string|null}
export interface BikeSalaryObligation {id:string;period:string;amount_paise:number;status:'owed'|'transfer_reported'|'driver_received';version:number;transfer?:{reference:string;amount_paise:number}|null;received_at?:number}
export interface BikeCompanyCashSummary {driver_id:string;version:number;collected_paise:number;reported_remittance_paise:number;confirmed_remittance_paise:number;outstanding_held_paise:number;available_to_report_paise:number;currency:'INR'}
export interface BikeDriverPayroll {driver_id:string;period:string;compensation_model:'monthly_salary';monthly_salary_paise:number;rostered:boolean;approved:boolean;obligations:BikeSalaryObligation[];server_time:number;company_cash?:BikeCompanyCashSummary}
interface BikeCashCollection {ride_id:string;amount_paise:number;collected_at:number;period:string}
interface BikeCashRemittance {id:string;version:number;status:'deposit_reported'|'company_received';amount_paise:number;deposit_reference:string;reported_at:number;received_at?:number}
interface BikeRemittancesResponse {company_cash:BikeCompanyCashSummary;items:BikeCashRemittance[];next_cursor:string|null;available_collections:BikeCashCollection[];collections_next_cursor:string|null}
type BikeAction=keyof typeof bikeActionLabels;
const labels:Record<string,string>={offered:'New request',queued:'Next ride',accepted:'Accepted',on_the_way:'To pickup',arrived:'At pickup',in_progress:'On the road',completion_pending:'Completion review',payment_due:'Payment due',payment_reported:'Cash reported',completed:'Completed',cancelled:'Cancelled',declined:'Declined',expired:'Expired',disputed:'Under review'};
const actionNeedsPosition=new Set(['depart','arrive','start','complete']);
const needsConfirmation=new Set(['decline','cancel','dispute','cash_received','start']);
const indiaTime=(stamp:number)=>new Date(stamp*1000).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'numeric',minute:'2-digit'});
const shortId=(id:string)=>id.slice(-6).toUpperCase();
const salaryStatus={owed:'Salary pending',transfer_reported:'Transfer reported',driver_received:'Receipt confirmed'};
const salaryPeriod=(period:string)=>/^\d{4}-\d{2}$/.test(period)?new Date(period+'-01T00:00:00+05:30').toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',month:'short',year:'numeric'}):period;

function BikeRideCard({ride,now,busy,onAction}:{ride:BikeRiderRide;now:number;busy:boolean;onAction:(ride:BikeRiderRide,action:BikeAction)=>void}){
 const actions=bikeAllowedActions(ride) as BikeAction[],collection=bikeCollectionSummary(ride);
 const stop=ride.state==='in_progress'?ride.stop_status?.destination:ride.stop_status?.pickup;
 const arrival=stop?.status==='inside'&&typeof stop.valid_until==='number'&&stop.valid_until>=now;
 const destination=ride.state==='in_progress'?ride.dropoff:ride.pickup;
 const navigation=destination&&Number.isFinite(destination.lat)&&Number.isFinite(destination.lng)&&Math.abs(destination.lat)<=90&&Math.abs(destination.lng)<=180?`https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}&travelmode=driving`:null;
 const phone=ride.passenger_phone&&/^\+?[0-9 ()-]{7,20}$/.test(ride.passenger_phone)?ride.passenger_phone:null;
 const stages=['Accepted','Pickup','Ride','Done'];
 const primary=actions.find(action=>!['cancel','decline','dispute'].includes(action));
 const more=actions.filter(action=>action!==primary);
 const liveMap=!ride.queued&&['accepted','on_the_way','arrived','in_progress'].includes(ride.state)&&ride.pickup&&ride.dropoff;
 const position=ride.position&&ride.position.received_at!=null&&now-ride.position.received_at>=0&&now-ride.position.received_at<=75?ride.position:null;
 const stage=['completed'].includes(ride.state)?3:['in_progress','completion_pending','payment_due','payment_reported'].includes(ride.state)?2:['on_the_way','arrived'].includes(ride.state)?1:0;
 return <article className={`bike-rider-trip${arrival?' is-at-stop':''}${ride.queued?' is-next':''}`} aria-label={`${labels[ride.state]||'Ride'} ${shortId(ride.id)}`}>
  <header><span className="bike-rider-trip-state"><span aria-hidden="true"/>{labels[ride.state]||'Ride update'}</span><small>#{shortId(ride.id)}</small></header>
  {liveMap&&<div className="bike-rider-live-map"><JourneyMap origin={ride.pickup!} destination={ride.dropoff!} route={ride.route?.points||[]} position={position} positionLabel="Your latest ride position" mapLabel="Your current bike route"/><span className="bike-rider-map-state">{arrival?<><Check size={14} aria-hidden="true"/>At the stop</>:ride.state==='in_progress'?'On the road':'Your pickup route'}</span></div>}
  <div className="bike-rider-passenger"><span className="bike-rider-passenger-icon"><TwoWheeler size={22} aria-hidden="true"/></span><div><h4>{ride.passenger_name||'Passenger details after acceptance'}</h4><small>{ride.vehicle_name||'Bike ride'}{ride.available_at&&ride.queued?` · After ${indiaTime(ride.available_at)}`:''}</small></div>{phone&&<a className="bike-rider-icon-button" href={`tel:${phone.replace(/[ ()-]/g,'')}`} aria-label="Call passenger"><Phone size={20} aria-hidden="true"/></a>}</div>
  <dl className="bike-rider-route"><div><dt><span aria-hidden="true"/>Pickup</dt><dd>{ride.pickup_address||'Shared after acceptance'}</dd></div><div><dt><span aria-hidden="true"/>Drop-off</dt><dd>{ride.dropoff_address||'Shared after acceptance'}</dd></div></dl>
  {arrival&&<p className="bike-rider-arrival" role="status"><Check size={18} aria-hidden="true"/>Within the stop area · GPS verified</p>}
  {stop?.distance_metres!=null&&!arrival&&stop.valid_until!=null&&stop.valid_until>=now&&<p className="bike-rider-distance"><Navigation size={16} aria-hidden="true"/>{Math.round(stop.distance_metres)} m to {ride.state==='in_progress'?'drop-off':'pickup'}</p>}
  {!['offered','queued','cancelled','declined','expired'].includes(ride.state)&&<ol className="bike-rider-progress" aria-label="Ride progress">{stages.map((name,index)=><li key={name} data-done={index<stage} aria-current={index===stage?'step':undefined}><i aria-hidden="true"/>{name}</li>)}</ol>}
  <div className="bike-rider-fare"><div><small>{collection.free?'Customer fare':'Collect for company'}</small><strong>{collection.customerPaise==null?'Pending quote':money(collection.customerPaise)}</strong><span>{collection.free?'No fare to collect':'Company cash'}</span></div>{ride.earnings_offer?.model==='per_ride'&&<div><small>Your agreed earning</small><strong>{money(ride.earnings_offer.amount_paise)}</strong><span>After verified completion</span></div>}</div>
  {ride.payment_status&&<p className="bike-rider-payment-status"><Wallet size={16} aria-hidden="true"/>{ride.payment_status.replaceAll('_',' ')}</p>}
  {ride.company_collection_status==='held_by_rider'&&typeof ride.company_cash_held_paise==='number'&&<p className="bike-rider-payment-status"><Wallet size={16} aria-hidden="true"/>Company cash held · {money(ride.company_cash_held_paise)}</p>}
  {navigation&&['accepted','on_the_way','arrived','in_progress'].includes(ride.state)&&!ride.queued&&<a className="bike-rider-navigation" href={navigation} target="_blank" rel="noopener noreferrer"><Navigation size={18} aria-hidden="true"/>Navigate<ArrowRight size={16} aria-hidden="true"/></a>}
  {ride.queued&&ride.accepted_by_driver&&<p className="bike-rider-queue-note"><Clock size={16} aria-hidden="true"/>Reserved next. Finish your current ride before pickup.</p>}
  {ride.state==='completion_pending'&&<p className="bike-rider-queue-note">Waiting for the passenger to confirm completion.</p>}
  {ride.state==='payment_due'&&<p className="bike-rider-queue-note">The passenger needs to report their cash payment.</p>}
  {ride.state==='payment_reported'&&<p className="bike-rider-queue-note">Confirm only the cash you actually received.</p>}
  {ride.state==='disputed'&&<p className="bike-rider-queue-note">This ride is awaiting support review.</p>}
  {ride.blockers?.includes('otp_locked_contact_support')&&<p className="bike-rider-error" role="status">Pickup code locked. Contact Repaido support before continuing.</p>}
  {actions.length>0&&<div className="bike-rider-trip-actions">{primary&&<button type="button" disabled={busy||!navigator.onLine} className="bike-rider-primary" onClick={()=>onAction(ride,primary)}>{bikeActionLabels[primary]}<ArrowRight size={16} aria-hidden="true"/></button>}{more.length>0&&<details className="bike-rider-more-actions"><summary>More options</summary><div>{more.map(action=><button key={action} type="button" disabled={busy||!navigator.onLine} onClick={()=>onAction(ride,action)}>{bikeActionLabels[action]}</button>)}</div></details>}</div>}
 </article>;
}

export function BikeRiderDashboard({data,rides,payroll,payrollError='',cashPanel,earningPanel,alertControl,now,busy,error,locationError,sharing,onVehicle,onOnline,onLocation,onRefresh,onAction,onConfirmSalary}:{data:AvailabilityResponse;rides:BikeRiderRide[];payroll?:BikeDriverPayroll|null;payrollError?:string;cashPanel?:ReactNode;earningPanel?:ReactNode;alertControl?:ReactNode;now:number;busy:boolean;error:string;locationError:string;sharing:boolean;onVehicle:(id:string)=>void;onOnline:(online:boolean)=>void;onLocation:()=>void;onRefresh:()=>void;onAction:(ride:BikeRiderRide,action:BikeAction)=>void;onConfirmSalary?:(obligation:BikeSalaryObligation)=>void}){
 const sections=bikeRiderSections(rides),presenceOnline=riderIsOnline(data.availability,now),serviceReady=data.dispatch_ready&&data.service_ready,online=presenceOnline&&serviceReady,[history,setHistory]=useState(false);
 const approved=data.vehicles.filter(vehicle=>vehicle.vehicle_kind==='bike'&&vehicle.status==='approved'&&vehicle.active&&(!vehicle.valid_until||vehicle.valid_until>now));
 const canWork=data.rider_approved??!!(payroll?.rostered&&payroll.approved);
 const selected=data.availability?.vehicle_id||approved[0]?.id||'';
 const [financeOpen,setFinanceOpen]=useState(false);
 const finances=<div className="bike-rider-workspace bike-rider-finance">
  {payroll&&(payroll.rostered||payroll.obligations.length>0)&&Number.isSafeInteger(payroll.monthly_salary_paise)&&<details className="bike-rider-payroll"><summary className="bike-rider-salary"><Wallet size={18} aria-hidden="true"/><span>Monthly salary<strong>{money(payroll.monthly_salary_paise)}<small> / month</small></strong></span><small>{payroll.rostered&&payroll.approved?'Your salary records':'Roster approval needed'}</small></summary><div><p>Ride collections belong to the company. Salary receipt is recorded separately.</p>{!payroll.rostered&&<p>Your account is not on the active bike rider roster.</p>}{payroll.obligations.length?payroll.obligations.map(record=><article key={record.id}><div><strong>{salaryPeriod(record.period)}</strong><small>{salaryStatus[record.status]}</small></div><b>{money(record.amount_paise)}</b>{record.status==='transfer_reported'&&onConfirmSalary&&<button type="button" disabled={busy} onClick={()=>onConfirmSalary(record)}>Confirm receipt</button>}</article>):<p>No salary periods have been recorded yet.</p>}</div></details>}
  {payrollError&&<p className="bike-rider-error" role="status">Salary records unavailable. {payrollError}</p>}
  {earningPanel}
  {cashPanel}
 </div>;
 return <section className="bike-rider-workspace" aria-label="Bike rider workspace" aria-busy={busy}>
  <header className="bike-rider-control"><div className="bike-rider-title"><span className="bike-rider-emblem"><TwoWheeler size={23} aria-hidden="true"/></span><div><h3>Bike rides</h3><span className={`bike-rider-presence${online?' is-online':''}`}><i aria-hidden="true"/>{sections.current.some((ride:BikeRiderRide)=>ride.state==='in_progress')?'On your trip':!serviceReady?'Requests paused':online?'Ready for requests':'Offline'}</span></div></div><button type="button" className="bike-rider-icon-button" aria-label="Refresh bike rides" disabled={busy} onClick={onRefresh}><RefreshCw size={20} aria-hidden="true"/></button></header>
  <div className="bike-rider-availability"><label>Bike<select value={selected} disabled={busy||data.availability?.online||!approved.length} onChange={e=>onVehicle(e.target.value)}>{approved.length?approved.map(vehicle=><option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>):<option value="">Approved bike needed</option>}</select></label><button type="button" className={`bike-rider-online-toggle${online?' is-online':''}`} role="switch" aria-label="Available for bike rides" aria-checked={online} disabled={busy||(!presenceOnline&&(!approved.length||!canWork||!serviceReady))} onClick={()=>onOnline(!presenceOnline)}><span aria-hidden="true"/>{presenceOnline?'Go offline':'Go online'}</button></div>
  {!serviceReady&&<p className="bike-rider-info" role="status">{data.availability_reason||'Bike requests are currently paused.'}</p>}
  {!approved.length&&<p className="bike-rider-info"><ShieldCheck size={18} aria-hidden="true"/>Add a bike in Vehicles, then complete the existing document review.</p>}
  {approved.length>0&&<div className="bike-rider-location"><LocateFixed size={18} aria-hidden="true"/><span>{sharing?'Precise GPS enabled on this screen':'Share precise GPS for pickup and arrival'}</span><button type="button" disabled={busy} onClick={onLocation}>{sharing?'Update GPS':'Share GPS'}</button></div>}
  {payroll&&!canWork&&<div className="bike-rider-enrollment-nudge"><ShieldCheck size={18} aria-hidden="true"/><span>Review your earning plan and rider approval.</span><button onClick={()=>setFinanceOpen(true)}>Earning plan</button></div>}
  {payrollError&&<p className="bike-rider-info" role="status">Rider status unavailable. Refresh to retry.</p>}
  {alertControl}
  {locationError&&<p className="bike-rider-error" role="alert">{locationError}</p>}
  {error&&<div className="bike-rider-error" role="alert"><span>{error}</span><button type="button" disabled={busy} onClick={onRefresh}>Retry</button></div>}
  <div className="bike-rider-section-tools"><div className="bike-rider-view-tabs" role="group" aria-label="Bike ride records"><button type="button" aria-pressed={!history} onClick={()=>setHistory(false)}>Today <span>{sections.current.length+sections.next.length+sections.offers.length}</span></button><button type="button" aria-pressed={history} onClick={()=>setHistory(true)}>History <span>{sections.history.length}</span></button></div><button type="button" className="bike-rider-money-button" onClick={()=>setFinanceOpen(true)}><Wallet size={18} aria-hidden="true"/>Money</button></div>
  {history?<div className="bike-rider-history">{sections.history.length?sections.history.map((ride:BikeRiderRide)=><details key={ride.id}><summary><span>{ride.dropoff_address||'Bike ride'}<small>{labels[ride.state]||ride.state} · #{shortId(ride.id)}</small></span><strong>{ride.pricing?.customer_total_paise==null?'—':money(ride.pricing.customer_total_paise)}</strong></summary><BikeRideCard ride={ride} now={now} busy={busy} onAction={onAction}/></details>):<p className="bike-rider-empty">Completed ride records will appear here.</p>}</div>:<>
   {sections.current.length>0&&<section className="bike-rider-section" aria-label="Current bike ride"><h4>Current ride</h4>{sections.current.map((ride:BikeRiderRide)=><BikeRideCard key={ride.id} ride={ride} now={now} busy={busy} onAction={onAction}/>)}</section>}
   {sections.next.length>0&&<section className="bike-rider-section" aria-label="Next reserved bike ride"><h4>Reserved next</h4>{sections.next.map((ride:BikeRiderRide)=><BikeRideCard key={ride.id} ride={ride} now={now} busy={busy} onAction={onAction}/>)}</section>}
   {sections.offers.length>0&&<section className="bike-rider-section" aria-label="Bike ride requests"><h4>New requests <span>{sections.offers.length}</span></h4><div className="bike-rider-offer-rail">{sections.offers.map((ride:BikeRiderRide)=><BikeRideCard key={ride.id} ride={ride} now={now} busy={busy} onAction={onAction}/>)}</div></section>}
   {!sections.current.length&&!sections.next.length&&!sections.offers.length&&<div className="bike-rider-empty"><span className="bike-rider-empty-icon"><TwoWheeler size={30} aria-hidden="true"/></span><h4>{online?'Ready for your next request':'Your next ride starts here'}</h4><p>{online?'New requests appear here. Availability is matched by the server.':'Choose an approved bike and go online with precise GPS.'}</p></div>}
  </>}
  {financeOpen&&<Modal title={payroll?.rostered?"Salary & company cash":"Ride earnings & company cash"} onClose={()=>setFinanceOpen(false)}>{finances}</Modal>}
 </section>;
}

function BikeCompanyCash({summary,request,onChanged}:{summary:BikeCompanyCashSummary;request:typeof operation;onChanged:()=>Promise<void>}){
 const [data,setData]=useState<BikeRemittancesResponse|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[report,setReport]=useState(false),[selected,setSelected]=useState<string[]>([]),[reference,setReference]=useState(''),[evidence,setEvidence]=useState('');
 const intent=useRef({fingerprint:'',id:crypto.randomUUID()});
 const cash=data?.company_cash||summary;
 const load=async(kind?:'deposits'|'collections')=>{
  setBusy(true);setError('');
  try{const params=new URLSearchParams();if(kind==='deposits'&&data?.next_cursor)params.set('cursor',data.next_cursor);if(kind==='collections'&&data?.collections_next_cursor)params.set('collection_cursor',data.collections_next_cursor);const result=await request<BikeRemittancesResponse>('/bike-rides/driver/remittances'+(params.size?'?'+params.toString():''),{}, {background:true,feedback:false});setData(previous=>!kind||!previous?result:{...result,items:[...new Map([...previous.items,...result.items].map(item=>[item.id,item])).values()],available_collections:[...new Map([...previous.available_collections,...result.available_collections].map(item=>[item.ride_id,item])).values()],next_cursor:kind==='deposits'?result.next_cursor:previous.next_cursor,collections_next_cursor:kind==='collections'?result.collections_next_cursor:previous.collections_next_cursor});}
  catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
 };
 const amount=(data?.available_collections||[]).filter(item=>selected.includes(item.ride_id)).reduce((sum,item)=>sum+item.amount_paise,0);
 const send=async()=>{
  if(!data||!selected.length||busy)return;setBusy(true);setError('');
  const payload={expected_version:data.company_cash.version,ride_ids:[...selected].sort(),amount_paise:amount,deposit_reference:reference.trim(),evidence:evidence.trim()},fingerprint=JSON.stringify(payload);
  if(intent.current.fingerprint!==fingerprint)intent.current={fingerprint,id:crypto.randomUUID()};
  try{await request('/bike-rides/driver/remittances',{method:'POST',body:JSON.stringify({...payload,request_id:intent.current.id})},{feedback:false});setReport(false);setSelected([]);setReference('');setEvidence('');await load();await onChanged();}
  catch(cause){if((cause as Error&{status?:number}).status===409){setReport(false);setSelected([]);await load();}setError((cause as Error).message);}finally{setBusy(false);}
 };
 return <details className="bike-rider-company-cash" onToggle={event=>{if(event.currentTarget.open&&!busy)void load();}}><summary><Wallet size={18} aria-hidden="true"/><span>Company collections<small>Cash held · salary separate</small></span><strong>{money(cash.outstanding_held_paise)}</strong></summary><div><div className="bike-rider-cash-totals"><span>Awaiting company receipt<strong>{money(cash.reported_remittance_paise)}</strong></span><span>Receipt confirmed<strong>{money(cash.confirmed_remittance_paise)}</strong></span></div><p>Report a deposit after transferring the money externally. The company verifies receipt separately.</p><div className="bike-rider-cash-tools"><button type="button" disabled={busy} onClick={()=>void load()}>Refresh records</button><button type="button" disabled={busy||!data?.available_collections.length} className="bike-rider-primary" onClick={()=>{setError('');setReport(true);}}>Report deposit</button></div>{error&&<p className="bike-rider-error" role="alert">{error}</p>}{busy&&!data&&<p role="status">Loading collections…</p>}{data?.items.map(item=><article key={item.id}><div><strong>{money(item.amount_paise)}</strong><small>{item.status==='company_received'?'Company receipt confirmed':'Deposit reported · verification pending'}</small><span>{item.deposit_reference}</span></div></article>)}{data?.next_cursor&&<button type="button" disabled={busy} onClick={()=>void load('deposits')}>More deposit records</button>}</div>{report&&<Modal title="Report company deposit" onClose={()=>{if(!busy)setReport(false);}}><form className="bike-rider-confirm" onSubmit={event=>{event.preventDefault();void send();}}><p>Select the full ride collections included in the deposit. Reporting does not move money.</p><fieldset className="bike-rider-cash-select"><legend>Ride collections</legend>{data?.available_collections.map(item=><label key={item.ride_id}><input type="checkbox" checked={selected.includes(item.ride_id)} disabled={!selected.includes(item.ride_id)&&selected.length>=100} onChange={event=>setSelected(previous=>event.target.checked?[...previous,item.ride_id]:previous.filter(id=>id!==item.ride_id))}/><span>#{shortId(item.ride_id)}<small>{salaryPeriod(item.period)}</small></span><strong>{money(item.amount_paise)}</strong></label>)}</fieldset>{data?.collections_next_cursor&&<button type="button" disabled={busy} onClick={()=>void load('collections')}>More collections</button>}<p><strong>Deposit total: {money(amount)}</strong></p><label>Deposit reference<input type="text" minLength={8} maxLength={200} required value={reference} onChange={event=>setReference(event.target.value)}/></label><label>Transfer evidence / notes<textarea minLength={10} maxLength={1000} required value={evidence} onChange={event=>setEvidence(event.target.value)}/></label>{error&&<p className="bike-rider-error" role="alert">{error}</p>}<div><button type="button" disabled={busy} onClick={()=>setReport(false)}>Back</button><button type="submit" className="bike-rider-primary" disabled={busy||!selected.length||amount<=0}>{busy?'Recording…':'Report actual deposit'}</button></div></form></Modal>}</details>;
}

export function BikeRiderWorkspace({request=operation,readPosition=currentPosition}:{request?:typeof operation;readPosition?:typeof currentPosition}={}){
 const [data,setData]=useState<AvailabilityResponse|null>(null),[rides,setRides]=useState<BikeRiderRide[]>([]),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[locationError,setLocationError]=useState(''),[sharing,setSharing]=useState(false),[vehicle,setVehicle]=useState(''),[now,setNow]=useState(Date.now()/1000);
 const [confirm,setConfirm]=useState<{ride:BikeRiderRide;action:BikeAction}|null>(null),[note,setNote]=useState(''),[otp,setOtp]=useState('');
 const [payroll,setPayroll]=useState<BikeDriverPayroll|null>(null),[payrollError,setPayrollError]=useState(''),[salaryConfirm,setSalaryConfirm]=useState<BikeSalaryObligation|null>(null);
 const [soundEnabled,setSoundEnabled]=useState(false),[soundError,setSoundError]=useState('');
 const audio=useRef<AudioContext|null>(null),playedStops=useRef(new Set<string>());
 const mounted=useRef(true),generation=useRef(0),dataRef=useRef(data),ridesRef=useRef(rides),positionBusy=useRef(false),actionBusy=useRef(false),offset=useRef(0),commands=useRef(new Map<string,object>());
 dataRef.current=data;ridesRef.current=rides;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 useEffect(()=>()=>{void audio.current?.close().catch(()=>{});},[]);
 const toggleSound=async()=>{
  if(soundEnabled){setSoundEnabled(false);void audio.current?.suspend().catch(()=>{});return;}
  try{const Audio=window.AudioContext||(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(!Audio)throw Error('Sound alerts are unavailable on this device.');audio.current??=new Audio();await audio.current.resume();if(audio.current.state!=='running')throw Error('Tap again to allow arrival sounds.');setSoundEnabled(true);setSoundError('');}
  catch(cause){setSoundEnabled(false);setSoundError((cause as Error).message);}
 };
 useEffect(()=>{
  const context=audio.current;
  if(!context||context.state!=='running'||error||locationError||!data?.dispatch_ready)return;
  const cues=bikeArrivalCueKeys(rides,{now,enabled:soundEnabled,visible:!document.hidden,connected:navigator.onLine,sharing});
  for(const key of cues){if(playedStops.current.has(key))continue;try{const gain=context.createGain(),tone=context.createOscillator(),at=context.currentTime;tone.type='sine';tone.frequency.setValueAtTime(740,at);tone.frequency.setValueAtTime(980,at+.16);gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(.07,at+.035);gain.gain.exponentialRampToValueAtTime(.0001,at+.45);tone.connect(gain);gain.connect(context.destination);tone.start(at);tone.stop(at+.46);playedStops.current.add(key);}catch{setSoundEnabled(false);setSoundError('Arrival sound paused. Tap Enable sound to retry.');break;}}
 },[rides,now,soundEnabled,sharing,error,locationError,data?.dispatch_ready]);
 const payrollRead=useRef<{at:number;result?:{value:BikeDriverPayroll|null;error:string};pending?:Promise<{value:BikeDriverPayroll|null;error:string}>}>({at:0});
 const readPayroll=useCallback((force=false)=>{
  const cache=payrollRead.current;
  if(cache.pending&&!force)return cache.pending;
  if(!force&&cache.result&&Date.now()-cache.at<60000)return Promise.resolve(cache.result);
  const pending=request<BikeDriverPayroll>('/bike-rides/driver/payroll',{}, {background:true,feedback:false}).then(value=>({value,error:''})).catch(cause=>({value:null,error:(cause as Error).message}));cache.pending=pending;
  void pending.then(result=>{if(cache.pending===pending){cache.result=result;cache.at=Date.now();cache.pending=undefined;}});return pending;
 },[request]);
 const refresh=useCallback(async(forcePayroll=false)=>{
  const requestNumber=++generation.current;
  try{
   const [availability,records,salary]=await Promise.all([request<AvailabilityResponse>('/bike-rides/driver/availability',{}, {background:true,feedback:false}),request<{rides:BikeRiderRide[];server_time:number}>('/bike-rides/driver/rides',{}, {background:true,feedback:false}),readPayroll(forcePayroll)]);
   if(!mounted.current||requestNumber!==generation.current)return;
   offset.current=availability.server_time-Date.now()/1000;setNow(availability.server_time);setData(availability);setRides(records.rides);setPayroll(salary.value);setPayrollError(salary.error);setSalaryConfirm(current=>{if(!current||!salary.value)return null;const latest=salary.value.obligations.find(record=>record.id===current.id);return latest?.status==='transfer_reported'?latest:null;});setVehicle(previous=>previous||availability.availability?.vehicle_id||availability.vehicles.find(v=>v.status==='approved'&&v.active&&v.vehicle_kind==='bike')?.id||'');setConfirm(current=>{if(!current)return null;const ride=records.rides.find(row=>row.id===current.ride.id);return ride&&bikeAllowedActions(ride).includes(current.action)?{...current,ride}:null;});setError('');return true;
  }catch(cause){if(mounted.current&&requestNumber===generation.current)setError((cause as Error).message);return false;}
  finally{if(mounted.current&&requestNumber===generation.current)setLoading(false);}
 },[request,readPayroll]);
 useEffect(()=>{let stopped=false,timer:ReturnType<typeof setTimeout>,failures=0;const poll=async()=>{if(stopped)return;if(!document.hidden&&navigator.onLine){const okay=await refresh();failures=okay?0:failures+1;}if(!stopped)timer=setTimeout(()=>void poll(),pollDelay(10000,failures));};void poll();const tick=setInterval(()=>setNow(Date.now()/1000+offset.current),1000);const focus=()=>{if(!document.hidden&&navigator.onLine)void refresh(true);};document.addEventListener('visibilitychange',focus);window.addEventListener('online',focus);return()=>{stopped=true;clearTimeout(timer);clearInterval(tick);document.removeEventListener('visibilitychange',focus);window.removeEventListener('online',focus);};},[refresh]);
 const readGps=useCallback(async()=>assertBikePosition(await readPosition(),Date.now()/1000),[readPosition]);
 const sharePosition=useCallback(async()=>{
  if(positionBusy.current||actionBusy.current||document.hidden||!navigator.onLine)return;
  positionBusy.current=true;
  try{
   const position=await readGps(),availability=dataRef.current?.availability;
   if(!mounted.current||document.hidden)return;
   const currentRides=ridesRef.current.filter(r=>['on_the_way','arrived','in_progress'].includes(r.state)&&!r.queued);
   // Active trip telemetry also renews the rider's existing presence. Renewing
   // availability with the same measurement would be rejected as a stale fix.
   for(const ride of currentRides){const updated=await request<BikeRiderRide>(`/bike-rides/bookings/${encodeURIComponent(ride.id)}/position`,{method:'POST',body:JSON.stringify(position)},{background:true,feedback:false});if(mounted.current)setRides(rows=>rows.map(row=>row.id===updated.id&&row.version<=updated.version?updated:row));}
   if(!currentRides.length&&availability?.online&&dataRef.current?.service_ready){const updated=await request<AvailabilityResponse>('/bike-rides/driver/availability',{method:'PUT',body:JSON.stringify({vehicle_id:availability.vehicle_id,online:true,position})},{background:true,feedback:false});if(mounted.current){setData(updated);offset.current=updated.server_time-Date.now()/1000;}}
   if(mounted.current)setLocationError('');
  }catch(cause){if(mounted.current){const failed=cause as Error&{status?:number;code?:string};const permanent=[401,403,404].includes(failed.status||0)||/permission.*denied|not supported|secure connection/i.test(failed.message);setLocationError(permanent?failed.message:'Location update delayed. Retrying automatically. '+failed.message);if(permanent)setSharing(false);}}
  finally{positionBusy.current=false;}
 },[readGps,refresh,request]);
 useEffect(()=>{if(!sharing)return;const timer=setInterval(()=>void sharePosition(),15000);const visible=()=>{if(!document.hidden)void sharePosition();};document.addEventListener('visibilitychange',visible);window.addEventListener('online',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',visible);};},[sharing,sharePosition]);
 const setOnline=async(online:boolean)=>{
  if(actionBusy.current)return;actionBusy.current=true;setBusy(true);setError('');
  try{const position=online?await readGps():undefined;if(!mounted.current||online&&document.hidden)return;await request('/bike-rides/driver/availability',{method:'PUT',body:JSON.stringify({vehicle_id:data?.availability?.online?data.availability.vehicle_id:vehicle,online,position})},{feedback:false});setSharing(online||ridesRef.current.some(ride=>['accepted','on_the_way','arrived','in_progress'].includes(ride.state)&&!ride.queued));setLocationError('');await refresh();}
  catch(cause){setError((cause as Error).message);}
  finally{actionBusy.current=false;if(mounted.current)setBusy(false);}
 };
 const run=async(ride:BikeRiderRide,action:BikeAction,input:{note:string;otp:string}={note:'',otp:''})=>{
  if(actionBusy.current)return;actionBusy.current=true;setBusy(true);setError('');
  try{
   const key=JSON.stringify([ride.id,ride.version,action,input.note,input.otp]);
   let command=commands.current.get(key);
   if(!command){command={command_id:crypto.randomUUID(),expected_version:ride.version,action,...(input.note.trim()?{note:input.note.trim()}:{}),...(action==='start'?{otp:input.otp}:{}),...(actionNeedsPosition.has(action)?{position:await readGps()}: {})};commands.current.set(key,command);}
   if(!mounted.current||document.hidden)return;
   await request(`/bike-rides/bookings/${encodeURIComponent(ride.id)}/commands`,{method:'POST',body:JSON.stringify(command)},{feedback:false});commands.current.delete(key);if(actionNeedsPosition.has(action))setSharing(true);setConfirm(null);setOtp('');setNote('');await refresh();
  }catch(cause){setError((cause as Error).message);await refresh();setError((cause as Error).message);}
  finally{actionBusy.current=false;if(mounted.current)setBusy(false);}
 };
 const chooseAction=(ride:BikeRiderRide,action:BikeAction)=>{setError('');setNote('');setOtp('');if(needsConfirmation.has(action))setConfirm({ride,action});else void run(ride,action);};
 const confirmSalary=async()=>{if(!salaryConfirm||actionBusy.current)return;actionBusy.current=true;setBusy(true);setError('');try{await request(`/bike-rides/driver/payroll/${encodeURIComponent(salaryConfirm.period)}/confirm`,{method:'POST',body:JSON.stringify({expected_version:salaryConfirm.version,received:true})},{feedback:false});setSalaryConfirm(null);await refresh(true);}catch(cause){setError((cause as Error).message);}finally{actionBusy.current=false;if(mounted.current)setBusy(false);}};
 if(!data)return <section className="bike-rider-workspace"><p role="status">{loading?'Opening your bike workspace…':'Bike workspace unavailable.'}</p>{error&&<p className="bike-rider-error" role="alert">{error}</p>}<button type="button" disabled={loading} onClick={()=>void refresh()}>Retry</button></section>;
 const dashboardData={...data,availability:data.availability?{...data.availability,vehicle_id:data.availability.online?data.availability.vehicle_id:vehicle}:vehicle?{vehicle_id:vehicle,online:false,updated_at:0}:null};
 return <><BikeRiderDashboard data={dashboardData} rides={rides} payroll={payroll} payrollError={payrollError} alertControl={<div className="bike-rider-alert-control"><button type="button" aria-pressed={soundEnabled} onClick={()=>void toggleSound()}>{soundEnabled?<Volume2 size={18} aria-hidden="true"/>:<VolumeX size={18} aria-hidden="true"/>}{soundEnabled?'Arrival sound on':'Enable sound'}</button>{soundError&&<span role="status">{soundError}</span>}</div>} earningPanel={!payroll?.rostered?<BikeIndependentEarnings request={request} onChanged={async()=>{await refresh(true);}}/>:undefined} cashPanel={payroll?.company_cash?<BikeCompanyCash summary={payroll.company_cash} request={request} onChanged={async()=>{await refresh(true);}}/>:undefined} now={now} busy={busy} error={error} locationError={locationError} sharing={sharing} onVehicle={setVehicle} onOnline={online=>void setOnline(online)} onLocation={()=>{setSharing(true);void sharePosition();}} onRefresh={()=>void refresh(true)} onAction={chooseAction} onConfirmSalary={record=>{setError('');setSalaryConfirm(record);}}/>{salaryConfirm&&<Modal title="Confirm salary receipt" onClose={()=>{if(!busy)setSalaryConfirm(null);}}><form className="bike-rider-confirm" onSubmit={event=>{event.preventDefault();void confirmSalary();}}><p>Confirm {money(salaryConfirm.amount_paise)} for {salaryPeriod(salaryConfirm.period)} only after you receive it in your account.</p>{salaryConfirm.transfer?.reference&&<p>Transfer reference: {salaryConfirm.transfer.reference}</p>}{error&&<p className="bike-rider-error" role="alert">{error}</p>}<div><button type="button" disabled={busy} onClick={()=>setSalaryConfirm(null)}>Back</button><button type="submit" className="bike-rider-primary" disabled={busy}>{busy?'Recording…':'I received this salary'}</button></div></form></Modal>}{confirm&&<Modal title={bikeActionLabels[confirm.action]} onClose={()=>{if(!busy)setConfirm(null);}}><form className="bike-rider-confirm" onSubmit={event=>{event.preventDefault();void run(confirm.ride,confirm.action,{note,otp});}}>{confirm.action==='start'?<><p>Ask the passenger for their ride OTP. Start only when they are safely at pickup.</p><label>Passenger OTP<input type="text" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={otp} onChange={event=>setOtp(event.target.value.replace(/\D/g,''))}/></label></>:confirm.action==='cash_received'?<p>Confirm only the cash you actually received for the company. Ride collection does not mark salary as paid.</p>:<label>{confirm.action==='dispute'?'What happened?':'Reason'}<textarea required minLength={5} maxLength={500} value={note} onChange={event=>setNote(event.target.value)}/></label>}{error&&<p className="bike-rider-error" role="alert">{error}</p>}<div><button type="button" disabled={busy} onClick={()=>setConfirm(null)}>Back</button><button type="submit" className="bike-rider-primary" disabled={busy}>{busy?'Updating…':bikeActionLabels[confirm.action]}</button></div></form></Modal>}</>;
}
