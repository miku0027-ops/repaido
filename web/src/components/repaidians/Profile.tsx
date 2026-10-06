import {useRef,useState} from 'react';
import {ArrowLeft,ArrowUpRight,BadgeCheck,BriefcaseBusiness,Check,Film,Grid3X3,Link2,MapPin,MessageCircle,Star,UserPlus} from 'lucide-react';
import type {CommunityMember,CommunityPost,ProfessionalFields,Trade} from '../../types/repaidians';
import {CommunityError,normalizeProfileHandle,PROFILE_HANDLE_PATTERN,profileHandleError,suggestProfileHandle,storeMedia,trades,updateAvatar,updateProfile} from '../../services/repaidiansService';
import {ProfileSettings} from './ProfileSettings';
import {Avatar,EmptyState,Media,tradeName} from './common';

export const professionalTypes=[
  {id:'member',label:'Community member'},{id:'agent',label:'Agent'},{id:'specialist',label:'Specialist'},
  {id:'contractor',label:'Contractor'},{id:'shop_owner',label:'Shop owner'},
] as const;
export const workStatuses=[
  {id:'available',label:'Available for work'},{id:'open_to_work',label:'Open to work'},
  {id:'hiring',label:'Hiring'},{id:'not_looking',label:'Not looking for work'},
] as const;
export const professionalTypeName=(value?:string)=>professionalTypes.find(type=>type.id===value)?.label||'Community member';
export const workStatusName=(value?:string)=>workStatuses.find(status=>status.id===value)?.label||'';

