import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowRight,Building2,CalendarDays,Car,ClipboardList,Home,MoreHorizontal,Recycle,Route,Scale,ShieldCheck,Truck,UserRound,Users,Wallet,Wrench,type LucideIcon} from 'lucide-react';
import {BusinessCalendar,BusinessRecords,VehicleEditor,useBusinessRecords} from './LocalBusiness';
import {DriverInvitations,SharedRideBookings,useSharedRecords,VehicleConnections} from './SharedRides';
import {money} from '../services/operations';
import {ContractError} from './customContractUI';
import {Modal} from './ui';
import {SharedRideRequestAlerts} from './SharedRideRequestAlerts';
import './business-suites.css';

type BusinessRole='cab_owner'|'driver'|'scrap_owner';
type Panel={id:string;label:string;icon:LucideIcon};
type Records=ReturnType<typeof useBusinessRecords>;
const closed=(r:any)=>['completed','cancelled','expired'].includes(r.state);
const indiaDate=(t:number)=>new Date(t*1000).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
const monthNow=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}).slice(0,7);
const only=(records:Records,test:(r:any)=>boolean):Records=>({...records,rows:records.rows.filter(test)});

export function BusinessAppLauncher({currentRole,registeredRoles,onClose}:{currentRole:string;registeredRoles:string[];onClose:()=>void}){
 const apps=[{role:'technician',label:'Agent',description:'Visits, tasks and service work',icon:Wrench},{role:'contractor',label:'Contractor',description:'Projects, tenders and teams',icon:Building2},{role:'cab_owner',label:'Cab owner',description:'Fleet, shared rides and rentals',icon:Car},{role:'driver',label:'Driver',description:'Assigned vehicles and journeys',icon:Route},{role:'scrap_owner',label:'Scrap collector',description:'Collections, weighing and payments',icon:Recycle}];
 return <Modal title="Your business apps" onClose={onClose}><p className="suite-launcher-note">One mobile number, separate business profiles. Each new business is reviewed before you receive work.</p><div className="suite-launcher">{apps.map(({role,label,description,icon:Icon})=><a key={role} href={'/worker?mode='+role} aria-current={currentRole===role?'page':undefined}><Icon size={24} aria-hidden="true"/><span><strong>{label}</strong><small>{description}</small><b>{currentRole===role?'Current app':registeredRoles.includes(role)?'Open your app':'Register this business'}</b></span><ArrowRight size={18} aria-hidden="true"/></a>)}</div></Modal>;
}
function SuiteFrame({role,title,description,partner,panels,panel,onPanel,action,children}:{role:BusinessRole;title:string;description:string;partner:any;panels:Panel[];panel:string;onPanel:(p:string)=>void;action?:ReactNode;children:ReactNode}){
 const heading=useRef<HTMLHeadingElement>(null),frame=useRef<HTMLElement>(null),navigation=useRef<HTMLElement>(null),panelHeader=useRef<HTMLDivElement>(null),first=useRef(true);
 const mobility=role!=='scrap_owner',owner=role==='cab_owner',scrap=role==='scrap_owner';
 const bookingPanels=panels.filter(p=>['cabs','shared','rentals'].includes(p.id));
 const inBookings=owner&&bookingPanels.some(p=>p.id===panel),inMore=owner?['more','payments','account'].includes(panel):scrap&&['more','calendar','account'].includes(panel);
 const primary:Panel[]=owner?[
  {id:'overview',label:'Home',icon:Home},{id:'bookings',label:'Bookings',icon:ClipboardList},
  {id:'fleet',label:'Fleet',icon:Car},{id:'schedule',label:'Schedule',icon:CalendarDays},
  {id:'more',label:'More',icon:MoreHorizontal}
 ]:scrap?[
  {id:'overview',label:'Home',icon:Home},{id:'requests',label:'Collect',icon:Truck},
  {id:'weighing',label:'Inspect',icon:Scale},{id:'payments',label:'Payments',icon:Wallet},
  {id:'more',label:'More',icon:MoreHorizontal}
 ]:panels;
 const group=inBookings?'bookings':inMore?'more':panel;
 const label=panels.find(p=>p.id===panel)?.label||'Overview';
 const select=(id:string)=>onPanel(id==='bookings'?'cabs':id);
 useEffect(()=>{
  const measure=()=>{
   frame.current?.style.setProperty('--suite-nav-height',`${navigation.current?.getBoundingClientRect().height||0}px`);
   frame.current?.style.setProperty('--suite-header-height',`${panelHeader.current?.getBoundingClientRect().height||0}px`);
  };
  const observer=new ResizeObserver(measure);
  if(navigation.current)observer.observe(navigation.current);
  if(panelHeader.current)observer.observe(panelHeader.current);
  measure();return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  if(first.current){first.current=false;return;}
  if(panelHeader.current&&frame.current&&frame.current.getBoundingClientRect().top<0){const top=window.scrollY+(panelHeader.current.parentElement?.getBoundingClientRect().top||0);window.scrollTo({top:Math.max(0,top),behavior:'instant'});}
  heading.current?.focus({preventScroll:true});
 },[panel,mobility]);
 return <section ref={frame} data-panel={panel} className={'local-business-hub business-suite suite-workspace suite-'+role+(mobility?' suite-mobility':'')} aria-label={title}>
  <header className="suite-hero"><span className="suite-emblem" aria-hidden="true">{role==='cab_owner'?<Car/>:role==='driver'?<Route/>:<Recycle/>}</span><div><small>REPAIDO BUSINESS</small><h1>{title}</h1><p>{description}</p><span className="suite-business-name"><ShieldCheck size={15} aria-hidden="true"/>{partner.name} · {partner.city}</span></div></header>
  <div className="suite-layout">
    <nav ref={navigation} className="suite-navigation" aria-label={title+' navigation'}>{primary.map(({id,label,icon:Icon})=><button key={id} aria-label={scrap&&id==='requests'?'Collections':scrap&&id==='weighing'?'Inspection':role==='driver'&&id==='journeys'?'Cab rides':role==='driver'&&id==='shared'?'Shared rides':role==='driver'&&id==='vehicles'?'Vehicles':label} aria-current={group===id?'page':undefined} onClick={()=>select(id)}><Icon size={21} aria-hidden="true"/><span>{role==='driver'&&id==='journeys'?'Cab rides':role==='driver'&&id==='shared'?'Shared rides':role==='driver'&&id==='vehicles'?'Vehicles':label}</span></button>)}</nav>
   <div className="suite-content">
    <div ref={panelHeader} className="suite-panel-header">
     <nav className="suite-breadcrumb" aria-label="Breadcrumb"><button onClick={()=>onPanel('overview')}>{title}</button>{inBookings&&<><span aria-hidden="true">/</span><button onClick={()=>onPanel('cabs')}>Bookings</button></>}{inMore&&panel!=='more'&&<><span aria-hidden="true">/</span><button onClick={()=>onPanel('more')}>More</button></>}<span aria-hidden="true">/</span><span aria-current="page">{label}</span></nav>
     <div className="suite-title-row"><h2 ref={heading} tabIndex={-1} className="suite-panel-title">{label}</h2>{action}</div>
     {inBookings&&<nav className="suite-booking-navigation" aria-label="Booking types">{bookingPanels.map(p=><button key={p.id} aria-current={panel===p.id?'page':undefined} onClick={()=>onPanel(p.id)}>{p.label}</button>)}</nav>}
    </div>
    {children}
   </div>
  </div>
 </section>;
}
function Metric({label,value,onClick}:{label:string;value:ReactNode;onClick?:()=>void}){return onClick?<button className="suite-metric" onClick={onClick}><span>{label}</span><strong>{value}</strong><ArrowRight size={16} aria-hidden="true"/></button>:<div className="suite-metric"><span>{label}</span><strong>{value}</strong></div>;}
function PanelCard({title,description,children}:{title:string;description?:string;children?:ReactNode}){return <section className="suite-card"><h3>{title}</h3>{description&&<p>{description}</p>}{children}</section>;}
function Empty({title,description,action,onClick}:{title:string;description:string;action?:string;onClick?:()=>void}){return <div className="suite-empty"><ClipboardList size={24} aria-hidden="true"/><h3>{title}</h3><p>{description}</p>{action&&<button onClick={onClick}>{action}<ArrowRight size={16} aria-hidden="true"/></button>}</div>;}
function NextWork({rows,onOpen,limit=3}:{rows:any[];onOpen:(row:any)=>void;limit?:number}){const next=rows.filter(r=>!closed(r)&&r.state!=='requested').sort((a,b)=>Number(b.state==='in_progress')-Number(a.state==='in_progress')||a.starts_at-b.starts_at).slice(0,limit);return <PanelCard title="Next on your schedule">{next.length?next.map(row=><button key={row.id} className="suite-next-work" onClick={()=>onOpen(row)}><CalendarDays size={19} aria-hidden="true"/><span><strong>{row.material?row.material+' collection':row.vehicle_name||row.quote?.vehicle?.name||'Vehicle booking'}</strong><small>{indiaDate(row.starts_at)} · {row.state.replaceAll('_',' ')}</small></span><ArrowRight size={17} aria-hidden="true"/></button>):<p>Your accepted work will appear here.</p>}</PanelCard>;}
function AccountPanel({partner,accountControls}:{partner:any;accountControls?:ReactNode}){return <><PanelCard title="Business profile"><dl className="suite-facts"><dt>Business name</dt><dd>{partner.name}</dd><dt>Business base</dt><dd>{partner.address}</dd><dt>Service city</dt><dd>{partner.city}</dd><dt>Document approval</dt><dd>Valid until {indiaDate(partner.valid_until)}</dd></dl><p>Contact support to update approved business details. Other business profiles keep their own review status.</p></PanelCard><PanelCard title="Your account">{accountControls}</PanelCard></>;}
function CalendarPanel({rows,children}:{rows:any[];children?:(month:string)=>ReactNode}){const [month,setMonth]=useState(monthNow);return <><label className="business-month">Schedule · India time<input aria-label="Schedule month" type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><BusinessCalendar month={month} rows={rows}/>{children?.(month)}</>;}

