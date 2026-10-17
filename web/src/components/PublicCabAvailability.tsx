import {useEffect,useRef,useState} from 'react';
import {ChevronDown,LocateFixed,MapPin,Square,DirectionsCar,HealthAndSafety} from '../icons';
import {auth} from '../firebase';
import {apiFetch} from '../services/api';
import './public-cab-availability.css';

type Vehicle={id:string;name:string;seats:number;vehicle_kind:string;eligible:boolean;reason:string;sharing:{enabled:boolean;version:number;expires_at:number;last_received_at:number;position_expires_at:number;location_status:string}};
type Availability={vehicles:Vehicle[];server_time:number;position_ttl_seconds:number;session_duration_seconds:number;approximation_metres:number};
type Phase='idle'|'starting'|'waiting'|'live'|'stopping'|'uncertain'|'error';
type Session={generation:number;uid:string;vehicleId:string;authorization:string;version:number;sessionToken:string;starting:boolean;stopped:boolean;watch:number|null;timer:ReturnType<typeof setInterval>|null;expiry:ReturnType<typeof setTimeout>|null;requests:Set<AbortController>;sequence:number;lastSent:number;sending:boolean;pinExpires:number;ttl:number;revoking:Promise<void>|null};
const endpoint='/api/operations/local-business';
async function request<T>(path:string,authorization:string,body?:object,options:{signal?:AbortSignal;keepalive?:boolean}={}):Promise<T>{
 const response=await apiFetch(endpoint+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+authorization,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),...options},{background:true,feedback:false});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Object.assign(new Error(data.detail?.message||(typeof data.detail==='string'?data.detail:null)||'Public availability could not be confirmed. Please retry.'),{status:response.status});
 return data as T;
}

