import {useEffect,useRef,useState} from 'react';
import {Heart,MessageCircle,Pause,Play,Volume2,VolumeX,Zap} from 'lucide-react';
import type {CommunityMember,CommunityReel} from '../../types/repaidians';
import {Author,EmptyState,LocalLabel,Media} from './common';
export function Reels({reels,likes,memberFor,onLike,onComments,onProfile,onBook,onCreate}:{reels:CommunityReel[];likes:string[];memberFor:(id:string)=>CommunityMember;onLike:(id:string)=>void;onComments:(id:string)=>void;onProfile:(id:string)=>void;onBook:(reel:CommunityReel)=>void;onCreate:()=>void}) {
  const [muted,setMuted]=useState(true);
  if(!reels.length)return <EmptyState title="Labour in action" onCreate={onCreate}>Show the care behind the result. Add a vertical work video with a clear description; your reel is saved on this device.</EmptyState>;
  return <div className="rp-reels" aria-label="Work reels">{reels.map(reel=><ReelCard key={reel.id} reel={reel} member={memberFor(reel.authorId)} liked={likes.includes(reel.id)} muted={muted} onMute={()=>setMuted(v=>!v)} onLike={()=>onLike(reel.id)} onComments={()=>onComments(reel.id)} onProfile={()=>onProfile(reel.authorId)} onBook={()=>onBook(reel)}/>)}</div>;
}
function ReelCard({reel,member,liked,muted,onMute,onLike,onComments,onProfile,onBook}:{reel:CommunityReel;member:CommunityMember;liked:boolean;muted:boolean;onMute:()=>void;onLike:()=>void;onComments:()=>void;onProfile:()=>void;onBook:()=>void}) {
  const ref=useRef<HTMLElement>(null),[active,setActive]=useState(false),[paused,setPaused]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('reduce-motion')),[hidden,setHidden]=useState(document.hidden);
  useEffect(()=>{const observer=new IntersectionObserver(([entry])=>setActive(entry.isIntersecting&&entry.intersectionRatio>.6),{threshold:[0,.6,1]});if(ref.current)observer.observe(ref.current);const visibility=()=>setHidden(document.hidden);document.addEventListener('visibilitychange',visibility);return()=>{observer.disconnect();document.removeEventListener('visibilitychange',visibility);};},[]);
  return <article ref={ref} className="rp-reel"><Media asset={reel.media} active={active&&!hidden} paused={paused} muted={muted} controls/>
    <div className="rp-reel-top"><button onClick={onMute} aria-label={muted?'Unmute reel':'Mute reel'}>{muted?<VolumeX size={20}/>:<Volume2 size={20}/>}</button><button onClick={()=>setPaused(v=>!v)} aria-label={paused?'Play reel':'Pause reel'}>{paused?<Play size={20}/>:<Pause size={20}/>}</button></div>
    <div className="rp-reel-info"><Author member={member} onOpen={onProfile}/><LocalLabel sample={reel.sample}/><p>{reel.caption}</p><div className="rp-reel-actions"><button onClick={onLike} aria-pressed={liked} aria-label={liked?'Unlike reel':'Like reel'}><Heart size={20} fill={liked?'currentColor':'none'}/></button><button onClick={onComments} aria-label="Reel comments"><MessageCircle size={20}/></button><button className="rp-primary" onClick={onBook}><Zap size={16}/>Book a service</button></div></div>
  </article>;
}