export function CabOwnerSuite({partner,vehicles,onRefresh,accountControls}:{partner:any;vehicles:any[];onRefresh:()=>Promise<unknown>;accountControls?:ReactNode}){
 const [recordId,setRecordId]=useState('');
 const [panel,setPanel]=useState('overview'),[editing,setEditing]=useState<any>(null);const source=useBusinessRecords('rides'),shared=useSharedRecords();
 const records=only(source,r=>r.customer_id!==source.uid&&(r.owner_id===source.uid||r.state==='requested'));
 const cabs=only(records,r=>r.mode==='cab'),rentals=only(records,r=>r.mode==='rental');
 const departures=shared.rows.filter(r=>r.owner_id===source.uid),active=records.rows.filter(r=>!closed(r)),pending=active.filter(r=>r.state==='requested');
 const received=records.rows.filter(r=>r.state==='completed'&&!r.financial_hold).reduce((sum,r)=>sum+(r.advance_paid_paise||0)+(r.balance_paid_paise||0),0);
 const panels:Panel[]=[{id:'overview',label:'Overview',icon:Home},{id:'shared',label:'Shared rides',icon:Users},{id:'cabs',label:'Cab bookings',icon:Car},{id:'rentals',label:'Self-drive',icon:CalendarDays},{id:'fleet',label:'Fleet & rates',icon:Truck},{id:'schedule',label:'Schedule',icon:CalendarDays},{id:'payments',label:'Payments',icon:Wallet},{id:'account',label:'Account',icon:UserRound},{id:'more',label:'More',icon:MoreHorizontal}];
 const open=(r:any)=>{setRecordId(r.id);setPanel(r.vehicle_name?'shared':r.mode==='rental'?'rentals':'cabs');};
 return <SuiteFrame role="cab_owner" title="Cab owner suite" description="Your fleet. Your routes. Your business." partner={partner} panels={panels} panel={panel} onPanel={setPanel} action={panel==='fleet'?<button className="ops-primary" onClick={()=>setEditing({id:crypto.randomUUID(),version:0})}>Add vehicle</button>:undefined}><ContractError error={records.error||shared.error} onRetry={()=>{void records.refresh();void shared.refresh();}}/>
  <SharedRideRequestAlerts rows={departures} accountKey={source.uid} onOpen={open}/>
  {panel==='overview'&&<>
   <div className="suite-metrics"><Metric label="New booking requests" value={pending.length} onClick={()=>{setRecordId(pending[0]?.id||'');setPanel(pending[0]?.mode==='rental'?'rentals':'cabs');}}/><Metric label="Active vehicles" value={vehicles.filter(v=>v.active&&v.status==='approved'&&v.valid_until>Date.now()/1000).length} onClick={()=>setPanel('fleet')}/><Metric label="Shared departures" value={departures.filter(r=>!closed(r)).length} onClick={()=>setPanel('shared')}/><Metric label="Completed fares collected" value={money(received)} onClick={()=>setPanel('payments')}/></div>
   <NextWork rows={[...active,...departures]} onOpen={open} limit={1}/>
   <div className="suite-quick-actions" role="group" aria-label="Manage your services">{[{id:'shared',label:'Shared rides',icon:Users},{id:'cabs',label:'Cab bookings',icon:Car},{id:'rentals',label:'Self-drive',icon:CalendarDays}].map(({id,label,icon:Icon})=><button key={id} onClick={()=>setPanel(id)}><Icon size={19} aria-hidden="true"/><span>{label}</span><ArrowRight size={16} aria-hidden="true"/></button>)}</div>
   {!vehicles.length&&<Empty title="Add your first vehicle" description="Set your services, rates and vehicle documents." action="Set up fleet" onClick={()=>setPanel('fleet')}/>}
  </>}
  {panel==='shared'&&<>{!vehicles.length&&<Empty title="A vehicle comes first" description="Add an approved vehicle for shared departures." action="Open fleet" onClick={()=>setPanel('fleet')}/>}<SharedRideBookings owner managementRole="cab_owner" vehicles={vehicles} initialRecordId={recordId}/></>}
  {panel==='cabs'&&<><p className="suite-intro">₹500 is credited toward the fare. Payment must be verified before departure.</p><BusinessRecords kind="rides" records={cabs} owner managementRole="cab_owner" initialRecordId={recordId} heading="Cab bookings"/></>}
  {panel==='rentals'&&<><p className="suite-intro">Check the licence, record handover and confirm the return. Open the booking for vehicle location.</p><BusinessRecords kind="rides" records={rentals} owner managementRole="cab_owner" initialRecordId={recordId} heading="Self-drive rentals"/></>}
  {panel==='fleet'&&<><p className="suite-intro">Manage your vehicles, drivers and rates for cab trips and self-drive rentals.</p>{vehicles.map(v=><article className="suite-card" key={v.id}><header className="suite-vehicle-heading"><h3>{v.name}</h3><span className="business-state">{v.status==='approved'&&v.valid_until<=Date.now()/1000?'Approval expired':v.status}</span></header><p>{v.registration} · {v.seats} passenger seats · {v.mode==='both'?'Cab & self-drive':v.mode==='rental'?'Self-drive':'Cab'}</p><dl className="suite-facts"><dt>Cab rate</dt><dd>{v.mode==='rental'?'Not offered':money(v.per_km_paise)+'/km'}</dd><dt>Rental rate</dt><dd>{v.mode==='cab'?'Not offered':money(v.daily_paise)+'/day'}</dd><dt>Availability</dt><dd>{v.active?'Listed when approved and available':'Not listed'}</dd></dl><button onClick={()=>setEditing(v)}>Edit vehicle & rates</button><VehicleConnections vehicle={v}/></article>)}{!vehicles.length&&<Empty title="Your fleet starts here" description="Add vehicle details and documents. Vehicles are reviewed before customers can book them."/>}</>}
  {panel==='schedule'&&<CalendarPanel rows={[...records.rows.filter(r=>r.owner_id===source.uid),...departures]}>{month=><><BusinessRecords kind="rides" records={records} owner managementRole="cab_owner" dateFilter={month} heading="Scheduled cab bookings & rentals"/><SharedRideBookings owner managementRole="cab_owner" dateFilter={month}/></>}</CalendarPanel>}
  {panel==='payments'&&<><div className="suite-metrics"><Metric label="Completed fares collected" value={money(received)}/><Metric label="Owner transfers confirmed" value={money(records.rows.filter(r=>r.settlement_received_at).reduce((s,r)=>s+(r.settlement?.amount_paise||0),0))}/></div><PanelCard title="Collections & owner transfers" description="Fare collection and transfer to your account are separate. Confirm a transfer only after you receive it."/><BusinessRecords kind="rides" records={records} owner managementRole="cab_owner" initialFilter="history" heading="Booking payment records"/><SharedRideBookings owner managementRole="cab_owner"/></>}
  {panel==='more'&&<div className="suite-menu">{[{id:'payments',label:'Payments',description:'Fare collections and owner transfers',icon:Wallet},{id:'account',label:'Account',description:'Business profile and account settings',icon:UserRound}].map(({id,label,description,icon:Icon})=><button key={id} onClick={()=>setPanel(id)}><Icon size={22} aria-hidden="true"/><span><strong>{label}</strong><small>{description}</small></span><ArrowRight size={18} aria-hidden="true"/></button>)}</div>}
  {panel==='account'&&<AccountPanel partner={partner} accountControls={accountControls}/>}
  {editing&&<VehicleEditor vehicle={editing} location={partner.location} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);void onRefresh();}}/>}
 </SuiteFrame>;
}