/** Public discovery is a separate, explicit opt-in; it never starts private trip tracking. */
export function PublicCabAvailability({accountKey}:{accountKey:string}){
 const [data,setData]=useState<Availability|null>(null),[vehicleId,setVehicleId]=useState(''),[consent,setConsent]=useState(false),[parked,setParked]=useState(false);
 const [phase,setPhase]=useState<Phase>('idle'),[message,setMessage]=useState(''),[loadError,setLoadError]=useState(''),[loading,setLoading]=useState(true),[open,setOpen]=useState(false),[now,setNow]=useState(Date.now());
 const mounted=useRef(false),epoch=useRef(0),session=useRef<Session|null>(null),read=useRef<AbortController|null>(null),refreshRef=useRef<()=>Promise<void>>(async()=>{});
 const active=['starting','waiting','live','stopping'].includes(phase),selected=data?.vehicles.find(vehicle=>vehicle.id===vehicleId);
 const current=(value:Session)=>mounted.current&&session.current===value&&!value.stopped&&value.generation===epoch.current&&auth.currentUser?.uid===value.uid&&!document.hidden&&navigator.onLine;
 const update=(value:Session,next:Phase,text:string)=>{if(mounted.current&&session.current===value&&auth.currentUser?.uid===value.uid){setPhase(next);setMessage(text);}};
 const clearGps=(value:Session)=>{
  if(value.watch!==null)navigator.geolocation?.clearWatch(value.watch);
  if(value.timer)clearInterval(value.timer);if(value.expiry)clearTimeout(value.expiry);
  value.watch=null;value.timer=null;value.expiry=null;
  for(const controller of value.requests)controller.abort();value.requests.clear();
 };
 const revoke=async(value:Session,keepalive=false)=>{
  if(value.revoking)return value.revoking;
  if(!value.authorization||!value.starting&&!value.sessionToken)return;
  // A token-scoped revoke cannot stop a later session from another browser.
  // While Start is pending, a versioned revoke invalidates that pending consent.
  const body=value.sessionToken?{enabled:false,session_token:value.sessionToken}:{enabled:false,expected_version:value.version};
  const task=request<{enabled:boolean;version:number;status?:string}>('/vehicles/'+encodeURIComponent(value.vehicleId)+'/public-availability',value.authorization,body,{keepalive}).then(result=>{
   update(value,'idle',result.status==='superseded'?'This window’s GPS is off. A newer sharing session is controlled from the window that started it.':'Public sharing stopped. GPS is off.');
   if(mounted.current&&auth.currentUser?.uid===value.uid)void refreshRef.current();
  }).catch(()=>{
   update(value,'uncertain','GPS is off. Removal is not confirmed. Any last public pin expires within 75 seconds; retry removal when connected.');
  }).finally(()=>{value.revoking=null;});
  value.revoking=task;return task;
 };
 const stop=(reason='Stopping public sharing…',keepalive=false)=>{
  read.current?.abort();
  const value=session.current;
  if(!value)return;
  value.stopped=true;epoch.current++;clearGps(value);
  if(mounted.current){setConsent(false);setParked(false);}
  update(value,'stopping',reason);void revoke(value,keepalive);
  // No start was sent: there is no remote session to remove.
  if(!value.starting&&!value.sessionToken)update(value,'idle','GPS is off. Public sharing was not started.');
 };
 refreshRef.current=async()=>{
  const scope=accountKey,controller=new AbortController();read.current?.abort();read.current=controller;
  if(!scope||auth.currentUser?.uid!==scope)return;
  try{
   const token=await auth.currentUser.getIdToken();
   if(controller.signal.aborted||auth.currentUser?.uid!==scope)return;
   const result=await request<Availability>('/transport/public-availability',token,undefined,{signal:controller.signal});
   if(!mounted.current||controller.signal.aborted||auth.currentUser?.uid!==scope)return;
   setData(result);setVehicleId(prior=>result.vehicles.some(vehicle=>vehicle.id===prior)?prior:result.vehicles.find(vehicle=>vehicle.eligible)?.id||result.vehicles[0]?.id||'');setLoadError('');
  }catch(error){if(mounted.current&&!controller.signal.aborted&&auth.currentUser?.uid===scope)setLoadError((error as Error).message);}
  finally{if(mounted.current&&!controller.signal.aborted&&auth.currentUser?.uid===scope)setLoading(false);}
 };
 useEffect(()=>{
  mounted.current=true;session.current=null;epoch.current++;setData(null);setVehicleId('');setConsent(false);setParked(false);setPhase('idle');setMessage('');setLoading(true);
  void refreshRef.current();
  const refreshVisible=()=>{if(!document.hidden&&navigator.onLine&&auth.currentUser?.uid===accountKey)void refreshRef.current();};
  const suspend=()=>{if(document.hidden||!navigator.onLine||auth.currentUser?.uid!==accountKey)stop('GPS paused. Removing public availability…',true);else refreshVisible();};
  const leaving=()=>stop('GPS paused. Removing public availability…',true);
  document.addEventListener('visibilitychange',suspend);window.addEventListener('offline',suspend);window.addEventListener('pagehide',leaving);
  window.addEventListener('online',refreshVisible);window.addEventListener('focus',refreshVisible);
  const clock=setInterval(()=>{
   setNow(Date.now());
   if(auth.currentUser?.uid!==accountKey&&session.current&&!session.current.stopped)stop('Account changed. Removing public availability…',true);
  },1000);
  return()=>{mounted.current=false;read.current?.abort();stop('GPS paused. Removing public availability…',true);clearInterval(clock);document.removeEventListener('visibilitychange',suspend);window.removeEventListener('offline',suspend);window.removeEventListener('pagehide',leaving);window.removeEventListener('online',refreshVisible);window.removeEventListener('focus',refreshVisible);};
 },[accountKey]);
 const start=async()=>{
  if(active||phase==='uncertain'||!selected?.eligible||!consent||!parked)return;
  if(!window.isSecureContext||!navigator.geolocation){setPhase('error');setMessage('Use a secure browser with location access to share availability.');return;}
  if(document.hidden||!navigator.onLine||auth.currentUser?.uid!==accountKey){setPhase('error');setMessage('Keep this app open and connected to start sharing.');return;}
  const value:Session={generation:++epoch.current,uid:accountKey,vehicleId:selected.id,authorization:'',version:selected.sharing.version,sessionToken:'',starting:false,stopped:false,watch:null,timer:null,expiry:null,requests:new Set(),sequence:0,lastSent:0,sending:false,pinExpires:0,ttl:data?.position_ttl_seconds||75,revoking:null};
  session.current=value;setPhase('starting');setMessage('Confirming your public availability…');
  try{
   value.authorization=await auth.currentUser!.getIdToken();
   if(!current(value))return;
   value.starting=true;
   const requestedAt=Date.now();
   // Keep the response observable after navigation so a delayed success is revoked.
   const result=await request<{session_token:string;version:number;expires_at:number;server_time:number;position_ttl_seconds:number}>('/vehicles/'+encodeURIComponent(value.vehicleId)+'/public-availability',value.authorization,{enabled:true,consent:true,expected_version:value.version,request_id:crypto.randomUUID()});
   value.sessionToken=result.session_token;value.version=result.version;
   if(!current(value)){
    value.stopped=true;clearGps(value);
    // The earlier pending-version revoke may still be resolving. After it, revoke
    // only this exact late session, never another tab's newer availability.
    if(value.revoking)await value.revoking;
    await revoke(value,true);return;
   }
   value.starting=false;value.ttl=result.position_ttl_seconds||75;
   update(value,'waiting','Waiting for a fresh, accurate GPS fix. You are not shown on the map yet.');
   const failure=(error:GeolocationPositionError)=>{
    if(!current(value))return;
    stop(error.code===1?'Location permission was denied. Removing public availability…':'GPS is unavailable. Removing public availability…');
   };
   const publish=async(position:GeolocationPosition)=>{
    if(!current(value)||value.sending||Date.now()-value.lastSent<20000)return;
    const {latitude:lat,longitude:lng,accuracy}=position.coords,age=Date.now()-position.timestamp;
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||!Number.isFinite(accuracy)||accuracy<=0||accuracy>100||age>30000||age< -5000){update(value,'waiting','Waiting for GPS accurate to 100 m or better. No new public pin has been confirmed.');return;}
    const controller=new AbortController();value.requests.add(controller);value.sending=true;value.lastSent=Date.now();
    try{
     const received=await request<{status:string;server_time:number;position_expires_at:number}>('/vehicles/'+encodeURIComponent(value.vehicleId)+'/public-availability/position',value.authorization,{session_token:value.sessionToken,sequence:++value.sequence,lat,lng,accuracy,captured_at:position.timestamp/1000},{signal:controller.signal});
     if(!current(value))return;
     value.pinExpires=value.lastSent+Math.max(0,Math.min(value.ttl*1000,(received.position_expires_at-received.server_time)*1000));update(value,'live','Approximate public pin confirmed. Customers see your available cab, not your exact position.');
    }catch(error){
     if(!current(value))return;
     const status=(error as {status?:number}).status;
     if([401,403,404,409,410].includes(status||0))stop('Availability changed. Removing public sharing…');
     else update(value,'waiting','Update not confirmed. Any previous public pin expires within 75 seconds. Keep this app open or stop sharing.');
    }finally{value.requests.delete(controller);value.sending=false;}
   };
   const options:PositionOptions={enableHighAccuracy:true,maximumAge:0,timeout:20000};
   value.watch=navigator.geolocation.watchPosition(position=>void publish(position),failure,options);
   value.timer=setInterval(()=>{if(current(value)&&!value.sending)navigator.geolocation.getCurrentPosition(position=>void publish(position),failure,options);},20000);
   value.expiry=setTimeout(()=>stop('This 30-minute session ended. Removing public availability…'),Math.max(0,Math.min(1800000,(result.expires_at-result.server_time)*1000)-(Date.now()-requestedAt)));
  }catch(error){
   if(!current(value))return;
   clearGps(value);
   // A lost Start response may still have reached the server. Revoke its version
   // before allowing another attempt; do not report a successful stop prematurely.
   if(value.starting){value.stopped=true;update(value,'stopping','Start was not confirmed. Removing any pending public availability…');await revoke(value);}
   else update(value,'error',(error as Error).message);
  }
 };
 const stopExisting=async()=>{
  if(phase!=='uncertain'&&session.current&&!session.current.stopped&&(session.current.sessionToken||session.current.starting)){stop();return;}
  if(!selected||auth.currentUser?.uid!==accountKey)return;
  const value:Session={generation:++epoch.current,uid:accountKey,vehicleId:selected.id,authorization:'',version:selected.sharing.version,sessionToken:'',starting:true,stopped:true,watch:null,timer:null,expiry:null,requests:new Set(),sequence:0,lastSent:0,sending:false,pinExpires:0,ttl:75,revoking:null};
  session.current=value;setPhase('stopping');setMessage('Confirming public availability is removed…');
  try{
   value.authorization=await auth.currentUser.getIdToken();if(auth.currentUser?.uid!==accountKey)return;
   // This is a fresh, explicit Stop intent. Reload the current version so an
   // earlier lost Start receipt does not leave retries bound to an old version.
   const latest=await request<Availability>('/transport/public-availability',value.authorization);
   if(auth.currentUser?.uid!==accountKey||session.current!==value)return;
   const vehicle=latest.vehicles.find(row=>row.id===value.vehicleId);
   if(!vehicle)throw Error('Vehicle assignment changed.');
   value.version=vehicle.sharing.version;await revoke(value);
  }catch{update(value,'uncertain','GPS is off. Removal is not confirmed. Retry when connected; any last public pin expires within 75 seconds.');}
 };
 const fresh=phase==='live'&&!!session.current?.pinExpires&&now<session.current.pinExpires;
 const status=fresh?'Sharing approximate location':phase==='live'?'GPS update overdue':phase==='starting'?'Starting…':phase==='waiting'?'Waiting for GPS':phase==='stopping'?'Removing…':phase==='uncertain'?'Removal unconfirmed':selected?.sharing.enabled?'Review previous session':'Off until you choose';
 return <details className="public-cab-control" open={open} onToggle={event=>setOpen(event.currentTarget.open)} data-state={fresh?'live':phase}>
  <summary><span className="public-cab-control-emblem" aria-hidden="true"><DirectionsCar size={20}/></span><span><strong>Appear on the cab map</strong><small>{status}</small></span><ChevronDown size={18} aria-hidden="true"/></summary>
  <div className="public-cab-control-body">
   <p className="public-cab-privacy"><HealthAndSafety size={18} aria-hidden="true"/><span>Public discovery uses an approximate {data?.approximation_metres||450} m area pin. Private journey tracking stays separate.</span></p>
   {loading?<p role="status">Checking approved vehicle assignments…</p>:loadError?<div className="public-cab-notice" role="status"><p>{loadError}</p><button type="button" onClick={()=>{setLoading(true);void refreshRef.current();}}>Retry vehicle check</button></div>:<>
    {data?.vehicles.length?<label className="public-cab-vehicle">Your approved cab<select value={vehicleId} disabled={active||phase==='uncertain'} onChange={event=>{setVehicleId(event.target.value);setConsent(false);setParked(false);setMessage('');setPhase('idle');}}>{data.vehicles.map(vehicle=><option key={vehicle.id} value={vehicle.id}>{vehicle.name}{vehicle.eligible?'':' · unavailable'}</option>)}</select></label>:<p>Availability sharing needs an approved cab and its current approved driver. Review your vehicle assignment first.</p>}
    {selected&&!selected.eligible&&<p className="public-cab-notice">{selected.reason||'This cab is not currently eligible for public availability.'}</p>}
    {!active&&selected?.sharing.enabled&&<p className="public-cab-notice">A previous sharing session may still be active. GPS is not running in this window. Remove it or explicitly start a new session.</p>}
    {!active&&phase!=='uncertain'&&selected?.eligible&&<div className="public-cab-consents">
     <label><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/><span>I agree to show this cab’s approximate location publicly while available.</span></label>
     <label><input type="checkbox" checked={parked} onChange={event=>setParked(event.target.checked)}/><span>I am parked safely and ready to receive requests.</span></label>
    </div>}
    {(message||phase==='live')&&<p className="public-cab-notice" role="status">{phase==='live'&&!fresh?'No fresh GPS update is confirmed. The public pin disappears automatically after 75 seconds without updates.':message}</p>}
    <div className="public-cab-actions">
     {!active&&phase!=='uncertain'&&<button type="button" className="public-cab-start" disabled={!selected?.eligible||!consent||!parked||loading} onClick={()=>void start()}><LocateFixed size={16} aria-hidden="true"/>Share while available</button>}
     {(active||phase==='uncertain'||selected?.sharing.enabled)&&<button type="button" disabled={phase==='stopping'} onClick={()=>void stopExisting()}><Square size={14} aria-hidden="true"/>{phase==='uncertain'?'Retry removal':'Stop public sharing'}</button>}
    </div>
   </>}
   <small className="public-cab-footnote"><MapPin size={14} aria-hidden="true"/>Only while this app is visible and connected. Pins expire after 75 seconds; consent ends after 30 minutes. Sharing does not guarantee a booking.</small>
  </div>
 </details>;
}
