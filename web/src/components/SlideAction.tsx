import {useEffect,useId,useRef,useState,type CSSProperties,type PointerEvent} from 'react';
import {ArrowRight,Check,RefreshCw} from '../icons';
import './slide-action.css';

/** A deliberate drag action, with native button/keyboard and form validation. */
export function SlideAction({label,pendingLabel='Working…',disabled=false,busy=false,onComplete,submit=false,className='',describedBy}:{label:string;pendingLabel?:string;disabled?:boolean;busy?:boolean;onComplete?:()=>void|Promise<void>;submit?:boolean;className?:string;describedBy?:string}){
 const button=useRef<HTMLButtonElement>(null),gesture=useRef<{id:number;x:number;travel:number;progress:number}|null>(null),locked=useRef(false),mounted=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [progress,setProgress]=useState(0),[travel,setTravel]=useState(0),[dragging,setDragging]=useState(false),[confirmed,setConfirmed]=useState(false),help=useId();
 const reset=()=>{gesture.current=null;setDragging(false);setProgress(0);};
 useEffect(()=>{if(disabled||busy)reset();},[disabled,busy]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(timer.current)clearTimeout(timer.current);};},[]);
 const activate=async()=>{
  if(disabled||busy||locked.current)return;
  const form=submit?button.current?.form:null;
  if(submit&&(!form||!form.reportValidity())){reset();return;}
  locked.current=true;setConfirmed(true);setProgress(1);setDragging(false);
  try{if(submit)form!.requestSubmit();else await onComplete?.();}
  finally{if(mounted.current)timer.current=setTimeout(()=>{locked.current=false;setConfirmed(false);reset();},700);}
 };
 const start=(event:PointerEvent<HTMLButtonElement>)=>{
  if(disabled||busy||locked.current||event.button!==0)return;
  gesture.current={id:event.pointerId,x:event.clientX,travel:Math.max(1,event.currentTarget.clientWidth-66),progress:0};
  setTravel(gesture.current.travel);event.currentTarget.setPointerCapture(event.pointerId);setDragging(true);
 };
 const move=(event:PointerEvent<HTMLButtonElement>)=>{
  const current=gesture.current;if(!current||current.id!==event.pointerId)return;
  current.progress=Math.min(1,Math.max(0,(event.clientX-current.x)/current.travel));setProgress(current.progress);
 };
 const end=(event:PointerEvent<HTMLButtonElement>)=>{
  const current=gesture.current;if(!current||current.id!==event.pointerId)return;
  gesture.current=null;
  if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  if(current.progress>=.86)void activate();else reset();
 };
 return <div className={'ride-slide '+className} data-dragging={dragging} data-confirmed={confirmed} style={{'--slide-progress':progress,'--slide-travel':travel+'px'} as CSSProperties}>
  <button ref={button} type="button" className="ride-slide-control" aria-label={label} aria-describedby={[help,describedBy].filter(Boolean).join(' ')} aria-busy={busy} disabled={disabled||busy||confirmed}
   onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={reset} onLostPointerCapture={()=>{if(gesture.current)reset();}}
   onKeyDown={event=>{if(event.key==='Escape')reset();}} onClick={event=>{if(event.detail===0)void activate();}}>
   <span className="ride-slide-fill" aria-hidden="true"/>
   <span className="ride-slide-copy" aria-hidden="true"><strong>{busy?pendingLabel:confirmed?'Let’s go':label}</strong><small>{busy?'Please wait':confirmed?'Confirmed':'Slide to continue'}</small></span>
   <span className="ride-slide-knob" aria-hidden="true">{busy?<RefreshCw size={23}/>:confirmed?<Check size={25}/>:<ArrowRight size={25}/>}</span>
   <span className="ride-slide-chevron" aria-hidden="true">››</span>
  </button>
  <span id={help} className="sr-only">Drag to the right, or press Enter or Space to continue.</span>
 </div>;
}
