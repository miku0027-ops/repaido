import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Bell,Bookmark,BriefcaseBusiness,Building2,Check,ChevronRight,ClipboardList,ImagePlus,RefreshCw,Share2,SlidersHorizontal,UserRound,Users,Video,Handshake} from '../../icons';
import {peekCommunityView,communityViewScope,professionalWorkspace,rememberCommunityView,subscribe,updatePartialProfile,type ProfessionalWorkspaceData} from '../../services/repaidiansService';
import type {StudioKind} from '../../types/repaidians';
import type {WorkMarketView} from './WorkAndMarket';
import {Avatar} from './common';
import './professional-workspace.css';

interface Props {accountKey:string;onView:(view:WorkMarketView)=>void;onProfile:()=>void;onSaved:()=>void;onPublish:(kind:StudioKind)=>void;onNotifications:()=>void;onOpenMember:(id:string)=>void;}
export function ProfessionalWorkspace(props:Props){
  const {accountKey,onView,onProfile,onSaved,onPublish,onNotifications,onOpenMember}=props;
  const [data,setData]=useState(()=>peekCommunityView<ProfessionalWorkspaceData>('workspace'));
  const [busy,setBusy]=useState(false),[action,setAction]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const sequence=useRef(0),controller=useRef<AbortController|null>(null),gate=useRef(false),alive=useRef(true);
  const refresh=useCallback(async(force=true)=>{
    controller.current?.abort();const abort=new AbortController();controller.current=abort;const seq=++sequence.current;
    setBusy(true);setError('');const owner=communityViewScope();
    try{const next=await professionalWorkspace(force,abort.signal);if(abort.signal.aborted||seq!==sequence.current||owner!==communityViewScope())return;setData(next);rememberCommunityView('workspace',next,owner);}
    catch(e){if(!abort.signal.aborted&&seq===sequence.current){if([401,402,403,404].includes((e as {status?:number}).status||0))setData(null);setError((e as Error).message);}}
    finally{if(!abort.signal.aborted&&seq===sequence.current)setBusy(false);}
  },[]);
  useEffect(()=>{
    alive.current=true;
    setData(peekCommunityView<ProfessionalWorkspaceData>('workspace'));void refresh(false);
    const stop=subscribe(change=>{if(change?.contentChanged!==false&&(!change?.path||/^\/(profile|network|publications|blocks|settings)/.test(change.path)))void refresh(true);});
    return()=>{alive.current=false;sequence.current++;controller.current?.abort();stop();};
  },[accountKey,refresh]);
  const ready=data?.member.workStatus==='available'||data?.member.workStatus==='open_to_work';
  const availability=async()=>{
    if(!data||gate.current)return;gate.current=true;setAction('availability');setError('');setNotice('');
    try{const next=await updatePartialProfile({workStatus:ready?'not_looking':'open_to_work'});if(!alive.current)return;setData(old=>old?{...old,member:next.member}:old);setNotice(ready?'Your availability is off.':'You are ready for work.');}
    catch(e){if(alive.current)setError((e as Error).message);}finally{gate.current=false;if(alive.current)setAction('');}
  };
  const shareProfile=async()=>{
    if(!data||gate.current)return;gate.current=true;setAction('share');setError('');setNotice('');
    const url=location.origin+'/?repaidians=1&repaidians-profile='+encodeURIComponent(data.member.id);
    try{if(navigator.share)await navigator.share({title:data.member.name+' on Repaidians',url});else{await navigator.clipboard.writeText(url);setNotice('Profile link copied.');}}
    catch(e){if((e as Error).name!=='AbortError')setError('Could not share the profile link. Please retry.');}finally{gate.current=false;setAction('');}
  };
  const tools=[
    {view:'jobs' as const,label:'Matching jobs',detail:'Find your next project',Icon:BriefcaseBusiness},
    {view:'applications' as const,label:'Applications',detail:'Reviews and joining offers',Icon:ClipboardList},
    {view:'contracts' as const,label:'Contracts',detail:'Proposals, teams and progress',Icon:Handshake},
    {view:'network' as const,label:'My network',detail:'Invitations and recommendations',Icon:Users},
    {view:'background' as const,label:'Professional background',detail:'Experience and featured work',Icon:UserRound},
    {view:'companies' as const,label:'Companies',detail:'Explore local businesses',Icon:Building2},
  ];
  return <section className="rp-professional-workspace" aria-label="Professional workspace">
    <header className="rp-workspace-heading"><div><span>Your professional workspace</span><h3>Your next step, in view.</h3></div><button type="button" aria-label="Refresh professional workspace" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={20} aria-hidden="true"/></button></header>
    {error&&<div className="rp-work-error" role="alert"><p>{error}</p><button type="button" onClick={()=>void refresh()}>Retry</button></div>}{notice&&<p className="rp-workspace-notice" role="status">{notice}</p>}
    {busy&&!data&&<p role="status">Opening your workspace…</p>}
    {data&&<>
      <section className="rp-workspace-identity"><Avatar member={data.member} size="large"/><div><strong>{data.member.name}</strong><span>{data.member.headline||'@'+data.member.handle}</span><button type="button" aria-pressed={ready} disabled={!!action} onClick={()=>void availability()}>{action==='availability'?'Updating availability…':ready?'Ready for work':'Set availability'}</button></div><button type="button" aria-label="Share professional profile" disabled={!!action} onClick={()=>void shareProfile()}><Share2 size={20} aria-hidden="true"/></button></section>
      <div className="rp-workspace-stats" aria-label="Professional activity"><div><strong>{data.stats.publications}</strong><span>Publications</span></div><div><strong>{data.stats.connections}</strong><span>Connections</span></div><div><strong>{data.stats.followers}</strong><span>Followers</span></div></div>
      <details className="rp-workspace-checklist"><summary><UserRound size={20} aria-hidden="true"/><span>Build your profile</span><strong>{data.completed} / {data.total}</strong></summary><p>Share the details that help people understand your work.</p><ul>{data.checklist.map(item=><li key={item.id}><span className="rp-workspace-check" data-complete={item.complete}>{item.complete?<Check size={16} aria-hidden="true"/>:<span aria-hidden="true"/>}</span><span>{item.label}{item.complete&&<small>Added</small>}</span>{!item.complete&&<button type="button" aria-label={item.label} onClick={()=>item.destination==='profile'?onProfile():item.destination==='publish'?onPublish('post'):onView('background')}><ChevronRight size={20} aria-hidden="true"/></button>}</li>)}</ul></details>
      {!!data.invitations.length&&<section className="rp-workspace-invitations"><div><h4>Connection invitations</h4><button type="button" onClick={()=>onView('network')}>Review<ArrowUpRight size={16} aria-hidden="true"/></button></div>{data.invitations.map(invite=>{const member=data.members.find(person=>person.id===invite.memberId);return member?<button className="rp-workspace-invitation" key={invite.id} onClick={()=>onOpenMember(member.id)}><Avatar member={member}/><span><strong>{member.name}</strong><small>{invite.note||member.headline||'Wants to connect'}</small></span><ChevronRight size={20} aria-hidden="true"/></button>:null;})}</section>}
    </>}
    <div className="rp-workspace-tools">{tools.map(tool=><button type="button" key={tool.view} onClick={()=>onView(tool.view)}><span className="rp-workspace-tool-icon"><tool.Icon size={20} aria-hidden="true"/></span><span><strong>{tool.label}</strong><small>{tool.detail}</small></span><ChevronRight size={16} aria-hidden="true"/></button>)}</div>
    <nav className="rp-workspace-shortcuts" aria-label="Publishing and saved work"><button onClick={()=>onPublish('post')}><ImagePlus size={20} aria-hidden="true"/>Share work</button><button onClick={()=>onPublish('reel')}><Video size={20} aria-hidden="true"/>Add a work video</button><button onClick={onSaved}><Bookmark size={20} aria-hidden="true"/>Saved posts</button><button onClick={onNotifications}><Bell size={20} aria-hidden="true"/>Updates</button><button onClick={()=>onView('preferences')}><SlidersHorizontal size={20} aria-hidden="true"/>Preferences</button></nav>
  </section>;
}
