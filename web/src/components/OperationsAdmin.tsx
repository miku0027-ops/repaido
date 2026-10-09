import {LocalBusinessAdmin} from './LocalBusiness';
import {ShopPrime} from './ShopPrime';
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
import {useEffect,useState,type ReactNode} from 'react';
import {LayoutDashboard,Users,Store,ClipboardList,Wallet,Headphones,ShieldCheck,LogOut,ArrowLeft} from 'lucide-react';
import {operation,money,type Job,type LiveWorker} from '../services/operations';
import {useOperationResource} from '../hooks/useOperationResource';
import {logoutUser} from '../services/repaidoService';
import RepaidoBrand from './RepaidoBrand';
import PortalAccess from './PortalAccess';
import {ShopRegistration,ShopReviewQueue} from './ShopRegistration';
import './operations.css';
import {SupportCenter,AdminRecovery,RefundReview,EvidenceReview} from './Lifecycle';
import {PrivateReview,FinanceReview} from './PrivateReview';
import {ShopB2BSection} from './ShopB2BSection';

export default function OperationsAdmin({onBack,shop=false}:{onBack:()=>void;shop?:boolean}){
 return <PortalAccess shop={shop}><Workspace shop={shop} onBack={onBack}/></PortalAccess>;
}
function Workspace({onBack,shop}:{onBack:()=>void;shop:boolean}){
 const [tab,setTab]=useState(shop?'Inventory':'Overview'),[error,setError]=useState('');
 const links=shop?[{name:'Orders',Icon:Store},{name:'Inventory',Icon:ClipboardList},{name:'Shop Prime',Icon:ShieldCheck},{name:'B2B Wholesale',Icon:Store},{name:'Rentals',Icon:Store},{name:'Earnings',Icon:Wallet}]:[{name:'Transport & scrap',Icon:Store},{name:'Partner programme',Icon:Users},{name:'Global Control',Icon:LayoutDashboard},{name:'Home plans',Icon:ClipboardList},{name:'Service terms',Icon:ClipboardList},{name:'Community',Icon:Store},{name:'Overview',Icon:LayoutDashboard},{name:'Rankings',Icon:Users},{name:'Workers',Icon:Users},{name:'Shops',Icon:Store},{name:'Bookings',Icon:ClipboardList},{name:'Finance',Icon:Wallet},{name:'Support',Icon:Headphones},{name:'Moderation',Icon:ShieldCheck},{name:'Activity',Icon:ClipboardList},{name:'Procurement',Icon:Store},{name:'Rentals',Icon:Store}];
  return <div className="operations portal-shell"><a href="#portal-content" className="portal-skip">Skip to workspace</a><aside className="portal-sidebar"><RepaidoBrand size="md"/><p className="ops-eyebrow">{shop?'Shop partner':'Company admin'}</p><nav aria-label={shop?'Shop workspace':'Company workspace'}>{links.map(({name,Icon})=><button key={name} aria-current={tab===name?'page':undefined} onClick={()=>setTab(name)}><Icon size={20} aria-hidden="true"/>{name}</button>)}</nav><div className="portal-sidebar-bottom"><p>{shop?'Approval protects the quality of our partner network.':'Your role determines which records and actions you can access.'}</p><button onClick={onBack}><ArrowLeft size={18}/>Customer app</button><button onClick={()=>void logoutUser().catch(e=>setError(e.message))}><LogOut size={18}/>Sign out</button></div></aside><div className="portal-body"><header className="portal-topbar"><span>{shop?'Partner workspace':'Operations workspace'}{!shop&&auth.currentUser?.email&&<small style={{display:'block'}}>{auth.currentUser.email}</small>}</span><span className="ops-badge"><ShieldCheck size={16}/>Restricted access</span></header><main id="portal-content" tabIndex={-1}>{error&&<p role="alert" className="ops-error">{error}</p>}{shop?<ShopRegistration>{s=><AdminContent shop shopId={s.id} title={s.name} tab={tab} onTab={setTab}/>}</ShopRegistration>:<AdminContent shop={false} tab={tab} onTab={setTab}/>}</main></div></div>;
}
function AdminContent({shop,shopId,tab,onTab,title}:{shop:boolean;shopId?:string;tab:string;onTab:(t:string)=>void;title?:string}){
 let content:ReactNode=null;
 if(shop)content=tab==='Rentals'?<ShopRentals/>:tab==='Shop Prime'?<ShopPrime/>:tab==='Inventory'?<ShopInventory/>:tab==='B2B Wholesale'?<ShopB2BSection shopId={shopId||''} shopName={title||'Partner Hub'}/>:tab==='Earnings'?<ShopPayables/>:<ShopPurchaseOrders/>;
 else {
  if(tab==='Overview')content=<CompanyOverview onTab={onTab}/>;
  if(tab==='Partner programme')content=<PartnerAdmin/>;
  if(tab==='Home plans')content=<HomePlanAdmin/>;
  if(tab==='Global Control')content=<CampaignAdmin/>;
  if(tab==='Service terms')content=<ServiceTermsAdmin/>;
  if(tab==='Community')content=<MarketplaceAdmin/>;
  if(tab==='Rentals')content=<RentalManager admin/>;
  if(tab==='Procurement')content=<ProcurementReview/>;
  if(tab==='Shops')content=<ShopReviewQueue/>;
  if(tab==='Workers')content=<OnboardingOverview/>;
  if(tab==='Rankings')content=<LocalLeaderboard/>;
  if(tab==='Activity')content=<AuditHistory/>;
  if(tab==='Bookings')content=<CompanyBookings/>;
  if(tab==='Transport & scrap')content=<LocalBusinessAdmin/>;
  if(tab==='Finance')content=<><HiringAdmin/><FinanceReview/><RefundReview/></>;
  if(tab==='Support')content=<SupportCenter admin/>;
  if(tab==='Moderation')content=<><NetworkModeration/><EvidenceReview/></>;
 }
 return <><div className="ops-heading portal-page-heading"><div><span className="ops-eyebrow">{shop?'Approved shop':'Repaido operations'}</span><h1>{title||tab}</h1><p>{shop?'Manage parts orders and collections.':'A dedicated workspace for your company team.'}</p></div></div>{content}</>;
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
