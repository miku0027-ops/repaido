import {ScrapLocationProvider} from './ScrapLocation';
import {CaptainClub,useCaptain} from './CaptainClub';
import {CleanupWorkspace} from './CleanupWorkspace';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ArrowRight,Building2,CalendarDays,Car,ClipboardList,Home,MoreHorizontal,Recycle,Route,Scale,ShieldCheck,Truck,UserRound,Users,Wallet,Wrench,Trophy,type LucideIcon,DriverBadge,LocalTaxi,KeyRound,TwoWheeler} from '../icons';
import {BusinessCalendar,BusinessRecords,VehicleEditor,useBusinessRecords} from './LocalBusiness';
import {DriverInvitations,SharedRideBookings,useSharedRecords,VehicleConnections} from './SharedRides';
import {money} from '../services/operations';
import {ContractError} from './customContractUI';
import {Modal} from './ui';
import {SharedRideRequestAlerts} from './SharedRideRequestAlerts';
import {PublicCabAvailability} from './PublicCabAvailability';
import {BikeRiderWorkspace} from './BikeRiderWorkspace';
import {BusinessCabRideWorkspace} from './BusinessCabRideWorkspace';
import './business-suites.css';

export const BusinessHeaderTarget=createContext<HTMLElement|null>(null);

type BusinessRole='cab_owner'|'driver'|'scrap_owner';
type Panel={id:string;label:string;icon:LucideIcon};
type Records=ReturnType<typeof useBusinessRecords>;
const closed=(r:any)=>['completed','cancelled','expired','declined'].includes(r.state);
const indiaDate=(t:number)=>new Date(t*1000).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
const monthNow=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}).slice(0,7);
const only=(records:Records,test:(r:any)=>boolean):Records=>({...records,rows:records.rows.filter(test)});
function initialMobilityPanel(role:'cab_owner'|'driver'){
 const query=new URLSearchParams(location.search);
 // A notification's exact ride stays ahead of a generic setup destination.
 if(query.has('bike-ride'))return 'bikes';
 if(query.has('shared-ride'))return 'shared';
 const tab=query.get('tab')||'';
 const allowed=role==='cab_owner'?['overview','bikes','shared','cabs','rentals','fleet','schedule','payments','account','more']:['overview','journeys','bikes','shared','vehicles','account'];
 return allowed.includes(tab)?tab:'overview';
}
function revealCurrentDestination(rail:HTMLElement|null|undefined){
 const selected=rail?.querySelector<HTMLElement>('[aria-current=page]');
 if(!rail||!selected||rail.scrollWidth<=rail.clientWidth)return;
 const bounds=rail.getBoundingClientRect(),item=selected.getBoundingClientRect();
 if(item.left<bounds.left+6)rail.scrollLeft+=item.left-bounds.left-6;
 else if(item.right>bounds.right-6)rail.scrollLeft+=item.right-bounds.right+6;
}

