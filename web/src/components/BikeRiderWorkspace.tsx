import {createBikeLocationSession} from '../services/bikeLocationSession.mjs';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowRight,Check,Clock,ChevronDown,LocateFixed,Navigation,Phone,RefreshCw,Settings,ShieldCheck,TwoWheeler,User,Volume2,VolumeX,Wallet} from '../icons';
import {currentPosition,money,operation} from '../services/operations';
import {assertBikePosition,bikeActionLabels,bikeAllowedActions,bikeArrivalCueKeys,bikeCollectionSummary,bikeRiderSections,riderIsOnline} from '../services/bikeRiderState.mjs';
import {Modal} from './ui';
import {ResumeRide,RideSheetHandle,RideWorkspace} from './RideWorkspace';
import {JourneyMap} from './JourneyTracking';
import {BikeIndependentEarnings} from './BikeIndependentEarnings';
import {pollDelay} from '../services/resilientReads.mjs';
import './bike-rider-workspace.css';
import './driver-go.css';
import {MotionPage} from './MotionPage';
import {RideNotificationControl} from './RideNotificationControl';

export interface BikeRiderPosition {lat:number;lng:number;accuracy:number;captured_at:number;received_at?:number}
export interface BikeRiderVehicle {id:string;name:string;status:string;active:boolean;vehicle_kind:string;valid_until?:number;presence_version?:number}
export interface BikeDriverAvailability {vehicle_id:string;online:boolean;version?:number;position?:BikeRiderPosition;updated_at:number}
export interface BikeRiderRide {
 early_dropoff?:{requested_at:number};id:string;state:string;version:number;vehicle_name?:string;passenger_name?:string;passenger_phone?:string;
 pickup?:{lat:number;lng:number};dropoff?:{lat:number;lng:number};pickup_address?:string;dropoff_address?:string;
 pricing?:{customer_total_paise?:number;free?:boolean};
 earnings_offer?:{model:string;amount_paise:number;terms?:string};route?:{points:{lat:number;lng:number}[]};position?:BikeRiderPosition|null;
 queued?:boolean;accepted_by_driver?:boolean;available_at?:number;created_at?:number;expires_at?:number;
 allowed_actions?:string[];stop_status?:{pickup?:BikeRiderStop;destination?:BikeRiderStop};
 payment_status?:string;company_cash_held_paise?:number;company_collection_status?:string;blockers?:string[];
}
interface BikeRiderRecords {rides:BikeRiderRide[];next_cursor?:string|null;server_time:number}
interface BikeRiderStop {status:'inside'|'outside'|'unknown';distance_metres?:number;radius_metres?:number;valid_until?:number}
interface AvailabilityResponse {rider_approved?:boolean;vehicles:BikeRiderVehicle[];availability:BikeDriverAvailability|null;server_time:number;dispatch_ready:boolean;service_ready:boolean;availability_reason?:string|null}
export interface BikeSalaryObligation {id:string;period:string;amount_paise:number;status:'owed'|'transfer_reported'|'driver_received';version:number;transfer?:{reference:string;amount_paise:number;payment_method?:'office_cash'|'bank_transfer'}|null;received_at?:number}
export interface BikeCompanyCashSummary {driver_id:string;version:number;collected_paise:number;reported_remittance_paise:number;confirmed_remittance_paise:number;outstanding_held_paise:number;available_to_report_paise:number;currency:'INR'}
export interface BikeDriverPayroll {salary_payment_method?:'office_cash'|'bank_transfer';cash_collection_point?:string|null;driver_id:string;period:string;compensation_model:'monthly_salary';monthly_salary_paise:number;rostered:boolean;approved:boolean;obligations:BikeSalaryObligation[];server_time:number;company_cash?:BikeCompanyCashSummary}
interface BikeCashCollection {ride_id:string;amount_paise:number;collected_at:number;period:string}
interface BikeCashRemittance {id:string;version:number;status:'deposit_reported'|'company_received';amount_paise:number;deposit_reference:string;reported_at:number;received_at?:number}
interface BikeRemittancesResponse {company_cash:BikeCompanyCashSummary;items:BikeCashRemittance[];next_cursor:string|null;available_collections:BikeCashCollection[];collections_next_cursor:string|null}
type BikeAction=keyof typeof bikeActionLabels;
const labels:Record<string,string>={offered:'New request',queued:'Next ride',accepted:'Accepted',on_the_way:'To pickup',arrived:'At pickup',in_progress:'On the road',completion_pending:'Completion review',payment_due:'Payment due',payment_reported:'Cash reported',completed:'Completed',cancelled:'Cancelled',declined:'Declined',expired:'Expired',disputed:'Under review'};
const actionNeedsPosition=new Set(['depart','arrive','start','complete']);
const needsConfirmation=new Set(['decline','cancel','dispute','cash_received','start']);
const indiaTime=(stamp:number)=>new Date(stamp*1000).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'numeric',minute:'2-digit'});
const shortId=(id:string)=>id.slice(-6).toUpperCase();
const salaryStatus={owed:'Salary pending',transfer_reported:'Payment reported',driver_received:'Receipt confirmed'};
const salaryPeriod=(period:string)=>/^\d{4}-\d{2}$/.test(period)?new Date(period+'-01T00:00:00+05:30').toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',month:'short',year:'numeric'}):period;
const newerRide=(current:BikeRiderRide|undefined,incoming:BikeRiderRide)=>!current||incoming.version>current.version||incoming.version===current.version&&(incoming.position?.received_at||0)>=(current.position?.received_at||0)?incoming:current;
function mergeRiderRides(current:BikeRiderRide[],incoming:BikeRiderRide[]){const rows=new Map(current.map(row=>[row.id,row]));for(const row of incoming)rows.set(row.id,newerRide(rows.get(row.id),row));return [...rows.values()];}


