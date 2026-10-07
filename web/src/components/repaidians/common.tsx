import {useEffect,useId,useRef,useState,type RefObject} from 'react';
import {BadgeCheck,User,ImageOff,Camera,Check} from 'lucide-react';
import type {CommunityMedia,CommunityMember} from '../../types/repaidians';
import {communityMediaScope,loadMedia,mediaFreshUntil,subscribeCommunityMedia,trades} from '../../services/repaidiansService';
import {RepaidianBadge} from '../RepaidianBadge';

export const tradeName=(trade: string)=>trades.find(t=>t.id===trade)?.name||trade;
export const money=(amount: number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(amount);
export function timeAgo(at: number) {
  const minutes=Math.max(0,Math.floor((Date.now()-at)/60000));
  return minutes<1?'Just now':minutes<60?minutes+'m ago':minutes<1440?Math.floor(minutes/60)+'h ago':new Date(at).toLocaleDateString('en-IN',{day:'numeric',month:'short'});
}
export function Avatar({member,size='normal'}:{member:CommunityMember;size?:'normal'|'large'}) {
  const container=useRef<HTMLSpanElement>(null),visible=useVisibleAsset(container);
  const {url,failed,setFailed}=useAssetUrl(member.avatarUrl,visible);
  const initials=member.name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(name=>Array.from(name)[0]).join('').toLocaleUpperCase();
  const ready=member.workStatus==='available'||member.workStatus==='open_to_work';
  return <span ref={container} className={'rp-avatar-frame'+(ready?' rp-avatar-ready':'')}><span className={'rp-avatar rp-avatar-'+size}>{url&&!failed?<img src={url} alt="" loading="lazy" decoding="async" onError={()=>setFailed(true)}/>:initials?<span className="rp-avatar-initials" aria-hidden="true">{initials}</span>:<User size={size==='large'?32:20} aria-hidden="true"/>}</span><RepaidianBadge badge={member.repaidianBadge} variant="avatar"/>{ready&&<span className="rp-ready-badge" role="img" aria-label="Ready for work" title="Ready for work"><Check size={size==='large'?14:10} aria-hidden="true"/></span>}</span>;
}
export function Author({member,onOpen}:{member:CommunityMember;onOpen:()=>void}) {
  const reviewedId=useId(),detail=(member.handle?'@'+member.handle+' · ':'')+tradeName(member.trade);
  return <button className="rp-author" onClick={onOpen} aria-label={'View '+member.name+' profile'} aria-describedby={member.reviewed?reviewedId:undefined}><Avatar member={member}/><span className="rp-author-details"><strong><span className="rp-author-name" title={member.name}>{member.name}</span>{member.reviewed&&<BadgeCheck size={15} aria-hidden="true"/>}</strong><small title={detail}>{detail}</small>{member.reviewed&&<span id={reviewedId} className="sr-only">Reviewed Repaido professional</span>}</span></button>;
}
export function Media({asset,active=false,muted=true,controls=false,paused=false,loop=false,onEnded,className=''}:{asset:CommunityMedia;active?:boolean;muted?:boolean;controls?:boolean;paused?:boolean;loop?:boolean;onEnded?:()=>void;className?:string}) {
  const container=useRef<HTMLDivElement>(null),visible=useVisibleAsset(container,asset.kind==='video'?'0px':'160px',asset.kind==='video'?.15:0);
  const {url,failed,setFailed}=useAssetUrl(asset.url,visible||active);
  const video=useRef<HTMLVideoElement>(null);
  useEffect(()=>{
    const element=video.current;if(!element)return;
    element.muted=muted;
    if(active&&!paused)void element.play().catch(()=>{});else element.pause();
  },[active,paused,muted,url]);
  return <div ref={container} className="rp-media-wrap">{failed?<div className="rp-media-missing" role="status"><ImageOff size={28}/><span>This media could not be loaded.</span></div>:!url?<div className="rp-media-missing" role="status">Opening media…</div>:asset.kind==='image'?<img className={'rp-media '+className} src={url} alt={asset.alt} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>:<video ref={video} className={'rp-media '+className} src={url} controls={controls} muted={muted} loop={loop} playsInline preload="metadata" aria-label={asset.alt} onEnded={onEnded} onError={()=>setFailed(true)}/>}</div>;
}
export function EmptyState({title,children,onCreate}:{title:string;children:React.ReactNode;onCreate?:()=>void}) {
  return <div className="rp-empty"><span className="rp-empty-icon"><Camera size={30}/></span><h2>{title}</h2><p>{children}</p>{onCreate&&<button className="rp-primary" onClick={onCreate}>Share your work</button>}</div>;
}
export function LocalLabel({sample}:{sample:boolean}) {return sample?<span className="rp-local-label">Sample content</span>:null;}

const protectedAsset=(url:string)=>url.startsWith('local-media:')||url.startsWith('/api/repaidians/media/');
function useVisibleAsset<T extends HTMLElement>(container:RefObject<T|null>,rootMargin='160px',threshold=0){
  const [visible,setVisible]=useState(false);
  useEffect(()=>{
    if(!('IntersectionObserver' in window)){setVisible(true);return;}
    const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting&&entry.intersectionRatio>=threshold),{rootMargin,threshold:[0,threshold]});
    if(container.current)observer.observe(container.current);
    return()=>observer.disconnect();
  },[container,rootMargin,threshold]);
  return visible;
}
// Reuse decoded object URLs while the same authorized blob is mounted in
// several places. Release them when the last visible consumer leaves.
const objectUrls=new WeakMap<Blob,{url:string;references:number}>();
function leaseObjectUrl(blob:Blob){
  const entry=objectUrls.get(blob)||{url:URL.createObjectURL(blob),references:0};entry.references++;objectUrls.set(blob,entry);
  return {url:entry.url,release:()=>{entry.references--;if(!entry.references){URL.revokeObjectURL(entry.url);objectUrls.delete(blob);}}};
}
function useAssetUrl(source:string,enabled=true) {
  const scope=communityMediaScope(),[asset,setAsset]=useState({source,scope,url:protectedAsset(source)?'':source,freshUntil:0}),[failed,setFailed]=useState(false),[revision,setRevision]=useState(0);
  const [documentVisible,setDocumentVisible]=useState(document.visibilityState!=='hidden'),active=enabled&&documentVisible;
  useEffect(()=>subscribeCommunityMedia(()=>setRevision(value=>value+1)),[]);
  useEffect(()=>{
    const visibility=()=>setDocumentVisible(document.visibilityState!=='hidden');
    document.addEventListener('visibilitychange',visibility);return()=>document.removeEventListener('visibilitychange',visibility);
  },[]);
  useEffect(()=>{
    let live=true,release:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined;const controller=new AbortController();
    setFailed(false);setAsset({source,scope,url:active&&!protectedAsset(source)?source:'',freshUntil:0});
    if(protectedAsset(source)&&active)void loadMedia(source,controller.signal).then(blob=>{
      if(!live||scope!==communityMediaScope())return;if(!blob){setFailed(true);return;}
      const freshUntil=mediaFreshUntil(source,blob);
      // Recheck visible protected assets at the original authorization expiry.
      // Shared observers still make one request; warm mounts never renew it.
      if(freshUntil<=performance.now()){setRevision(value=>value+1);return;}
      const lease=leaseObjectUrl(blob);release=lease.release;setAsset({source,scope,url:lease.url,freshUntil});
      timer=setTimeout(()=>setRevision(value=>value+1),Math.max(0,freshUntil-performance.now()));
    }).catch(error=>{if(live&&scope===communityMediaScope()&&(error as Error).name!=='AbortError')setFailed(true);});
    return()=>{live=false;controller.abort();if(timer!==undefined)clearTimeout(timer);release?.();};
  },[source,active,scope,revision]);
  const fresh=!protectedAsset(source)||performance.now()<asset.freshUntil;
  return {url:active&&fresh&&asset.source===source&&asset.scope===scope?asset.url:'',failed,setFailed};
}