export function BusinessAppLauncher({currentRole,registeredRoles,onClose}:{currentRole:string;registeredRoles:string[];onClose:()=>void}){
 const apps=[{role:'technician',label:'Agent',description:'Visits, tasks and service work',icon:Wrench},{role:'contractor',label:'Contractor',description:'Projects, tenders and teams',icon:Building2},{role:'cab_owner',label:'Cab owner',description:'Fleet, shared rides and rentals',icon:Car},{role:'driver',label:'Driver',description:'Assigned vehicles and journeys',icon:DriverBadge},{role:'scrap_owner',label:'Scrap collector',description:'Collections, weighing and payments',icon:Recycle}];
 return <Modal title="Your business apps" onClose={onClose}><p className="suite-launcher-note">One mobile number, separate business profiles. Each new business is reviewed before you receive work.</p><div className="suite-launcher">{apps.map(({role,label,description,icon:Icon})=><a key={role} href={'/worker?mode='+role} aria-current={currentRole===role?'page':undefined}><Icon size={24} aria-hidden="true"/><span><strong>{label}</strong><small>{description}</small><b>{currentRole===role?'Current app':registeredRoles.includes(role)?'Open your app':'Register this business'}</b></span><ArrowRight size={20} aria-hidden="true"/></a>)}</div></Modal>;
}
function SuiteFrame({role,title,description,partner,panels,panel,onPanel,action,children}:{role:BusinessRole;title:string;description:string;partner:any;panels:Panel[];panel:string;onPanel:(p:string)=>void;action?:ReactNode;children:ReactNode}){
 const headerTarget=useContext(BusinessHeaderTarget);
 const heading=useRef<HTMLHeadingElement>(null),frame=useRef<HTMLElement>(null),navigation=useRef<HTMLElement>(null),panelHeader=useRef<HTMLDivElement>(null),first=useRef(true);
 const mobility=role!=='scrap_owner',owner=role==='cab_owner',scrap=role==='scrap_owner';
 const bookingPanels=panels.filter(p=>(owner?['cabs','shared','rentals','bikes']:['journeys','bikes','shared']).includes(p.id));
 const inBookings=mobility&&bookingPanels.some(p=>p.id===panel),inMore=owner?['more','payments','account'].includes(panel):scrap&&['more','cleanup','impact','calendar','account'].includes(panel);
 const primary:Panel[]=owner?[
  {id:'overview',label:'Home',icon:Home},{id:'bookings',label:'Bookings',icon:ClipboardList},
  {id:'fleet',label:'Fleet',icon:Car},{id:'schedule',label:'Schedule',icon:CalendarDays},
  {id:'more',label:'More',icon:MoreHorizontal}
 ]:scrap?[
  {id:'overview',label:'Home',icon:Home},{id:'requests',label:'Collect',icon:Truck},
  {id:'weighing',label:'Inspect',icon:Scale},{id:'payments',label:'Payments',icon:Wallet},
  {id:'more',label:'More',icon:MoreHorizontal}
 ]:panels.filter(p=>p.id!=='shared');
 const group=owner&&inBookings?'bookings':role==='driver'&&panel==='shared'?'journeys':inMore?'more':panel;
 const label=panels.find(p=>p.id===panel)?.label||'Overview';
 const select=(id:string)=>onPanel(id==='bookings'?'cabs':id);
 useEffect(()=>{
  const measure=()=>{
   frame.current?.style.setProperty('--suite-nav-height',`${navigation.current?.getBoundingClientRect().height||0}px`);
   frame.current?.style.setProperty('--suite-header-height',`${panelHeader.current?.getBoundingClientRect().height||0}px`);
   revealCurrentDestination(navigation.current);
   revealCurrentDestination(panelHeader.current?.querySelector<HTMLElement>('.suite-booking-navigation'));
  };
  const observer=new ResizeObserver(measure);
  if(navigation.current)observer.observe(navigation.current);
  if(panelHeader.current)observer.observe(panelHeader.current);
  measure();return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  revealCurrentDestination(navigation.current);
  revealCurrentDestination(panelHeader.current?.querySelector<HTMLElement>('.suite-booking-navigation'));
 },[panel]);
 useEffect(()=>{
  const initial=first.current;first.current=false;
  if(initial&&panel!=='bikes')return;
  if(panel==='bikes'&&frame.current){
   // Enter the ride cockpit once its data has a layout. Waiting for that first
   // render avoids clamping a deep-link scroll against the short loading view.
   let pending=true;
   const enter=()=>{
    if(!pending||!frame.current?.querySelector('.bike-rider-settings,.bike-rider-workspace>.bike-rider-error'))return;
    pending=false;observer.disconnect();
    let top=window.scrollY+(panelHeader.current?.parentElement?.getBoundingClientRect().top||0);
    const currentAction=frame.current.querySelector<HTMLElement>('[aria-label="Current bike ride"] .bike-rider-trip-actions>.bike-rider-primary');
    if(currentAction&&navigation.current)top=Math.max(top,window.scrollY+currentAction.getBoundingClientRect().bottom-navigation.current.getBoundingClientRect().top+12);
    window.scrollTo({top:Math.max(0,top),behavior:'instant'});
   };
   const observer=new ResizeObserver(enter);observer.observe(frame.current);enter();
   heading.current?.focus({preventScroll:true});
   return()=>{pending=false;observer.disconnect();};
  }
  if(panelHeader.current&&frame.current&&frame.current.getBoundingClientRect().top<0){const top=window.scrollY+(panelHeader.current.parentElement?.getBoundingClientRect().top||0);window.scrollTo({top:Math.max(0,top),behavior:'instant'});}
  heading.current?.focus({preventScroll:true});
 },[panel,mobility]);
 return <section ref={frame} data-panel={panel} className={'local-business-hub business-suite suite-workspace suite-'+role+(mobility?' suite-mobility':'')} aria-label={title}>
  {headerTarget?createPortal(<div className="worker-suite-identity"><h1>{role==='driver'?'Driver':role==='cab_owner'?'Cab owner':'Scrap collector'}</h1><span>{partner.name}</span><small><ShieldCheck size={12} aria-hidden="true"/>{partner.city}</small></div>,headerTarget):<header className="suite-hero"><span className="suite-emblem" aria-hidden="true">{role==='cab_owner'?<Car/>:role==='driver'?<DriverBadge/>:<Recycle/>}</span><div><small>REPAIDO BUSINESS</small><h1>{title}</h1><span className="suite-business-name"><ShieldCheck size={16} aria-hidden="true"/>{partner.name} · {partner.city}</span></div></header>}
  <div className="suite-layout">
    <nav ref={navigation} className="suite-navigation" aria-label={title+' navigation'}>{primary.map(({id,label,icon:Icon})=><button key={id} aria-label={scrap&&id==='requests'?'Collections':scrap&&id==='weighing'?'Inspection':role==='driver'&&id==='journeys'?'Cab rides':role==='driver'&&id==='shared'?'Shared rides':role==='driver'&&id==='vehicles'?'Vehicles':label} aria-current={group===id?'page':undefined} onClick={()=>select(id)}><Icon size={24} aria-hidden="true"/><span>{role==='driver'&&id==='journeys'?'Cab rides':role==='driver'&&id==='shared'?'Shared rides':role==='driver'&&id==='vehicles'?'Vehicles':label}</span></button>)}</nav>
   <div className="suite-content">
    <div ref={panelHeader} className={"suite-panel-header"+(inBookings?' has-ride-tabs':'')}>

     <div className="suite-title-row"><h2 ref={heading} tabIndex={-1} className="suite-panel-title">{label}</h2>{action}</div>
     {inBookings&&<nav className="suite-booking-navigation" aria-label="Booking types">{bookingPanels.map(p=><button key={p.id} aria-current={panel===p.id?'page':undefined} onClick={()=>onPanel(p.id)}><span aria-hidden="true">{({journeys:'Cab',cabs:'Cab',bikes:'Bike',shared:'Shared',rentals:'Self-drive'} as Record<string,string>)[p.id]||p.label}</span><span className="sr-only">{p.label}</span></button>)}</nav>}
    </div>
    {children}
   </div>
  </div>
 </section>;
}
function Metric({label,value,onClick}:{label:string;value:ReactNode;onClick?:()=>void}){return onClick?<button className="suite-metric" onClick={onClick}><span>{label}</span><strong>{value}</strong><ArrowRight size={16} aria-hidden="true"/></button>:<div className="suite-metric"><span>{label}</span><strong>{value}</strong></div>;}
function PanelCard({title,description,children}:{title:string;description?:string;children?:ReactNode}){return <section className="suite-card"><h3>{title}</h3>{description&&<p>{description}</p>}{children}</section>;}
function Empty({title,description,action,onClick}:{title:string;description:string;action?:string;onClick?:()=>void}){return <div className="suite-empty"><ClipboardList size={24} aria-hidden="true"/><h3>{title}</h3><p>{description}</p>{action&&<button onClick={onClick}>{action}<ArrowRight size={16} aria-hidden="true"/></button>}</div>;}
function NextWork({rows,onOpen,limit=3}:{rows:any[];onOpen:(row:any)=>void;limit?:number}){const next=rows.filter(r=>!closed(r)&&r.state!=='requested').sort((a,b)=>Number(b.state==='in_progress')-Number(a.state==='in_progress')||a.starts_at-b.starts_at).slice(0,limit);return <PanelCard title="Next on your schedule">{next.length?next.map(row=><button key={row.id} className="suite-next-work" onClick={()=>onOpen(row)}><CalendarDays size={20} aria-hidden="true"/><span><strong>{row.material?row.material+' collection':row.vehicle_name||row.quote?.vehicle?.name||'Vehicle booking'}</strong><small>{indiaDate(row.starts_at)} · {row.state.replaceAll('_',' ')}</small></span><ArrowRight size={20} aria-hidden="true"/></button>):<p>Your accepted work will appear here.</p>}</PanelCard>;}
function AccountPanel({partner,accountControls}:{partner:any;accountControls?:ReactNode}){return <><PanelCard title="Business profile"><dl className="suite-facts"><dt>Business name</dt><dd>{partner.name}</dd><dt>Business base</dt><dd>{partner.address}</dd><dt>Service city</dt><dd>{partner.city}</dd><dt>Document approval</dt><dd>Valid until {indiaDate(partner.valid_until)}</dd></dl><p>Contact support to update approved business details. Other business profiles keep their own review status.</p></PanelCard><PanelCard title="Your account">{accountControls}</PanelCard></>;}
function CalendarPanel({rows,children}:{rows:any[];children?:(month:string)=>ReactNode}){const [month,setMonth]=useState(monthNow);return <><label className="business-month">Schedule · India time<input aria-label="Schedule month" type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><BusinessCalendar month={month} rows={rows}/>{children?.(month)}</>;}

