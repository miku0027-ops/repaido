import {useEffect,useState} from 'react';
import {Send} from 'lucide-react';
import {Modal} from '../ui';
import {comment,commentsPage,messagesPage,sendMessage} from '../../services/repaidiansService';
import type {CommunityComment,CommunityMember,CommunityMessage} from '../../types/repaidians';
import {Avatar,timeAgo} from './common';

export function CommentsDrawer({account,targetId,memberFor,onClose,onMembers}:{account:string;targetId:string;memberFor:(id:string)=>CommunityMember;onClose:()=>void;onMembers:(members:CommunityMember[])=>void}) {
  const [comments,setComments]=useState<CommunityComment[]>([]),[text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[cursor,setCursor]=useState<string|null>(null);
  const load=async(more=false)=>{const data=await commentsPage(targetId,more?cursor||'':'');setComments(old=>more?[...old,...data.comments]:data.comments);setCursor(data.nextCursor);onMembers(data.members);};
  useEffect(()=>{let active=true;void load().catch(e=>{if(active)setError((e as Error).message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[targetId]);
  return <Modal title="Comments" className="rp-dialog rp-drawer" onClose={onClose}>
    <div className="rp-comments">{loading&&<p role="status">Opening the conversation…</p>}{comments.map(c=><article key={c.id}><Avatar member={memberFor(c.authorId)}/><div><strong>{memberFor(c.authorId).name}</strong><p>{c.text}</p><small>{timeAgo(c.createdAt)}</small></div></article>)}
      {!loading&&!comments.length&&!error&&<p className="rp-muted">Start the conversation. Ask about the work or share a useful tip.</p>}
      {cursor&&<button onClick={()=>void load(true).catch(e=>setError((e as Error).message))}>Earlier comments</button>}</div>
    <form className="rp-compose" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await comment(account,targetId,text);setText('');await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><label htmlFor="rp-comment">Your comment</label><div><textarea id="rp-comment" rows={2} required maxLength={500} value={text} onChange={e=>setText(e.target.value)}/><button className="rp-primary" aria-label="Post comment" disabled={busy||!text.trim()}><Send size={20}/></button></div>{error&&<p role="alert" className="rp-error">{error}</p>}</form>
  </Modal>;
}
export function MessageDrawer({account,selfId,recipient,canSend,onUpgrade,onClose,onMembers}:{account:string;selfId:string;recipient:CommunityMember;canSend:boolean;onUpgrade:()=>void;onClose:()=>void;onMembers:(members:CommunityMember[])=>void}) {
  const [messages,setMessages]=useState<CommunityMessage[]>([]),[text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[cursor,setCursor]=useState<string|null>(null);
  const load=async(more=false)=>{const data=await messagesPage(recipient.id,more?cursor||'':'');setMessages(old=>more?[...data.messages,...old]:data.messages);setCursor(data.nextCursor);onMembers(data.members);};
  useEffect(()=>{let active=true;const refresh=()=>{if(document.hidden)return;void load().catch(e=>{if(active)setError((e as Error).message);}).finally(()=>{if(active)setLoading(false);});};refresh();const timer=setInterval(refresh,10000);return()=>{active=false;clearInterval(timer);};},[recipient.id]);
  return <Modal title={'Message '+recipient.name} className="rp-dialog rp-drawer rp-thread" onClose={onClose}>
    <div className="rp-thread-person"><Avatar member={recipient}/><span><strong>{recipient.name}</strong><small>@{recipient.handle}</small></span></div>
    <div className="rp-messages" aria-live="polite">{cursor&&<button onClick={()=>void load(true).catch(e=>setError((e as Error).message))}>Earlier messages</button>}{loading&&<p role="status">Opening your conversation…</p>}{messages.map(m=><article className={m.senderId===selfId?'rp-message-sent':'rp-message-received'} key={m.id}><p>{m.text}</p><small>{timeAgo(m.createdAt)} · {m.senderId===selfId?'Sent':'Received'}</small></article>)}{!loading&&!messages.length&&!error&&<p className="rp-muted">Say hello and share a clear brief.</p>}</div>
    <form className="rp-compose" onSubmit={async e=>{e.preventDefault();if(!canSend){onUpgrade();return;}setBusy(true);setError('');try{await sendMessage(account,recipient.id,text);setText('');await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><label htmlFor="rp-message">Message</label><div><textarea id="rp-message" rows={2} maxLength={1000} required value={text} onChange={e=>setText(e.target.value)}/><button className="rp-primary" disabled={busy||!text.trim()} aria-label="Send message"><Send size={20}/></button></div>{!canSend&&<p className="rp-fine">Reading is included. Pro is required to send messages.</p>}{error&&<p role="alert" className="rp-error">{error}</p>}</form>
  </Modal>;
}
