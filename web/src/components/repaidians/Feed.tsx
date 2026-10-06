import {useState} from 'react';
import {Bookmark,ChevronLeft,ChevronRight,Heart,MessageCircle,Share2,Eye,Users} from 'lucide-react';
import type {CommunityActivity,CommunityMember,CommunityPost} from '../../types/repaidians';
import {Author,EmptyState,LocalLabel,Media,timeAgo,tradeName} from './common';
export function Feed({posts,activity,memberFor,onProfile,onLike,onSave,onComments,onShare,onCreate}:{posts:CommunityPost[];activity:CommunityActivity;memberFor:(id:string)=>CommunityMember;onProfile:(id:string)=>void;onLike:(id:string)=>void;onSave:(id:string)=>void;onComments:(id:string)=>void;onShare:(post:CommunityPost)=>void;onCreate:()=>void}) {
  if(!posts.length)return <EmptyState title="Room for a new perspective" onCreate={onCreate}>Follow a professional, explore another trade, or share your own work.</EmptyState>;
  return <div className="rp-feed">{posts.map(post=><PostCard key={post.id} post={post} activity={activity} member={memberFor(post.authorId)} onProfile={()=>onProfile(post.authorId)} onLike={()=>onLike(post.id)} onSave={()=>onSave(post.id)} onComments={()=>onComments(post.id)} onShare={()=>onShare(post)}/>)}</div>;
}
function PostCard({post,activity,member,onProfile,onLike,onSave,onComments,onShare}:{post:CommunityPost;activity:CommunityActivity;member:CommunityMember;onProfile:()=>void;onLike:()=>void;onSave:()=>void;onComments:()=>void;onShare:()=>void}) {
  const [slide,setSlide]=useState(0),[heart,setHeart]=useState(false),liked=activity.likes.includes(post.id),saved=activity.saved.includes(post.id);
  const doubleLike=()=>{if(!liked)onLike();setHeart(true);setTimeout(()=>setHeart(false),700);};
  return <article className="rp-post"><header><Author member={member} onOpen={onProfile}/><span className="rp-trade-badge">{tradeName(post.trade)}</span></header>
    <div className="rp-post-media" onDoubleClick={doubleLike}><Media asset={post.media[slide]}/>{heart&&<Heart className="rp-big-heart" size={64} fill="currentColor" aria-hidden="true"/>}{post.media.length>1&&<><span className="rp-slide-count">{slide+1}/{post.media.length}</span><div className="rp-carousel-controls"><button aria-label="Previous photo" disabled={slide===0} onClick={()=>setSlide(v=>v-1)}><ChevronLeft size={18}/></button><button aria-label="Next photo" disabled={slide===post.media.length-1} onClick={()=>setSlide(v=>v+1)}><ChevronRight size={18}/></button></div></>}</div>
    <div className="rp-post-body"><div className="rp-post-actions"><button aria-pressed={liked} aria-label={liked?'Unlike post':'Like post'} onClick={onLike}><Heart size={21} fill={liked?'currentColor':'none'}/>{liked&&<span>1</span>}</button><button aria-label="Open comments" onClick={onComments}><MessageCircle size={21}/></button><button aria-label="Share post" onClick={onShare}><Share2 size={20}/></button><button className="rp-save" aria-pressed={saved} aria-label={saved?'Unsave post':'Save post'} onClick={onSave}><Bookmark size={20} fill={saved?'currentColor':'none'}/></button></div>
      <LocalLabel sample={post.sample}/><p className="rp-caption"><strong>{member.name.split(' ')[0]}</strong> {post.caption}</p><footer><span>{post.visibility==='trade'?<Users size={12}/>:<Eye size={12}/>} {post.visibility==='trade'?'Your trade only':'Public preview'}</span><time dateTime={new Date(post.createdAt).toISOString()}>{timeAgo(post.createdAt)}</time></footer></div>
  </article>;
}