export function CabOwnerSuite({partner,vehicles,onRefresh,accountControls}:{partner:any;vehicles:any[];onRefresh:()=>Promise<unknown>;accountControls?:ReactNode}){
 const [recordId,setRecordId]=useState(()=>new URLSearchParams(location.search).get('shared-ride')||'');
 const [panel,setPanel]=useState(()=>initialMobilityPanel('cab_owner')),[editing,setEditing]=useState<any>(null);const source=useBusinessRecords('rides'),shared=useSharedRecords();
 const records=only(source,r=>r.customer_id!==source.uid&&(r.owner_id===source.uid||r.state==='requested'));
 const cabs=only(records,r=>r.mode==='cab'),rentals=only(records,r=>r.mode==='rental');
 const departures=shared.rows.filter(r=>r.owner_id===source.uid),active=records.rows.filter(r=>!closed(r)),pending=active.filter(r=>r.state==='requested');
 const received=records.rows.filter(r=>r.state==='completed'&&!r.financial_hold).reduce((sum,r)=>sum+(r.advance_paid_paise||0)+(r.balance_paid_paise||0),0);
 const panels:Panel[]=[{id:'overview',label:'Overview',icon:Home},{id:'bikes',label:'Bike rides',icon:TwoWheeler},{id:'shared',label:'Shared rides',icon:Users},{id:'cabs',label:'Cab bookings',icon:LocalTaxi},{id:'rentals',label:'Self-drive',icon:KeyRound},{id:'fleet',label:'Fleet & rates',icon:Car},{id:'schedule',label:'Schedule',icon:CalendarDays},{id:'payments',label:'Payments',icon:Wallet},{id:'account',label:'Account',icon:UserRound},{id:'more',label:'More',icon:MoreHorizontal}];
 const open=(r:any)=>{setRecordId(r.id);setPanel(r.vehicle_name?'shared':r.mode==='rental'?'rentals':'cabs');};
 return <SuiteFrame role="cab_owner" title="Cab owner suite" description="Your fleet. Your routes. Your business." partner={partner} panels={panels} panel={panel} onPanel={setPanel} action={panel==='fleet'?<button className="ops-primary" onClick={()=>setEditing({id:crypto.randomUUID(),version:0})}>Add vehicle</button>:undefined}><ContractError error={records.error||shared.error} onRetry={()=>{void records.refresh();void shared.refresh();}}/>
  <SharedRideRequestAlerts rows={departures} accountKey={source.uid} onOpen={open} settings={panel==='account'}/>
  <BusinessCabRideWorkspace records={cabs} role="cab_owner"/>
  {panel==='overview'&&<>
   <div className="suite-metrics"><Metric label="New booking requests" value={pending.length} onClick={()=>{setRecordId(pending[0]?.id||'');setPanel(pending[0]?.mode==='rental'?'rentals':'cabs');}}/><Metric label="Active vehicles" value={vehicles.filter(v=>v.active&&v.status==='approved'&&v.valid_until>Date.now()/1000).length} onClick={()=>setPanel('fleet')}/><Metric label="Shared departures" value={departures.filter(r=>!closed(r)).length} onClick={()=>setPanel('shared')}/><Metric label="Completed fares collected" value={money(received)} onClick={()=>setPanel('payments')}/></div>
   <NextWork rows={[...active,...departures]} onOpen={open} limit={1}/>
   <div className="suite-quick-actions" role="group" aria-label="Manage your services">{[{id:'bikes',label:'Bike rides',icon:TwoWheeler},{id:'shared',label:'Shared rides',icon:Users},{id:'cabs',label:'Cab bookings',icon:LocalTaxi},{id:'rentals',label:'Self-drive',icon:KeyRound}].map(({id,label,icon:Icon})=><button key={id} onClick={()=>setPanel(id)}><Icon size={20} aria-hidden="true"/><span>{label}</span><ArrowRight size={16} aria-hidden="true"/></button>)}</div>
   {!vehicles.length&&<Empty title="Add your first vehicle" description="Set your services, rates and vehicle documents." action="Set up fleet" onClick={()=>setPanel('fleet')}/>}
  </>}
  {panel==='shared'&&<>{!vehicles.length&&<Empty title="A vehicle comes first" description="Add an approved vehicle for shared departures." action="Open fleet" onClick={()=>setPanel('fleet')}/>}<SharedRideBookings owner managementRole="cab_owner" vehicles={vehicles} initialRecordId={recordId}/></>}
  <BikeRiderWorkspace background={panel!=='bikes'} vehicleRole="owner" onManageVehicles={()=>setPanel('fleet')}/>
  {panel==='cabs'&&<><BusinessRecords kind="rides" records={cabs} owner managementRole="cab_owner" initialRecordId={recordId} heading="Cab bookings"/></>}
  {panel==='rentals'&&<><BusinessRecords kind="rides" records={rentals} owner managementRole="cab_owner" initialRecordId={recordId} heading="Self-drive rentals"/></>}
  {panel==='fleet'&&<>{vehicles.map(v=><article className="suite-card" key={v.id}><header className="suite-vehicle-heading"><h3>{v.name}</h3><span className="business-state">{v.status==='approved'&&v.valid_until<=Date.now()/1000?'Approval expired':v.status}</span></header><p>{v.registration} · {v.seats} passenger seats · {v.vehicle_kind==='bike'?'Bike rides & shared departures':v.mode==='both'?'Cab & self-drive':v.mode==='rental'?'Self-drive':'Cab'}</p><dl className="suite-facts">{v.vehicle_kind==='bike'?<><dt>Company bike fares</dt><dd>Set by Repaido</dd><dt>Shared departure fare</dt><dd>Set per published ride</dd></>:<><dt>Cab rate</dt><dd>{v.mode==='rental'?'Not offered':money(v.per_km_paise)+'/km'}</dd><dt>Rental rate</dt><dd>{v.mode==='cab'?'Not offered':money(v.daily_paise)+'/day'}</dd></>}<dt>Availability</dt><dd>{v.active?'Listed when approved and available':'Not listed'}</dd></dl><button onClick={()=>setEditing(v)}>{v.vehicle_kind==='bike'?'Edit bike & documents':'Edit vehicle & rates'}</button><VehicleConnections vehicle={v}/></article>)}{!vehicles.length&&<Empty title="Your fleet starts here" description="Add vehicle details and documents. Vehicles are reviewed before customers can book them."/>}</>}
  {panel==='schedule'&&<CalendarPanel rows={[...records.rows.filter(r=>r.owner_id===source.uid),...departures]}>{month=><><BusinessRecords kind="rides" records={records} owner managementRole="cab_owner" dateFilter={month} heading="Scheduled cab bookings & rentals"/><SharedRideBookings owner managementRole="cab_owner" dateFilter={month}/></>}</CalendarPanel>}
  {panel==='payments'&&<><div className="suite-metrics"><Metric label="Completed fares collected" value={money(received)}/><Metric label="Owner transfers confirmed" value={money(records.rows.filter(r=>r.settlement_received_at).reduce((s,r)=>s+(r.settlement?.amount_paise||0),0))}/></div><PanelCard title="Collections & owner transfers" description="Fare collection and transfer to your account are separate. Confirm a transfer only after you receive it."/><BusinessRecords kind="rides" records={records} owner managementRole="cab_owner" initialFilter="history" heading="Booking payment records"/><SharedRideBookings owner managementRole="cab_owner"/></>}
  {panel==='more'&&<div className="suite-menu">{[{id:'payments',label:'Payments',description:'Fare collections and owner transfers',icon:Wallet},{id:'account',label:'Account',description:'Business profile and account settings',icon:UserRound}].map(({id,label,description,icon:Icon})=><button key={id} onClick={()=>setPanel(id)}><Icon size={20} aria-hidden="true"/><span><strong>{label}</strong><small>{description}</small></span><ArrowRight size={20} aria-hidden="true"/></button>)}</div>}
  {panel==='account'&&<AccountPanel partner={partner} accountControls={accountControls}/>}
  <PublicCabAvailability accountKey={source.uid}/>
  {editing&&<VehicleEditor vehicle={editing} location={partner.location} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);void onRefresh();}}/>}
 </SuiteFrame>;
}

