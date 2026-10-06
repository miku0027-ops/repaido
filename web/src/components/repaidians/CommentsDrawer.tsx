import {useState} from 'react';
import {Send} from 'lucide-react';
import {Modal} from '../ui';
import {comment,sendMessage} from '../../services/repaidiansService';
import type {CommunityComment,CommunityMember,CommunityMessage} from '../../types/repaidians';
import {Avatar,timeAgo} from './common';
export function CommentsDrawer({account,targetId,comments,memberFor,onClose}:{account:string;targetId:string;comments:CommunityComment[];memberFor:(id:string)=>CommunityMember;onClose:()=>void}) {
  const [text,setText]=useState(''),[error,setError]=useState('');
  return <Modal title="Comments" className="rp-dialog rp-drawer" onClose={onClose}>
    <p className="rp-fine">These comments are saved on this device only.</p>
    <div className="rp-comments">{comments.filter(c=>c.targetId===targetId).map(c=><article key={c.id}><Avatar member={memberFor(c.authorId)}/><div><strong>{memberFor(c.authorId).name}</strong><p>{c.text}</p><small>{timeAgo(c.createdAt)}</small></div></article>)}
    {!comments.some(c=>c.targetId===targetId)&&<p className="rp-muted">Start the conversation. Ask about the scope or share a useful tip.</p>}</div>
    <form className="rp-compose" onSubmit={e=>{e.preventDefault();try{comment(account,targetId,text);setText('');setError('');}catch(e){setError((e as Error).message);}}}><label htmlFor="rp-comment">Your comment</label><div><textarea id="rp-comment" rows={2} required maxLength={500} value={text} onChange={e=>setText(e.target.value)}/><button className="rp-primary" aria-label="Post comment" disabled={!text.trim()}><Send size={18}/></button></div>{error&&<p role="alert">{error}</p>}</form>
  </Modal>;
}
export function MessageDrawer({account,recipient,messages,onClose}:{account:string;recipient:CommunityMember;messages:CommunityMessage[];onClose:()=>void}) {
  const [text,setText]=useState(''),[error,setError]=useState('');
  return <Modal title={'Message '+recipient.name} className="rp-dialog rp-drawer" onClose={onClose}>
    <p className="rp-notice">Private preview: messages stay on this device and are not delivered to this professional.</p>
    <div className="rp-messages">{messages.filter(m=>m.recipientId===recipient.id).map(m=><article key={m.id}><p>{m.text}</p><small>{timeAgo(m.createdAt)} · Saved locally</small></article>)}</div>
    <form className="rp-compose" onSubmit={e=>{e.preventDefault();try{sendMessage(account,recipient.id,text);setText('');setError('');}catch(e){setError((e as Error).message);}}}><label htmlFor="rp-message">Message preview</label><div><textarea id="rp-message" rows={2} maxLength={1000} required value={text} onChange={e=>setText(e.target.value)}/><button className="rp-primary" disabled={!text.trim()} aria-label="Save message"><Send size={18}/></button></div>{error&&<p role="alert">{error}</p>}</form>
  </Modal>;
}
