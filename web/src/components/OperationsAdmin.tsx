import {AdminTable, AdminStatus} from './AdminTable';
import {RetailShopResolutions,RetailResolutionAdmin} from './RetailResolutions';
import {CommunityMissionsAdmin} from './CommunityMissions';
import ShopTools from './ShopTools';
import {Homes} from './Homes';
import {LocalBusinessAdmin} from './LocalBusiness';
import {ShopPrime} from './ShopPrime';
import {ShopAccessPanel,ShopPresence} from './ShopAccessPanel';
import {NetworkModeration} from './NetworkModeration';
import {PartnerAdmin} from './PartnerProgram';
import {HomePlanAdmin} from './HomePlanAdmin';
import {CampaignAdmin} from './CampaignAdmin';
import {HiringAdmin} from './Hiring';
import {MarketplaceAdmin} from './Marketplace';
import {ServiceTermsAdmin} from './ServiceTerms';
import {OnboardingOverview} from './OnboardingOverview';
import {LocalLeaderboard} from './LocalLeaderboard';
import {auth} from '../firebase';
import {ShopRentals,RentalManager} from './Rentals';
import {ShopInventory,ShopPurchaseOrders,ShopPayables,ProcurementReview} from './Procurement';
import {VisitEvidence} from './VisitEvidence';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {LayoutDashboard,Users,Store,ClipboardList,Wallet,ShieldCheck,LogOut,ArrowLeft,Menu,X,ChevronRight,Search,Inventory2,Package,Warehouse,KeyRound,Handyman,BadgePercent,Crown,Truck,House,Forum,Payments,SupportAgent,FactCheck,ShoppingCart,Handshake,Trophy,FileText,Settings,History} from '../icons';
import {operation,money,type Job,type LiveWorker} from '../services/operations';
import {useOperationResource} from '../hooks/useOperationResource';
import {logoutUser} from '../services/repaidoService';
import RepaidoBrand from './RepaidoBrand';
import PortalAccess from './PortalAccess';
import {ShopRegistration,ShopReviewQueue} from './ShopRegistration';
import './operations.css';
import './workspace-navigation.css';
import './company-crm.css';
import {SupportCenter,AdminRecovery,RefundReview,EvidenceReview} from './Lifecycle';
import {FinanceReview} from './PrivateReview';
import {ShopB2BSection} from './ShopB2BSection';