export function DriverSuite({partner,vehicles=[],accountControls}:{partner:any;vehicles?:any[];accountControls?:ReactNode}){
 const [recordId,setRecordId]=useState(()=>new URLSearchParams(location.search).get('shared-ride')||'');
 const open=(row:any)=>{setRecordId(row.id);setPanel(row.vehicle_name?'shared':'journeys');};
 const [panel,setPanel]=useState(()=>initialMobilityPanel('driver'));const source=useBusinessRecords('rides'),shared=useSharedRecords();
 const records=only(source,r=>r.mode==='cab'&&(r.driver_id===source.uid||!r.driver_id&&r.owner_id===source.uid)),departures=shared.rows.filter(r=>r.driver_id===source.uid||!r.driver_id&&r.owner_id===source.uid),active=records.rows.filter(r=>!closed(r));
 const panels:Panel[]=[{id:'overview',label:'Today',icon:Home},{id:'journeys',label:'Cab journeys',icon:Route},{id:'bikes',label:'Bike rides',icon:TwoWheeler},{id:'shared',label:'Shared journeys',icon:Users},{id:'vehicles',label:'Vehicle assignments',icon:Car},{id:'account',label:'Account',icon:UserRound}];
 return <SuiteFrame role="driver" title="Driver suite" description="Your pickups, passengers and journeys." partner={partner} panels={panels} panel={panel} onPanel={setPanel}><ContractError error={records.error||shared.error}/>
  <SharedRideRequestAlerts rows={departures} accountKey={source.uid} onOpen={open} driver settings={panel==='account'}/>
  <BusinessCabRideWorkspace records={records} role="driver"/>
  <BikeRiderWorkspace background={panel!=='bikes'&&panel!=='overview'} home={panel==='overview'} vehicleRole="driver" onManageVehicles={()=>setPanel('vehicles')}/>
  {panel==='overview'&&<details className="suite-other-journeys"><summary><Car size={18} aria-hidden="true"/>Cab & shared work<span>{active.length+departures.filter(row=>!closed(row)).length}</span></summary>
   <div className="suite-metrics"><Metric label="Assigned cab journeys" value={active.length} onClick={()=>setPanel('journeys')}/><Metric label="Assigned shared rides" value={departures.filter(r=>!closed(r)).length} onClick={()=>setPanel('shared')}/><Metric label="Ready for pickup" value={active.filter(r=>['reserved','on_the_way'].includes(r.state)).length} onClick={()=>{const row=active.find(r=>['reserved','on_the_way'].includes(r.state));if(row)open(row);else setPanel('journeys');}}/><Metric label="Journeys in progress" value={[...active,...departures].filter(r=>r.state==='in_progress').length} onClick={()=>{const row=[...active,...departures].find(r=>r.state==='in_progress');if(row)open(row);else setPanel('journeys');}}/></div>
   <NextWork rows={[...active,...departures]} onOpen={open} limit={1}/>
   <div className="suite-menu"><button onClick={()=>setPanel('vehicles')}><Car size={20} aria-hidden="true"/><span><strong>Vehicle assignments</strong><small>Review your owner’s invitations</small></span><ArrowRight size={20} aria-hidden="true"/></button></div>
  </details>}
  {panel==='journeys'&&<><BusinessRecords kind="rides" records={records} owner managementRole="driver" initialRecordId={recordId} heading="Assigned cab journeys"/></>}
  {panel==='shared'&&<><SharedRideBookings owner managementRole="driver" vehicles={vehicles} initialRecordId={recordId}/></>}
  {panel==='vehicles'&&<DriverInvitations compact/>}
  {panel==='account'&&<AccountPanel partner={partner} accountControls={accountControls}/>}
  <PublicCabAvailability accountKey={source.uid}/>
 </SuiteFrame>;
}

