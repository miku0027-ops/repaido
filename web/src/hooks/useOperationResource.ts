import {useCallback,useEffect,useRef,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {operation,operationSnapshot} from '../services/operations';

// Account-only memory snapshots render immediately. Background reads never put
// a populated panel back into its initial loading state or announce a save.
export function useOperationResource<T>(path:string,interval=15000){
 const [uid,setUid]=useState(auth.currentUser?.uid||'');
 const current=useRef({uid,path});current.current={uid,path};
 const epoch=useRef(0),running=useRef<Promise<void>|null>(null),queued=useRef(false);
 const [state,setState]=useState(()=>{
  const data=operationSnapshot<T>(path);
  return {uid,path,data,error:'',busy:!!uid&&!data,loaded:!!data};
 });
 const refresh=useCallback((force=true,foreground=true):Promise<void>=>{
  if(!uid||auth.currentUser?.uid!==uid)return Promise.resolve();
  if(running.current){if(force)queued.current=true;return running.current;}
  const revision=epoch.current;
  if(foreground)setState(prior=>({...prior,busy:true,error:''}));
  const request=operation<T>(path,{}, {background:true,force}).then(data=>{
   if(revision===epoch.current&&auth.currentUser?.uid===uid&&current.current.path===path)setState({uid,path,data,error:'',busy:false,loaded:true});
  }).catch((error:Error&{status?:number})=>{
   if(revision===epoch.current&&auth.currentUser?.uid===uid&&current.current.path===path)setState(prior=>({...prior,data:[401,402,403,404].includes(error.status||0)?null:prior.data,error:error.message,busy:false}));
  }).finally(()=>{if(running.current===request){running.current=null;if(queued.current){queued.current=false;void refresh(false,false);}}});
  running.current=request;return request;
 },[uid,path]);
 useEffect(()=>onIdTokenChanged(auth,user=>setUid(user?.uid||'')),[]);
 useEffect(()=>{
  epoch.current++;running.current=null;queued.current=false;
  const data=uid?operationSnapshot<T>(path):null;
  setState({uid,path,data,error:'',busy:!!uid&&!data,loaded:!!data});
  void refresh(false,false);
  const update=()=>{if(!document.hidden&&navigator.onLine)void refresh(false,false);};
  const timer=setInterval(update,interval);
  const changed=()=>{if(running.current)queued.current=true;update();};
  window.addEventListener('repaido:operations-updated',changed);window.addEventListener('focus',update);window.addEventListener('online',update);document.addEventListener('visibilitychange',update);
  return()=>{epoch.current++;running.current=null;queued.current=false;clearInterval(timer);window.removeEventListener('repaido:operations-updated',changed);window.removeEventListener('focus',update);window.removeEventListener('online',update);document.removeEventListener('visibilitychange',update);};
 },[uid,path,interval,refresh]);
 const same=state.uid===uid&&state.path===path&&auth.currentUser?.uid===uid;
 return {...(same?state:{uid,path,data:null,error:'',busy:!!uid,loaded:false}),uid,refresh};
}
