import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Navigation} from 'lucide-react';
import {auth} from '../firebase';
import {business} from '../services/localBusiness';
import {currentPosition} from '../services/operations';

const SharingContext=createContext({managed:false,resume:()=>{}});
export const useScrapLocationManager=()=>useContext(SharingContext);

/** Keep an explicitly started journey live when its task sheet is closed. */
export function ScrapLocationProvider({rows,uid,children}:{rows:any[];uid:string;children:ReactNode}){
 const [error,setError]=useState(''),[retry,setRetry]=useState(0),epoch=useRef(0);
 const ids=rows.filter(row=>row.owner_id===uid&&row.tracking_consent&&['accepted','evaluated','agreed','payment_reported'].includes(row.state)).map(row=>row.id).sort();
 const key=JSON.stringify([uid,ids]);
 useEffect(()=>{
  const active=JSON.parse(key)[1] as string[],generation=++epoch.current;let running=false;const stopped=new Set<string>();setError('');
  if(!active.length||!uid)return;
  const publish=async()=>{
   if(running||document.hidden||!navigator.onLine||auth.currentUser?.uid!==uid||generation!==epoch.current||active.every(id=>stopped.has(id)))return;
   running=true;
   try{
    const position=await currentPosition(true);
    if(generation!==epoch.current||auth.currentUser?.uid!==uid)return;
    const failures:string[]=[];
    await Promise.all(active.filter(id=>!stopped.has(id)).map(async id=>{
     try{await business('/scrap/'+id+'/position',position,'POST',{feedback:false});}
     catch(problem){const status=(problem as {status?:number}).status;if([401,403,404,409].includes(status||0))stopped.add(id);failures.push((problem as Error).message);}
    }));
    if(generation===epoch.current)setError(failures[0]||'');
   }catch(problem){if(generation===epoch.current)setError((problem as Error).message);}
   finally{running=false;}
  };
  void publish();const timer=setInterval(()=>void publish(),8000);
  document.addEventListener('visibilitychange',publish);window.addEventListener('online',publish);
  return()=>{epoch.current++;clearInterval(timer);document.removeEventListener('visibilitychange',publish);window.removeEventListener('online',publish);};
 },[key,retry]);
 const resume=()=>setRetry(value=>value+1);
 return <SharingContext.Provider value={{managed:true,resume}}>{ids.length>0&&<aside className="scrap-sharing-banner" aria-label="Collection location sharing"><Navigation size={17} aria-hidden="true"/><span>{error||`Live location on for ${ids.length} collection${ids.length===1?'':'s'} while this app is open.`}</span>{error&&<button type="button" onClick={resume}>Retry location</button>}</aside>}{children}</SharingContext.Provider>;
}
