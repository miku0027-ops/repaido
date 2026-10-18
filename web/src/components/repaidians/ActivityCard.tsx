import {useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,BriefcaseBusiness,CarFront,Check,CheckCircle2,ChevronDown,Clock,Home,Leaf,MapPin,RefreshCw,ShieldCheck,Star,Users} from '../../icons';
import type {CommunityMember,CommunityMilestone,CommunityPost} from '../../types/repaidians';
import type {Professional} from '../Hiring';
import {publicProfessionalDetails} from '../../services/hireProfileCache';
import {memberProfile} from '../../services/repaidiansService';
import {timeAgo} from './common';
import './activity-card.css';

type RecordDetails=Pick<Professional,'id'|'completed_tasks'|'rating'|'review_count'|'work_history'|'reviews'|'totals_scope'|'evidence_scope'>;
const recordDate=(at?:number)=>at&&Number.isFinite(at)?new Date(at*1000).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'Date not recorded';

/** A source-checked activity is separate from the author's review history. */
export function ActivityCard({milestone,member,now,onProfile}:{milestone:CommunityMilestone;member:CommunityMember;now:number;onProfile:()=>void}){
  const [open,setOpen]=useState(false),[record,setRecord]=useState<RecordDetails|null>(null),[updates,setUpdates]=useState<CommunityPost[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const request=useRef(0),loadedAt=useRef(0),recordId=useId();
  useEffect(()=>{setOpen(false);setRecord(null);setUpdates(null);setError('');setBusy(false);},[member.id,member.reviewed]);
  useEffect(()=>{
    if(!open||((record||updates)&&performance.now()-loadedAt.current<60000))return;
    const controller=new AbortController(),sequence=++request.current;let active=true;setBusy(true);setError('');setRecord(null);setUpdates(null);
    const load=member.reviewed?publicProfessionalDetails<RecordDetails>(member.id,controller.signal).then(data=>{if(active&&sequence===request.current){loadedAt.current=performance.now();setRecord(data);}}):memberProfile(member.id).then(data=>{if(active&&sequence===request.current){loadedAt.current=performance.now();setUpdates(data.posts.filter(post=>post.authorId===member.id&&post.milestoneCard).sort((a,b)=>b.createdAt-a.createdAt).slice(0,3));}});
    void load.catch(e=>{if(active&&!controller.signal.aborted)setError((e as Error).message||'Work records could not load. Please retry.');}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;controller.abort();};
  },[open,member.id,member.reviewed,attempt]);
  const fresh=!!milestone.checkedAt&&now-milestone.checkedAt<=90000&&now>=milestone.checkedAt-5000;
  const phase=milestone.phase||'scheduled',active=fresh&&phase==='active',recycling=['scrap','cleanup'].includes(milestone.source);
  const Icon=['cab','shared'].includes(milestone.source)?CarFront:milestone.source==='home'?Home:milestone.source==='hire'?Clock:recycling?Leaf:BriefcaseBusiness;
  const rating=record?record.rating:member.rating,completed=record?record.completed_tasks:member.completedTasks,count=record?record.review_count:member.reviewCount;
  const partial=record?.totals_scope?.complete===false||record?.evidence_scope?.complete===false;
  return <section className="rp-activity" aria-label={milestone.title+' activity'} data-phase={phase} data-current={active}>
    <div className="rp-activity-hero">
      <div className="rp-activity-topline"><span className="rp-activity-kind"><Icon size={18} aria-hidden="true"/>{milestone.participant||'Work update'}</span><span className="rp-activity-phase">{phase==='completed'?<CheckCircle2 size={14} aria-hidden="true"/>:<i aria-hidden="true"/>}{active?'In progress':phase==='completed'?'Completed':phase==='review'?'Under review':phase==='paused'?'Paused':fresh?'Update':'Last reported'}</span></div>
      <h3>{milestone.title}</h3><p className="rp-activity-status">{milestone.label}</p>
      <div className="rp-activity-meta">{milestone.city&&<span><MapPin size={14} aria-hidden="true"/>{milestone.city}</span>}<span><RefreshCw size={13} aria-hidden="true"/>{fresh?'Record checked '+timeAgo(milestone.checkedAt!):'Open profile for the latest record'}</span></div>
      {!!milestone.points_earned&&<span className="rp-activity-points"><Leaf size={14} aria-hidden="true"/>+{milestone.points_earned} verified points</span>}
    </div>
    <div className="rp-activity-trust" aria-label={'Credibility of '+member.name}>
      {member.reviewed?<><span><ShieldCheck size={16} aria-hidden="true"/>Profile reviewed</span><span><Star size={16} aria-hidden="true"/>{rating!=null&&Number.isFinite(rating)?<><strong>{rating.toFixed(1)}</strong> work rating{count!=null?' · '+count+' '+(count===1?'review':'reviews'):''}</>:'No work reviews yet'}</span><span><Check size={16} aria-hidden="true"/>{completed!=null?completed.toLocaleString()+' completed jobs':'Work history available'}</span></>:<span><Users size={16} aria-hidden="true"/>Community profile · explore their shared history</span>}
    </div>
    <div className="rp-activity-decisions"><button className="rp-activity-profile" onClick={onProfile} aria-label={'Explore '+member.name+' profile'}>Explore profile<ArrowRight size={16} aria-hidden="true"/></button><button className="rp-activity-record-toggle" onClick={()=>setOpen(value=>!value)} aria-expanded={open} aria-controls={open?recordId:undefined}>{open?'Close record':'Quick record'}<ChevronDown size={16} aria-hidden="true"/></button></div>
    {open&&<div className="rp-activity-record" id={recordId}>
      <h4>{member.reviewed?'Recent completed work':'Shared activity history'}</h4>
      {busy&&<p role="status">Checking public records…</p>}{error&&<div className="rp-activity-error" role="alert"><p>{error}</p><button onClick={()=>setAttempt(value=>value+1)}><RefreshCw size={16} aria-hidden="true"/>Retry records</button></div>}
      {record&&<><p className="rp-activity-record-note">Customer work ratings, separate from this activity.{partial?' Totals and examples cover the available recent records.':''}</p>{record.work_history?.length?<ul>{record.work_history.slice(0,3).map((work,index)=><li key={index}><span><strong>{work.service}</strong><small>{recordDate(work.completed_at)}</small></span>{work.rating!=null&&<span className="rp-activity-work-score"><Star size={14} aria-hidden="true"/>{work.rating}/5</span>}</li>)}</ul>:<p>No completed work records are available yet.</p>}{record.reviews?.find(review=>review.text)&&<blockquote><span><Star size={14} aria-hidden="true"/>Verified customer review</span><p>“{record.reviews.find(review=>review.text)!.text}”</p></blockquote>}</>}
      {updates&&(updates.length?<ul>{updates.map(post=><li key={post.id}><span><strong>{post.milestoneCard!.title}</strong><small>{post.milestoneCard!.label} · {timeAgo(post.createdAt)}</small></span></li>)}</ul>:<p>No other shared work updates are available.</p>)}
      <p className="rp-activity-record-note">A shared activity does not confirm availability. Review the full profile before choosing a service.</p>
    </div>}
    {recycling&&<a className="rp-activity-mission" href="/?tab=market&sub=scrap&scrap-view=report">Join the cleaner-city mission<ArrowRight size={16} aria-hidden="true"/></a>}
  </section>;
}
