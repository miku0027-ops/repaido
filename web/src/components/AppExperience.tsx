import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Sparkles,ShieldCheck,Wrench,Heart,Home,ShoppingBag} from 'lucide-react';
import {loadingState,getLoadingInterests} from '../services/loading';
import {loadingLabel,selectTip} from '../services/loadingMessages.mjs';
import RepaidoBrand from './RepaidoBrand';
import './app-experience.css';
export function AppExperience(){
 const pending=useSyncExternalStore(loadingState.subscribe,loadingState.getSnapshot);
 const [launch,setLaunch]=useState(()=>{
  try{
    if(/(company-admin|shop-admin)/.test(location.pathname))return false;
    const p=new URLSearchParams(location.search);
    return !(p.has('tab')||p.has('noSplash')||p.has('portal')||p.has('hiring')||p.has('booking')||p.has('home-plan'));
  }catch{return true;}
 }),[now,setNow]=useState(Date.now()),[turn,setTurn]=useState(0);
 const splash=useRef<HTMLDialogElement>(null),notice=useRef<HTMLDivElement>(null);
 const worker=location.pathname.startsWith('/worker');
 useEffect(()=>{
   const mark=(el:Element)=>{const images=el instanceof HTMLImageElement?[el]:Array.from(el.querySelectorAll('img'));for(const img of images)if(!img.complete)img.setAttribute('data-repaido-loading','true');};
   const settled=(event:Event)=>{if(event.target instanceof HTMLImageElement)event.target.removeAttribute('data-repaido-loading');};
   mark(document.body);document.addEventListener('load',settled,true);document.addEventListener('error',settled,true);
   const observer=new MutationObserver(changes=>{for(const change of changes){if(change.type==='attributes'&&change.target instanceof Element)mark(change.target);for(const node of change.addedNodes)if(node instanceof Element)mark(node);}});observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
   return()=>{observer.disconnect();document.removeEventListener('load',settled,true);document.removeEventListener('error',settled,true);};
 },[]);

 useEffect(()=>{if(!launch)return;const dialog=splash.current;dialog?.showModal();const timer=setTimeout(()=>{dialog?.close();setLaunch(false);},7000);return()=>{clearTimeout(timer);dialog?.close();};},[]);
 useEffect(()=>{if(!pending.length)return;const timer=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(timer);},[pending.length>0]);
 useEffect(()=>{const timer=setInterval(()=>setTurn(v=>v+1),6000);return()=>clearInterval(timer);},[]);
 const oldest=pending.filter(p=>now-p.started>=650).sort((a,b)=>a.started-b.started)[0];
 const active=!!oldest&&!launch;const slow=oldest&&now-oldest.started>10000;
 useEffect(()=>{const el=notice.current;if(!el)return;try{if(active&&!el.matches(':popover-open'))el.showPopover();else if(!active&&el.matches(':popover-open'))el.hidePopover();}catch{}},[active]);
 return <>{launch&&<dialog ref={splash} className="repaido-launch repaido-puja-launch" aria-labelledby="launch-heading" onCancel={e=>e.preventDefault()}><div className="launch-brand"><RepaidoBrand size="xl"/><span>Repair your living</span></div><div className="launch-photo"><img src="/images/puja-ready-home.jpg" alt="A welcoming home decorated for Durga Puja"/><span className="launch-season"><Sparkles size={14}/>Durga Puja Offers · Repaido Home</span></div><div className="launch-copy"><h1 id="launch-heading">A home ready to welcome Maa Durga.</h1><p>Explore festive home services and available Puja offers.</p><div className="launch-services">{[[Home,'Cleaning & repairs'],[Wrench,'Home projects'],[Heart,'Maid & family care'],[ShoppingBag,'Parts & rentals']].map(([Icon,label])=>{const Glyph=Icon as typeof Home;return <span key={String(label)}><Glyph size={16}/>{String(label)}</span>;})}</div><p className="launch-trust"><ShieldCheck size={15}/>Compare professionals. Review the scope. Choose your service.</p><div className="launch-progress" aria-label="Opening Repaido"><span/></div><small>{worker?'Preparing your workday…':'Preparing your Repaido experience…'}</small></div></dialog>}<div ref={notice} popover="manual" data-visible={active} className="repaido-loading-notice" role="status" aria-live="polite" aria-atomic="true"><span className="repaido-loading-art" aria-hidden="true">{active&&<svg className="loading-vector" viewBox="0 0 100 100" aria-hidden="true"><circle className="loading-vector-track" cx="50" cy="50" r="30"/><circle className="loading-vector-arc" cx="50" cy="50" r="30"/><circle className="loading-vector-dot" cx="50" cy="80" r="5"/></svg>}<span className="loading-static-mark"><Wrench size={36}/></span></span><div><strong>{slow?'Taking longer than usual. Please wait…':loadingLabel(oldest?.path||'')}</strong><p>{selectTip(oldest?.path||'',turn,getLoadingInterests(),worker)}</p></div></div></>;
}