export function ScrapCollectorSuite({partner,accountControls}:{partner:any;accountControls?:ReactNode}){
 const [recordId,setRecordId]=useState(()=>new URLSearchParams(location.search).get('scrap-collection')||'');
 const [panel,setPanel]=useState(()=>new URLSearchParams(location.search).get('scrap-view')==='impact'?'impact':new URLSearchParams(location.search).has('cleanup-report')?'cleanup':new URLSearchParams(location.search).has('scrap-collection')?'requests':'overview'),captain=useCaptain();const source=useBusinessRecords('scrap'),records=only(source,r=>r.customer_id!==source.uid&&(r.owner_id===source.uid||r.state==='requested'));
 const active=records.rows.filter(r=>!closed(r)),newRequests=active.filter(r=>r.state==='requested'),weighing=only(records,r=>['accepted','evaluated','agreed'].includes(r.state)),payments=only(records,r=>['agreed','payment_reported','completed','disputed'].includes(r.state));
 const paid=records.rows.filter(r=>r.state==='completed'&&r.payment_source==='customer_confirmed_receipt').reduce((s,r)=>s+(r.agreed_paise||0),0);
 const panels:Panel[]=[{id:'overview',label:'Overview',icon:Home},{id:'requests',label:'Collections',icon:Truck},{id:'weighing',label:'Inspection',icon:Scale},{id:'payments',label:'Payments',icon:Wallet},{id:'cleanup',label:'Community cleanup',icon:Recycle},{id:'impact',label:'Points & rewards',icon:Trophy},{id:'calendar',label:'Schedule',icon:CalendarDays},{id:'account',label:'Account',icon:UserRound},{id:'more',label:'More',icon:MoreHorizontal}];
 const go=(value:string)=>{setRecordId('');setPanel(value);};
 const open=(row:any)=>{setRecordId(row.id);setPanel(['agreed','payment_reported'].includes(row.state)?'payments':row.state==='requested'?'requests':'weighing');};
 return <ScrapLocationProvider rows={records.rows} uid={source.uid}><SuiteFrame role="scrap_owner" title="Scrap collection suite" description="Clear weights. Agreed prices. Confirmed receipts." partner={partner} panels={panels} panel={panel} onPanel={go}><ContractError error={records.error} onRetry={()=>void records.refresh()}/>
  {panel==='overview'&&<><div className="suite-metrics"><Metric label="New collection requests" value={newRequests.length} onClick={()=>go('requests')}/><Metric label="Inspection & approval" value={weighing.rows.length} onClick={()=>go('weighing')}/><Metric label="Receipt confirmation pending" value={active.filter(r=>r.state==='payment_reported').length} onClick={()=>go('payments')}/><Metric label="Paid to scrap sellers" value={money(paid)} onClick={()=>go('payments')}/></div>{captain.data&&<section className="scrap-partner-impact" aria-label="Your recycling contribution"><Trophy size={20} aria-hidden="true"/><div><strong>{captain.data.level.name} contributor · {captain.data.qualifying_points} points</strong><p>{captain.data.verified_contributions} verified contributions · {captain.data.points_available_today} points available today</p></div><button type="button" onClick={()=>go('impact')}>Rewards<ArrowRight size={16} aria-hidden="true"/></button></section>}<NextWork rows={active} onOpen={open} limit={1}/><div className="suite-quick-actions" role="group" aria-label="Manage collections">{[{id:'requests',label:'Collections',icon:Truck},{id:'weighing',label:'Inspection',icon:Scale},{id:'cleanup',label:'Community cleanup',icon:Recycle},{id:'impact',label:'Points & rewards',icon:Trophy},{id:'calendar',label:'Schedule',icon:CalendarDays}].map(({id,label,icon:Icon})=><button key={id} onClick={()=>go(id)}><Icon size={20} aria-hidden="true"/><span>{label}</span></button>)}</div></>}
  {panel==='cleanup'&&<CleanupWorkspace mode="collector"/>}{panel==='impact'&&<CaptainClub/>}
  {panel==='requests'&&<><BusinessRecords kind="scrap" records={records} owner managementRole="scrap_owner" initialRecordId={recordId} heading="Collection requests"/></>}
  {panel==='weighing'&&<><BusinessRecords kind="scrap" records={weighing} owner managementRole="scrap_owner" initialRecordId={recordId} heading="Inspection & weighing"/></>}
  {panel==='payments'&&<><div className="suite-metrics"><Metric label="Paid to scrap sellers" value={money(paid)}/><Metric label="Approved amount to pay" value={money(active.filter(r=>r.state==='agreed').reduce((s,r)=>s+(r.agreed_paise||0),0))}/></div><BusinessRecords kind="scrap" records={payments} owner managementRole="scrap_owner" initialRecordId={recordId} heading="Customer payments"/></>}
  {panel==='calendar'&&<CalendarPanel rows={records.rows.filter(r=>r.owner_id===source.uid)}>{month=><BusinessRecords kind="scrap" records={records} owner managementRole="scrap_owner" dateFilter={month} heading="Scheduled collections"/>}</CalendarPanel>}
  {panel==='account'&&<AccountPanel partner={partner} accountControls={accountControls}/>}
  {panel==='more'&&<div className="suite-menu">{[{id:'cleanup',label:'Community cleanup',description:'Authorised public-place collection and cleanup evidence',icon:Recycle},{id:'impact',label:'Points & rewards',description:'Your verified contribution, levels and coupons',icon:Trophy},{id:'calendar',label:'Schedule',description:'Upcoming collections and work history',icon:CalendarDays},{id:'account',label:'Account',description:'Business profile and account settings',icon:UserRound}].map(({id,label,description,icon:Icon})=><button key={id} onClick={()=>go(id)}><Icon size={20} aria-hidden="true"/><span><strong>{label}</strong><small>{description}</small></span><ArrowRight size={20} aria-hidden="true"/></button>)}</div>}
 </SuiteFrame></ScrapLocationProvider>;
}
