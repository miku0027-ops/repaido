import {useEffect,useRef,useState} from 'react';
import {ShieldCheck,User,ImageOff,Play} from 'lucide-react';
import type {CommunityMedia,CommunityMember} from '../../types/repaidians';
import {loadMedia,trades} from '../../services/repaidiansService';

export const tradeName=(trade: string)=>trades.find(t=>t.id===trade)?.name||trade;
export const money=(amount: number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(amount);
export function timeAgo(at: number) {
  const minutes=Math.max(0,Math.floor((Date.now()-at)/60000));
  return minutes<1?'Just now':minutes<60?minutes+'m ago':minutes<1440?Math.floor(minutes/60)+'h ago':new Date(at).toLocaleDateString('en-IN',{day:'numeric',month:'short'});
}
export function Avatar({member,size='normal'}:{member:CommunityMember;size?:'normal'|'large'}) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[member.avatarUrl]);
  return <span className={'rp-avatar rp-avatar-'+size}>{member.avatarUrl&&!failed?<img src={member.avatarUrl} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<User size={size==='large'?32:20} aria-hidden="true"/>}</span>;
}
export function Author({member,onOpen}:{member:CommunityMember;onOpen:()=>void}) {
  return <button className="rp-author" onClick={onOpen}><Avatar member={member}/><span><strong>{member.name}{member.reviewed&&<ShieldCheck size={14} aria-label="Reviewed Repaido profile"/>}</strong><small>@{member.handle} · {tradeName(member.trade)}</small></span></button>;
}
export function Media({asset,active=false,muted=true,controls=false,paused=false,onEnded,className=''}:{asset:CommunityMedia;active?:boolean;muted?:boolean;controls?:boolean;paused?:boolean;onEnded?:()=>void;className?:string}) {
  const [url,setUrl]=useState(asset.url.startsWith('local-media:')?'':asset.url),[failed,setFailed]=useState(false);
  const video=useRef<HTMLVideoElement>(null);
  useEffect(()=>{
    let live=true,objectUrl='';
    setFailed(false);setUrl(asset.url.startsWith('local-media:')?'':asset.url);
    if(asset.url.startsWith('local-media:'))void loadMedia(asset.url).then(blob=>{if(!live)return;if(!blob){setFailed(true);return;}objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}).catch(()=>{if(live)setFailed(true);});
    return()=>{live=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[asset.url]);
  useEffect(()=>{
    const element=video.current;if(!element)return;
    element.muted=muted;
    if(active&&!paused)void element.play().catch(()=>{});else element.pause();
  },[active,paused,muted,url]);
  if(failed)return <div className="rp-media-missing" role="status"><ImageOff size={28}/><span>This media is unavailable on this device.</span></div>;
  if(!url)return <div className="rp-media-missing" role="status">Opening media…</div>;
  return asset.kind==='image'?<img className={'rp-media '+className} src={url} alt={asset.alt} loading="lazy" onError={()=>setFailed(true)}/>:<video ref={video} className={'rp-media '+className} src={url} controls={controls} muted={muted} playsInline preload="metadata" aria-label={asset.alt} onEnded={onEnded} onError={()=>setFailed(true)}/>;
}
export function EmptyState({title,children,onCreate}:{title:string;children:React.ReactNode;onCreate?:()=>void}) {
  return <div className="rp-empty"><span className="rp-empty-icon"><Play size={26}/></span><h2>{title}</h2><p>{children}</p>{onCreate&&<button className="rp-primary" onClick={onCreate}>Create something</button>}</div>;
}
export function LocalLabel({sample}:{sample:boolean}) {return <span className="rp-local-label">{sample?'Sample content':'Local post'} · preview only</span>;}
