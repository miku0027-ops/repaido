import {useEffect,useRef,useState} from 'react';
import {Bookmark,ChevronLeft,ChevronRight,Heart,MessageCircle,Send,Users,MoreHorizontal,Flag,Trash2} from 'lucide-react';
import type {CommunityActivity,CommunityMember,CommunityPost} from '../../types/repaidians';
import {Author,EmptyState,LocalLabel,Media,timeAgo} from './common';
interface FeedProps {
  posts:CommunityPost[];activity:CommunityActivity;memberFor:(id:string)=>CommunityMember;
  onProfile:(id:string)=>void;onLike:(id:string)=>void;onSave:(id:string)=>void;
  onComments:(id:string)=>void;onShare:(post:CommunityPost)=>void;onCreate:()=>void;
  onDelete?:(id:string)=>void;onReport?:(id:string)=>void;currentMemberId?:string;
}
export function Feed({posts,activity,memberFor,onProfile,onLike,onSave,onComments,onShare,onCreate,onDelete,onReport,currentMemberId}:FeedProps) {
  if(!posts.length)return <EmptyState title="Your next inspiration starts here" onCreate={onCreate}>Follow people in your trade or share the work you’re proud of. New posts will appear here.</EmptyState>;
  return <div className="rp-feed">{posts.map(post=><PostCard key={post.id} post={post} activity={activity} member={memberFor(post.authorId)} own={currentMemberId===post.authorId} onProfile={()=>onProfile(post.authorId)} onLike={()=>onLike(post.id)} onSave={()=>onSave(post.id)} onComments={()=>onComments(post.id)} onShare={()=>onShare(post)} onDelete={onDelete?()=>onDelete(post.id):undefined} onReport={onReport?()=>onReport(post.id):undefined}/>)}</div>;
}
function PostCard({post,activity,member,own,onProfile,onLike,onSave,onComments,onShare,onDelete,onReport}:{post:CommunityPost;activity:CommunityActivity;member:CommunityMember;own:boolean;onProfile:()=>void;onLike:()=>void;onSave:()=>void;onComments:()=>void;onShare:()=>void;onDelete?:()=>void;onReport?:()=>void}) {
  const [slide,setSlide]=useState(0),[heart,setHeart]=useState(false),[expanded,setExpanded]=useState(false),[menu,setMenu]=useState(false);
  const liked=activity.likes.includes(post.id),saved=activity.saved.includes(post.id),start=useRef<{x:number;y:number}|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  useEffect(()=>{setSlide(0);setMenu(false);},[post.id]);
  const doubleLike=()=>{if(!liked)onLike();setHeart(true);clearTimeout(timer.current);timer.current=setTimeout(()=>setHeart(false),750);};
  const move=(direction:number)=>setSlide(value=>Math.max(0,Math.min(post.media.length-1,value+direction)));
  const captionLong=post.caption.length>160||post.caption.split('\n').length>2;
  const likeCount=post.likeCount??0,commentCount=post.commentCount??0;
  return <article className="rp-post"><header><Author member={member} onOpen={onProfile}/>{(onReport||(own&&onDelete))&&<div className="rp-post-options"><button aria-label="Post options" aria-expanded={menu} onClick={()=>setMenu(v=>!v)}><MoreHorizontal size={23}/></button>{menu&&<div className="rp-post-menu">{own&&onDelete&&<button onClick={()=>{setMenu(false);onDelete();}}><Trash2 size={17}/>Delete post</button>}{onReport&&<button onClick={()=>{setMenu(false);onReport();}}><Flag size={17}/>Report post</button>}<button onClick={()=>setMenu(false)}>Cancel</button></div>}</div>}</header>
    <div className="rp-post-media" onDoubleClick={e=>{if(!(e.target as HTMLElement).closest('button'))doubleLike();}} onTouchStart={e=>{start.current={x:e.touches[0].clientX,y:e.touches[0].clientY};}} onTouchEnd={e=>{if(!start.current)return;const dx=e.changedTouches[0].clientX-start.current.x,dy=e.changedTouches[0].clientY-start.current.y;start.current=null;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.3)move(dx<0?1:-1);}}>
      {post.media[slide]?<Media asset={post.media[slide]} controls={post.media[slide].kind==='video'}/>:<div className="rp-media-missing">Media unavailable</div>}{heart&&<Heart className="rp-big-heart" size={84} fill="currentColor" strokeWidth={1.5} aria-hidden="true"/>}{post.media.length>1&&<><span className="rp-slide-count" aria-label={'Photo '+(slide+1)+' of '+post.media.length}>{slide+1}/{post.media.length}</span><div className="rp-carousel-controls">{slide>0?<button aria-label="Previous photo" onClick={()=>move(-1)}><ChevronLeft size={19}/></button>:<span/>}{slide<post.media.length-1&&<button aria-label="Next photo" onClick={()=>move(1)}><ChevronRight size={19}/></button>}</div></>}
    </div>
    <div className="rp-post-body"><div className="rp-post-actions"><button className={liked?'rp-liked':''} aria-pressed={liked} aria-label={liked?'Unlike post':'Like post'} onClick={onLike}><Heart size={26} strokeWidth={1.7} fill={liked?'currentColor':'none'}/></button><button aria-label="Open comments" onClick={onComments}><MessageCircle size={26} strokeWidth={1.7}/></button><button aria-label="Share post" onClick={onShare}><Send size={25} strokeWidth={1.7}/></button>{post.media.length>1&&<span className="rp-carousel-dots" aria-label={'Photo '+(slide+1)+' of '+post.media.length}>{post.media.map((_,i)=><i key={i} className={i===slide?'active':''}/>)}</span>}<button className="rp-save" aria-pressed={saved} aria-label={saved?'Unsave post':'Save post'} onClick={onSave}><Bookmark size={25} strokeWidth={1.7} fill={saved?'currentColor':'none'}/></button></div>
      {likeCount>0&&<p className="rp-like-count">{likeCount.toLocaleString()} {likeCount===1?'like':'likes'}</p>}<LocalLabel sample={post.sample}/><p className={'rp-caption '+(!expanded&&captionLong?'rp-caption-clamped':'')}><strong className="rp-caption-author">{member.handle||member.name}</strong> {post.caption}</p>{captionLong&&<button className="rp-caption-expand" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'less':'more'}</button>}
      {commentCount>0&&<button className="rp-view-comments" onClick={onComments}>View {commentCount===1?'1 comment':'all '+commentCount.toLocaleString()+' comments'}</button>}
      <footer>{post.visibility==='trade'&&<span><Users size={12}/>Your trade</span>}<time dateTime={new Date(post.createdAt).toISOString()}>{timeAgo(post.createdAt)}</time></footer></div>
  </article>;
}
