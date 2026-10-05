import {useEffect,useState} from 'react';
export function RotatingNote({lines}:{lines:string[]}){
 const [index,setIndex]=useState(0),[paused,setPaused]=useState(false);
 useEffect(()=>{if(paused||lines.length<2)return;let timer:ReturnType<typeof setTimeout>;const tick=()=>{if(!document.hidden&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.documentElement.classList.contains('reduce-motion'))setIndex(i=>(i+1)%lines.length);timer=setTimeout(tick,2000+Math.random()*1000);};timer=setTimeout(tick,2500);return()=>clearTimeout(timer);},[paused,lines.length]);
 return <span className="rotating-note" onMouseEnter={()=>setPaused(true)} onTouchStart={()=>setPaused(true)}><span className="rotating-note-window"><span key={index}>{lines[index%lines.length]}</span></span></span>;
}
