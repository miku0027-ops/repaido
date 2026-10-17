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
import {PrivateReview,FinanceReview} from './PrivateReview';
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
 return <div className={"operations portal-shell"+(!shop?" portal-company crm-workspace":"")}>{shop&&<ShopPresence/>}<a href="#portal-content" className="portal-skip">Skip to workspace</a><aside className="portal-sidebar" data-menu-open={navigationOpen}><div className="portal-sidebar-heading"><RepaidoBrand size="md"/><button className="portal-menu-toggle" aria-label="Workspace menu" aria-expanded={navigationOpen} aria-controls="portal-navigation" onClick={()=>setNavigationOpen(value=>!value)}>{navigationOpen?<X size={20} aria-hidden="true"/>:<Menu size={20} aria-hidden="true"/>}<span>{navigationOpen?'Close':tab}</span></button></div><p className="ops-eyebrow">{shop?'Shop partner':'Company admin'}</p><nav id="portal-navigation" aria-label={shop?'Shop workspace':'Company workspace'}>{workspaceQuery&&!links.some(item=>item.name.toLowerCase().includes(workspaceQuery.toLowerCase()))&&<p role="status" className="crm-no-workspace">No workspace matches.</p>}{links.filter(item=>item.name.toLowerCase().includes(workspaceQuery.toLowerCase())).map(({name,Icon})=><button key={name} aria-current={tab===name?'page':undefined} onClick={()=>changeTab(name)}><Icon size={24} aria-hidden="true"/>{name}</button>)}</nav><div className="portal-sidebar-bottom"><p>{shop?'Manage your shop, orders and stock.':'Access follows your company role.'}</p><button onClick={onBack}><ArrowLeft size={20} aria-hidden="true"/>Customer app</button><button disabled={signingOut} aria-busy={signingOut} onClick={async()=>{setSigningOut(true);setError('');try{await logoutUser();}catch(e){setError((e as Error).message);}finally{setSigningOut(false);}}}><LogOut size={20} aria-hidden="true"/>{signingOut?'Signing out…':'Sign out'}</button></div></aside><div className="portal-body"><header className="portal-topbar">{!shop&&<div className="crm-workspace-search"><Search size={16} aria-hidden="true"/><input ref={search} type="search" aria-label="Find a company workspace" placeholder="Find a workspace…" value={workspaceQuery} onChange={event=>{setWorkspaceQuery(event.target.value);setNavigationOpen(true);}} onFocus={()=>{if(workspaceQuery)setNavigationOpen(true);}} onKeyDown={event=>{if(event.key==='Escape')setWorkspaceQuery('');}}/><kbd>⌘ K</kbd></div>}<span className="crm-account-summary">{shop?'Partner workspace':'Company operations'}{!shop&&auth.currentUser?.email&&<small style={{display:'block'}}>{auth.currentUser.email}</small>}</span><span className="ops-badge"><ShieldCheck size={16} aria-hidden="true"/>Restricted access</span></header><main ref={content} id="portal-content" tabIndex={-1}><nav className="portal-breadcrumb" aria-label="Workspace breadcrumb"><button onClick={()=>changeTab(shop?'Inventory':'Overview')}>{shop?'Shop':'Company'}</button><ChevronRight size={16} aria-hidden="true"/><span aria-current="page">{tab}</span></nav>{error&&<p role="alert" className="ops-error">{error}</p>}{shop?<ShopRegistration>{s=><AdminContent shop shopId={s.id} title={s.name} tab={tab} onTab={changeTab}/>}</ShopRegistration>:<AdminContent shop={false} tab={tab} onTab={changeTab}/>}</main></div></div>;
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
  if(tab==='Finance')content=<><HiringAdmin/><FinanceReview/><RefundReview/></>;
  if(tab==='Support')content=<><RetailResolutionAdmin/><SupportCenter admin/></>;
  if(tab==='Moderation')content=<><NetworkModeration/><EvidenceReview/></>;
 }
 const descriptions:Record<string,string>={'Overview':'Your operations at a glance.','Bookings':'Review service visits and customer requests.','Workers':'Review applications and professional records.','Shops':'Review shop applications and approvals.','Transport & scrap':'Review business profiles, vehicles and service records.','Home plans':'Manage plans, scheduled visits and attendance.','Community':'Review listings and community activity.','Finance':'Review collections, refunds and payouts.','Support':'Help customers and professionals resolve requests.','Moderation':'Review reported content and evidence.','Procurement':'Review parts purchases and supplier records.','Rentals':'Follow handovers, returns and rental records.','Partner programme':'Manage partner applications and agreements.','Rankings':'Review verified work and service ratings.','Service terms':'Manage the terms customers see before booking.','Global Control':'Manage campaigns and delivery limits.','Activity':'Review recorded company actions.'};
 return <><div className="ops-heading portal-page-heading"><div><span className="ops-eyebrow">{shop?'Approved shop':'Repaido operations'}</span><h1 tabIndex={-1}>{title||tab}</h1><p>{shop?'Manage your stock, orders and collections.':descriptions[tab]}</p></div></div>{content}</>;
}

