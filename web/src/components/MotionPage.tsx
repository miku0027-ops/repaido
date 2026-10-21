import {useLayoutEffect,useRef,type ReactNode} from 'react';
import './motion-system.css';

/** Animate a destination change, never a refresh or a remounted account. */
export function MotionPage({step,children,className=''}:{step:string;children:ReactNode;className?:string}){
 const element=useRef<HTMLDivElement>(null),previous=useRef(step);
 useLayoutEffect(()=>{
  if(previous.current===step)return;
  previous.current=step;
  const node=element.current,media=matchMedia('(prefers-reduced-motion: reduce)');
  const reduced=()=>media.matches||!!node?.closest('.reduce-motion,[data-reduced-motion=true]')||document.documentElement.classList.contains('reduce-motion');
  if(!node||reduced()||!node.animate)return;
  const motion=node.animate([{opacity:.7,translate:'0 10px'},{opacity:1,translate:'0 0'}],{duration:260,easing:'cubic-bezier(.22,1,.36,1)'});
  const stop=()=>{if(reduced())motion.cancel();};
  media.addEventListener('change',stop);
  const observer=new MutationObserver(stop);observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','data-reduced-motion']});
  return()=>{motion.cancel();media.removeEventListener('change',stop);observer.disconnect();};
 },[step]);
 return <div ref={element} className={'motion-page '+className}>{children}</div>;
}