export function DriverSuite({partner,accountControls}:{partner:any;accountControls?:ReactNode}){
 const [recordId,setRecordId]=useState('');
 const open=(row:any)=>{setRecordId(row.id);setPanel(row.vehicle_name?'shared':'journeys');};
 const [panel,setPanel]=useState('overview');const source=useBusinessRecords('rides'),shared=useSharedRecords();
 const records=only(source,r=>r.mode==='cab'&&(r.driver_id===source.uid||!r.driver_id&&r.owner_id===source.uid)),departures=shared.rows.filter(r=>r.driver_id===source.uid||!r.driver_id&&r.owner_id===source.uid),active=records.rows.filter(r=>!closed(r));
 const panels:Panel[]=[{id:'overview',label:'Today',icon:Home},{id:'journeys',label:'Cab journeys',icon:Route},{id:'shared',label:'Shared journeys',icon:Users},{id:'vehicles',label:'My vehicles',icon:Car},{id:'account',label:'Account',icon:UserRound}];
 return <SuiteFrame role="driver" title="Driver suite" description="Your pickups, passengers and journeys." partner={partner} panels={panels} panel={panel} onPanel={setPanel}><ContractError error={records.error||shared.error}/>
  <SharedRideRequestAlerts rows={departures} accountKey={source.uid} onOpen={open} driver/>
  {panel==='overview'&&<>
   <div className="suite-metrics"><Metric label="Assigned cab journeys" value={active.length} onClick={()=>setPanel('journeys')}/><Metric label="Assigned shared rides" value={departures.filter(r=>!closed(r)).length} onClick={()=>setPanel('shared')}/><Metric label="Ready for pickup" value={active.filter(r=>['reserved','on_the_way'].includes(r.state)).length} onClick={()=>{const row=active.find(r=>['reserved','on_the_way'].includes(r.state));if(row)open(row);else setPanel('journeys');}}/><Metric label="Journeys in progress" value={[...active,...departures].filter(r=>r.state==='in_progress').length} onClick={()=>{const row=[...active,...departures].find(r=>r.state==='in_progress');if(row)open(row);else setPanel('journeys');}}/></div>
   <NextWork rows={[...active,...departures]} onOpen={open} limit={1}/>
   <div className="suite-menu"><button onClick={()=>setPanel('vehicles')}><Car size={22} aria-hidden="true"/><span><strong>Vehicle assignments</strong><small>Review your owner’s invitations</small></span><ArrowRight size={18} aria-hidden="true"/></button></div>
  </>}
  {panel==='journeys'&&<><p className="suite-intro">Confirm pickup, record the odometer and keep the journey status current.</p><BusinessRecords kind="rides" records={records} owner managementRole="driver" initialRecordId={recordId} heading="Assigned cab journeys"/></>}
  {panel==='shared'&&<><p className="suite-intro">Check agreed pickup pins, mark passengers boarded and keep the journey status current.</p><SharedRideBookings owner managementRole="driver" initialRecordId={recordId}/></>}
  {panel==='vehicles'&&<DriverInvitations/>}
  {panel==='account'&&<AccountPanel partner={partner} accountControls={accountControls}/>}
 </SuiteFrame>;
}