export function Profile({account,member,self,posts,following,followingCount,followersCount,onBack,onFollow,onMessage,onBook,onCreate,onPublication,onBlock}:{account:string;member:CommunityMember;self:boolean;posts:CommunityPost[];following:boolean;followingCount:number;followersCount:number;onBack:()=>void;onFollow:()=>void;onMessage:()=>void;onBook:()=>void;onCreate:()=>void;onPublication?:(id:string)=>void;onBlock?:()=>void}) {
  const [handle,setHandle]=useState(member.handle);
  const handleInput=useRef<HTMLInputElement>(null);
  const [handleServerError,setHandleServerError]=useState('');
  const normalizedHandle=normalizeProfileHandle(handle);
  const handleChanged=normalizedHandle!==member.handle;
  const handleIssue=(handleChanged?profileHandleError(handle):'')||handleServerError;
  const handleSuggestion=handleIssue?suggestProfileHandle(handle):'';
  const [name,setName]=useState(member.name),[trade,setTrade]=useState<Trade>(member.trade),[bio,setBio]=useState(member.bio);
  const [headline,setHeadline]=useState(member.headline||''),[city,setCity]=useState(member.city||''),[skills,setSkills]=useState((member.skills||[]).join(', ')),[experience,setExperience]=useState(member.experienceYears?String(member.experienceYears):'');
  const [workStatus,setWorkStatus]=useState<ProfessionalFields['workStatus']>(member.workStatus||'not_looking'),[professionalType,setProfessionalType]=useState<ProfessionalFields['professionalType']>(member.professionalType||'member');
  const [error,setError]=useState(''),[saved,setSaved]=useState(false),[saving,setSaving]=useState(false),[uploading,setUploading]=useState(false),[grid,setGrid]=useState<'all'|'video'>('all');
  const authored=posts.filter(post=>post.authorId===member.id);
  const portfolio=authored.flatMap(post=>post.media.map((media,index)=>({media,id:post.id+'-'+index,publicationId:post.id,caption:post.caption}))).filter(item=>grid==='all'||item.media.kind==='video');
  const listingUpdates=grid==='all'?authored.filter(post=>!post.media.length&&post.reference):[];
  const changed=()=>{setSaved(false);setError('');};
  const save=async()=>{
    const parsedSkills=[...new Set(skills.split(',').map(skill=>skill.trim()).filter(Boolean))];
    if(parsedSkills.length>12||parsedSkills.some(skill=>skill.length>60))throw new Error('Add up to 12 skills, with no more than 60 characters per skill.');
    const years=experience.trim()===''?0:Number(experience);
    if(!Number.isInteger(years)||years<0||years>60)throw new Error('Enter whole years of experience between 0 and 60.');
    if(name.trim().length<2)throw new Error('Enter a display name with at least 2 characters.');
    await updateProfile(account,name.trim(),trade,bio,{headline:headline.trim(),city:city.trim(),skills:parsedSkills,experienceYears:years,workStatus,professionalType,...(handleChanged?{handle:normalizedHandle}: {})});
  };
  return <section className="rp-profile">
    <div className="rp-profile-title"><button className="rp-back" onClick={onBack} aria-label="Back to community"><ArrowLeft size={23}/></button><h2>{member.name}{member.reviewed&&<BadgeCheck size={19} aria-label="Reviewed Repaido professional"/>}</h2></div>
    <header className="rp-profile-header"><Avatar member={member} size="large"/><div className="rp-profile-stats"><div><strong>{member.postsCount??authored.length}</strong><small>posts</small></div><div><strong>{followersCount.toLocaleString()}</strong><small>followers</small></div><div><strong>{followingCount.toLocaleString()}</strong><small>following</small></div></div></header>
    <div className="rp-profile-details"><strong>{member.name}</strong><span className="rp-muted">@{member.handle}</span>
      {member.headline&&<p className="rp-professional-headline">{member.headline}</p>}
      <div className="rp-professional-facts"><span><BriefcaseBusiness size={15}/>{professionalTypeName(member.professionalType)} · {tradeName(member.trade)}</span>{member.city&&<span><MapPin size={15}/>{member.city}</span>}{!!member.experienceYears&&<span>{member.experienceYears} {member.experienceYears===1?'year':'years'} of experience</span>}</div>
      {member.workStatus&&<span className="rp-professional-status" data-status={member.workStatus}>{workStatusName(member.workStatus)}</span>}
      <p className="rp-profile-bio">{member.bio||'Building something worth sharing.'}</p>
      {!!member.skills?.length&&<div className="rp-professional-skills" aria-label="Skills">{member.skills.map(skill=><span key={skill}>{skill}</span>)}</div>}
      {member.professionalInfoSource==='profile'&&<small className="rp-fine">Professional details shared by this member.</small>}
      {member.reviewed&&(member.completedTasks!=null||member.rating!=null)&&<div className="rp-work-credentials">{member.completedTasks!=null&&<span><Check size={14}/>{member.completedTasks.toLocaleString()} completed jobs</span>}{member.rating!=null&&<span><Star size={14}/>{member.rating.toFixed(1)} work rating</span>}</div>}
    </div>
    {!self&&<div className="rp-profile-actions"><button className={following?'rp-secondary':'rp-primary'} aria-pressed={following} onClick={onFollow}>{following?<Check size={16}/>:<UserPlus size={16}/>} {following?'Following':'Follow'}</button><button className="rp-secondary" onClick={onMessage}><MessageCircle size={16}/>Message</button>{member.reviewed&&member.registeredId&&<button className="rp-secondary rp-book-profile" onClick={onBook}>Find services<ArrowUpRight size={16}/></button>}</div>}
    {!self&&onBlock&&<div className="rp-profile-safety"><button onClick={onBlock}>Block member</button></div>}
    {self&&<details className="rp-edit-profile"><summary>Edit profile</summary><form onSubmit={async event=>{event.preventDefault();if(saving||uploading)return;setSaving(true);setError('');setSaved(false);setHandleServerError('');try{await save();setSaved(true);}catch(error){if(error instanceof CommunityError&&['INVALID_HANDLE','HANDLE_TAKEN'].includes(error.code)){setHandleServerError(error.message);handleInput.current?.focus();}else setError((error as Error).message);}finally{setSaving(false);}}}>
      <label>Profile photo<input aria-label="Profile photo" aria-describedby="rp-avatar-help" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading||saving} onChange={async event=>{const file=event.target.files?.[0];if(!file)return;setError('');setSaved(false);setUploading(true);try{if(!/^image\/(jpeg|png|webp)$/.test(file.type))throw new Error('Choose a JPG, PNG or WebP profile photo.');if(file.size>2*1024*1024)throw new Error('Choose a profile photo up to 2 MB.');const [photo]=await storeMedia([file]);await updateAvatar(photo.url);setSaved(true);}catch(error){setError((error as Error).message);}finally{setUploading(false);event.target.value='';}}}/><small id="rp-avatar-help" className="rp-fine">JPG, PNG or WebP, up to 2 MB. Your new photo saves immediately.</small>{uploading&&<span role="status">Uploading your photo…</span>}</label>
      <div className="rp-profile-field"><label>Handle<input ref={handleInput} required minLength={3} maxLength={30} pattern={handleChanged?PROFILE_HANDLE_PATTERN:undefined} value={handle} onChange={event=>{setHandle(event.target.value.toLowerCase().replace(/^@/,''));setHandleServerError('');changed();}} onBlur={()=>setHandle(normalizeProfileHandle(handle))} onInvalid={()=>{setHandleServerError(profileHandleError(handle));setSaved(false);}} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={!!handleIssue} aria-describedby={`rp-handle-help${handleIssue?' rp-handle-error':''}`}/></label><small id="rp-handle-help" className="rp-fine">New handles use 3–30 letters, numbers, dots or underscores, starting with a letter or number. Your name below can include spaces.</small>{handleIssue&&<p id="rp-handle-error" className="rp-field-error" role="alert">{handleIssue}</p>}{handleSuggestion&&<button type="button" className="rp-secondary rp-handle-suggestion" onClick={()=>{setHandle(handleSuggestion);setHandleServerError('');changed();handleInput.current?.focus();}}>Use @{handleSuggestion}</button>}{handleSuggestion&&<small className="rp-fine">Availability is checked when you save.</small>}</div>
      {member.avatarUrl&&<button type="button" className="rp-secondary" disabled={saving||uploading} onClick={async()=>{setUploading(true);setError('');try{await updateAvatar('');setSaved(true);}catch(e){setError((e as Error).message);}finally{setUploading(false);}}}>Remove profile photo</button>}
      <label>Name<input required minLength={2} maxLength={100} value={name} onChange={event=>{setName(event.target.value);changed();}}/></label>
      <label>Headline<input maxLength={140} value={headline} onChange={event=>{setHeadline(event.target.value);changed();}} placeholder="Describe the work you do"/></label>
      <div className="rp-form-grid"><label>Your trade<select value={trade} onChange={event=>{setTrade(event.target.value as Trade);changed();}}>{trades.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>City<input maxLength={80} value={city} onChange={event=>{setCity(event.target.value);changed();}} autoComplete="address-level2"/></label></div>
      <div className="rp-form-grid"><label>Professional type<select value={professionalType} onChange={event=>{setProfessionalType(event.target.value as ProfessionalFields['professionalType']);changed();}}>{professionalTypes.map(type=><option key={type.id} value={type.id}>{type.label}</option>)}</select></label><label>Work status<select value={workStatus} onChange={event=>{setWorkStatus(event.target.value as ProfessionalFields['workStatus']);changed();}}>{workStatuses.map(status=><option key={status.id} value={status.id}>{status.label}</option>)}</select></label></div>
      <label>Years of experience<input type="number" min={0} max={60} step={1} value={experience} onChange={event=>{setExperience(event.target.value);changed();}}/></label>
      <label>Skills<input maxLength={730} aria-describedby="rp-profile-skills-help" value={skills} onChange={event=>{setSkills(event.target.value);changed();}}/></label><small id="rp-profile-skills-help" className="rp-fine">Separate up to 12 skills with commas.</small>
      <label>About your work<textarea rows={3} maxLength={500} value={bio} onChange={event=>{setBio(event.target.value);changed();}}/></label>
      <button className="rp-primary" disabled={saving||uploading} aria-busy={saving}>{saving?'Saving…':'Save profile'}</button>{saved&&<p role="status">Profile saved.</p>}{error&&<p className="rp-error" role="alert">{error}</p>}
    </form></details>}
    {self&&<ProfileSettings key={member.id}/>}
    <div className="rp-portfolio-tabs" role="group" aria-label="Portfolio content"><button aria-pressed={grid==='all'} onClick={()=>setGrid('all')}><Grid3X3 size={21}/><span>Posts</span></button><button aria-pressed={grid==='video'} onClick={()=>setGrid('video')}><Film size={21}/><span>Videos</span></button></div>
    {!!portfolio.length&&<div className="rp-portfolio">{portfolio.map(item=><figure key={item.id}>{onPublication?<button className="rp-portfolio-open" aria-label={'Open '+item.media.kind+' by '+member.name+(item.caption?': '+item.caption.slice(0,100):'')} onClick={()=>onPublication(item.publicationId)}><Media asset={item.media}/></button>:<Media asset={item.media}/>} {item.media.kind==='video'&&<Film className="rp-portfolio-kind" size={20} aria-label="Video"/>}</figure>)}</div>}
    {!!listingUpdates.length&&<section aria-label="Listing updates"><h3>Listing updates</h3>{listingUpdates.map(post=>{const card=post.referenceCard;const title=card?.title||'Listing unavailable';return <button className="rp-member-row" key={post.id} disabled={!onPublication} aria-label={'Open listing update: '+title} onClick={()=>onPublication?.(post.id)}><Link2 size={22}/><span><strong>{title}</strong><small>{card?card.kind==='tender'?'Tender update':card.kind==='job'?'Job update':'Product update':'The original listing is no longer available.'}</small></span><ArrowUpRight size={18}/></button>;})}</section>}
    {!portfolio.length&&!listingUpdates.length&&<EmptyState title={self?'Your work. Your story.':'A portfolio in the making'} onCreate={self?onCreate:undefined}>{self?'Share a photo, video or listing update and build a portfolio people can explore.':'This professional’s published work will appear here.'}</EmptyState>}
  </section>;
}
