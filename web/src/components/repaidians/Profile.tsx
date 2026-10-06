import {useState} from 'react';
import {ArrowLeft,ArrowUpRight,MessageCircle,ShieldCheck,Star,UserPlus} from 'lucide-react';
import type {CommunityMember,CommunityPost,Trade} from '../../types/repaidians';
import {trades,updateProfile} from '../../services/repaidiansService';
import {Avatar,EmptyState,Media,tradeName} from './common';
export function Profile({account,member,self,posts,following,followingCount,followersCount,onBack,onFollow,onMessage,onBook,onCreate}:{account:string;member:CommunityMember;self:boolean;posts:CommunityPost[];following:boolean;followingCount:number;followersCount:number;onBack:()=>void;onFollow:()=>void;onMessage:()=>void;onBook:()=>void;onCreate:()=>void}) {
  const [name,setName]=useState(member.name),[trade,setTrade]=useState<Trade>(member.trade),[bio,setBio]=useState(member.bio),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const portfolio=posts.filter(p=>p.authorId===member.id).flatMap(p=>p.media.map((media,i)=>({media,id:p.id+'-'+i})));
  return <section className="rp-profile">
    {!self&&<button className="rp-back" onClick={onBack}><ArrowLeft size={17}/>Back to community</button>}
    <header className="rp-profile-header"><Avatar member={member} size="large"/><span className="rp-trade-badge">{tradeName(member.trade)}</span><h2>{member.name}{member.reviewed&&<ShieldCheck size={18} aria-label="Reviewed Repaido professional"/>}</h2><p>@{member.handle}</p><span className="rp-muted">{member.role}</span><p className="rp-profile-bio">{member.bio}</p></header>
    <div className="rp-profile-stats"><div><strong>{member.completedTasks??'—'}</strong><small>Completed tasks</small></div><div><strong>{member.rating!=null?<><Star size={14}/>{member.rating.toFixed(1)}</>:'—'}</strong><small>Work rating</small></div><div><strong>{followersCount}</strong><small>Followers here</small></div><div><strong>{followingCount}</strong><small>Following here</small></div></div>
    {member.reviewed&&<p className="rp-fine">Task counts and ratings come from the live Repaido directory. Social activity is local to this preview.</p>}
    {!self&&<div className="rp-profile-actions"><button className="rp-primary" aria-pressed={following} onClick={onFollow}><UserPlus size={17}/>{following?'Following':'Follow'}</button><button className="rp-secondary" onClick={onMessage}><MessageCircle size={17}/>Message</button><button className="rp-secondary" onClick={onBook}>Book service<ArrowUpRight size={17}/></button></div>}
    {self&&<details className="rp-edit-profile"><summary>Edit your local profile</summary><form onSubmit={e=>{e.preventDefault();try{updateProfile(account,name,trade,bio);setError('');setSaved(true);}catch(e){setError((e as Error).message);}}}><label>Name<input required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label><label>Your trade<select value={trade} onChange={e=>setTrade(e.target.value as Trade)}>{trades.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>About your work<textarea rows={3} maxLength={500} value={bio} onChange={e=>setBio(e.target.value)}/></label><button className="rp-primary">Save profile</button>{saved&&<p role="status">Local profile saved.</p>}{error&&<p role="alert">{error}</p>}</form></details>}
    <div className="rp-section-heading"><strong>Portfolio</strong><span>{portfolio.length} photos · preview</span></div>
    {portfolio.length?<div className="rp-portfolio">{portfolio.map(item=><figure key={item.id}><Media asset={item.media}/></figure>)}</div>:<EmptyState title="Let your work do the talking" onCreate={self?onCreate:undefined}>Published photo posts appear here as a square portfolio.</EmptyState>}
  </section>;
}
