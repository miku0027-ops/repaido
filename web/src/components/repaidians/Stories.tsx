import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Pause,Play,Plus,Send,Volume2,VolumeX} from 'lucide-react';
import {Modal} from '../ui';
import type {CommunityMember,CommunityStory} from '../../types/repaidians';
import {Avatar,LocalLabel,Media} from './common';
export function StoriesTray({stories,memberFor,onOpen,onCreate}:{stories:CommunityStory[];memberFor:(id:string)=>CommunityMember;onOpen:(id:string)=>void;onCreate:()=>void}) {
  const authors=[...new Set(stories.map(s=>s.authorId))];
  return <section className="rp-stories-section" aria-label="24-hour stories"><div className="rp-section-heading"><strong>On the job</strong><span>Stories · 24 hours</span></div><div className="rp-stories">
    <button className="rp-story-add" onClick={onCreate}><span><Plus size={23}/></span><small>Your story</small></button>
    {authors.map(id=>{const member=memberFor(id);return <button className="rp-story-button" key={id} onClick={()=>onOpen(stories.find(s=>s.authorId===id)!.id)} aria-label={'View '+member.name+' stories'}><span className="rp-story-ring"><Avatar member={member}/></span><small>{member.name.split(' ')[0]}</small></button>;})}
  </div></section>;
}
export function StoryViewer({stories,initialId,memberFor,onClose,onReply,suspended=false}:{stories:CommunityStory[];initialId:string;memberFor:(id:string)=>CommunityMember;onClose:()=>void;onReply:(member:CommunityMember,text:string)=>boolean;suspended?:boolean}) {
  const [index,setIndex]=useState(()=>Math.max(0,stories.findIndex(s=>s.id===initialId)));
  const [elapsed,setElapsed]=useState(0),[paused,setPaused]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('reduce-motion')),[held,setHeld]=useState(false),[hidden,setHidden]=useState(document.hidden),[muted,setMuted]=useState(true);
  const [reply,setReply]=useState('');
  const last=useRef(Date.now()),story=stories[index],duration=story?.media.kind==='video'?15000:6000;
  const next=()=>{if(index>=stories.length-1)onClose();else setIndex(v=>v+1);};
  useEffect(()=>{setElapsed(0);setReply('');last.current=Date.now();},[index]);
  useEffect(()=>{const visibility=()=>setHidden(document.hidden);document.addEventListener('visibilitychange',visibility);return()=>document.removeEventListener('visibilitychange',visibility);},[]);
  useEffect(()=>{
    last.current=Date.now();
    const interval=setInterval(()=>{const now=Date.now(),delta=now-last.current;last.current=now;if(!paused&&!held&&!hidden&&!suspended)setElapsed(value=>Math.min(duration,value+delta));},100);
    return()=>clearInterval(interval);
  },[paused,held,hidden,suspended,duration]);
  useEffect(()=>{if(elapsed>=duration)next();},[elapsed,duration]);
  if(!story)return null;
  const member=memberFor(story.authorId);
  return <Modal title={'Story by '+member.name} className="rp-dialog rp-story-viewer" onClose={onClose}>
    <div className="rp-story-progress" aria-label={'Story '+(index+1)+' of '+stories.length}>{stories.map((s,i)=><span key={s.id}><i style={{width:(i<index?100:i===index?elapsed/duration*100:0)+'%'}}/></span>)}</div>
    <div className="rp-story-header"><Avatar member={member}/><strong>{member.name}</strong><button onClick={()=>setPaused(v=>!v)} aria-label={paused?'Play story':'Pause story'}>{paused?<Play size={18}/>:<Pause size={18}/>}</button>{story.media.kind==='video'&&<button onClick={()=>setMuted(v=>!v)} aria-label={muted?'Unmute story':'Mute story'}>{muted?<VolumeX size={18}/>:<Volume2 size={18}/>}</button>}</div>
    <div className="rp-story-canvas" onPointerDown={()=>setHeld(true)} onPointerUp={()=>setHeld(false)} onPointerCancel={()=>setHeld(false)} onPointerLeave={()=>setHeld(false)}>
      <Media asset={story.media} active muted={muted} paused={paused||held||hidden||suspended} onEnded={next}/>
      <button className="rp-story-back" disabled={index===0} onClick={()=>setIndex(v=>v-1)} aria-label="Previous story"><ChevronLeft size={24}/></button>
      <button className="rp-story-next" onClick={next} aria-label="Next story"><ChevronRight size={24}/></button>
      <div className="rp-story-caption"><LocalLabel sample={story.sample}/><p>{story.caption}</p></div>
    </div>
    <form className="rp-compose" onSubmit={e=>{e.preventDefault();if(onReply(member,reply))setReply('');}}><label htmlFor="rp-story-reply">Reply to story</label><div><input id="rp-story-reply" required maxLength={1000} placeholder="Share a thought…" value={reply} onChange={e=>setReply(e.target.value)}/><button className="rp-primary" aria-label="Send story reply" disabled={!reply.trim()}><Send size={18}/></button></div></form>
    <small className="rp-fine">Hold the image to pause. Use the arrows to move between stories.</small>
  </Modal>;
}
