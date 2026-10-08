import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {CheckCircle2,AlertCircle,Info,LoaderCircle,X} from 'lucide-react';
import {onIdTokenChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {loadingState} from '../services/loading';
import {loadingLabel} from '../services/loadingMessages.mjs';
import {actionFeedback,clearFeedback,dismissFeedback,notifyFeedback,type Feedback} from '../services/actionFeedback';
import './app-experience.css';

function FeedbackCard({item}:{item:Feedback}){
 const [paused,setPaused]=useState(false),[slow,setSlow]=useState(false);
 useEffect(()=>{setSlow(false);if(item.tone!=='pending')return;const timer=setTimeout(()=>setSlow(true),10000);return()=>clearTimeout(timer);},[item.id,item.tone]);
 useEffect(()=>{if(paused||item.tone==='pending'||item.tone==='error')return;const timer=setTimeout(()=>dismissFeedback(item.id),9000);return()=>clearTimeout(timer);},[item.id,item.at,item.tone,paused]);
 const Icon=item.tone==='pending'?LoaderCircle:item.tone==='success'?CheckCircle2:item.tone==='error'?AlertCircle:Info;
 return <div className="app-feedback-card" data-tone={item.tone} onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)} onFocus={()=>setPaused(true)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setPaused(false);}}>
  <Icon size={22} aria-hidden="true" className={item.tone==='pending'?'app-feedback-spinner':''}/>
  <div role={item.tone==='error'?'alert':'status'} aria-atomic="true"><strong>{item.title}</strong>{(item.message||slow)&&<p>{item.message||'Still waiting for confirmation…'}</p>}</div>
  {item.tone!=='pending'&&<button type="button" aria-label="Dismiss notification" onClick={()=>dismissFeedback(item.id)}><X size={18}/></button>}
 </div>;
}

// A manual popover occupies the browser's top layer, including above native dialogs.
// It never makes the page inert, takes focus, or closes a form.
export function AppExperience(){
 const items=useSyncExternalStore(actionFeedback.subscribe,actionFeedback.getSnapshot);
 const pending=useSyncExternalStore(loadingState.subscribe,loadingState.getSnapshot);
 const [now,setNow]=useState(Date.now()),host=useRef<HTMLDivElement>(null);
 const [portalTarget,setPortalTarget]=useState<Element>(document.body);
 useEffect(()=>{if(!pending.length)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(timer);},[pending.length>0]);
 const oldest=pending.find(p=>now-p.started>=650);
 const legacy=items.length===0&&oldest;
 const visible=items.length>0||!!legacy;
 useEffect(()=>{
  const sync=()=>setPortalTarget(Array.from(document.querySelectorAll('dialog[open]')).at(-1)||document.body);
  sync();const observer=new MutationObserver(sync);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
  return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  const node=host.current;if(!node||!visible)return;
  if(node.showPopover)node.showPopover();
  return()=>{if(node.matches(':popover-open'))node.hidePopover();};
 },[visible,portalTarget]);
 useEffect(()=>{let uid=auth.currentUser?.uid;return onIdTokenChanged(auth,user=>{if(user?.uid!==uid){uid=user?.uid;clearFeedback();}});},[]);
 useEffect(()=>{
  const invalid=(event:Event)=>{
   const field=event.target;if(!(field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement||field instanceof HTMLSelectElement))return;
   if(!field.hasAttribute('aria-invalid')){field.dataset.feedbackInvalid='true';field.setAttribute('aria-invalid','true');}
   const firstInvalid=field.form&&Array.from(field.form.elements).find(control=>control.matches('input:invalid,select:invalid,textarea:invalid'));
   if(firstInvalid&&firstInvalid!==field)return;
   const label=field.getAttribute('aria-label')||field.labels?.[0]?.textContent?.trim().split('\n')[0]?.slice(0,100)||'This field';
   notifyFeedback({tone:'error',title:'Check your details',message:`${label}: ${field.validationMessage}`},'validation');
  };
  const changed=(event:Event)=>{const field=event.target;if(field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement||field instanceof HTMLSelectElement){if(field.validity.valid&&field.dataset.feedbackInvalid){delete field.dataset.feedbackInvalid;field.removeAttribute('aria-invalid');}if(field.form&&!field.form.querySelector(':invalid'))clearFeedback('validation');}};
  const submitted=()=>clearFeedback('validation');
  document.addEventListener('invalid',invalid,true);document.addEventListener('input',changed,true);document.addEventListener('change',changed,true);document.addEventListener('submit',submitted,true);
  return()=>{document.removeEventListener('invalid',invalid,true);document.removeEventListener('input',changed,true);document.removeEventListener('change',changed,true);document.removeEventListener('submit',submitted,true);};
 },[]);
 return createPortal(<div ref={host} popover="manual" className="app-feedback-stack" role="region" aria-label="Action updates">{items.map(item=><FeedbackCard key={item.id} item={item}/>)}{legacy&&<div className="app-feedback-card" data-tone="pending" role="status"><LoaderCircle size={22} className="app-feedback-spinner" aria-hidden="true"/><div><strong>{loadingLabel(legacy.path)}</strong>{now-legacy.started>10000&&<p>Still waiting for confirmation…</p>}</div></div>}</div>,portalTarget);
}
