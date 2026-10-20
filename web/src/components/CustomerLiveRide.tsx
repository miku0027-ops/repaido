import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {auth} from '../firebase';
import {useOperationResource} from '../hooks/useOperationResource';
import {bikeCommand,bikeFinished,bikeRideLabel,saveBikeSnapshot,type BikeRide} from '../services/bike-rides-api';
import {BikeRideDetail} from './BikeRides';
import {BikePickupAlert} from './BikePickupAlert';
import {RideBusinessRecords} from './LocalBusiness';
import {CustomerRideContext,ResumeRide,RideWorkspace,type RideKind} from './RideWorkspace';

const bikeRank:Record<string,number>={in_progress:0,arrived:1,on_the_way:2,accepted:3,completion_pending:4,payment_due:5,payment_reported:6,dispatch_pending:7,offered:8,queued:9,disputed:10};
const cabRank:Record<string,number>={in_progress:0,on_the_way:1,reserved:2,completion_pending:3,balance_due:4,accepted:5,requested:6,disputed:10};
const pendingBike=(ride:BikeRide)=>['dispatch_pending','offered'].includes(ride.state)||ride.state==='queued'&&!ride.accepted_by_driver;
const cabLabel=(state:string)=>({requested:'Waiting for acceptance',accepted:'Advance payment',reserved:'Pickup reserved',on_the_way:'To pickup',in_progress:'On the road',completion_pending:'Confirm arrival',balance_due:'Balance due',disputed:'Under review'}[state]||state.replaceAll('_',' '));

/** A single account-bound host keeps the current trip reachable from every
 * customer tab. Only explicit native commands change a booking. */
