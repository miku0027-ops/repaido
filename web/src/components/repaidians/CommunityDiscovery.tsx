import {useEffect,useRef,useState} from 'react';
import {Bell,BriefcaseBusiness,ChevronRight,MessageCircle,Search,Send,SlidersHorizontal} from 'lucide-react';
import type {CommunityMember,CommunityNotification,CommunityThread,ProfessionalFilters,Trade} from '../../types/repaidians';
import {notificationsPage,readNotifications,searchMembers,threadsPage} from '../../services/repaidiansService';
import {Avatar,EmptyState,timeAgo,tradeName} from './common';
import {professionalTypes,professionalTypeName,workStatuses,workStatusName} from './Profile';
import {trades} from '../../services/repaidiansService';
import {PlacementDetails} from './WorkHub';
import './discovery-notifications.css';

export function PeopleSearch({onProfile,onMembers}:{onProfile:(id:string)=>void;onMembers:(members:CommunityMember[])=>void}) {
  const [query,setQuery]=useState(''),[members,setMembers]=useState<CommunityMember[]>([]),[busy,setBusy]=useState(true),[moreBusy,setMoreBusy]=useState(false),[error,setError]=useState(''),[cursor,setCursor]=useState<string|null>(null);
  const [filters,setFilters]=useState<ProfessionalFilters>({trade:'all',city:'',workStatus:'all',professionalType:'all'});
  const generation=useRef(0),filterCount=[filters.trade,filters.city,filters.workStatus,filters.professionalType].filter(value=>value&&value!=='all').length;
  useEffect(()=>{
    const controller=new AbortController();generation.current++;setBusy(true);setError('');setMembers([]);setCursor(null);
    const timer=setTimeout(()=>{void searchMembers(query,controller.signal,filters).then(data=>{if(controller.signal.aborted)return;setMembers(data.members);setCursor(data.nextCursor||null);onMembers(data.members);}).catch(error=>{if(!controller.signal.aborted)setError((error as Error).message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});},250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[query,filters]);
  const loadMore=async()=>{
    if(!cursor||moreBusy)return;const current=generation.current;setMoreBusy(true);setError('');
    try{const data=await searchMembers(query,undefined,filters,cursor);if(current!==generation.current)return;setMembers(old=>[...new Map([...old,...data.members].map(member=>[member.id,member])).values()]);setCursor(data.nextCursor||null);onMembers(data.members);}catch(error){if(current===generation.current)setError((error as Error).message);}finally{setMoreBusy(false);}
  };
  const change=<K extends keyof ProfessionalFilters>(key:K,value:ProfessionalFilters[K])=>setFilters(old=>({...old,[key]:value}));
  return <section className="rp-search-panel"><div className="rp-section-heading"><h2>Discover professionals</h2><Search size={22}/></div><label className="rp-search-input"><Search size={20}/><input aria-label="Search Repaidians" type="search" placeholder="Search a name or @handle" maxLength={100} value={query} onChange={event=>setQuery(event.target.value)}/></label>
    <details className="rp-professional-filters"><summary><SlidersHorizontal size={18}/>Filter professionals{filterCount>0&&<span>{filterCount} active</span>}</summary><div className="rp-form-grid"><label>Trade<select value={filters.trade||'all'} onChange={event=>change('trade',event.target.value as Trade|'all')}><option value="all">All trades</option>{trades.map(trade=><option key={trade.id} value={trade.id}>{trade.name}</option>)}</select></label><label>City<input value={filters.city||''} maxLength={80} placeholder="Any city" onChange={event=>change('city',event.target.value)}/></label><label>Work status<select value={filters.workStatus||'all'} onChange={event=>change('workStatus',event.target.value as ProfessionalFilters['workStatus'])}><option value="all">Any work status</option>{workStatuses.map(status=><option key={status.id} value={status.id}>{status.label}</option>)}</select></label><label>Professional type<select value={filters.professionalType||'all'} onChange={event=>change('professionalType',event.target.value as ProfessionalFilters['professionalType'])}><option value="all">All professional types</option>{professionalTypes.map(type=><option key={type.id} value={type.id}>{type.label}</option>)}</select></label></div>{filterCount>0&&<button className="rp-secondary" onClick={()=>setFilters({trade:'all',city:'',workStatus:'all',professionalType:'all'})}>Clear filters</button>}</details>
    <p className="rp-fine">Search by the beginning of a name or handle, then narrow by professional details.</p>
    {error&&<div className="rp-error" role="alert"><p>{error}</p><button className="rp-secondary" onClick={()=>setFilters(old=>({...old}))}>Retry search</button></div>}{busy&&<p role="status">Finding your community…</p>}
    <div className="rp-search-results">{members.map(member=><button className="rp-member-row rp-professional-result" key={member.id} aria-label={'View '+member.name+' profile'} onClick={()=>onProfile(member.id)}><Avatar member={member}/><span className="rp-professional-result-body"><strong>{member.name}</strong>{member.headline&&<span className="rp-professional-result-headline">{member.headline}</span>}<small>{professionalTypeName(member.professionalType)} · {tradeName(member.trade)}{member.city?' · '+member.city:''}</small>{member.workStatus&&member.workStatus!=='not_looking'&&<span className="rp-professional-status" data-status={member.workStatus}>{workStatusName(member.workStatus)}</span>}{!!member.skills?.length&&<span className="rp-professional-result-skills">{member.skills.slice(0,3).join(' · ')}</span>}</span><span className="rp-row-action">View</span></button>)}</div>
    {cursor&&!busy&&<button className="rp-load-more" disabled={moreBusy} onClick={()=>void loadMore()}>{moreBusy?'Finding more…':'More professionals'}</button>}
    {!busy&&!error&&!members.length&&<EmptyState title="No matching professionals yet.">Try another name, trade or city. Profiles appear when members join the community.</EmptyState>}
  </section>;
}
export function CommunityInbox({selfId,onOpen,onMembers}:{selfId:string;onOpen:(id:string)=>void;onMembers:(members:CommunityMember[])=>void}) {
  const [threads,setThreads]=useState<CommunityThread[]>([]),[members,setMembers]=useState<CommunityMember[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(true),[cursor,setCursor]=useState<string|null>(null),[moreBusy,setMoreBusy]=useState(false),[retry,setRetry]=useState(0);
  const epoch=useRef(0),pending=useRef(false),pageCount=useRef(1);
  useEffect(()=>{
    let active=true;const generation=++epoch.current;
    pending.current=false;pageCount.current=1;setThreads([]);setMembers([]);setCursor(null);setMoreBusy(false);setBusy(true);setError('');
    const refresh=()=>{
      if(document.hidden||pending.current)return;pending.current=true;
      // Refresh every page the member opened. Replacing the window with the
      // server's current result also removes unavailable or blocked peers.
      void (async()=>{
        let next:string|null=null,loaded=0;const items:CommunityThread[]=[],people:CommunityMember[]=[];
        do{
          const data=await threadsPage(next||'');if(!active||generation!==epoch.current)return null;
          items.push(...data.threads);people.push(...data.members);next=data.nextCursor;loaded++;
        }while(next&&loaded<pageCount.current);
        return {threads:items,members:people,nextCursor:next,loaded};
      })().then(data=>{
        if(!data||!active||generation!==epoch.current)return;
        pageCount.current=data.loaded;
        setThreads([...new Map(data.threads.map(thread=>[thread.id,thread])).values()].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)));
        setMembers([...new Map(data.members.map(member=>[member.id,member])).values()]);setCursor(data.nextCursor);
        onMembers(data.members);setError('');
      }).catch(e=>{if(active&&generation===epoch.current){if([401,402,403,404].includes((e as {status?:number}).status||0)){setThreads([]);setMembers([]);setCursor(null);}setError((e as Error).message);}}).finally(()=>{if(active&&generation===epoch.current){pending.current=false;setBusy(false);}});
    };
    refresh();const timer=setInterval(refresh,15000);document.addEventListener('visibilitychange',refresh);
    return()=>{active=false;epoch.current++;clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
  },[selfId,retry]);
  const more=async()=>{
    if(!cursor||pending.current)return;const generation=epoch.current;pending.current=true;setMoreBusy(true);setError('');
    try{
      const data=await threadsPage(cursor);if(generation!==epoch.current)return;
      pageCount.current++;setThreads(old=>[...new Map([...old,...data.threads].map(thread=>[thread.id,thread])).values()].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)));
      setMembers(old=>[...new Map([...old,...data.members].map(member=>[member.id,member])).values()]);setCursor(data.nextCursor);onMembers(data.members);
    }catch(e){if(generation===epoch.current){if([401,402,403,404].includes((e as {status?:number}).status||0)){setThreads([]);setMembers([]);setCursor(null);}setError((e as Error).message);}}
    finally{if(generation===epoch.current){pending.current=false;setMoreBusy(false);}}
  };
  return <section className="rp-inbox"><div className="rp-section-heading"><h2>Messages</h2><Send size={22}/></div><p className="rp-fine">Your private conversations with the people behind the work.</p>{busy&&<p role="status">Opening your inbox…</p>}{error&&<div role="alert" className="rp-error"><p>{error}</p><button className="rp-secondary" onClick={()=>setRetry(value=>value+1)}>Retry inbox</button></div>}
    {threads.map(thread=>{const id=thread.memberId||thread.recipientId||thread.id;const member=members.find(m=>m.id===id);return <button className="rp-member-row" key={thread.id} onClick={()=>onOpen(id)}>{member&&<Avatar member={member}/>}<span><strong>{member?.name||'Community member'}</strong><small>{thread.lastMessage||thread.text||'Open conversation'}</small></span>{thread.updatedAt&&<time>{timeAgo(thread.updatedAt)}</time>}{!!thread.unreadCount&&<b className="rp-unread-dot" aria-label={thread.unreadCount+' unread messages'}>{thread.unreadCount}</b>}</button>;})}
    {cursor&&<button className="rp-load-more" disabled={moreBusy} onClick={()=>void more()}>{moreBusy?'Opening earlier conversations…':'Earlier conversations'}</button>}
    {!busy&&!error&&!threads.length&&!cursor&&<EmptyState title="Good work begins with a hello.">Visit a profile to start a conversation. New messages will appear here.</EmptyState>}
  </section>;
}
export function CommunityNotifications({accountKey,onProfile,onMembers,onApplications,onContract,onPublication,onCustomContract,onJob}:{accountKey:string;onProfile:(id:string)=>void;onMembers:(members:CommunityMember[])=>void;onApplications:(id?:string)=>void;onContract:(id:string)=>void;onPublication?:(id:string)=>void;onCustomContract?:(id:string)=>void;onJob?:(id:string)=>void}) {
  const [items,setItems]=useState<CommunityNotification[]>([]),[members,setMembers]=useState<CommunityMember[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState(''),[placement,setPlacement]=useState<string|null>(null),[cursor,setCursor]=useState<string|null>(null),[moreBusy,setMoreBusy]=useState(false),[retry,setRetry]=useState(0);
  const epoch=useRef(0);
  useEffect(()=>{
    let active=true,pending=false;const generation=++epoch.current;
    setItems([]);setMembers([]);setCursor(null);setPlacement(null);setBusy(true);setMoreBusy(false);setError('');
    const refresh=()=>{if(document.hidden||pending)return;pending=true;void notificationsPage().then(data=>{if(!active||generation!==epoch.current)return;setItems(data.notifications);setMembers(data.members);setCursor(data.nextCursor);onMembers(data.members);setError('');}).catch(e=>{if(active)setError((e as Error).message);}).finally(()=>{pending=false;if(active)setBusy(false);});};
    refresh();const timer=setInterval(refresh,30000);document.addEventListener('visibilitychange',refresh);
    return()=>{active=false;epoch.current++;clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
  },[accountKey,retry]);
  const more=async()=>{if(!cursor||moreBusy)return;const generation=epoch.current;setMoreBusy(true);try{const data=await notificationsPage(cursor);if(generation!==epoch.current)return;setItems(old=>[...new Map([...old,...data.notifications].map(item=>[item.id,item])).values()]);setMembers(old=>[...new Map([...old,...data.members].map(member=>[member.id,member])).values()]);setCursor(data.nextCursor);onMembers(data.members);}catch(e){if(generation===epoch.current)setError((e as Error).message);}finally{if(generation===epoch.current)setMoreBusy(false);}};
  const open=async(item:CommunityNotification)=>{
    const generation=epoch.current;
    // Settle the acknowledgement's cache invalidation before opening private
    // work details; otherwise the read can invalidate the new detail request.
    if(!item.read){try{await readNotifications([item.id]);if(generation===epoch.current)setItems(old=>old.map(row=>row.id===item.id?{...row,read:true}:row));}catch{/* Opening an update remains possible if read acknowledgement fails. */}}
    if(generation!==epoch.current)return;
    if(item.queryId&&onCustomContract)onCustomContract(item.queryId);
    else if(item.type==='job_discovery'&&onJob){const id=item.jobId||item.projectId||item.targetId;if(id)onJob(id);}
    else if(item.placementId||item.type==='placement'||item.type==='congratulation')setPlacement(item.placementId||item.targetId||null);
    else if(item.applicationId||item.type==='application_update')onApplications(item.applicationId||item.targetId);
    else if(item.contractId||item.type==='contract_update'){const id=item.contractId||item.targetId;if(id)onContract(id);}
    else if(['like','comment','bid'].includes(item.type)&&item.targetId&&onPublication)onPublication(item.targetId);
    else if(item.actorId||item.authorId)onProfile((item.actorId||item.authorId)!);
  };
  const text=(item:CommunityNotification)=>item.text||item.body||({like:'liked your publication',comment:'commented on your publication',follow:'started following you',message:'sent you a message',bid:'submitted interest in your tender'}[item.type]||'shared an update');
  return <section className="rp-notifications"><div className="rp-section-heading"><h2>Notifications</h2><Bell size={22}/></div>{busy&&<p role="status">Checking your latest activity…</p>}{error&&<div className="rp-error" role="alert"><p>{error}</p><button className="rp-secondary" onClick={()=>setRetry(value=>value+1)}>Retry</button></div>}
    {items.map(item=>{const member=members.find(m=>m.id===(item.actorId||item.authorId)),discovery=item.type==='job_discovery';return <button className={'rp-member-row rp-notification-row'+(discovery?' rp-job-discovery':'')} data-unread={!item.read} data-notification-type={item.type} key={item.id} onClick={()=>void open(item)}>{discovery?<span className="rp-discovery-icon"><BriefcaseBusiness size={22} aria-hidden="true"/></span>:member?<Avatar member={member}/>:<MessageCircle size={24}/>}<span><strong>{item.title||member?.name||'Repaidians'}</strong><small>{text(item)}</small>{discovery&&<span className="rp-discovery-action">View matching job</span>}<time>{timeAgo(item.createdAt)}</time></span><ChevronRight size={16} aria-hidden="true"/></button>;})}
    {cursor&&<button className="rp-secondary" disabled={moreBusy} onClick={()=>void more()}>{moreBusy?'Loading updates…':'Earlier updates'}</button>}
    {!busy&&!error&&!items.length&&<EmptyState title="Your latest activity, in one place.">Interactions, applications and chosen discoveries will appear here. Manage discovery alerts in Work &amp; market.</EmptyState>}
    {placement&&<PlacementDetails accountKey={accountKey} placementId={placement} onClose={()=>setPlacement(null)} onOpenMember={id=>{setPlacement(null);onProfile(id);}}/>}
  </section>;
}
