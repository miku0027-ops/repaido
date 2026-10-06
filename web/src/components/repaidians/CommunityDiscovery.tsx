import {useEffect,useRef,useState} from 'react';
import {Bell,MessageCircle,Search,Send,SlidersHorizontal} from 'lucide-react';
import type {CommunityMember,CommunityNotification,CommunityThread,ProfessionalFilters,Trade} from '../../types/repaidians';
import {notificationsPage,readNotifications,searchMembers,threadsPage} from '../../services/repaidiansService';
import {Avatar,EmptyState,timeAgo,tradeName} from './common';
import {professionalTypes,professionalTypeName,workStatuses,workStatusName} from './Profile';
import {trades} from '../../services/repaidiansService';

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
  const [threads,setThreads]=useState<CommunityThread[]>([]),[members,setMembers]=useState<CommunityMember[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(true);
  useEffect(()=>{
    let active=true;
    const refresh=()=>{if(document.hidden)return;void threadsPage().then(data=>{if(active){setThreads(data.threads);setMembers(data.members);onMembers(data.members);setError('');}}).catch(e=>{if(active)setError((e as Error).message);}).finally(()=>{if(active)setBusy(false);});};
    refresh();const timer=setInterval(refresh,15000);return()=>{active=false;clearInterval(timer);};
  },[selfId]);
  return <section className="rp-inbox"><div className="rp-section-heading"><h2>Messages</h2><Send size={22}/></div><p className="rp-fine">Your private conversations with the people behind the work.</p>{busy&&<p role="status">Opening your inbox…</p>}{error&&<p role="alert" className="rp-error">{error}</p>}
    {threads.map(thread=>{const id=thread.memberId||thread.recipientId||thread.id;const member=members.find(m=>m.id===id);return <button className="rp-member-row" key={thread.id} onClick={()=>onOpen(id)}>{member&&<Avatar member={member}/>}<span><strong>{member?.name||'Community member'}</strong><small>{thread.lastMessage||thread.text||'Open conversation'}</small></span>{thread.updatedAt&&<time>{timeAgo(thread.updatedAt)}</time>}{!!thread.unreadCount&&<b className="rp-unread-dot" aria-label={thread.unreadCount+' unread messages'}>{thread.unreadCount}</b>}</button>;})}
    {!busy&&!error&&!threads.length&&<EmptyState title="Good work begins with a hello.">Visit a profile to start a conversation. New messages will appear here.</EmptyState>}
  </section>;
}
export function CommunityNotifications({onProfile,onMembers}:{onProfile:(id:string)=>void;onMembers:(members:CommunityMember[])=>void}) {
  const [items,setItems]=useState<CommunityNotification[]>([]),[members,setMembers]=useState<CommunityMember[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;void notificationsPage().then(data=>{if(!active)return;setItems(data.notifications);setMembers(data.members);onMembers(data.members);const unread=data.notifications.filter(n=>!n.read).map(n=>n.id);if(unread.length)void readNotifications(unread).catch(()=>{});}).catch(e=>{if(active)setError((e as Error).message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};
  },[]);
  const text=(item:CommunityNotification)=>item.text||({like:'liked your publication',comment:'commented on your publication',follow:'started following you',message:'sent you a message',bid:'submitted interest in your tender'}[item.type]||'shared an update');
  return <section className="rp-notifications"><div className="rp-section-heading"><h2>Your activity</h2><Bell size={22}/></div>{busy&&<p role="status">Checking your latest activity…</p>}{error&&<p className="rp-error" role="alert">{error}</p>}
    {items.map(item=>{const member=members.find(m=>m.id===(item.actorId||item.authorId));return <article className="rp-member-row" key={item.id}>{member?<button aria-label={'View '+member.name} onClick={()=>onProfile(member.id)}><Avatar member={member}/></button>:<MessageCircle size={24}/>}<span><strong>{member?.name||'Repaidians'}</strong><small>{text(item)}</small></span><time>{timeAgo(item.createdAt)}</time></article>;})}
    {!busy&&!error&&!items.length&&<EmptyState title="Your work will start conversations.">Likes, comments, follows and tender interest will appear here.</EmptyState>}
  </section>;
}