export function CustomerLiveRide({children,onHome}:{children:ReactNode;onHome?:()=>void}){
 const bikes=useOperationResource<{rides:BikeRide[];server_time?:number}>('/bike-rides/bookings',5000);
 const cabs=useOperationResource<{rides:any[]}>('/local-business/rides',10000);
 const uid=bikes.uid,scope=useRef(uid),commands=useRef(new Map<string,string>()),running=useRef(false);
 const [saved,setSaved]=useState<{uid:string;rides:BikeRide[]}>({uid,rides:[]});
 const [selection,setSelection]=useState<{uid:string;kind:RideKind;id:string}|null>(null),[minimized,setMinimized]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[online,setOnline]=useState(navigator.onLine),[clock,setClock]=useState(Date.now());
 const previousRide=useRef<{uid:string;kind:RideKind;id:string}|null>(null),[receipt,setReceipt]=useState<{uid:string;kind:RideKind;row:any}|null>(null);
 const serverClock=useRef({at:Date.now(),seconds:Date.now()/1000});
 useEffect(()=>{scope.current=uid;commands.current.clear();running.current=false;setBusy(false);setError('');setMinimized('');setSelection(null);setSaved({uid,rides:[]});},[uid]);
 useEffect(()=>{const seconds=bikes.data?.server_time||bikes.data?.rides.find(row=>row.server_time)?.server_time;if(seconds)serverClock.current={at:Date.now(),seconds};},[bikes.data]);
 useEffect(()=>{const update=()=>setOnline(navigator.onLine),timer=setInterval(()=>setClock(Date.now()),1000);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{clearInterval(timer);window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
 const open=useCallback((kind:RideKind,id:string)=>{const current=auth.currentUser?.uid;if(!current)return;setSelection({uid:current,kind,id});setMinimized('');},[]);
 const currentSaved=saved.uid===uid?saved.rides:[];
 const rows=auth.currentUser?.uid!==uid||[401,402,403,404].includes(bikes.errorStatus)?[]:(bikes.data?.rides||[]).reduce((all,row)=>saveBikeSnapshot(all,row),currentSaved);
 const bike=rows.filter(row=>!bikeFinished(row.state)&&bikeRank[row.state]!==undefined).sort((a,b)=>bikeRank[a.state]-bikeRank[b.state]||a.created_at-b.created_at);
 const cab=(cabs.data?.rides||[]).filter(row=>row.mode==='cab'&&row.customer_id===uid&&cabRank[row.state]!==undefined).sort((a,b)=>cabRank[a.state]-cabRank[b.state]||a.starts_at-b.starts_at);
 const chosen=selection?.uid===uid?selection:null;
 const selectedBike=chosen?.kind==='bike'?bike.find(row=>row.id===chosen.id):undefined,selectedCab=chosen?.kind==='cab'?cab.find(row=>row.id===chosen.id):undefined;
 const current=selectedBike?{kind:'bike' as const,row:selectedBike}:selectedCab?{kind:'cab' as const,row:selectedCab}:bike[0]&&cab[0]?(bikeRank[bike[0].state]<=cabRank[cab[0].state]?{kind:'bike' as const,row:bike[0]}:{kind:'cab' as const,row:cab[0]}):bike[0]?{kind:'bike' as const,row:bike[0]}:cab[0]?{kind:'cab' as const,row:cab[0]}:null;
 const key=current?uid+':'+current.kind+':'+current.row.id:'';
 useEffect(()=>{
  const previous=previousRide.current;
  if(current){setReceipt(null);previousRide.current={uid,kind:current.kind,id:current.row.id};return;}
  if(previous?.uid===uid&&auth.currentUser?.uid===uid){const finished=previous.kind==='bike'?rows.find(row=>row.id===previous.id):(cabs.data?.rides||[]).find(row=>row.id===previous.id);if(finished?.state==='completed')setReceipt({uid,kind:previous.kind,row:finished});}
  previousRide.current=null;
 },[uid,key,current?.row.state,current?.row.version]);
 // Queued customer records do not expose driver acceptance in every API
 // version. Only server-allowed cancellation is offered; dismissal never cancels.
 const locked=!!current&&(current.kind==='bike'?pendingBike(current.row):current.row.state==='requested');
 const show=!!uid&&!!current&&(locked||minimized!==key),status=current?(current.kind==='bike'?bikeRideLabel(current.row.state):cabLabel(current.row.state)):'';
 const run=async(ride:BikeRide,action:string,note?:string)=>{
  if(running.current||auth.currentUser?.uid!==uid)return false;running.current=true;setBusy(true);setError('');
  const fingerprint=JSON.stringify([ride.id,ride.version,action,note||'']);let command=commands.current.get(fingerprint);if(!command){command=crypto.randomUUID();commands.current.set(fingerprint,command);}
  try{const result=await bikeCommand(ride,action,command,note);if(scope.current!==uid||auth.currentUser?.uid!==uid)return false;setSaved(prior=>({uid,rides:saveBikeSnapshot(prior.uid===uid?prior.rides:[],result)}));commands.current.delete(fingerprint);await bikes.refresh();return true;}
  catch(cause){if(scope.current===uid){setError((cause as Error).message||'Could not update this ride. Retry with the latest status.');await bikes.refresh();}return false;}
  finally{if(scope.current===uid){running.current=false;setBusy(false);}}
 };
 const now=serverClock.current.seconds+(clock-serverClock.current.at)/1000;
 const readError=current?.kind==='bike'?bikes.error:cabs.error;
 const refresh=()=>{setError('');void bikes.refresh();void cabs.refresh();};
 const context=useMemo(()=>open,[open]);
 return <CustomerRideContext.Provider value={context}>
  {current&&!show&&<ResumeRide kind={current.kind} status={status} onOpen={()=>open(current.kind,current.row.id)}/>}
  {children}
  {uid&&current&&<RideWorkspace key={key} open={show} title={current.kind==='bike'?'Your bike ride':'Your cab ride'} kind={current.kind} status={status} locked={locked} onMinimize={()=>{if(!busy)setMinimized(key);}}>
   {(!online||readError||error)&&<div className="ride-workspace-read-error" role="status"><span>{!online?'You’re offline. Your ride stays here; reconnect for current location and actions.':error||'Could not refresh the ride. Last confirmed details are shown.'}</span><button type="button" disabled={busy||!online} onClick={refresh}>Retry ride status</button></div>}
   {current.kind==='bike'?<BikeRideDetail key={current.row.id} ride={current.row} serverNow={now} online={online} busy={busy} fullscreen onAction={run}/>:<RideBusinessRecords kind="rides" records={{rows:[current.row],uid:cabs.uid,error:'',busy:cabs.busy,loaded:cabs.loaded,refresh:()=>cabs.refresh()}} embedded workspace onSignIn={()=>{}}/>}
  </RideWorkspace>}
  {!current&&receipt?.uid===uid&&auth.currentUser?.uid===uid&&<RideWorkspace title="Ride complete" kind={receipt.kind} status="Completed" returnLabel="Back to home" onMinimize={()=>{setReceipt(null);onHome?.();}}>
   {receipt.kind==='bike'?<BikeRideDetail ride={receipt.row} serverNow={now} online={online} busy={false} fullscreen onAction={run}/>:<RideBusinessRecords kind="rides" records={{rows:[receipt.row],uid:cabs.uid,error:'',busy:false,loaded:true,refresh:()=>cabs.refresh()}} embedded workspace historyView/>}
   <div className="ride-receipt-actions"><button type="button" className="bike-primary" onClick={()=>{setReceipt(null);onHome?.();}}>Back to home</button></div>
  </RideWorkspace>}
  <BikePickupAlert key={uid} uid={uid} rides={rows} active={online&&!bikes.error&&!!uid} onOpen={id=>open('bike',id)}/>
 </CustomerRideContext.Provider>;
}
