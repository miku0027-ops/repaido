import {useEffect,useRef} from 'react';
import {Check,MapPin,Search,Calendar,Tag,Send} from '../icons';
import type {AnimationItem} from 'lottie-web';
import './interaction-motion.css';

type Kind='search'|'location'|'success'|'offer'|'calendar'|'sending';
const fixed=(k:unknown)=>({a:0,k});
const tween=(from:number[],to:number[],end=26)=>({a:1,k:[{t:0,s:from,e:to,o:{x:[.22],y:[1]},i:{x:[.36],y:[1]}},{t:end,s:to}]});
const stroke=(color:number[])=>({ty:'st',c:fixed(color),o:fixed(100),w:fixed(4),lc:2,lj:2});
const line=(vertices:number[][])=>({ty:'sh',ks:fixed({i:vertices.map(()=>[0,0]),o:vertices.map(()=>[0,0]),v:vertices,c:false})});
/** Original local vector assets. No remote artwork, autoplay loop or tracking. */
function artwork(kind:Kind){
 if(kind==='offer'||kind==='calendar'||kind==='sending'){
  const ink=[.12,.23,.39,1],accent=[.85,.57,.09,1],blue=[.57,.76,1,1];
  const outline=(vertices:number[][],color=ink)=>[line(vertices),stroke(color)];
  const layer=(ind:number,shapes:unknown[],delay=0,rotation=0)=>({ddd:0,ind,ty:4,nm:kind+' '+ind,sr:1,ip:delay,op:48,st:0,bm:0,ks:{o:fixed(100),r:tween([rotation],[0],32),p:tween([32,36,0],[32,32,0],32),a:fixed([32,32,0]),s:tween([86,86,100],[100,100,100],32)},shapes});
  const trim={ty:'tm',s:fixed(0),e:tween([0],[100],32),o:fixed(0),m:1};
  const layers=kind==='offer'?[
   layer(1,[...outline([[15,18],[34,18],[51,35],[33,53],[15,35],[15,18]]),{ty:'el',p:fixed([23,26]),s:fixed([5,5])},stroke(accent)],0,-10),
   layer(2,[...outline([[30,34],[36,40],[44,31]],accent),trim],6),
  ]:kind==='calendar'?[
   layer(1,[{ty:'rc',p:fixed([32,34]),s:fixed([39,36]),r:fixed(6)},stroke(ink),...outline([[13,28],[51,28]]),...outline([[23,12],[23,21]]),...outline([[41,12],[41,21]])],0,-5),
   layer(2,[...outline([[23,39],[30,45],[42,34]],ink),trim],8),
  ]:[
   layer(1,[...outline([[11,48],[25,17],[53,14],[43,45],[11,48]],blue),...outline([[25,17],[29,35],[53,14]],blue)],0,-8),
   layer(2,[...outline([[8,28],[16,27]],blue),...outline([[6,37],[12,36]],blue),trim],5),
  ];
  return {v:'5.13.0',fr:30,ip:0,op:48,w:64,h:64,nm:'Repaido '+kind,ddd:0,assets:[],layers};
 }
 const color=kind==='success'?[.43,.91,.72,1]:[.57,.76,1,1];
 const circle={ty:'el',p:fixed([32,32]),s:fixed([48,48])};
 const shapes=kind==='success'?[circle,stroke(color),line([[21,32],[29,40],[43,24]]),stroke(color),{ty:'tm',s:fixed(0),e:tween([0],[100]),o:fixed(0),m:1}]:kind==='search'?[{ty:'el',p:fixed([27,27]),s:fixed([27,27])},stroke(color),line([[37,37],[49,49]]),stroke(color)]:[line([[32,52],[18,31],[18,20],[25,12],[39,12],[46,20],[46,31],[32,52]]),stroke(color),{ty:'el',p:fixed([32,25]),s:fixed([10,10])},stroke(color)];
 return {v:'5.13.0',fr:30,ip:0,op:36,w:64,h:64,nm:'Repaido '+kind,ddd:0,assets:[],layers:[{ddd:0,ind:1,ty:4,nm:kind,sr:1,ip:0,op:36,st:0,bm:0,ks:{o:fixed(100),r:kind==='search'?tween([-18],[0]):fixed(0),p:fixed([32,32,0]),a:fixed([32,32,0]),s:tween([78,78,100],[100,100,100])},shapes}]};
}

/** Decorative only: real state is always described by the adjacent text. */
export function InteractionMotion({kind,active=true}:{kind:Kind;active?:boolean}){
 const host=useRef<HTMLSpanElement>(null);
 useEffect(()=>{
  const node=host.current;if(!node)return;
  let alive=true,visible=false,animation:AnimationItem|undefined,ready=false,finished=false;
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const reduced=()=>media.matches||!!node.closest('.reduce-motion,[data-reduced-motion="true"]');
  const sync=()=>{
   if(!ready||!animation)return;
   const hidden=!active||document.hidden||!!node.closest('[hidden]')||!visible;
   if(reduced()){animation.goToAndStop(animation.totalFrames-1,true);node.dataset.motion='reduced';}
   else if(hidden||finished){animation.pause();node.dataset.motion=finished?'complete':'paused';}
   else{animation.play();node.dataset.motion='playing';}
  };
  const intersection=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting||false;sync();});intersection.observe(node);
  const observer=new MutationObserver(sync);
  for(let parent=node.parentElement;parent;parent=parent.parentElement)observer.observe(parent,{attributes:true,attributeFilter:['class','hidden','data-reduced-motion']});
  media.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);
  void import('lottie-web').then(({default:lottie})=>{
   if(!alive)return;
   animation=lottie.loadAnimation({container:node.querySelector('.interaction-motion-player')!,renderer:'svg',loop:false,autoplay:false,animationData:artwork(kind),rendererSettings:{progressiveLoad:false}});
   animation.addEventListener('DOMLoaded',()=>{if(!alive)return;ready=true;node.dataset.ready='true';sync();});
   animation.addEventListener('complete',()=>{finished=true;sync();});
  }).catch(()=>{/* Keep the static icon if the optional animation cannot load. */});
  return()=>{alive=false;intersection.disconnect();observer.disconnect();media.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);animation?.destroy();delete node.dataset.ready;delete node.dataset.motion;};
 },[kind,active]);
 const Icon=kind==='success'?Check:kind==='location'?MapPin:kind==='offer'?Tag:kind==='calendar'?Calendar:kind==='sending'?Send:Search;
 return <span ref={host} className="interaction-motion" data-kind={kind} aria-hidden="true"><Icon className="interaction-motion-fallback" size={24}/><span className="interaction-motion-player"/></span>;
}
