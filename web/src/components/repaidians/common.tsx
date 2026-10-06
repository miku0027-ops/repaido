import {useEffect,useRef,useState} from 'react';
import {BadgeCheck,User,ImageOff,Camera} from 'lucide-react';
import type {CommunityMedia,CommunityMember} from '../../types/repaidians';
import {loadMedia,trades} from '../../services/repaidiansService';

export const tradeName=(trade: string)=>trades.find(t=>t.id===trade)?.name||trade;
export const money=(amount: number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(amount);
export function timeAgo(at: number) {
  const minutes=Math.max(0,Math.floor((Date.now()-at)/60000));
  return minutes<1?'Just now':minutes<60?minutes+'m ago':minutes<1440?Math.floor(minutes/60)+'h ago':new Date(at).toLocaleDateString('en-IN',{day:'numeric',month:'short'});
}
export function Avatar({member,size='normal'}:{member:CommunityMember;size?:'normal'|'large'}) {
  const {url,failed,setFailed}=useAssetUrl(member.avatarUrl);
  return <span className={'rp-avatar rp-avatar-'+size}>{url&&!failed?<img src={url} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<User size={size==='large'?32:20} aria-hidden="true"/>}</span>;
}
export function Author({member,onOpen}:{member:CommunityMember;onOpen:()=>void}) {
  return <button className="rp-author" onClick={onOpen} aria-label={'View '+member.name+' profile'}><Avatar member={member}/><span><strong>{member.handle||member.name}{member.reviewed&&<BadgeCheck size={15} aria-label="Reviewed Repaido profile"/>}</strong><small>{member.name} · {tradeName(member.trade)}</small></span></button>;
}
export function Media({asset,active=false,muted=true,controls=false,paused=false,loop=false,onEnded,className=''}:{asset:CommunityMedia;active?:boolean;muted?:boolean;controls?:boolean;paused?:boolean;loop?:boolean;onEnded?:()=>void;className?:string}) {
  const [visible,setVisible]=useState(false),container=useRef<HTMLDivElement>(null);
  const {url,failed,setFailed}=useAssetUrl(asset.url,visible||active);
  const video=useRef<HTMLVideoElement>(null);
  useEffect(()=>{
    if(!('IntersectionObserver' in window)){setVisible(true);return;}
    const observer=new IntersectionObserver(([entry])=>{if(entry.isIntersecting){setVisible(true);observer.disconnect();}},{rootMargin:'160px'});
    if(container.current)observer.observe(container.current);
    return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    const element=video.current;if(!element)return;
    element.muted=muted;
    if(active&&!paused)void element.play().catch(()=>{});else element.pause();
  },[active,paused,muted,url]);
  return <div ref={container} className="rp-media-wrap">{failed?<div className="rp-media-missing" role="status"><ImageOff size={28}/><span>This media could not be loaded.</span></div>:!url?<div className="rp-media-missing" role="status">Opening media…</div>:asset.kind==='image'?<img className={'rp-media '+className} src={url} alt={asset.alt} loading="lazy" onError={()=>setFailed(true)}/>:<video ref={video} className={'rp-media '+className} src={url} controls={controls} muted={muted} loop={loop} playsInline preload="metadata" aria-label={asset.alt} onEnded={onEnded} onError={()=>setFailed(true)}/>}</div>;
}
export function EmptyState({title,children,onCreate}:{title:string;children:React.ReactNode;onCreate?:()=>void}) {
  return <div className="rp-empty"><span className="rp-empty-icon"><Camera size={30}/></span><h2>{title}</h2><p>{children}</p>{onCreate&&<button className="rp-primary" onClick={onCreate}>Share your work</button>}</div>;
}
export function LocalLabel({sample}:{sample:boolean}) {return sample?<span className="rp-local-label">Sample content</span>:null;}

const protectedAsset=(url:string)=>url.startsWith('local-media:')||url.startsWith('/api/repaidians/media/');
function useAssetUrl(source:string,enabled=true) {
  const [url,setUrl]=useState(protectedAsset(source)?'':source),[failed,setFailed]=useState(false);
  useEffect(()=>{
    let live=true,objectUrl='';
    setFailed(false);setUrl(protectedAsset(source)?'':source);
    if(protectedAsset(source)&&enabled)void loadMedia(source).then(blob=>{if(!live)return;if(!blob){setFailed(true);return;}objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}).catch(()=>{if(live)setFailed(true);});
    return()=>{live=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[source,enabled]);
  return {url,failed,setFailed};
}
