import {useEffect,useRef,useState} from 'react';
import {Send} from 'lucide-react';
import {Modal} from '../ui';
import {comment,commentsPage,messagesPage,sendMessage} from '../../services/repaidiansService';
import type {CommunityComment,CommunityMember,CommunityMessage} from '../../types/repaidians';
import {Avatar,timeAgo} from './common';

function useDrawerScope(key:string) {
  const scopeRef=useRef({key,active:false});
  if(scopeRef.current.key!==key)scopeRef.current={key,active:false};
  const scope=scopeRef.current;
  useEffect(()=>{scope.active=true;return()=>{scope.active=false;};},[key]);
  return ()=>()=>scope.active&&scopeRef.current===scope;
}

export function CommentsDrawer({account,targetId,memberFor,onClose,onMembers}:{account:string;targetId:string;memberFor:(id:string)=>CommunityMember;onClose:()=>void;onMembers:(members:CommunityMember[])=>void}) {
  const [comments,setComments]=useState<CommunityComment[]>([]),[text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[moreBusy,setMoreBusy]=useState(false),[cursor,setCursor]=useState<string|null>(null);
  const captureScope=useDrawerScope(JSON.stringify([account,targetId])),readGeneration=useRef(0);
  const load=async(more=false)=>{
    const active=captureScope();if(!active())return;const generation=++readGeneration.current,current=()=>active()&&generation===readGeneration.current;
    if(more)setMoreBusy(true);
    try{const data=await commentsPage(targetId,more?cursor||'':'');if(!current())return;setComments(old=>more?[...new Map([...old,...data.comments].map(item=>[item.id,item])).values()]:data.comments);setCursor(data.nextCursor);setError('');onMembers(data.members);}
    catch(error){if(current())setError((error as Error).message);}
    finally{if(current()){setLoading(false);setMoreBusy(false);}}
  };
  useEffect(()=>{setComments([]);setText('');setError('');setBusy(false);setLoading(true);setMoreBusy(false);setCursor(null);void load();},[account,targetId]);
  return <Modal title="Comments" className="rp-dialog rp-drawer" onClose={onClose}>
    <div className="rp-comments">{loading&&<p role="status">Opening the conversation…</p>}{comments.map(c=><article key={c.id}><Avatar member={memberFor(c.authorId)}/><div><strong>{memberFor(c.authorId).name}</strong><p>{c.text}</p><small>{timeAgo(c.createdAt)}</small></div></article>)}
      {!loading&&!comments.length&&!error&&<p className="rp-muted">Start the conversation. Ask about the work or share a useful tip.</p>}
      {cursor&&<button disabled={moreBusy} onClick={()=>void load(true)}>{moreBusy?'Loading comments…':'Earlier comments'}</button>}</div>
    <form className="rp-compose" onSubmit={async e=>{e.preventDefault();const active=captureScope();if(busy||!active())return;setBusy(true);setError('');try{await comment(account,targetId,text);if(!active())return;setText('');await load();}catch(e){if(active())setError((e as Error).message);}finally{if(active())setBusy(false);}}}><label htmlFor="rp-comment">Your comment</label><div><textarea id="rp-comment" rows={2} required maxLength={500} value={text} onChange={e=>setText(e.target.value)}/><button className="rp-primary" aria-label="Post comment" disabled={busy||!text.trim()}><Send size={20}/></button></div>{error&&<p role="alert" className="rp-error">{error}</p>}</form>
  </Modal>;
}
export function MessageDrawer({account,selfId,recipient,canSend,onUpgrade,onClose,onMembers}:{account:string;selfId:string;recipient:CommunityMember;canSend:boolean;onUpgrade:()=>void;onClose:()=>void;onMembers:(members:CommunityMember[])=>void}) {
  const [messages,setMessages]=useState<CommunityMessage[]>([]),[text,setText]=useState(''),[error,setError]=useState(''),[readError,setReadError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[moreBusy,setMoreBusy]=useState(false),[cursor,setCursor]=useState<string|null>(null);
  const key=JSON.stringify([account,selfId,recipient.id]),captureScope=useDrawerScope(key),readGeneration=useRef(0);
  const readState=useRef({key,pending:false,expanded:false,failedMore:false});
  if(readState.current.key!==key)readState.current={key,pending:false,expanded:false,failedMore:false};
  const merge=(old:CommunityMessage[],incoming:CommunityMessage[])=>[...new Map([...old,...incoming].map(message=>[message.id,message])).values()].sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
  const load=async(more=false)=>{
    const active=captureScope(),reads=readState.current;if(!active()||reads.pending||more&&!cursor)return;reads.pending=true;
    const generation=++readGeneration.current,current=()=>active()&&generation===readGeneration.current;
    if(more)setMoreBusy(true);
    try{
      const data=await messagesPage(recipient.id,more?cursor||'':'');if(!current())return;
      setMessages(old=>merge(old,data.messages));
      // The refresh page is the latest 30 messages. Preserve the cursor for
      // history already opened, so polling cannot drop or strand older pages.
      if(more||!reads.expanded)setCursor(data.nextCursor);
      if(more)reads.expanded=true;
      setReadError('');onMembers(data.members);
    }catch(error){if(current()){
      const unavailable=[401,402,403,404].includes((error as {status?:number}).status||0);
      if(unavailable){setMessages([]);setCursor(null);reads.expanded=false;}
      reads.failedMore=more&&!unavailable;setReadError((error as Error).message);
    }}finally{reads.pending=false;if(current()){setLoading(false);setMoreBusy(false);}}
  };
  useEffect(()=>{
    setMessages([]);setText('');setError('');setReadError('');setBusy(false);setLoading(true);setMoreBusy(false);setCursor(null);
    const refresh=()=>{if(!document.hidden)void load();};refresh();const timer=setInterval(refresh,10000);document.addEventListener('visibilitychange',refresh);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
  },[account,selfId,recipient.id]);
  return <Modal title={'Message '+recipient.name} className="rp-dialog rp-drawer rp-thread" onClose={onClose}>
    <div className="rp-thread-person"><Avatar member={recipient}/><span><strong>{recipient.name}</strong><small>@{recipient.handle}</small></span></div>
    <div className="rp-messages" aria-live="polite">{cursor&&<button disabled={moreBusy} onClick={()=>void load(true)}>{moreBusy?'Loading messages…':'Earlier messages'}</button>}{loading&&<p role="status">Opening your conversation…</p>}{messages.map(m=><article className={m.senderId===selfId?'rp-message-sent':'rp-message-received'} key={m.id}><p>{m.text}</p><small>{timeAgo(m.createdAt)} · {m.senderId===selfId?'Sent':'Received'}</small></article>)}{!loading&&!messages.length&&!error&&!readError&&<p className="rp-muted">Say hello and share a clear brief.</p>}</div>
    {readError&&<div role="alert" className="rp-error"><p>{readError}</p><button className="rp-secondary" onClick={()=>void load(readState.current.failedMore)}>Retry messages</button></div>}
    <form className="rp-compose" onSubmit={async e=>{e.preventDefault();const active=captureScope();if(busy||!active())return;if(!canSend){onUpgrade();return;}setBusy(true);setError('');try{const result=await sendMessage(account,recipient.id,text);if(!active())return;setMessages(old=>merge(old,[result.message]));setText('');await load();}catch(e){if(active())setError((e as Error).message);}finally{if(active())setBusy(false);}}}><label htmlFor="rp-message">Message</label><div><textarea id="rp-message" rows={2} maxLength={1000} required value={text} onChange={e=>setText(e.target.value)}/><button className="rp-primary" disabled={busy||!text.trim()} aria-label="Send message"><Send size={20}/></button></div>{!canSend&&<p className="rp-fine">Sending messages requires an active free trial or Pro membership.</p>}{error&&<p role="alert" className="rp-error">{error}</p>}</form>
  </Modal>;
}