export default function OperationsAdmin({onBack,shop=false}:{onBack:()=>void;shop?:boolean}){
 return <PortalAccess shop={shop}><Workspace shop={shop} onBack={onBack}/></PortalAccess>;
}
function Workspace({onBack,shop}:{onBack:()=>void;shop:boolean}){
 const [tab,setTab]=useState(shop?'Inventory':'Overview'),[error,setError]=useState('');
 const [navigationOpen,setNavigationOpen]=useState(false),[signingOut,setSigningOut]=useState(false),[workspaceQuery,setWorkspaceQuery]=useState('');
 const search=useRef<HTMLInputElement>(null);
 useEffect(()=>{const shortcut=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setNavigationOpen(true);search.current?.focus();}};document.addEventListener('keydown',shortcut);return()=>document.removeEventListener('keydown',shortcut);},[]);
 const content=useRef<HTMLElement>(null),initial=useRef(true);
 const changeTab=(value:string)=>{setTab(value);setNavigationOpen(false);setWorkspaceQuery('');};
 useEffect(()=>{
  if(initial.current){initial.current=false;return;}
  window.scrollTo({top:0,behavior:'instant'});content.current?.querySelector<HTMLElement>('h1')?.focus({preventScroll:true});
 },[tab]);
 const links=shop?[{name:'Inventory',Icon:Inventory2},{name:'Orders',Icon:Package},{name:'B2B Wholesale',Icon:Warehouse},{name:'Rentals',Icon:KeyRound},{name:'Earnings',Icon:Wallet},{name:'Business tools',Icon:Handyman},{name:'Visibility & offers',Icon:BadgePercent},{name:'Shop Prime',Icon:Crown}]:[{name:'Overview',Icon:LayoutDashboard},{name:'Bookings',Icon:ClipboardList},{name:'Workers',Icon:Users},{name:'Shops',Icon:Store},{name:'Transport & scrap',Icon:Truck},{name:'Home plans',Icon:House},{name:'Community',Icon:Forum},{name:'Finance',Icon:Payments},{name:'Support',Icon:SupportAgent},{name:'Moderation',Icon:FactCheck},{name:'Procurement',Icon:ShoppingCart},{name:'Rentals',Icon:KeyRound},{name:'Partner programme',Icon:Handshake},{name:'Rankings',Icon:Trophy},{name:'Service terms',Icon:FileText},{name:'Global Control',Icon:Settings},{name:'Activity',Icon:History}];
 const groups = shop ? [{name:'Shop operations',names:links.map(link=>link.name)}] : [
  {name:'Monitor',names:['Overview','Activity']},
  {name:'Deliver services',names:['Bookings','Home plans','Transport & scrap','Rentals']},
  {name:'Partners & supply',names:['Workers','Shops','Procurement','Partner programme']},
  {name:'Trust & money',names:['Support','Moderation','Finance']},
  {name:'Growth & policy',names:['Community','Rankings','Global Control','Service terms']},
 ];
 return <div className={"operations portal-shell"+(!shop?" portal-company crm-workspace":"")}>
  {shop&&<ShopPresence/>}<a href="#portal-content" className="portal-skip">Skip to workspace</a>
  <aside className="portal-sidebar" data-menu-open={navigationOpen}>
   <div className="portal-sidebar-heading"><RepaidoBrand size="md"/><button className="portal-menu-toggle" aria-label="Workspace menu" aria-expanded={navigationOpen} aria-controls="portal-navigation" onClick={()=>setNavigationOpen(value=>!value)}>{navigationOpen?<X size={20} aria-hidden="true"/>:<Menu size={20} aria-hidden="true"/>}<span>{navigationOpen?'Close':tab}</span></button></div>
   <p className="ops-eyebrow">{shop?'Shop partner':'Company workspace'}</p>
   <nav id="portal-navigation" aria-label={shop?'Shop workspace':'Company workspace'}>
    {workspaceQuery&&!links.some(item=>item.name.toLowerCase().includes(workspaceQuery.toLowerCase()))&&<p role="status" className="crm-no-workspace">No workspace matches.</p>}
    {groups.map(group=>{const visible=links.filter(item=>group.names.includes(item.name)&&item.name.toLowerCase().includes(workspaceQuery.toLowerCase()));return visible.length?<div className="crm-nav-group" key={group.name}>{!shop&&<span className="crm-nav-label">{group.name}</span>}{visible.map(({name,Icon})=><button key={name} aria-current={tab===name?'page':undefined} onClick={()=>changeTab(name)}><Icon size={20} aria-hidden="true"/>{name}</button>)}</div>:null;})}
   </nav>
   <div className="portal-sidebar-bottom"><p>{shop?'Manage your shop, orders and stock.':'Access follows your company role.'}</p><button onClick={onBack}><ArrowLeft size={18} aria-hidden="true"/>Customer app</button><button disabled={signingOut} aria-busy={signingOut} onClick={async()=>{setSigningOut(true);setError('');try{await logoutUser();}catch(e){setError((e as Error).message);}finally{setSigningOut(false);}}}><LogOut size={18} aria-hidden="true"/>{signingOut?'Signing out…':'Sign out'}</button></div>
  </aside>
  <div className="portal-body"><header className="portal-topbar">
   {!shop&&<div className="crm-workspace-search"><Search size={18} aria-hidden="true"/><input ref={search} type="search" aria-label="Find a company workspace" placeholder="Find a workspace…" value={workspaceQuery} onChange={event=>{setWorkspaceQuery(event.target.value);setNavigationOpen(true);}} onKeyDown={event=>{if(event.key==='Escape'){setWorkspaceQuery('');setNavigationOpen(false);}}}/><kbd>Ctrl K</kbd></div>}
   <span className="crm-account-summary">{shop?'Partner workspace':'Company operations'}{!shop&&auth.currentUser?.email&&<small>{auth.currentUser.email}</small>}</span><span className="ops-badge"><ShieldCheck size={16} aria-hidden="true"/>Restricted access</span>
  </header><main ref={content} id="portal-content" tabIndex={-1}>
   <nav className="portal-breadcrumb" aria-label="Workspace breadcrumb"><button onClick={()=>changeTab(shop?'Inventory':'Overview')}>{shop?'Shop':'Company'}</button><ChevronRight size={16} aria-hidden="true"/><span aria-current="page">{tab}</span></nav>
   {error&&<p role="alert" className="ops-error">{error}</p>}
   {shop?<ShopRegistration>{s=><AdminContent shop shopId={s.id} title={s.name} tab={tab} onTab={changeTab}/>}</ShopRegistration>:<AdminContent shop={false} tab={tab} onTab={changeTab}/>}
  </main></div>
 </div>;
}
function AdminContent({shop,shopId,tab,onTab,title}:{shop:boolean;shopId?:string;tab:string;onTab:(t:string)=>void;title?:string}){
 let content:ReactNode=null;
 if(shop)content=tab==='Business tools'?<ShopTools/>:tab==='Visibility & offers'?<ShopAccessPanel/>:tab==='Rentals'?<ShopRentals/>:tab==='Shop Prime'?<ShopPrime/>:tab==='Inventory'?<ShopInventory/>:tab==='B2B Wholesale'?<ShopB2BSection shopId={shopId||''} shopName={title||'Partner Hub'}/>:tab==='Earnings'?<ShopPayables/>:<><RetailShopResolutions/><ShopPurchaseOrders/></>;
 else {
  if(tab==='Overview')content=<CompanyOverview onTab={onTab}/>;
  if(tab==='Partner programme')content=<PartnerAdmin/>;
  if(tab==='Home plans')content=<HomePlanAdmin/>;
  if(tab==='Global Control')content=<CampaignAdmin/>;
  if(tab==='Service terms')content=<ServiceTermsAdmin/>;
  if(tab==='Community')content=<><CommunityMissionsAdmin/><MarketplaceAdmin/></>;
  if(tab==='Rentals')content=<><Homes admin/><RentalManager admin/></>;
  if(tab==='Procurement')content=<ProcurementReview/>;
  if(tab==='Shops')content=<ShopReviewQueue/>;
  if(tab==='Workers')content=<OnboardingOverview/>;
  if(tab==='Rankings')content=<LocalLeaderboard/>;
  if(tab==='Activity')content=<AuditHistory/>;
  if(tab==='Bookings')content=<CompanyBookings/>;
  if(tab==='Transport & scrap')content=<LocalBusinessAdmin/>;
  if(tab==='Finance')content=<><FinanceReview/><RefundReview/><details className="crm-policy-panel"><summary>Day-hire policy & activation</summary><HiringAdmin/></details></>;
  if(tab==='Support')content=<><RetailResolutionAdmin/><SupportCenter admin/></>;
  if(tab==='Moderation')content=<><NetworkModeration/><EvidenceReview/></>;
 }
 const descriptions:Record<string,string>={'Overview':'Your operations at a glance.','Bookings':'Review service visits and customer requests.','Workers':'Review applications and professional records.','Shops':'Review shop applications and approvals.','Transport & scrap':'Review business profiles, vehicles and service records.','Home plans':'Manage plans, scheduled visits and attendance.','Community':'Review listings and community activity.','Finance':'Review collections, refunds and payouts.','Support':'Help customers and professionals resolve requests.','Moderation':'Review reported content and evidence.','Procurement':'Review parts purchases and supplier records.','Rentals':'Follow handovers, returns and rental records.','Partner programme':'Manage partner applications and agreements.','Rankings':'Review verified work and service ratings.','Service terms':'Manage the terms customers see before booking.','Global Control':'Manage campaigns and delivery limits.','Activity':'Review recorded company actions.'};
 return <><div className="ops-heading portal-page-heading"><div><span className="ops-eyebrow">{shop?'Approved shop':'Repaido operations'}</span><h1 tabIndex={-1}>{title||tab}</h1><p>{shop?'Manage your stock, orders and collections.':descriptions[tab]}</p></div></div>{content}</>;
}

