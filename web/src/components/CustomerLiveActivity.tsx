import {useEffect,useRef,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {ArrowRight,Car,Clock,Radio,RefreshCw,TwoWheeler,Users,Wrench} from '../icons';
import {operation} from '../services/operations';
import {selectCustomerLiveActivity,type ActivitySources,type LiveActivityTarget} from '../services/customerLiveActivity';
import {pollDelay} from '../services/resilientReads.mjs';
import './customer-live-activity.css';
export type {LiveActivityTarget} from '../services/customerLiveActivity';
const paths={bike:'/bike-rides/bookings',ride:'/local-business/rides',shared:'/local-business/shared',job:'/jobs'} as const;
const fields={bike:'rides',ride:'rides',shared:'departures',job:'jobs'} as const;
const identity=()=>auth.currentUser?.uid?'firebase:'+auth.currentUser.uid:'local:'+(localStorage.getItem('repaido.token')||'');
/** One foreground reader is mounted on Home. Existing operation() requests and
 * snapshots coalesce with Bookings; no mutation or location request is made. */
export function CustomerLiveActivity({accountId,onOpen,onOpenAll,active=true,request=operation}:{accountId:string;onOpen:(target:LiveActivityTarget)=>void;onOpenAll?:()=>void;active?:boolean;request?:typeof operation}){
 const [revision,setRevision]=useState(0),[clock,setClock]=useState(Date.now()/1000),[online,setOnline]=useState(navigator.onLine),[state,setState]=useState<{account:string;identity:string;sources:ActivitySources;busy:boolean}>({account:'',identity:'',sources:{},busy:false});
 const latest=useRef(state);latest.current=state;const refresh=useRef<(force?:boolean)=>void>(()=>{}),authIdentity=useRef(identity());
 useEffect(()=>onIdTokenChanged(auth,()=>{const next=identity();if(next!==authIdentity.current){authIdentity.current=next;setRevision(value=>value+1);}}),[]);
 useEffect(()=>{
  const scope=identity(),firebaseUid=auth.currentUser?.uid;
  if(!active||!accountId||firebaseUid&&firebaseUid!==accountId||scope==='local:'){setState({account:accountId,identity:scope,sources:{},busy:false});return;}
  let alive=true,running=false,queued=false,failures=0,timer:ReturnType<typeof setTimeout>,debounce:ReturnType<typeof setTimeout>;
  setState({account:accountId,identity:scope,sources:{},busy:true});
  const owns=()=>alive&&identity()===scope&&(!auth.currentUser||auth.currentUser.uid===accountId);
  const load=async(force=false)=>{
   if(!owns())return;if(running){queued=queued||force;return;}
   clearTimeout(timer);
   if(document.hidden||!navigator.onLine){timer=setTimeout(()=>void load(),20000);return;}
   running=true;setState(prior=>prior.account===accountId&&prior.identity===scope?{...prior,busy:true}:prior);
   const keys=Object.keys(paths) as (keyof typeof paths)[];
   const results=await Promise.allSettled(keys.map(key=>request<Record<string,any>>(paths[key],{}, {background:true,feedback:false,force})));
   if(!owns())return;
   const previous=latest.current.account===accountId&&latest.current.identity===scope?latest.current.sources:{};
   const sources:ActivitySources={};let failed=false;
   results.forEach((result,index)=>{const key=keys[index];if(result.status==='fulfilled'){
    const value=result.value,receivedAt=Date.now()/1000;
    if(!Array.isArray(value[fields[key]])){failed=true;if(previous[key])sources[key]={...previous[key]!,error:'Update delayed'};return;}
    const rows=value[fields[key]];
    const reported=value.server_time||rows.find((row:Record<string,any>)=>Number.isFinite(row.server_time))?.server_time||rows.find((row:Record<string,any>)=>Number.isFinite(row.stop_status?.server_time))?.stop_status?.server_time;
    sources[key]={rows,receivedAt,serverTime:Number.isFinite(reported)?reported:receivedAt};
   }else{failed=true;const error=result.reason as Error&{status?:number};if(previous[key]&&![401,402,403,404].includes(error.status||0))sources[key]={...previous[key]!,error:'Update delayed'};}});
   failures=failed?failures+1:0;setState({account:accountId,identity:scope,sources,busy:false});setClock(Date.now()/1000);running=false;
   if(queued){queued=false;void load(true);return;}
   timer=setTimeout(()=>void load(),pollDelay(selectCustomerLiveActivity(sources,accountId).length?10000:20000,failures));
  };
  refresh.current=force=>{clearTimeout(debounce);debounce=setTimeout(()=>void load(force),force?0:200);};
  const changed=()=>refresh.current(true),visible=()=>{setOnline(navigator.onLine);if(!document.hidden&&navigator.onLine)refresh.current(false);};
  void load();const tick=setInterval(()=>{if(!document.hidden)setClock(Date.now()/1000);},1000);
  window.addEventListener('repaido:operations-updated',changed);window.addEventListener('repaido:bike-rides-updated',changed);window.addEventListener('focus',visible);window.addEventListener('online',visible);window.addEventListener('offline',visible);document.addEventListener('visibilitychange',visible);
  return()=>{alive=false;refresh.current=()=>{};clearTimeout(timer);clearTimeout(debounce);clearInterval(tick);window.removeEventListener('repaido:operations-updated',changed);window.removeEventListener('repaido:bike-rides-updated',changed);window.removeEventListener('focus',visible);window.removeEventListener('online',visible);window.removeEventListener('offline',visible);document.removeEventListener('visibilitychange',visible);};
 },[accountId,active,request,revision]);
 const safe=active&&state.account===accountId&&state.identity===identity()&&(!auth.currentUser||auth.currentUser.uid===accountId);
 const activities=safe?selectCustomerLiveActivity(state.sources,accountId,clock):[];
 if(!activities.length)return null;
 const visible=onOpenAll?activities.slice(0,3):activities;
 return <section className="customer-live-activity" aria-label="Your current activity"><header><h2><Radio size={18} aria-hidden="true"/>Happening now</h2><button type="button" className="customer-live-refresh" aria-label="Refresh current activity" disabled={state.busy||!online} onClick={()=>refresh.current(true)}><RefreshCw size={18} aria-hidden="true"/></button></header><div className="customer-live-rail">{visible.map(item=>{const stale=item.stale||!online,Icon=item.target.kind==='bike'?TwoWheeler:item.target.kind==='shared'?Users:item.target.kind==='job'?Wrench:Car;return <article key={item.key} className={'customer-live-card'+(stale?' is-stale':' is-'+item.mode)}><div className="customer-live-graphic" aria-hidden="true"><span className="customer-live-path"/><span className="customer-live-vehicle"><Icon size={38}/></span><i/><b/></div><div className="customer-live-content"><div className="customer-live-kind"><span>{item.type}</span>{stale&&<small>{!online?'Offline · last update':'Update delayed'}</small>}</div><h3>{stale?'Last known: ':''}{item.status}</h3><p className="customer-live-destination">{item.destination}</p><p className="customer-live-detail">{item.detail}</p><button type="button" className="customer-live-open" onClick={()=>{if(state.identity===identity())onOpen(item.target);}}>Open {item.target.kind==='job'?'booking':'ride'}<ArrowRight size={19} aria-hidden="true"/></button></div></article>;})}</div>{activities.length>visible.length&&onOpenAll&&<button type="button" className="customer-live-more" onClick={onOpenAll}><Clock size={16} aria-hidden="true"/>{activities.length-visible.length} more active bookings<ArrowRight size={16} aria-hidden="true"/></button>}</section>;
}
