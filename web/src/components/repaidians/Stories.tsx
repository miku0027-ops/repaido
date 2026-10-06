import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Pause,Play,Plus,Send,Volume2,VolumeX,X} from 'lucide-react';
import {Modal} from '../ui';
import type {CommunityMember,CommunityStory} from '../../types/repaidians';
import {Avatar,LocalLabel,Media,timeAgo} from './common';
export function StoriesTray({stories,memberFor,onOpen,onCreate}:{stories:CommunityStory[];memberFor:(id:string)=>CommunityMember;onOpen:(id:string)=>void;onCreate:()=>void}) {
  const authors=[...new Set(stories.map(s=>s.authorId))];
  return <section className="rp-stories-section" aria-label="24-hour stories"><div className="rp-stories">
    <button className="rp-story-add" onClick={onCreate}><span><Plus size={27} strokeWidth={1.5}/></span><small>Your story</small></button>
    {authors.map(id=>{const member=memberFor(id);return <button className="rp-story-button" key={id} onClick={()=>onOpen(stories.find(s=>s.authorId===id)!.id)} aria-label={'View '+member.name+' stories'}><span className="rp-story-ring"><Avatar member={member}/></span><small>{member.handle||member.name.split(' ')[0]}</small></button>;})}
  </div></section>;
}
export function StoryViewer({stories,initialId,memberFor,onClose,onReply,suspended=false}:{stories:CommunityStory[];initialId:string;memberFor:(id:string)=>CommunityMember;onClose:()=>void;onReply:(member:CommunityMember,text:string)=>boolean|Promise<boolean>;suspended?:boolean}) {
  const [index,setIndex]=useState(()=>Math.max(0,stories.findIndex(s=>s.id===initialId)));
  const [elapsed,setElapsed]=useState(0),[paused,setPaused]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('reduce-motion')),[held,setHeld]=useState(false),[hidden,setHidden]=useState(document.hidden),[muted,setMuted]=useState(true);
  const [reply,setReply]=useState(''),[sending,setSending]=useState(false);
  const last=useRef(Date.now()),story=stories[index],duration=story?.media.kind==='video'?15000:6000;
  const next=()=>{if(index>=stories.length-1)onClose();else setIndex(v=>v+1);};
  useEffect(()=>{setElapsed(0);setReply('');last.current=Date.now();},[index]);
  useEffect(()=>{const visibility=()=>setHidden(document.hidden);document.addEventListener('visibilitychange',visibility);return()=>document.removeEventListener('visibilitychange',visibility);},[]);
  useEffect(()=>{
    last.current=Date.now();
    const interval=setInterval(()=>{const now=Date.now(),delta=now-last.current;last.current=now;if(!paused&&!held&&!hidden&&!suspended&&!sending)setElapsed(value=>Math.min(duration,value+delta));},100);
    return()=>clearInterval(interval);
  },[paused,held,hidden,suspended,sending,duration]);
  useEffect(()=>{if(elapsed>=duration)next();},[elapsed,duration]);
  useEffect(()=>{const keyboard=(event:KeyboardEvent)=>{if((event.target as HTMLElement)?.matches('input,textarea'))return;if(event.key==='ArrowRight'){event.preventDefault();next();}if(event.key==='ArrowLeft'&&index>0){event.preventDefault();setIndex(v=>v-1);}if(event.code==='Space'){event.preventDefault();setPaused(v=>!v);}};document.addEventListener('keydown',keyboard);return()=>document.removeEventListener('keydown',keyboard);},[index,stories.length]);
  if(!story)return null;
  const member=memberFor(story.authorId);
  return <Modal title={'Story by '+member.name} frameless className="rp-dialog rp-story-viewer" onClose={onClose}>
    <div className="rp-story-progress" aria-label={'Story '+(index+1)+' of '+stories.length}>{stories.map((s,i)=><span key={s.id}><i style={{width:(i<index?100:i===index?elapsed/duration*100:0)+'%'}}/></span>)}</div>
    <div className="rp-story-header"><Avatar member={member}/><div><strong>{member.handle||member.name}</strong><small>{timeAgo(story.createdAt)}</small></div><button onClick={()=>setPaused(v=>!v)} aria-label={paused?'Play story':'Pause story'}>{paused?<Play size={20}/>:<Pause size={20}/>}</button>{story.media.kind==='video'&&<button onClick={()=>setMuted(v=>!v)} aria-label={muted?'Unmute story':'Mute story'}>{muted?<VolumeX size={20}/>:<Volume2 size={20}/>}</button>}<button aria-label="Close story" data-autofocus onClick={onClose}><X size={25}/></button></div>
    <div className="rp-story-canvas" onPointerDown={()=>setHeld(true)} onPointerUp={()=>setHeld(false)} onPointerCancel={()=>setHeld(false)} onPointerLeave={()=>setHeld(false)}>
      <Media asset={story.media} active muted={muted} paused={paused||held||hidden||suspended||sending} onEnded={next}/>
      {index>0&&<button className="rp-story-back" onClick={()=>setIndex(v=>v-1)} aria-label="Previous story"><ChevronLeft size={26}/></button>}
      <button className="rp-story-next" onClick={next} aria-label="Next story"><ChevronRight size={26}/></button>
      <div className="rp-story-caption"><LocalLabel sample={story.sample}/><p>{story.caption}</p></div>
    </div>
    <form className="rp-compose rp-story-reply" onSubmit={async e=>{e.preventDefault();if(sending||!reply.trim())return;setSending(true);try{if(await onReply(member,reply))setReply('');}finally{setSending(false);}}}><label className="sr-only" htmlFor="rp-story-reply">Reply to {member.name}</label><div><input id="rp-story-reply" required maxLength={1000} placeholder={'Reply to '+member.name.split(' ')[0]+'…'} value={reply} onFocus={()=>setHeld(true)} onBlur={()=>setHeld(false)} onChange={e=>setReply(e.target.value)}/><button aria-label="Send story reply" disabled={!reply.trim()||sending} aria-busy={sending}><Send size={23}/></button></div></form>
  </Modal>;
}
