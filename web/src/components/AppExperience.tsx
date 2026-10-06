import {useEffect,useState,useSyncExternalStore} from 'react';
import {loadingState} from '../services/loading';
import {loadingLabel} from '../services/loadingMessages.mjs';
import './app-experience.css';

// Requests never take focus, block interaction or impose an artificial launch delay.
// Read screens own their skeleton/error state; slow writes get a quiet status.
export function AppExperience(){
  const pending=useSyncExternalStore(loadingState.subscribe,loadingState.getSnapshot);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(!pending.length)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(timer);},[pending.length>0]);
  const oldest=pending.filter(p=>now-p.started>=650).sort((a,b)=>a.started-b.started)[0];
  return oldest?<div className="repaido-request-status" role="status" aria-live="polite"><span className="repaido-request-dot" aria-hidden="true"/><span>{now-oldest.started>10000?'Still connecting. You can keep browsing.':loadingLabel(oldest.path)}</span></div>:null;
}
