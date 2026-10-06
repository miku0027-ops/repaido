import {useEffect,useState} from 'react';
import {Bell,MessageCircle,Search,Send} from 'lucide-react';
import type {CommunityMember,CommunityNotification,CommunityThread} from '../../types/repaidians';
import {notificationsPage,readNotifications,searchMembers,threadsPage} from '../../services/repaidiansService';
import {Avatar,EmptyState,timeAgo,tradeName} from './common';

export function PeopleSearch({onProfile,onMembers}:{onProfile:(id:string)=>void;onMembers:(members:CommunityMember[])=>void}) {
  const [query,setQuery]=useState(''),[members,setMembers]=useState<CommunityMember[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>{setBusy(true);setError('');void searchMembers(query,controller.signal).then(data=>{setMembers(data.members);onMembers(data.members);}).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});},250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[query]);
  return <section className="rp-search-panel"><div className="rp-section-heading"><h2>Discover people</h2><Search size={22}/></div><label className="rp-search-input"><Search size={20}/><input aria-label="Search Repaidians" type="search" placeholder="Search a name or @handle" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <p className="rp-fine">Find people by the beginning of their name or handle.</p>
    {error&&<p className="rp-error" role="alert">{error}</p>}{busy&&<p role="status">Finding your community…</p>}
    <div className="rp-search-results">{members.map(member=><button className="rp-member-row" key={member.id} onClick={()=>onProfile(member.id)}><Avatar member={member}/><span><strong>{member.name}</strong><small>@{member.handle} · {tradeName(member.trade)}</small></span><span className="rp-row-action">View</span></button>)}</div>
    {!busy&&!error&&!members.length&&<EmptyState title="A community starts with you.">No matching profiles yet. Invite your crew to join Repaidians.</EmptyState>}
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
