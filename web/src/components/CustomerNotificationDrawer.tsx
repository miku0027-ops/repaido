import {useEffect,useMemo,useRef,useState} from 'react';
import {Bell,Check,CheckCheck,ChevronRight,RefreshCw,ShieldCheck,X} from 'lucide-react';
import {operation,operationSnapshot} from '../services/operations';
import type {B2BQuotation} from '../types/b2b';
import {Modal} from './ui';
import {auth} from '../firebase';
import {TransportNotificationSettings} from './TransportNotificationSettings';
import './customer-notifications.css';

export interface RawNotification {
  id:string;title:string;body:string;job_id?:string;destination?:string;campaign_id?:string;plan_id?:string;
  query_id?:string;queryId?:string;bid_id?:string;project_id?:string;community_job_id?:string;kind?:string;business_id?:string;
  created_at?:number;read_at?:number|null;alert_kind?:string;event_type?:string;
}
type Filter='all'|'unread'|'bookings'|'offers'|'contracts'|'discoveries';
interface Props {
  isOpen:boolean;onClose:()=>void;onOpenJob?:(id:string)=>void;
  onOpenCommunityJob?:(id:string)=>void;
  onOpenSharedRide?:(id:string)=>void;
  onOpenContract?:(queryId:string,proposalId?:string)=>void;
  onOpenQuotationModal?:(quotation:B2BQuotation)=>void;onNavigateTab?:(tab:string,sub?:string)=>void;
  onOpenPromotion?:(id?:string)=>void;onOpenHomePlan?:(id?:string)=>void;onUnreadCountChange?:(count:number)=>void;
}
export function CustomerNotificationDrawer(props:Props){
  // Mount the actual dialog only while open: native modal focus and inert background.
  return props.isOpen?<NotificationPanel {...props}/>:null;
}
function NotificationPanel({onClose,onOpenJob,onOpenCommunityJob,onOpenSharedRide,onOpenContract,onNavigateTab,onOpenPromotion,onOpenHomePlan,onUnreadCountChange}:Props){
  const cached=operationSnapshot<{notifications:RawNotification[]}>('/notifications');
  const [notifications,setNotifications]=useState(cached?.notifications||[]);
  const [loading,setLoading]=useState(!cached),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState('');
  const [filter,setFilter]=useState<Filter>('all');
  const alive=useRef(true),request=useRef(0),openingDiscovery=useRef(false);
  const load=async(force=false)=>{
    const id=++request.current;setRefreshing(true);
    try{
      const data=await operation<{notifications:RawNotification[]}>('/notifications',{}, {background:true,force});
      if(alive.current&&id===request.current){setNotifications(data.notifications);setError('');}
    }catch(e){if(alive.current&&id===request.current)setError((e as Error).message);}
    finally{if(alive.current&&id===request.current){setLoading(false);setRefreshing(false);}}
  };
  useEffect(()=>{
    alive.current=true;void load();
    const refresh=()=>{if(!document.hidden)void load(true);};
    window.addEventListener('repaido:operations-updated',refresh);window.addEventListener('focus',refresh);
    const timer=setInterval(refresh,30000);
    return()=>{alive.current=false;request.current++;clearInterval(timer);window.removeEventListener('repaido:operations-updated',refresh);window.removeEventListener('focus',refresh);};
  },[]);
  const unread=notifications.filter(n=>!n.read_at).length;
  useEffect(()=>{if(!loading&&!error)onUnreadCountChange?.(unread);},[unread,loading,error,onUnreadCountChange]);
  const discoveryJob=(n:RawNotification)=>n.destination==='repaidians'&&n.kind==='job_discovery'?(n.community_job_id||n.project_id):undefined;
  const filtered=useMemo(()=>notifications.filter(n=>filter==='all'||filter==='unread'&&!n.read_at||filter==='bookings'&&(!!n.job_id&&!discoveryJob(n)||n.kind==='local_business'&&n.destination==='mobility')||filter==='offers'&&!!n.campaign_id||filter==='contracts'&&n.destination==='custom_contract'||filter==='discoveries'&&!!discoveryJob(n)),[notifications,filter]);
  const mark=async(id?:string)=>{
    if(busy)return;setBusy(id||'all');setError('');
    try{
      const result=await operation<{read_at:number}>(id?`/notifications/${encodeURIComponent(id)}/read`:'/notifications/read-all',{method:'POST'}, {background:true});
      if(alive.current){
        setNotifications(rows=>rows.map(n=>!id||n.id===id?{...n,read_at:n.read_at||result.read_at}:n));
      }
      if(notifications.some(n=>(!id||n.id===id)&&discoveryJob(n)))window.dispatchEvent(new Event('repaidians:update'));
    }catch(e){if(alive.current)setError((e as Error).message);}
    finally{if(alive.current)setBusy('');}
  };
  const open=async(n:RawNotification)=>{
    const communityJob=discoveryJob(n);
    if(communityJob&&onOpenCommunityJob){
      if(openingDiscovery.current||busy)return;
      openingDiscovery.current=true;
      // Reading this mirrored alert refreshes both inboxes. Settle that
      // invalidation before opening the job's account-scoped detail request.
      try{await mark(n.id);if(alive.current){onClose();onOpenCommunityJob(communityJob);}}
      finally{openingDiscovery.current=false;}
      return;
    }
    void mark(n.id);
    const queryId=n.query_id||n.queryId;
    if(n.destination==='custom_contract'&&queryId&&onOpenContract){onClose();onOpenContract(queryId,n.bid_id);}
    else if(n.job_id&&!communityJob&&onOpenJob){onClose();onOpenJob(n.job_id);}
    else if(n.campaign_id&&onOpenPromotion){onClose();onOpenPromotion(n.campaign_id);}
    else if(n.plan_id&&onOpenHomePlan){onClose();onOpenHomePlan(n.plan_id);}
    else if(n.kind==='local_business'&&n.destination==='mobility'&&n.business_id&&onOpenSharedRide){onClose();onOpenSharedRide(n.business_id);}
    else if(n.kind==='local_business'&&onNavigateTab){onClose();if(n.destination==='scrap')onNavigateTab('ShopSpares','scrap');else onNavigateTab('Bookings','rides');}
    else if(n.destination==='b2b_quotation'&&onNavigateTab){onClose();onNavigateTab('ShopSpares','b2b');}
  };
  const label=(n:RawNotification)=>n.kind==='local_business'?(n.destination==='mobility'?'Ride update':'Collection update'):discoveryJob(n)?'Matching job':n.destination==='custom_contract'?'Custom contract':n.alert_kind==='arrival'?'Arrival update':n.job_id?'Booking update':n.campaign_id?'Offer':n.plan_id?'Home plan':'Account update';
  const actionable=(n:RawNotification)=>!!((n.kind==='local_business'&&onNavigateTab)||(discoveryJob(n)&&onOpenCommunityJob)||(n.destination==='custom_contract'&&(n.query_id||n.queryId)&&onOpenContract)||(n.job_id&&!discoveryJob(n)&&onOpenJob)||(n.campaign_id&&onOpenPromotion)||(n.plan_id&&onOpenHomePlan)||(n.destination==='b2b_quotation'&&onNavigateTab));
  const actionLabel=(n:RawNotification)=>discoveryJob(n)?'View matching job':n.destination==='custom_contract'?(n.kind==='custom_contract_recommendations'||n.event_type==='custom_contract_recommendations'?'Review matches':n.kind==='custom_contract_bid'||n.event_type==='custom_contract_bid'?'Review proposal':'View contract'):n.job_id?'View booking':'View details';
  const date=(n:RawNotification)=>n.created_at?new Date(n.created_at*1000).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Date unavailable';
  return <Modal title="Notifications" className="customer-notification-dialog" frameless onClose={onClose}>
    <section className="repaido-notif-drawer-panel">
      <header className="notif-drawer-header"><div className="notif-drawer-brand"><span className="notif-drawer-brand-icon"><Bell size={21} aria-hidden="true"/></span><div><h2>Notifications</h2><p>{loading?'Checking updates…':error?'Last received updates':unread?`${unread} unread`:'You’re up to date'}</p></div></div><button className="notif-header-close-btn" onClick={onClose} aria-label="Close notification panel" data-autofocus><X size={22}/></button></header>
      <div className="notif-toolbar"><button className="notif-header-btn" disabled={!!busy||!unread} onClick={()=>void mark()}><CheckCheck size={18}/>Mark all read</button><button className="notif-header-btn" aria-label="Refresh notifications" disabled={refreshing} onClick={()=>void load(true)}><RefreshCw size={18} className={refreshing?'notif-refreshing':''}/></button></div>
      <nav className="notif-filter-bar" aria-label="Filter notifications">{([{id:'all',label:'All'},{id:'unread',label:'Unread'},{id:'bookings',label:'Bookings'},{id:'offers',label:'Offers'},{id:'contracts',label:'Contracts'},{id:'discoveries',label:'Discoveries'}] as const).map(f=><button className={`notif-filter-chip${filter===f.id?' active':''}`} key={f.id} aria-pressed={filter===f.id} onClick={()=>setFilter(f.id)}>{f.label}</button>)}</nav>
      {error&&<p className="notif-error" role="alert">{error} <button onClick={()=>void load(true)}>Retry</button></p>}
      {notice&&<p className="notif-status" role="status">{notice}</p>}
      <div className="notif-feed-container" aria-busy={loading}>
        {loading?<p role="status">Loading your notifications…</p>:!filtered.length?<div className="notif-empty-state"><Bell size={32} aria-hidden="true"/><h3>{error?'Notifications unavailable':filter==='unread'?'All caught up':'No notifications here yet'}</h3><p>{error?'Retry when your connection is ready.':filter==='all'?'Updates from your bookings, contract requests and account will appear here when something changes.':'Choose All to see your other updates.'}</p></div>:filtered.map(n=><article className={`notif-card${!n.read_at?' is-unread':''}`} key={n.id}><div className="notif-card-header"><span className="notif-micro-tag">{label(n)}</span>{!n.read_at&&<span className="notif-unread-dot" role="img" aria-label="Unread"/>}</div><h3 className="notif-card-title">{n.title}</h3><p className="notif-card-desc">{n.body}</p><time className="notif-time" dateTime={n.created_at?new Date(n.created_at*1000).toISOString():undefined}>{date(n)}</time><div className="notif-card-actions">{actionable(n)&&<button className="notif-action-btn" onClick={()=>open(n)}>{actionLabel(n)}<ChevronRight size={17}/></button>}{!n.read_at&&<button className="notif-mark-read-btn" disabled={!!busy} aria-label={`Mark ${n.title} as read`} onClick={()=>void mark(n.id)}><Check size={18}/>Mark read</button>}</div></article>)}
      </div>
      <footer className="notif-drawer-footer"><p><ShieldCheck size={17} aria-hidden="true"/>Updates from your account</p><details><summary>Ride notification settings</summary><TransportNotificationSettings accountKey={auth.currentUser?.uid||'guest'}/></details></footer>
    </section>
  </Modal>;
}
export default CustomerNotificationDrawer;
