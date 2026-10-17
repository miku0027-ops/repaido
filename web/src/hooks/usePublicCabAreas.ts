import {useEffect,useState} from 'react';
import {apiFetch} from '../services/api';
import {parsePublicCabAreas,freshPublicCabAreas} from '../services/publicCabAreas.mjs';
import type {TransportArea} from '../components/TransportRail';

export type PublicCabArea={id:string;position:{lat:number;lng:number};available_count:number;updated_at:number;expires_at:number;approximation_metres:number};
type Snapshot={server_time:number;available_cabs:PublicCabArea[]};
type State={key:string;snapshot:Snapshot|null;receivedAt:number;status:'loading'|'ready'|'error'};

/** Foreground-only public reads; live areas never enter the catalogue cache. */
export function usePublicCabAreas(area:TransportArea|undefined,active:boolean,accountKey:string,revision:number){
 const [online,setOnline]=useState(navigator.onLine),[visible,setVisible]=useState(!document.hidden),[now,setNow]=useState(performance.now());
 const [state,setState]=useState<State>({key:'',snapshot:null,receivedAt:0,status:'loading'});
 const valid=area?.confirmed!==false&&Number.isFinite(area?.lat)&&Number.isFinite(area?.lng);
 const enabled=active&&valid&&online&&visible;
 const key=JSON.stringify([accountKey,area?.lat,area?.lng]);
 useEffect(()=>{
  const network=()=>{setOnline(navigator.onLine);if(!navigator.onLine)setState({key:'',snapshot:null,receivedAt:0,status:'loading'});};
  const visibility=()=>{setVisible(!document.hidden);if(document.hidden)setState({key:'',snapshot:null,receivedAt:0,status:'loading'});};
  window.addEventListener('online',network);window.addEventListener('offline',network);document.addEventListener('visibilitychange',visibility);
  return()=>{window.removeEventListener('online',network);window.removeEventListener('offline',network);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 useEffect(()=>{
  if(!enabled){setState({key:'',snapshot:null,receivedAt:0,status:'loading'});return;}
  let alive=true,timer:ReturnType<typeof setTimeout>|undefined;const controller=new AbortController();
  setState({key,snapshot:null,receivedAt:0,status:'loading'});
  const load=async()=>{
   const requestStarted=performance.now();
   try{
    const response=await apiFetch(`/api/operations/local-business/transport/available-cabs?lat=${area!.lat}&lng=${area!.lng}`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])},{background:true,feedback:false});
    if(!response.ok)throw Error('Live availability could not load.');
    const snapshot=parsePublicCabAreas(await response.json());
    // Count transport time conservatively so a slow response cannot extend a pin's expiry.
    if(alive){setNow(performance.now());setState({key,snapshot,receivedAt:requestStarted,status:'ready'});}
   }catch{if(alive)setState({key,snapshot:null,receivedAt:0,status:'error'});}
   finally{if(alive)timer=setTimeout(()=>void load(),20000);}
  };
  void load();
  return()=>{alive=false;controller.abort();if(timer)clearTimeout(timer);};
 },[enabled,key,revision]);
 const current=enabled&&state.key===key?state:null;
 const areas:PublicCabArea[]=current?.snapshot?freshPublicCabAreas(current.snapshot,current.receivedAt,now):[];
 useEffect(()=>{
  if(!current?.snapshot||!areas.length)return;
  const serverNow=current.snapshot.server_time+Math.max(0,now-current.receivedAt)/1000;
  const delay=Math.max(1,(Math.min(...areas.map(area=>area.expires_at))-serverNow)*1000+1);
  const timer=setTimeout(()=>setNow(performance.now()),delay);return()=>clearTimeout(timer);
 },[current,now]);
 return {areas,status:!enabled?'paused' as const:current?.status||'loading',enabled};
}