export function ScrapCollectorSuite({partner,accountControls}:{partner:any;accountControls?:ReactNode}){
 const [recordId,setRecordId]=useState('');
 const [panel,setPanel]=useState('overview');const source=useBusinessRecords('scrap'),records=only(source,r=>r.customer_id!==source.uid&&(r.owner_id===source.uid||r.state==='requested'));
 const active=records.rows.filter(r=>!closed(r)),newRequests=active.filter(r=>r.state==='requested'),weighing=only(records,r=>['accepted','evaluated','agreed'].includes(r.state)),payments=only(records,r=>['agreed','payment_reported','completed','disputed'].includes(r.state));
 const paid=records.rows.filter(r=>r.state==='completed'&&r.payment_source==='customer_confirmed_receipt').reduce((s,r)=>s+(r.agreed_paise||0),0);
 const panels:Panel[]=[{id:'overview',label:'Overview',icon:Home},{id:'requests',label:'Collections',icon:Truck},{id:'weighing',label:'Inspection',icon:Scale},{id:'payments',label:'Payments',icon:Wallet},{id:'calendar',label:'Schedule',icon:CalendarDays},{id:'account',label:'Account',icon:UserRound},{id:'more',label:'More',icon:MoreHorizontal}];
 const open=(row:any)=>{setRecordId(row.id);setPanel(['agreed','payment_reported'].includes(row.state)?'payments':row.state==='requested'?'requests':'weighing');};
 return <SuiteFrame role="scrap_owner" title="Scrap collection suite" description="Clear weights. Agreed prices. Confirmed receipts." partner={partner} panels={panels} panel={panel} onPanel={setPanel}><ContractError error={records.error} onRetry={()=>void records.refresh()}/>
  {panel==='overview'&&<><div className="suite-metrics"><Metric label="New collection requests" value={newRequests.length} onClick={()=>setPanel('requests')}/><Metric label="Inspection & approval" value={weighing.rows.length} onClick={()=>setPanel('weighing')}/><Metric label="Receipt confirmation pending" value={active.filter(r=>r.state==='payment_reported').length} onClick={()=>setPanel('payments')}/><Metric label="Customer-confirmed payments" value={money(paid)} onClick={()=>setPanel('payments')}/></div><NextWork rows={active} onOpen={open} limit={1}/><div className="suite-quick-actions" role="group" aria-label="Manage collections">{[{id:'requests',label:'Collections',icon:Truck},{id:'weighing',label:'Inspection',icon:Scale},{id:'calendar',label:'Schedule',icon:CalendarDays}].map(({id,label,icon:Icon})=><button key={id} onClick={()=>setPanel(id)}><Icon size={19} aria-hidden="true"/><span>{label}</span></button>)}</div><p className="suite-intro">Collection area: within 8 km of your business base in {partner.city}.</p></>}
  {panel==='requests'&&<><p className="suite-intro">Review the material and pickup time. The customer’s exact address is shared after you accept.</p><BusinessRecords kind="scrap" records={records} owner managementRole="scrap_owner" initialRecordId={recordId} heading="Collection requests"/></>}
  {panel==='weighing'&&<><p className="suite-intro">Record the grade, weights and price per kilogram. The customer reviews your quote before you collect and pay.</p><BusinessRecords kind="scrap" records={weighing} owner managementRole="scrap_owner" initialRecordId={recordId} heading="Inspection & weighing"/></>}
  {panel==='payments'&&<><div className="suite-metrics"><Metric label="Customer-confirmed payments" value={money(paid)}/><Metric label="Approved amount to pay" value={money(active.filter(r=>r.state==='agreed').reduce((s,r)=>s+(r.agreed_paise||0),0))}/></div><p className="suite-intro">Record the actual payment reference after paying. The customer confirms receipt. A recorded reference alone does not confirm payment.</p><BusinessRecords kind="scrap" records={payments} owner managementRole="scrap_owner" initialRecordId={recordId} heading="Customer payments"/></>}
  {panel==='calendar'&&<CalendarPanel rows={records.rows.filter(r=>r.owner_id===source.uid)}>{month=><BusinessRecords kind="scrap" records={records} owner managementRole="scrap_owner" dateFilter={month} heading="Scheduled collections"/>}</CalendarPanel>}
  {panel==='account'&&<AccountPanel partner={partner} accountControls={accountControls}/>}
  {panel==='more'&&<div className="suite-menu">{[{id:'calendar',label:'Schedule',description:'Upcoming collections and work history',icon:CalendarDays},{id:'account',label:'Account',description:'Business profile and account settings',icon:UserRound}].map(({id,label,description,icon:Icon})=><button key={id} onClick={()=>setPanel(id)}><Icon size={22} aria-hidden="true"/><span><strong>{label}</strong><small>{description}</small></span><ArrowRight size={18} aria-hidden="true"/></button>)}</div>}
 </SuiteFrame>;
}