function CompanyOverview({onTab}:{onTab:(tab:string)=>void}){
 const workers=useOperationResource<{workers:LiveWorker[]}>('/admin/workers',60000),jobs=useOperationResource<{jobs:Job[]}>('/admin/jobs',60000);
 const refresh=async()=>{await Promise.all([workers.refresh(),jobs.refresh()]);};
 const openJobs=jobs.data?.jobs.filter(job=>!['completed','cancelled'].includes(job.state));
 const stages=Object.entries((openJobs||[]).reduce<Record<string,number>>((counts,job)=>{counts[job.state]=(counts[job.state]||0)+1;return counts;},{})).sort((a,b)=>b[1]-a[1]);
 return <>
  <div className="crm-section-heading"><div><h2>Operations pulse</h2><p>Counts reflect loaded service visits and professional records.</p></div><button disabled={workers.busy||jobs.busy} onClick={()=>void refresh()}>{workers.busy||jobs.busy?'Refreshing overview…':'Refresh overview'}</button></div>
  <div className="portal-metrics">
   <button onClick={()=>onTab('Workers')}><span><Users size={18} aria-hidden="true"/>Workers</span><strong>{workers.data?workers.data.workers.length:workers.busy?'Loading…':'Unavailable'}</strong><span>Registered professionals</span></button>
   <button onClick={()=>onTab('Bookings')}><span><ClipboardList size={18} aria-hidden="true"/>Bookings</span><strong>{openJobs?openJobs.length:jobs.busy?'Loading…':'Unavailable'}</strong><span>Open service tasks</span></button>
   <button onClick={()=>onTab('Shops')}><span><Store size={18} aria-hidden="true"/>Shops</span><strong>Review</strong><span>Applications and verification</span></button>
  </div>
  <AdminResourceStatus name="workers" resource={workers}/><AdminResourceStatus name="bookings" resource={jobs}/>
  <div className="crm-dashboard-grid">
   <section className="crm-dashboard-panel"><div className="crm-section-heading"><h2>Visit pipeline</h2><button onClick={()=>onTab('Bookings')}>Open bookings<ChevronRight size={18} aria-hidden="true"/></button></div>{jobs.data?<>{stages.length?<ul className="crm-pipeline">{stages.map(([state,count])=><li key={state}><span>{state.replaceAll('_',' ')}</span><strong>{count}</strong><span className="crm-pipeline-track" aria-hidden="true"><span style={{width:`${count/(openJobs?.length||1)*100}%`}}/></span></li>)}</ul>:<p>No open service tasks in loaded records.</p>}<p className="crm-scope-note">Completed and cancelled visits are excluded. Other service types have their own queues.</p></>:<p>{jobs.busy?'Loading visit pipeline…':'Visit pipeline unavailable. Retry bookings above.'}</p>}</section>
   <section className="crm-dashboard-panel"><h2>Work queues</h2><div className="crm-queue-links">{[{name:'Workers',label:'Agent onboarding',note:'Identity, documents & service scope',Icon:Users},{name:'Support',label:'Customer support',note:'Queries, returns & escalations',Icon:SupportAgent},{name:'Finance',label:'Settlement & refund review',note:'Verified collections and provider outcomes',Icon:Payments},{name:'Moderation',label:'Trust & evidence',note:'Reports, corrections & review decisions',Icon:FactCheck}].map(({name,label,note,Icon})=><button key={name} onClick={()=>onTab(name)}><Icon size={20} aria-hidden="true"/><span><strong>{label}</strong><small>{note}</small></span><ChevronRight size={18} aria-hidden="true"/></button>)}</div></section>
  </div>
  <section className="crm-dashboard-panel"><h2>Business workspaces</h2><div className="crm-workflow-links">{[{tab:'Home plans',text:'Recurring visits & care'},{tab:'Transport & scrap',text:'Mobility, collections & settlements'},{tab:'Rentals',text:'Equipment returns & house listings'},{tab:'Procurement',text:'Parts pickup & shop payables'},{tab:'Community',text:'Listings, messages & missions'},{tab:'Global Control',text:'Campaign budgets & delivery'}].map(item=><button key={item.tab} onClick={()=>onTab(item.tab)}><strong>{item.tab}</strong><span>{item.text}</span><ChevronRight size={18} aria-hidden="true"/></button>)}</div></section>
 </>;
}
function AdminResourceStatus({name,resource}:{name:string;resource:{data:unknown;error:string;busy:boolean;refresh:()=>Promise<void>}}){
 if(resource.error)return <div className="ops-notice" role="alert"><strong>Could not load {name}.</strong><p>{resource.error}</p>{resource.data!=null&&<p>Showing the last loaded records.</p>}<button disabled={resource.busy} onClick={()=>void resource.refresh()}>{resource.busy?'Retrying…':'Retry '+name}</button></div>;
 return resource.data==null&&resource.busy?<p role="status">Loading {name}…</p>:null;
}
function CompanyBookings(){
 const resource=useOperationResource<{jobs:Job[]}>('/admin/jobs',60000),jobs=resource.data?.jobs||[];
 const [state,setState]=useState('open');
 const filtered=jobs.filter(job=>state==='all'||(state==='open'?!['completed','cancelled'].includes(job.state):job.state===state));
 return <><button disabled={resource.busy} onClick={()=>void resource.refresh()}>{resource.busy?'Refreshing bookings…':'Refresh bookings'}</button><AdminResourceStatus name="bookings" resource={resource}/>{resource.data&&<AdminTable label="Service bookings" rows={filtered} rowKey={j=>j.id} rowLabel={j=>j.service_name+' '+j.id.slice(0,8)} searchText={j=>j.id} empty="No bookings match this view." toolbar={<label>Status<select value={state} onChange={e=>setState(e.target.value)}><option value="open">Open visits</option><option value="all">All visits</option>{Array.from(new Set(jobs.map(j=>j.state))).sort().map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label>} columns={[
  {key:'service',label:'Service / reference',value:j=>j.service_name,render:j=><><h3>{j.service_name}</h3><small>#{j.id.slice(0,8)}</small></>},
  {key:'state',label:'Stage',value:j=>j.state,render:j=><AdminStatus value={j.state}/>},
  {key:'worker',label:'Professional / city',value:j=>j.worker_name||'Awaiting assignment',render:j=><>{j.worker_name||'Awaiting assignment'}<small>{j.city}</small></>},
  {key:'schedule',label:'Scheduled',value:j=>j.starts_epoch||0,render:j=>j.starts_at||'Not scheduled'},
  {key:'amount',label:'Total',value:j=>j.total_paise,numeric:true,render:j=><>{money(j.total_paise)}{j.hourly_hire&&j.hourly_final_total_paise===undefined&&<small> · ceiling</small>}</>},
  {key:'payment',label:'Payment / payout',value:j=>j.payment_status,render:j=><>{j.payment_status.replaceAll('_',' ')}<small>Payout: {j.payout_status.replaceAll('_',' ')}</small></>},
 ]} renderDetail={job=><><h3>{job.service_name} · #{job.id}</h3><AdminRecovery job={job} onRefresh={()=>resource.refresh()}/><details><summary>Private visit evidence</summary><VisitEvidence job={job} admin onRefresh={()=>resource.refresh()}/></details></>}/>}</>;
}

function AuditHistory(){
 const resource=useOperationResource<{entries:{id:string;action:string;actor_id:string;at:number}[]}>('/admin/audit-history',60000);
 return <section><div className="crm-section-heading"><div><h2>Team activity</h2><p>Latest 100 recorded administrative events. Times use your device time zone.</p></div><button disabled={resource.busy} onClick={()=>void resource.refresh()}>Refresh activity</button></div><AdminResourceStatus name="activity" resource={resource}/>{resource.data&&<AdminTable label="Team activity" rows={resource.data.entries} rowKey={r=>r.id} rowLabel={r=>r.action} initialSort={{key:'at',direction:'desc'}} empty="No recorded activity yet." columns={[{key:'at',label:'Time',value:r=>r.at,render:r=>r.at?new Date(r.at*1000).toLocaleString():'Not recorded'},{key:'action',label:'Action',value:r=>r.action},{key:'actor',label:'Team account',value:r=>r.actor_id}]}/>}</section>;
}