function RideCardBody({fullscreen,children}:{fullscreen:boolean;children:ReactNode}){return fullscreen?<div className="bike-rider-trip-body"><RideSheetHandle/>{children}</div>:<>{children}</>;}
function BikeRideCard({ride,now,busy,onAction,fullscreen=false}:{ride:BikeRiderRide;now:number;busy:boolean;onAction:(ride:BikeRiderRide,action:BikeAction)=>void;fullscreen?:boolean}){
 const actions=(bikeAllowedActions(ride) as BikeAction[]).filter(action=>action!=='complete'||!!ride.early_dropoff||(ride.stop_status?.destination?.status==='inside'&&ride.stop_status.destination.valid_until!=null&&ride.stop_status.destination.valid_until>=now)),collection=bikeCollectionSummary(ride);
 const travelling=!ride.queued&&['accepted','on_the_way','arrived','in_progress'].includes(ride.state);
 const isDestination=ride.state==='in_progress',stop=travelling?(isDestination?ride.stop_status?.destination:ride.stop_status?.pickup):undefined;
 const arrival=stop?.status==='inside'&&typeof stop.valid_until==='number'&&stop.valid_until>=now;
 const destination=isDestination?ride.dropoff:ride.pickup;
 const navigation=destination&&Number.isFinite(destination.lat)&&Number.isFinite(destination.lng)&&Math.abs(destination.lat)<=90&&Math.abs(destination.lng)<=180?`https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}&travelmode=driving`:null;
 const phone=ride.passenger_phone&&/^\+?[0-9 ()-]{7,20}$/.test(ride.passenger_phone)?ride.passenger_phone:null;
 const stages=['Accepted','Pickup','Ride','Done'];
 const primary=actions.find(action=>!['cancel','decline','dispute'].includes(action)),more=actions.filter(action=>action!==primary&&action!=='decline');
 const liveMap=fullscreen&&ride.pickup&&ride.dropoff;
 const position=ride.position&&ride.position.received_at!=null&&now-ride.position.received_at>=0&&now-ride.position.received_at<=75?ride.position:null;
 const stage=ride.state==='completed'?3:['in_progress','completion_pending','payment_due','payment_reported'].includes(ride.state)?2:['on_the_way','arrived'].includes(ride.state)?1:0;
 const request=!ride.accepted_by_driver&&['offered','queued'].includes(ride.state);
 const seconds=request&&Number.isFinite(ride.expires_at)?Math.max(0,Math.ceil(ride.expires_at!-now)):null;
 const expired=seconds===0,disabled=busy||!navigator.onLine||expired;
 const route=<dl className="bike-rider-route"><div><dt><span aria-hidden="true"/>Pickup</dt><dd>{ride.pickup_address||'Shared after acceptance'}</dd></div><div><dt><span aria-hidden="true"/>Drop-off</dt><dd>{ride.dropoff_address||'Shared after acceptance'}</dd></div></dl>;
 return <article className={`bike-rider-trip${arrival?' is-at-stop':''}${ride.queued?' is-next':''}${request?' is-request':''}`} aria-label={`${labels[ride.state]||'Ride'} ${shortId(ride.id)}`}>
  <RideCardBody fullscreen={fullscreen}><header><span className="bike-rider-trip-state"><span aria-hidden="true"/>{labels[ride.state]||'Ride update'}</span>{seconds!=null?<span className={`bike-rider-request-clock${expired?' is-expired':''}`}><Clock size={16} aria-hidden="true"/>{expired?'Request expired':`${seconds}s to respond`}</span>:<small>#{shortId(ride.id)}</small>}</header>
  {travelling&&<div className="bike-rider-stop-focus"><div><span>{isDestination?'Head to drop-off':ride.state==='arrived'?'Meet at pickup':'Head to pickup'}</span><h4>{(isDestination?ride.dropoff_address:ride.pickup_address)||'Use the confirmed ride location'}</h4></div>{navigation&&<a className="bike-rider-navigation" href={navigation} target="_blank" rel="noopener noreferrer" aria-label={`Navigate to ${isDestination?'drop-off':'pickup'}`}><Navigation size={21} aria-hidden="true"/><span>Navigate</span></a>}</div>}
  {ride.state==='in_progress'&&ride.early_dropoff&&<p className="bike-rider-arrival" role="status">Passenger requested an early drop-off. Stop safely before finishing.</p>}
  {ride.state==='in_progress'&&!ride.early_dropoff&&!arrival&&<p className="bike-rider-distance">Finish ride unlocks within 150 m of the destination with precise GPS.</p>}
  {arrival&&<p className="bike-rider-arrival" role="status"><Check size={18} aria-hidden="true"/>Within the stop area · GPS verified</p>}
  {stop?.distance_metres!=null&&!arrival&&stop.valid_until!=null&&stop.valid_until>=now&&<p className="bike-rider-distance"><Navigation size={16} aria-hidden="true"/>{Math.round(stop.distance_metres)} m to {isDestination?'drop-off':'pickup'}</p>}
  <div className="bike-rider-passenger"><span className="bike-rider-passenger-icon"><User size={21} aria-hidden="true"/></span><div><h4>{ride.passenger_name||'Bike ride request'}</h4><small>{request?'Passenger details after acceptance':ride.vehicle_name||'Bike ride'}</small></div>{phone&&<a className="bike-rider-icon-button" href={`tel:${phone.replace(/[ ()-]/g,'')}`} aria-label="Call passenger"><Phone size={20} aria-hidden="true"/></a>}</div>
  {!travelling&&route}
  <div className="bike-rider-trip-fare"><div><small>{collection.free?'Customer fare':'Collect for company'}</small><strong>{collection.customerPaise==null?'Pending quote':money(collection.customerPaise)}</strong><span>{collection.free?'No fare to collect':'Company cash'}</span></div>{ride.earnings_offer?.model==='per_ride'&&<div><small>Your agreed earning</small><strong>{money(ride.earnings_offer.amount_paise)}</strong><span>Per agreed terms</span></div>}</div>
  {ride.payment_status&&<p className="bike-rider-payment-status"><Wallet size={16} aria-hidden="true"/>{ride.payment_status.replaceAll('_',' ')}</p>}
  {ride.company_collection_status==='held_by_rider'&&typeof ride.company_cash_held_paise==='number'&&<p className="bike-rider-payment-status"><Wallet size={16} aria-hidden="true"/>Company cash held · {money(ride.company_cash_held_paise)}</p>}
  {ride.queued&&ride.accepted_by_driver&&<p className="bike-rider-queue-note"><Clock size={18} aria-hidden="true"/><span>Reserved next{ride.available_at?` · planned after ${indiaTime(ride.available_at)}`:''}. Finish your current ride first.</span></p>}
  {ride.state==='completion_pending'&&<p className="bike-rider-queue-note">Waiting for the passenger to confirm completion.</p>}
  {ride.state==='payment_due'&&<p className="bike-rider-queue-note">The passenger needs to report their cash payment.</p>}
  {ride.state==='payment_reported'&&<p className="bike-rider-queue-note">Confirm only the cash you actually received.</p>}
  {ride.state==='disputed'&&<p className="bike-rider-queue-note">This ride is awaiting support review.</p>}
  {ride.blockers?.includes('otp_locked_contact_support')&&<p className="bike-rider-error" role="status">Pickup code locked. Contact Repaido support before continuing.</p>}
  {expired&&<p className="bike-rider-queue-note" role="status">This request has ended. Refresh for the latest rides.</p>}
  {actions.length>0&&<div className="bike-rider-trip-actions">{primary&&<button type="button" disabled={disabled} className="bike-rider-primary" onClick={()=>onAction(ride,primary)}>{bikeActionLabels[primary]}<ArrowRight size={18} aria-hidden="true"/></button>}{request&&actions.includes('decline')&&<button type="button" className="bike-rider-decline" disabled={disabled} onClick={()=>onAction(ride,'decline')}>Reject</button>}{more.length>0&&<details className="bike-rider-more-actions"><summary>More options<ChevronDown size={18} aria-hidden="true"/></summary><div>{more.map(action=><button key={action} type="button" disabled={disabled} onClick={()=>onAction(ride,action)}>{bikeActionLabels[action]}</button>)}</div></details>}</div>}

  {travelling&&<details className="bike-rider-route-details"><summary>Route details<ChevronDown size={18} aria-hidden="true"/></summary>{route}</details>}
  {!['offered','queued','cancelled','declined','expired'].includes(ride.state)&&<ol className="bike-rider-progress" aria-label="Ride progress">{stages.map((name,index)=><li key={name} data-done={index<stage} aria-current={index===stage?'step':undefined}><i aria-hidden="true"/>{name}</li>)}</ol>}
 </RideCardBody>
  {liveMap&&<div className="bike-rider-live-map"><JourneyMap origin={ride.pickup!} destination={ride.dropoff!} route={ride.route?.points||[]} position={position} positionLabel="Your latest ride position" mapLabel="Your current bike route" rideScreen={fullscreen}/><span className="bike-rider-map-state">{arrival?<><Check size={16} aria-hidden="true"/>At the stop</>:position?'Your latest position':'Route · waiting for fresh GPS'}</span></div>}
 </article>;
}

export function BikeRiderDashboard({data,rides,vehicleRole='owner',onManageVehicles,payroll,payrollError='',historyMore=false,historyLoading=false,historyError='',onMoreHistory,cashPanel,earningPanel,alertControl,now,busy,error,locationError,sharing,onVehicle,onOnline,onLocation,onRefresh,onAction,onConfirmSalary,background=false}:{data:AvailabilityResponse;rides:BikeRiderRide[];vehicleRole?:'owner'|'driver';onManageVehicles?:()=>void;payroll?:BikeDriverPayroll|null;payrollError?:string;historyMore?:boolean;historyLoading?:boolean;historyError?:string;onMoreHistory?:()=>void;cashPanel?:ReactNode;earningPanel?:ReactNode;alertControl?:ReactNode;now:number;busy:boolean;error:string;locationError:string;sharing:boolean;onVehicle:(id:string)=>void;onOnline:(online:boolean)=>void;onLocation:()=>void;onRefresh:()=>void;onAction:(ride:BikeRiderRide,action:BikeAction)=>void;onConfirmSalary?:(obligation:BikeSalaryObligation)=>void;background?:boolean}){
 const [minimized,setMinimized]=useState('');
 const sections=bikeRiderSections(rides),presenceOnline=riderIsOnline(data.availability,now),serviceReady=data.dispatch_ready&&data.service_ready,[history,setHistory]=useState(()=>new URLSearchParams(location.search).get('ride-history')==='1');
 const offer=sections.offers.find((ride:BikeRiderRide)=>(ride.expires_at||0)>now),focusRide=offer||sections.current[0]||sections.next[0];
 const showRide=!!focusRide&&(!!offer||minimized!==focusRide.id);
 const approved=data.vehicles.filter(vehicle=>vehicle.vehicle_kind==='bike'&&vehicle.status==='approved'&&vehicle.active&&(!vehicle.valid_until||vehicle.valid_until>now+1800));
 const riderApproved=data.rider_approved??(payroll?!!(payroll.rostered&&payroll.approved):undefined),canWork=riderApproved===true;
 const setupNeeded=!approved.length||!canWork,online=presenceOnline&&serviceReady&&!setupNeeded;
 const bikeSetupReason=!data.vehicles.length?(vehicleRole==='driver'?'Accept your bike assignment in Vehicles.':'Add a bike and its documents in Fleet.'):
  !data.vehicles.some(v=>v.status==='approved')?'Your bike is waiting for document approval.':
  !data.vehicles.some(v=>v.status==='approved'&&v.active)?'Your approved bike is inactive. Ask the owner to activate it.':'Bike documents must remain valid for at least 30 more minutes. Ask the owner to renew them.';
 const dutyReason=!approved.length?bikeSetupReason:!canWork?(riderApproved===false?'Your rider earning plan needs company approval.':'Refresh to check rider approval.'):!serviceReady?'Bike requests are currently paused.':'Works on laptop and phone. Allow precise browser location and keep this screen open while on duty.';
 const selected=data.availability?.vehicle_id||approved[0]?.id||'';
 const [financeOpen,setFinanceOpen]=useState(false);
 const staleSession=data.availability?.online&&!presenceOnline;
 const setup=setupNeeded&&<section className="bike-rider-setup" aria-label="Bike rider setup"><header><ShieldCheck size={21} aria-hidden="true"/><h4>Get ready to ride</h4></header>
  {!approved.length&&<div className="bike-rider-setup-step"><span className="bike-rider-setup-icon"><TwoWheeler size={21} aria-hidden="true"/></span><div><h4>{data.vehicles.length?'Bike setup needs attention':vehicleRole==='driver'?'Connect a bike':'Add your bike'}</h4><p>{bikeSetupReason}</p></div>{onManageVehicles&&<button type="button" onClick={onManageVehicles}>{vehicleRole==='driver'?'Vehicle invitations':'Open fleet'}<ArrowRight size={17} aria-hidden="true"/></button>}</div>}
  {!canWork&&<div className="bike-rider-setup-step"><span className="bike-rider-setup-icon"><ShieldCheck size={21} aria-hidden="true"/></span><div><h4>{riderApproved===false?'Rider approval needed':'Check rider approval'}</h4><p>{riderApproved===false?'Your earning plan needs company approval before you can take requests.':'Rider status is unavailable. Refresh before going online.'}</p></div><button type="button" disabled={busy} onClick={riderApproved===false?()=>setFinanceOpen(true):onRefresh}>{riderApproved===false?'Earning plan':'Refresh status'}<ArrowRight size={17} aria-hidden="true"/></button></div>}
 </section>;
 const finances=<div className="bike-rider-workspace bike-rider-finance">
  <dl className="bike-earnings-totals" aria-label="Your recorded money totals">{payroll?.rostered&&<div><dt>Monthly salary</dt><dd>{money(payroll.monthly_salary_paise)}</dd></div>}{payroll?.company_cash&&<><div><dt>Company cash held</dt><dd>{money(payroll.company_cash.outstanding_held_paise)}</dd></div><div><dt>Company receipt confirmed</dt><dd>{money(payroll.company_cash.confirmed_remittance_paise)}</dd></div></>}</dl>
  {payroll&&(payroll.rostered||payroll.obligations.length>0)&&Number.isSafeInteger(payroll.monthly_salary_paise)&&<details className="bike-rider-payroll"><summary className="bike-rider-salary"><Wallet size={18} aria-hidden="true"/><span>Monthly salary<strong>{money(payroll.monthly_salary_paise)}<small> / month</small></strong></span><small>{payroll.rostered&&payroll.approved?'Your salary records':'Roster approval needed'}</small></summary><div><p>Ride collections belong to the company. Salary receipt is recorded separately.</p>{payroll.salary_payment_method==='office_cash'&&<p>Salary collection: cash from {payroll.cash_collection_point||'the company office'}. Confirm receipt after the cash is handed to you.</p>}{!payroll.rostered&&<p>Your account is not on the active bike rider roster.</p>}{payroll.obligations.length?payroll.obligations.map(record=><article key={record.id}><div><strong>{salaryPeriod(record.period)}</strong><small>{record.status==='transfer_reported'&&record.transfer?.payment_method==='office_cash'?'Cash handed over · confirm receipt':salaryStatus[record.status]}</small></div><b>{money(record.amount_paise)}</b>{record.status==='transfer_reported'&&onConfirmSalary&&<button type="button" disabled={busy} onClick={()=>onConfirmSalary(record)}>Confirm receipt</button>}</article>):<p>No salary periods have been recorded yet.</p>}</div></details>}
  {payrollError&&<p className="bike-rider-error" role="status">Salary records unavailable. {payrollError}</p>}
  {earningPanel}
  {cashPanel}
 </div>;
 return <>{focusRide&&!showRide&&<ResumeRide kind="bike" status={labels[focusRide.state]||'Ride update'} onOpen={()=>setMinimized('')}/>}<section hidden={background} data-duty={setupNeeded?'setup':online?'online':'offline'} className="bike-rider-workspace" aria-label="Bike rider workspace" aria-busy={busy}>
  <header className="bike-rider-control"><div className="bike-rider-title"><span className="bike-rider-emblem"><TwoWheeler size={23} aria-hidden="true"/></span><div><h3>Bike rides</h3><span className={`bike-rider-presence${online?' is-online':''}`}><i aria-hidden="true"/>{sections.current.some((ride:BikeRiderRide)=>ride.state==='in_progress')?'On your trip':setupNeeded?'Setup needed':!serviceReady?'Requests paused':online?'Ready for requests':'Offline'}</span></div></div><div className="bike-rider-control-actions"><button type="button" className={`bike-rider-online-toggle${online?' is-online':''}`} role="switch" aria-label="Available for bike rides" aria-description={dutyReason} aria-checked={online} disabled={busy||(!presenceOnline&&(!approved.length||!canWork||!serviceReady))} onClick={()=>onOnline(!presenceOnline)}><span aria-hidden="true"/>{presenceOnline?'Go offline':'Go online'}</button><button type="button" className="bike-rider-icon-button" aria-label="Refresh bike rides" disabled={busy} onClick={onRefresh}><RefreshCw size={20} aria-hidden="true"/></button></div></header>
  <button type="button" className="bike-rider-earnings-strip" onClick={()=>setFinanceOpen(true)}><Wallet size={19} aria-hidden="true"/><span>{payroll?.company_cash?'Company cash held':'Earnings & company cash'}</span>{payroll?.company_cash&&<strong>{money(payroll.company_cash.outstanding_held_paise)}</strong>}<ChevronDown size={18} aria-hidden="true"/></button>
  {!background&&!focusRide&&approved.length>0&&<div className="bike-rider-duty-map"><JourneyMap position={presenceOnline?data.availability?.position:null} mapLabel="Rider duty map" positionLabel="Your latest duty location"/><span className="bike-rider-map-state">{!serviceReady?'Requests paused':online?'On duty · waiting for requests':'Off duty · plan your next trip'}</span></div>}
  <div className="bike-rider-shift-panel">
   {staleSession&&<div className="bike-rider-stale-session" role="status"><span>Your last location has expired.</span><button type="button" disabled={busy} onClick={()=>onOnline(false)}>End previous session</button></div>}
   <details className="bike-rider-settings"><summary aria-label="Ride settings"><Settings size={18} aria-hidden="true"/><span className="bike-rider-settings-name">{approved.find(bike=>bike.id===selected)?.name||'Ride settings'}</span><small>{!approved.length?'Bike needed':!canWork?'Approval needed':sharing&&!locationError?'GPS on':'GPS needed'}</small><ChevronDown size={18} aria-hidden="true"/></summary><div>
    <div className="bike-rider-availability"><label>Your bike<select value={selected} disabled={busy||data.availability?.online||!approved.length} onChange={e=>onVehicle(e.target.value)}>{approved.length?approved.map(vehicle=><option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>):<option value="">Approved bike needed</option>}</select></label></div>
    {approved.length>0&&<div className="bike-rider-location"><LocateFixed size={20} aria-hidden="true"/><span>{sharing?'GPS updates while this screen is open':'Share precise GPS for pickup and arrival'}</span><button type="button" disabled={busy} onClick={onLocation}>{sharing?'Update GPS':'Share GPS'}</button></div>}
    {alertControl}
    <RideNotificationControl/>
    <p className="bike-rider-driving-note">Laptop and phone supported. Allow precise browser location and keep this screen open. Set up before moving. Stop safely to use ride controls.</p>
   </div></details>
  </div>
  {!serviceReady&&<p className="bike-rider-info" role="status">{data.availability_reason||'Bike requests are currently paused.'}</p>}
  {payrollError&&canWork&&<p className="bike-rider-info" role="status">Earning records unavailable. Open Money to retry.</p>}
  {locationError&&<p className="bike-rider-info" role="status">{locationError}</p>}
  {error&&<div className="bike-rider-error" role="alert"><span>{error}</span><button type="button" disabled={busy} onClick={onRefresh}>Retry</button></div>}
  <div className="bike-rider-section-tools"><div className="bike-rider-view-tabs" role="group" aria-label="Bike ride records"><button type="button" aria-pressed={!history} onClick={()=>setHistory(false)}>Active <span>{sections.current.length+sections.next.length+sections.offers.length}</span></button><button type="button" aria-pressed={history} onClick={()=>setHistory(true)}>History <span>{sections.history.length}</span></button></div><button type="button" className="bike-rider-money-button" onClick={()=>setFinanceOpen(true)}><Wallet size={18} aria-hidden="true"/>Money</button></div>
  <MotionPage step={history?'history':'active'} variant="ride" className="driver-records-motion">
  {history?<div className="bike-rider-history">{sections.history.length?sections.history.map((ride:BikeRiderRide)=><details key={ride.id}><summary><span>{ride.dropoff_address||'Bike ride'}<small>{labels[ride.state]||ride.state} · #{shortId(ride.id)}</small></span><strong>{ride.pricing?.customer_total_paise==null?'—':money(ride.pricing.customer_total_paise)}</strong></summary><BikeRideCard ride={ride} now={now} busy={busy} onAction={onAction}/></details>):<p className="bike-rider-empty">Completed ride records will appear here.</p>}{historyError&&<p className="bike-rider-error" role="status">{historyError}</p>}{historyMore&&onMoreHistory&&<button type="button" className="bike-rider-load-history" disabled={historyLoading} onClick={onMoreHistory}>{historyLoading?'Loading earlier rides…':'Earlier rides'}</button>}</div>:<>
   {sections.current.length>0&&<section className="bike-rider-section" aria-label="Current bike ride"><h4>Current ride</h4>{sections.current.map((ride:BikeRiderRide)=><BikeRideCard key={ride.id} ride={ride} now={now} busy={busy} onAction={onAction}/>)}</section>}
   {sections.next.length>0&&<section className="bike-rider-section" aria-label="Next reserved bike ride"><h4>Reserved next</h4>{sections.next.map((ride:BikeRiderRide)=><BikeRideCard key={ride.id} ride={ride} now={now} busy={busy} onAction={onAction}/>)}</section>}
   {sections.offers.length>0&&<section className="bike-rider-section" aria-label="Bike ride requests"><h4>New requests <span>{sections.offers.length}</span></h4><div className="bike-rider-offer-rail">{sections.offers.map((ride:BikeRiderRide)=><BikeRideCard key={ride.id} ride={ride} now={now} busy={busy} onAction={onAction}/>)}</div></section>}
   {setup}
   {!setupNeeded&&!sections.current.length&&!sections.next.length&&!sections.offers.length&&<div className="bike-rider-empty"><span className="bike-rider-empty-icon"><TwoWheeler size={30} aria-hidden="true"/></span><h4>{!serviceReady?'Requests are paused':online?'Ready for your next request':'Your next ride starts here'}</h4><p>{!serviceReady?'You can still review your rides and earning records.':online?'Keep this screen open for new ride requests.':'Choose your bike and enable precise GPS to go online.'}</p></div>}
  </>}
  </MotionPage>
 </section>
  {focusRide&&<RideWorkspace open={showRide} key={focusRide.id} kind="bike" title={offer?'New bike request':'Your bike ride'} status={labels[focusRide.state]||'Ride update'} locked={!!offer} onMinimize={()=>{if(!busy)setMinimized(focusRide.id);}}><div className="bike-rider-workspace">{(error||locationError)&&<div className="bike-rider-error" role="alert"><span>{error||locationError}</span><button type="button" disabled={busy} onClick={onRefresh}>Retry</button></div>}<BikeRideCard ride={focusRide} now={now} busy={busy} onAction={onAction} fullscreen/></div></RideWorkspace>}
  {financeOpen&&<Modal className="ride-finance-dialog" title={payroll?.rostered?"Salary & company cash":"Ride earnings & company cash"} onClose={()=>setFinanceOpen(false)}>{finances}</Modal>}
 </>;
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
 return <details className="bike-rider-company-cash" onToggle={event=>{if(event.currentTarget.open&&!busy)void load();}}><summary><Wallet size={18} aria-hidden="true"/><span>Company collections<small>Cash held · salary separate</small></span><strong>{money(cash.outstanding_held_paise)}</strong></summary><div><div className="bike-rider-cash-totals"><span>Awaiting company receipt<strong>{money(cash.reported_remittance_paise)}</strong></span><span>Receipt confirmed<strong>{money(cash.confirmed_remittance_paise)}</strong></span></div><p>Report a deposit after transferring the money externally. The company verifies receipt separately.</p><div className="bike-rider-cash-tools"><button type="button" disabled={busy} onClick={()=>void load()}>Refresh records</button><button type="button" disabled={busy||!data?.available_collections.length} className="bike-rider-primary" onClick={()=>{setError('');setReport(true);}}>Report deposit</button></div>{error&&<p className="bike-rider-error" role="alert">{error}</p>}{busy&&!data&&<p role="status">Loading collections…</p>}{data?.items.map(item=><article key={item.id}><div><strong>{money(item.amount_paise)}</strong><small>{item.status==='company_received'?'Company receipt confirmed':'Deposit reported · verification pending'}</small><span>{item.deposit_reference}</span></div></article>)}{data?.next_cursor&&<button type="button" disabled={busy} onClick={()=>void load('deposits')}>More deposit records</button>}</div>{report&&<Modal title="Report company deposit" onClose={()=>{if(!busy)setReport(false);}}><form className="bike-rider-confirm" onSubmit={event=>{event.preventDefault();void send();}}><p>Select the full ride collections included in the deposit. Reporting does not move money.</p><fieldset className="bike-rider-cash-select"><legend>Ride collections</legend>{data?.available_collections.map(item=><label key={item.ride_id}><input type="checkbox" checked={selected.includes(item.ride_id)} disabled={!selected.includes(item.ride_id)&&selected.length>=100} onChange={event=>setSelected(previous=>event.target.checked?[...previous,item.ride_id]:previous.filter(id=>id!==item.ride_id))}/><span>#{shortId(item.ride_id)}<small>{salaryPeriod(item.period)}</small></span><strong>{money(item.amount_paise)}</strong></label>)}</fieldset>{data?.collections_next_cursor&&<button type="button" disabled={busy} onClick={()=>void load('collections')}>More collections</button>}<p><strong>Deposit total: {money(amount)}</strong></p><label>Deposit reference<input type="text" minLength={8} maxLength={200} required value={reference} onChange={event=>setReference(event.target.value)}/></label><label>Transfer evidence / notes<textarea aria-label="Transfer evidence / notes" minLength={10} maxLength={1000} required value={evidence} onChange={event=>setEvidence(event.target.value)}/></label>{error&&<p className="bike-rider-error" role="alert">{error}</p>}<div><button type="button" disabled={busy} onClick={()=>setReport(false)}>Back</button><button type="submit" className="bike-rider-primary" disabled={busy||!selected.length||amount<=0}>{busy?'Recording…':'Report actual deposit'}</button></div></form></Modal>}</details>;
}

export function BikeRiderWorkspace({request=operation,readPosition=currentPosition,vehicleRole='owner',onManageVehicles,background=false,home=false}:{request?:typeof operation;readPosition?:typeof currentPosition;vehicleRole?:'owner'|'driver';onManageVehicles?:()=>void;background?:boolean;home?:boolean}={}){
 const [data,setData]=useState<AvailabilityResponse|null>(null),[rides,setRides]=useState<BikeRiderRide[]>([]),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[locationError,setLocationError]=useState(''),[sharing,setSharing]=useState(false),[vehicle,setVehicle]=useState(''),[now,setNow]=useState(Date.now()/1000);
 const [confirm,setConfirm]=useState<{ride:BikeRiderRide;action:BikeAction}|null>(null),[note,setNote]=useState(''),[otp,setOtp]=useState('');
 const [payroll,setPayroll]=useState<BikeDriverPayroll|null>(null),[payrollError,setPayrollError]=useState(''),[salaryConfirm,setSalaryConfirm]=useState<BikeSalaryObligation|null>(null);
 const [soundEnabled,setSoundEnabled]=useState(false),[soundError,setSoundError]=useState('');
 const [historyCursor,setHistoryCursor]=useState<string|null>(null),[historyLoading,setHistoryLoading]=useState(false),[historyError,setHistoryError]=useState('');
 const gpsSession=useRef(createBikeLocationSession(navigator.geolocation)),lastSent=useRef(0),lastLocationSuccess=useRef(Date.now()),refreshBusy=useRef(false),readFailures=useRef(0);
 const historyStarted=useRef(false),historyBusy=useRef(false),olderActiveOffset=useRef(0),resumeChecked=useRef(false);
 const audio=useRef<AudioContext|null>(null),playedStops=useRef(new Set<string>());
 const mounted=useRef(true),generation=useRef(0),presenceIntent=useRef(0),presenceMutation=useRef(false),dataRef=useRef(data),ridesRef=useRef(rides),positionBusy=useRef(false),actionBusy=useRef(false),offset=useRef(0),commands=useRef(new Map<string,object>());
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
 const applyAvailability=useCallback((availability:AvailabilityResponse)=>{
  const previous=dataRef.current?.availability,next=availability.availability;
  if(previous&&next&&previous.vehicle_id===next.vehicle_id&&(previous.version||0)>(next.version||0))return;
  dataRef.current=availability;setData(availability);offset.current=availability.server_time-Date.now()/1000;setNow(availability.server_time);
 },[]);
 const refresh=useCallback(async(forcePayroll=false)=>{
  if(refreshBusy.current||presenceMutation.current)return true;refreshBusy.current=true;
  const requestNumber=++generation.current;
  try{
   const [availability,records,salary]=await Promise.all([request<AvailabilityResponse>('/bike-rides/driver/availability',{}, {background:true,feedback:false}),request<BikeRiderRecords>('/bike-rides/driver/rides',{}, {background:true,feedback:false}),readPayroll(forcePayroll)]);
   if(!mounted.current||requestNumber!==generation.current)return;
   const recentIds=new Set(records.rides.map(row=>row.id));
   const olderActive=ridesRef.current.filter(row=>!recentIds.has(row.id)&&!['completed','cancelled','declined','expired'].includes(row.state));
   // Refresh a bounded slice of loaded older obligations. History pages are not
   // repeatedly downloaded, and older payment/dispute records remain reachable.
   const slice=olderActive.length?Array.from({length:Math.min(8,olderActive.length)},(_,index)=>olderActive[(olderActiveOffset.current+index)%olderActive.length]):[];
   olderActiveOffset.current+=slice.length;
   const older=await Promise.allSettled(slice.map(row=>request<BikeRiderRide>(`/bike-rides/bookings/${encodeURIComponent(row.id)}`,{}, {background:true,feedback:false})));
   if(!mounted.current||requestNumber!==generation.current)return;
   const updated=[...records.rides,...older.flatMap(result=>result.status==='fulfilled'?[result.value]:[])];
   if(older.length)setHistoryError(older.some(result=>result.status==='rejected')?'Some earlier records could not refresh. Use Refresh to retry.':'');
   applyAvailability(availability);
   setRides(previous=>mergeRiderRides(previous,updated));
   if(!historyStarted.current)setHistoryCursor(records.next_cursor||null);
   setPayroll(salary.value);setPayrollError(salary.error);setSalaryConfirm(current=>{if(!current||!salary.value)return null;const latest=salary.value.obligations.find(record=>record.id===current.id);return latest?.status==='transfer_reported'?latest:null;});setVehicle(previous=>previous||availability.availability?.vehicle_id||availability.vehicles.find(v=>v.status==='approved'&&v.active&&v.vehicle_kind==='bike')?.id||'');setConfirm(current=>{if(!current)return null;const previous=ridesRef.current.find(row=>row.id===current.ride.id),incoming=updated.find(row=>row.id===current.ride.id),ride=incoming?newerRide(previous,incoming):previous;return ride&&bikeAllowedActions(ride).includes(current.action)?{...current,ride}:null;});setError('');readFailures.current=0;return true;
  }catch(cause){readFailures.current++;if(mounted.current&&requestNumber===generation.current&&(!dataRef.current||readFailures.current>=3))setError('Connection interrupted. Your current ride is kept here while updates reconnect.');return false;}
  finally{refreshBusy.current=false;if(mounted.current&&requestNumber===generation.current)setLoading(false);}
 },[request,readPayroll,applyAvailability]);
 useEffect(()=>{let stopped=false,timer:ReturnType<typeof setTimeout>,failures=0;const poll=async()=>{if(stopped)return;if(!document.hidden&&navigator.onLine){const okay=await refresh();failures=okay?0:failures+1;}if(!stopped)timer=setTimeout(()=>void poll(),pollDelay(10000,failures));};void poll();const tick=setInterval(()=>setNow(Date.now()/1000+offset.current),1000);const focus=()=>{if(!document.hidden&&navigator.onLine)void refresh(true);};document.addEventListener('visibilitychange',focus);window.addEventListener('online',focus);return()=>{stopped=true;clearTimeout(timer);clearInterval(tick);document.removeEventListener('visibilitychange',focus);window.removeEventListener('online',focus);};},[refresh]);
 const moreHistory=async()=>{
  if(!historyCursor||historyBusy.current)return;historyBusy.current=true;setHistoryLoading(true);setHistoryError('');
  try{
   const result=await request<BikeRiderRecords>('/bike-rides/driver/rides?after='+encodeURIComponent(historyCursor),{}, {background:true,feedback:false});
   if(!mounted.current)return;
   historyStarted.current=true;setHistoryCursor(result.next_cursor||null);
   setRides(previous=>mergeRiderRides(previous,result.rides));
  }catch(cause){if(mounted.current)setHistoryError('Earlier rides unavailable. '+(cause as Error).message);}
  finally{historyBusy.current=false;if(mounted.current)setHistoryLoading(false);}
 };
 const readGps=useCallback(async(fresh=false)=>assertBikePosition(await (readPosition===currentPosition&&!fresh?gpsSession.current.read():readPosition()),Date.now()/1000),[readPosition]);
 useEffect(()=>{if(sharing&&readPosition===currentPosition)gpsSession.current.start();else gpsSession.current.stop();return()=>gpsSession.current.stop();},[sharing,readPosition]);
 const sharePosition=useCallback(async()=>{
  if(positionBusy.current||actionBusy.current||document.hidden||!navigator.onLine)return;
  positionBusy.current=true;
  const intent=presenceIntent.current;
  try{
   const position=await readGps(),availability=dataRef.current?.availability;
   if(!mounted.current||intent!==presenceIntent.current||actionBusy.current||document.hidden||position.captured_at<=lastSent.current)return;
   const currentRides=ridesRef.current.filter(r=>['on_the_way','arrived','in_progress'].includes(r.state)&&!r.queued);
   // Active trip telemetry also renews the rider's existing presence. Renewing
   // availability with the same measurement would be rejected as a stale fix.
   for(const ride of currentRides){const updated=await request<BikeRiderRide>(`/bike-rides/bookings/${encodeURIComponent(ride.id)}/position`,{method:'POST',body:JSON.stringify(position)},{background:true,feedback:false});if(mounted.current)setRides(rows=>mergeRiderRides(rows,[updated]));}
   if(!currentRides.length&&availability?.online&&dataRef.current?.service_ready){const updated=await request<AvailabilityResponse>('/bike-rides/driver/availability',{method:'PUT',body:JSON.stringify({vehicle_id:availability.vehicle_id,online:true,heartbeat:true,position,expected_version:availability.version??0})},{background:true,feedback:false});if(mounted.current&&intent===presenceIntent.current){generation.current++;applyAvailability(updated);}}
   if(intent!==presenceIntent.current)return;
   lastSent.current=position.captured_at;lastLocationSuccess.current=Date.now();
   if(mounted.current)setLocationError('');
  }catch(cause){if(mounted.current&&intent===presenceIntent.current){const failed=cause as Error&{status?:number;code?:string};if(failed.code==='AVAILABILITY_CHANGED'){await refresh();return;}if(['STALE_POSITION','POSITION_RATE_LIMIT'].includes(failed.code||''))return;const permanent=[401,403].includes(failed.status||0)||/permission.*(denied|off)|not supported|secure connection/i.test(failed.message);if(permanent||Date.now()-lastLocationSuccess.current>45000)setLocationError(permanent?failed.message:'Live location is paused. Keep this screen open with precise GPS and a connection.');if(permanent)setSharing(false);}}
  finally{positionBusy.current=false;}
 },[readGps,request,applyAvailability,refresh]);
 useEffect(()=>{if(!sharing)return;const timer=setInterval(()=>void sharePosition(),10000);const visible=()=>{if(!document.hidden)void sharePosition();};document.addEventListener('visibilitychange',visible);window.addEventListener('online',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',visible);};},[sharing,sharePosition]);
 useEffect(()=>{
  if(sharing&&data&&!data.availability?.online&&!rides.some(ride=>['accepted','on_the_way','arrived','in_progress'].includes(ride.state)&&!ride.queued))setSharing(false);
 },[data,rides,sharing]);
 useEffect(()=>{
  if(!dataRef.current||resumeChecked.current)return;
  let cancelled=false;
  // Reuse an existing permission only; reloading must never open a GPS prompt.
  // The loaded/not-loaded dependency keeps polling from cancelling this check.
  void navigator.permissions?.query({name:'geolocation'}).then(permission=>{
   if(cancelled||!mounted.current)return;
   resumeChecked.current=true;
   const hasLiveRide=ridesRef.current.some(ride=>['accepted','on_the_way','arrived','in_progress'].includes(ride.state)&&!ride.queued);
   if(permission.state==='granted'&&(dataRef.current?.availability?.online||hasLiveRide)){setSharing(true);void sharePosition();}
  }).catch(()=>{});
  return()=>{cancelled=true;};
 },[data!==null,sharePosition]);
 const setOnline=async(online:boolean)=>{
  if(actionBusy.current)return;actionBusy.current=true;presenceMutation.current=true;presenceIntent.current++;generation.current++;setBusy(true);setError('');
  let failure='';
  try{
   const position=online?await readGps(true):undefined;
   if(!mounted.current||online&&document.hidden)return;
   const vehicleId=dataRef.current?.availability?.online?dataRef.current.availability.vehicle_id:vehicle;
   for(let attempt=0;attempt<3;attempt++){
    const previous=dataRef.current?.availability;
    try{
     const updated=await request<AvailabilityResponse>('/bike-rides/driver/availability',{method:'PUT',body:JSON.stringify({vehicle_id:vehicleId,online,position,expected_version:previous?.vehicle_id===vehicleId?previous.version??0:dataRef.current?.vehicles.find(item=>item.id===vehicleId)?.presence_version??0})},{feedback:false});
     if(!mounted.current)return;
     generation.current++;applyAvailability(updated);
     if(position){lastSent.current=position.captured_at;lastLocationSuccess.current=Date.now();}
     setSharing(!!updated.availability?.online||ridesRef.current.some(ride=>['accepted','on_the_way','arrived','in_progress'].includes(ride.state)&&!ride.queued));setLocationError('');break;
    }catch(cause){
     // An in-flight trip update may have advanced presence. Retry only the
     // explicit offline intent; never auto-resurrect an online session.
     if(online||(cause as {code?:string}).code!=='AVAILABILITY_CHANGED'||attempt===2)throw cause;
     const latest=await request<AvailabilityResponse>('/bike-rides/driver/availability',{}, {background:true,feedback:false,force:true});
     if(!mounted.current)return;applyAvailability(latest);
    }
   }
  }catch(cause){failure=(cause as Error).message;}
  finally{
   actionBusy.current=false;presenceMutation.current=false;
   if(mounted.current){setBusy(false);await refresh();if(failure)setError(failure);}
  }
 };
 const run=async(ride:BikeRiderRide,action:BikeAction,input:{note:string;otp:string}={note:'',otp:''})=>{
  if(actionBusy.current)return;actionBusy.current=true;setBusy(true);setError('');
  try{
   const key=JSON.stringify([ride.id,ride.version,action,input.note,input.otp]);
   let command=commands.current.get(key);
   if(!command){command={command_id:crypto.randomUUID(),expected_version:ride.version,action,...(input.note.trim()?{note:input.note.trim()}:{}),...(action==='start'?{otp:input.otp}:{}),...(actionNeedsPosition.has(action)?{position:await readGps(true)}: {})};commands.current.set(key,command);}
   if(!mounted.current||document.hidden)return;
   await request(`/bike-rides/bookings/${encodeURIComponent(ride.id)}/commands`,{method:'POST',body:JSON.stringify(command)},{feedback:false});commands.current.delete(key);if(actionNeedsPosition.has(action))setSharing(true);setConfirm(null);setOtp('');setNote('');await refresh();
  }catch(cause){setError((cause as Error).message);await refresh();setError((cause as Error).message);}
  finally{actionBusy.current=false;if(mounted.current)setBusy(false);}
 };
 const chooseAction=(ride:BikeRiderRide,action:BikeAction)=>{setError('');setNote('');setOtp('');if(needsConfirmation.has(action))setConfirm({ride,action});else void run(ride,action);};
 useEffect(()=>{if(!confirm||busy)return;const latest=rides.find(row=>row.id===confirm.ride.id);if(latest&&(!bikeAllowedActions(latest).includes(confirm.action)||['offered','queued'].includes(latest.state)&&!latest.accepted_by_driver&&(latest.expires_at||0)<=now))setConfirm(null);},[rides,now,confirm,busy]);
 const confirmSalary=async()=>{if(!salaryConfirm||actionBusy.current)return;actionBusy.current=true;setBusy(true);setError('');try{await request(`/bike-rides/driver/payroll/${encodeURIComponent(salaryConfirm.period)}/confirm`,{method:'POST',body:JSON.stringify({expected_version:salaryConfirm.version,received:true})},{feedback:false});setSalaryConfirm(null);await refresh(true);}catch(cause){setError((cause as Error).message);}finally{actionBusy.current=false;if(mounted.current)setBusy(false);}};
 if(!data)return background||home?null:<section className="bike-rider-workspace"><p role="status">{loading?'Opening your bike workspace…':'Bike workspace unavailable.'}</p>{error&&<p className="bike-rider-error" role="alert">{error}</p>}<button type="button" disabled={loading} onClick={()=>void refresh()}>Retry</button></section>;
 const dashboardData={...data,availability:data.availability?{...data.availability,vehicle_id:data.availability.online?data.availability.vehicle_id:vehicle}:vehicle?{vehicle_id:vehicle,online:false,updated_at:0}:null};
 return <><BikeRiderDashboard background={background||home&&!data.vehicles.some(item=>item.vehicle_kind==='bike')&&!rides.some(item=>!['completed','cancelled','declined','expired'].includes(item.state))} data={dashboardData} rides={rides} vehicleRole={vehicleRole} onManageVehicles={onManageVehicles} payroll={payroll} payrollError={payrollError} historyMore={!!historyCursor} historyLoading={historyLoading} historyError={historyError} onMoreHistory={()=>void moreHistory()} alertControl={<div className="bike-rider-alert-control"><button type="button" aria-pressed={soundEnabled} onClick={()=>void toggleSound()}>{soundEnabled?<Volume2 size={18} aria-hidden="true"/>:<VolumeX size={18} aria-hidden="true"/>}{soundEnabled?'Arrival sound on':'Enable sound'}</button>{soundError&&<span role="status">{soundError}</span>}</div>} earningPanel={!payroll?.rostered?<BikeIndependentEarnings request={request} onChanged={async()=>{await refresh(true);}}/>:undefined} cashPanel={payroll?.company_cash?<BikeCompanyCash summary={payroll.company_cash} request={request} onChanged={async()=>{await refresh(true);}}/>:undefined} now={now} busy={busy} error={error} locationError={locationError} sharing={sharing} onVehicle={setVehicle} onOnline={online=>void setOnline(online)} onLocation={()=>{setSharing(true);void sharePosition();}} onRefresh={()=>void refresh(true)} onAction={chooseAction} onConfirmSalary={record=>{setError('');setSalaryConfirm(record);}}/>{salaryConfirm&&<Modal title="Confirm salary receipt" onClose={()=>{if(!busy)setSalaryConfirm(null);}}><form className="bike-rider-confirm" onSubmit={event=>{event.preventDefault();void confirmSalary();}}><p>Confirm {money(salaryConfirm.amount_paise)} for {salaryPeriod(salaryConfirm.period)} only after you actually receive it{salaryConfirm.transfer?.payment_method==='office_cash'?' in cash at the company office':''}. {salaryConfirm.transfer?.payment_method==='office_cash'?'Count the cash before confirming.':'Check the completed payment before confirming.'}</p>{salaryConfirm.transfer?.reference&&<p>{salaryConfirm.transfer.payment_method==='office_cash'?'Cash receipt reference':'Transfer reference'}: {salaryConfirm.transfer.reference}</p>}{error&&<p className="bike-rider-error" role="alert">{error}</p>}<div><button type="button" disabled={busy} onClick={()=>setSalaryConfirm(null)}>Back</button><button type="submit" className="bike-rider-primary" disabled={busy}>{busy?'Recording…':'I received this salary'}</button></div></form></Modal>}{confirm&&<Modal title={bikeActionLabels[confirm.action]} onClose={()=>{if(!busy)setConfirm(null);}}><form className="bike-rider-confirm" onSubmit={event=>{event.preventDefault();void run(confirm.ride,confirm.action,{note,otp});}}>{confirm.action==='start'?<><p>Ask the passenger for their ride OTP. Start only when they are safely at pickup.</p><label>Passenger OTP<input type="text" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={otp} onChange={event=>setOtp(event.target.value.replace(/\D/g,''))}/></label></>:confirm.action==='cash_received'?<p>Confirm only the cash you actually received for the company. Ride collection does not mark salary as paid.</p>:<label>{confirm.action==='dispute'?'What happened?':'Reason'}<textarea aria-label={confirm.action==='dispute'?'What happened?':'Reason'} required minLength={confirm.action==='dispute'?10:5} maxLength={500} value={note} onChange={event=>setNote(event.target.value)}/></label>}{error&&<p className="bike-rider-error" role="alert">{error}</p>}<div><button type="button" disabled={busy} onClick={()=>setConfirm(null)}>Back</button><button type="submit" className="bike-rider-primary" disabled={busy}>{busy?'Updating…':bikeActionLabels[confirm.action]}</button></div></form></Modal>}</>;
}
