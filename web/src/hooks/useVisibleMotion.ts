import {useEffect,useRef,useState} from 'react';

/** Decorative motion sleeps off screen and follows both app and system preferences. */
export function useVisibleMotion<T extends HTMLElement>(){
 const ref=useRef<T>(null),[active,setActive]=useState(false),[onscreen,setOnscreen]=useState(false);
 useEffect(()=>{
  const node=ref.current;if(!node)return;
  let visible=false;
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const sync=()=>{const shown=visible&&!document.hidden&&!node.closest('[hidden]');setOnscreen(shown);setActive(shown&&!media.matches&&!node.closest('.reduce-motion,[data-reduced-motion="true"]'));};
  const intersection=new IntersectionObserver(entries=>{visible=!!entries[0]?.isIntersecting;sync();});intersection.observe(node);
  const observer=new MutationObserver(sync);
  for(let parent=node.parentElement;parent;parent=parent.parentElement)observer.observe(parent,{attributes:true,attributeFilter:['class','hidden','data-reduced-motion']});
  media.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);
  return()=>{intersection.disconnect();observer.disconnect();media.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);};
 },[]);
 return {ref,active,visible:onscreen};
}