function CompanyOverview({onTab}:{onTab:(tab:string)=>void}){
 const workers=useOperationResource<{workers:LiveWorker[]}>('/admin/workers',60000),jobs=useOperationResource<{jobs:Job[]}>('/admin/jobs',60000);
 const refresh=async()=>{await Promise.all([workers.refresh(),jobs.refresh()]);};
 return <><button disabled={workers.busy||jobs.busy} onClick={()=>void refresh()}>{workers.busy||jobs.busy?'Refreshing overview…':'Refresh overview'}</button>
  <div className="portal-metrics">
   <button onClick={()=>onTab('Workers')}><span>Workers</span><strong>{workers.data?workers.data.workers.length:workers.busy?'Loading…':'Unavailable'}</strong><span>Registered professionals</span></button>
   <button onClick={()=>onTab('Bookings')}><span>Bookings</span><strong>{jobs.data?jobs.data.jobs.filter(job=>!['completed','cancelled'].includes(job.state)).length:jobs.busy?'Loading…':'Unavailable'}</strong><span>Open service tasks</span></button>
   <button onClick={()=>onTab('Shops')}><span>Shops</span><strong>Review</strong><span>Applications and verification</span></button>
  </div>
  <AdminResourceStatus name="workers" resource={workers}/><AdminResourceStatus name="bookings" resource={jobs}/>
  <section className="ops-card"><h2>Today’s operations</h2><p>Review applications, follow bookings and resolve customer issues. Each workspace loads its own records.</p><div className="ops-actions"><button onClick={()=>onTab('Shops')}>Review shop applications</button><button onClick={()=>onTab('Bookings')}>Open bookings</button></div></section>
 </>;
}
function AdminResourceStatus({name,resource}:{name:string;resource:{data:unknown;error:string;busy:boolean;refresh:()=>Promise<void>}}){
 if(resource.error)return <div className="ops-notice" role="alert"><strong>Could not load {name}.</strong><p>{resource.error}</p>{resource.data!=null&&<p>Showing the last loaded records.</p>}<button disabled={resource.busy} onClick={()=>void resource.refresh()}>{resource.busy?'Retrying…':'Retry '+name}</button></div>;
 return resource.data==null&&resource.busy?<p role="status">Loading {name}…</p>:null;
}
function CompanyBookings(){
 const resource=useOperationResource<{jobs:Job[]}>('/admin/jobs',60000),jobs=resource.data?.jobs||[];
 return <><button disabled={resource.busy} onClick={()=>void resource.refresh()}>{resource.busy?'Refreshing bookings…':'Refresh bookings'}</button><AdminResourceStatus name="bookings" resource={resource}/>{resource.data&&(jobs.length?<div className="portal-card-grid">{jobs.map(job=><article className="ops-card" key={job.id}><h3>{job.service_name}</h3><p>{job.state} · {job.city} · {money(job.total_paise)}</p><p>{job.worker_name||'Awaiting assignment'} · payout {job.payout_status}</p><AdminRecovery job={job} onRefresh={()=>resource.refresh()}/><details><summary>Private visit evidence</summary><VisitEvidence job={job} admin onRefresh={()=>resource.refresh()}/></details></article>)}</div>:<p className="ops-empty">No bookings yet. Customer booking requests appear here.</p>)}</>;
}

function AuditHistory(){
 const [rows,setRows]=useState<{id:string;action:string;actor_id:string;at:number}[]>([]),[error,setError]=useState('');
 const load=async()=>{try{setRows((await operation<{entries:typeof rows}>('/admin/audit-history')).entries);setError('');}catch(e){setError((e as Error).message);}};
 useEffect(()=>{void load();},[]);
 return <section className="ops-card"><h2>Team activity</h2><p>Latest 100 recorded administrative events.</p><button onClick={()=>void load()}>Refresh activity</button>{error&&<p role="alert">{error}</p>}<div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left'}}><thead><tr><th>Time</th><th>Action</th><th>Team account</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.id||i}><td>{r.at?new Date(r.at*1000).toLocaleString():'Not recorded'}</td><td>{r.action}</td><td>{r.actor_id}</td></tr>)}</tbody></table></div>{!rows.length&&!error&&<p>No recorded activity yet.</p>}</section>;
}
