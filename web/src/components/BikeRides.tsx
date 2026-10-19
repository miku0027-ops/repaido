import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {ArrowLeft,ArrowRight,ArrowDownUp,Bell,Check,CheckCircle2,ChevronDown,Clock3,Flag,MapPin,Phone,RefreshCw,Route,ShieldCheck,Ticket,TwoWheeler,UserRound} from '../icons';
import {money} from '../services/operations';
import type {BusinessLocation} from '../services/localBusiness';
import {bikeCommand,bikeFinished,bikeFreshPosition,bikePolicy,bikeQuoteExpired,bikeRideLabel,bikeStopInside,bookBike,getBikeRide,getBikeRides,mergeBikeSnapshots,saveBikeSnapshot,searchBikes,type BikePoint,type BikePolicy,type BikePromotion,type BikeQuote,type BikeRide} from '../services/bike-rides-api';
import {bindTransportBell,disableTransportBell,enableTransportBell,receiveTransportRequests,subscribeTransportBell,transportBellEnabled} from '../services/transportBell';
import {BikePhoneVerification} from './BikePhoneVerification';
import {JourneyMap} from './JourneyTracking';
import {LocationPickerModal} from './LocationPickerModal';
import {Modal} from './ui';
import type {TransportArea} from './TransportRail';
import type {TransportBookingSummary} from '../services/transport-booking-state';
import './bike-rides.css';

const time=(epoch:number)=>new Date(epoch*1000).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
const confirmedArea=(area?:TransportArea):BusinessLocation|null=>area?.confirmed&&typeof area.lat==='number'&&typeof area.lng==='number'&&Number.isFinite(area.lat)&&Number.isFinite(area.lng)?{lat:area.lat,lng:area.lng,address:area.address||'',city:area.city||''}:null;
const minutes=(seconds:number)=>`${Math.max(1,Math.ceil(seconds/60))} min`;
const message=(error:unknown)=>(error as Error).message||'Could not connect. Please retry.';
// Resume a current journey before an offer or outstanding cash receipt. This is
// used once per account; quiet refreshes must never interrupt route planning.
const resumePriority:Record<string,number>={in_progress:0,completion_pending:1,arrived:2,on_the_way:3,en_route:3,accepted:4,queued:5,offered:6,dispatch_pending:7,payment_due:8,payment_reported:9};
const resumeRide=(rides:BikeRide[])=>rides.reduce<BikeRide|undefined>((best,ride)=>resumePriority[ride.state]!==undefined&&(!best||resumePriority[ride.state]<resumePriority[best.state])?ride:best,undefined);

/** Participant records are kept only in this mounted account scope. Discovery
 * contains no other passenger's locations and never invents available riders. */
export function BikeRides({onSignIn,initialLocation,active=true,onSearch,onSharedBike,bookingsOnly=false,initialRideId='',embedded=false,historyView,onHistoryChange,onSummary}:{onSignIn:()=>void;initialLocation?:TransportArea;active?:boolean;onSearch?:()=>void;onSharedBike?:()=>void;bookingsOnly?:boolean;initialRideId?:string;embedded?:boolean;historyView?:boolean;onHistoryChange?:(history:boolean)=>void;onSummary?:(summary:TransportBookingSummary)=>void}){
 const [uid,setUid]=useState(auth.currentUser?.uid||''),[policy,setPolicy]=useState<BikePolicy|null>(null),[policyError,setPolicyError]=useState(''),[policyRevision,setPolicyRevision]=useState(0);
 const [pickup,setPickup]=useState<BusinessLocation|null>(confirmedArea(initialLocation)),[dropoff,setDropoff]=useState<BusinessLocation|null>(null),[picking,setPicking]=useState<'pickup'|'dropoff'|null>(null);
 const [verifyPhone,setVerifyPhone]=useState(false);
 const [other,setOther]=useState(false),[name,setName]=useState(auth.currentUser?.displayName||''),[phone,setPhone]=useState(auth.currentUser?.phoneNumber||'');
 const [route,setRoute]=useState<BikePoint[]>([]);
 const [quotes,setQuotes]=useState<BikeQuote[]>([]),[promotion,setPromotion]=useState<BikePromotion|null>(null),[searched,setSearched]=useState(false),[searchReason,setSearchReason]=useState(''),[selectedQuote,setSelectedQuote]=useState<BikeQuote|null>(null),[consent,setConsent]=useState(false);
 const [recordsLoaded,setRecordsLoaded]=useState(false),[nextCursor,setNextCursor]=useState<string|null>(null),[pageBusy,setPageBusy]=useState(false),[pageError,setPageError]=useState(''),[openingRide,setOpeningRide]=useState(false);
 const [rides,setRides]=useState<BikeRide[]>([]),[selectedId,setSelectedId]=useState(''),[localHistory,setLocalHistory]=useState(false),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[readError,setReadError]=useState(''),[notice,setNotice]=useState(''),[online,setOnline]=useState(navigator.onLine),[clock,setClock]=useState(Date.now());
 const expandedHistory=useRef(false),pinnedIds=useRef(new Set<string>()),openedInitial=useRef(''),resumeHandled=useRef(false),resumeIntent=useRef({bookingsOnly,initialRideId});resumeIntent.current={bookingsOnly,initialRideId};
 const scope=useRef(uid),revision=useRef(0),mutationRevision=useRef(0),requestKey=useRef(crypto.randomUUID()),commandKeys=useRef(new Map<string,string>()),serverClock=useRef({at:Date.now(),seconds:Date.now()/1000}),searchRunning=useRef(false),searchEpoch=useRef(0);
 const syncClock=(seconds?:number)=>{if(Number.isFinite(seconds))serverClock.current={at:Date.now(),seconds:seconds!};};
 const serverNow=serverClock.current.seconds+(clock-serverClock.current.at)/1000;
 const selected=rides.find(ride=>ride.id===selectedId),selection=useRef<BikeRide|undefined>(selected);selection.current=selected;
 const history=historyView??localHistory;
 const setHistory=(value:boolean)=>{setLocalHistory(value);onHistoryChange?.(value);};
 useEffect(()=>{const current=selection.current;if(historyView!==undefined&&current&&bikeFinished(current.state)!==historyView)setSelectedId('');},[historyView]);

 useEffect(()=>onIdTokenChanged(auth,user=>{
  const next=user?.uid||'';if(scope.current!==next){scope.current=next;setPickup(confirmedArea(initialLocation));setDropoff(null);setRoute([]);revision.current++;searchEpoch.current++;setRides([]);setRecordsLoaded(false);setNextCursor(null);setPageBusy(false);setPageError('');setOpeningRide(false);setVerifyPhone(false);expandedHistory.current=false;pinnedIds.current.clear();openedInitial.current='';resumeHandled.current=false;setSelectedId('');setQuotes([]);setSelectedQuote(null);setPromotion(null);setSearched(false);setError('');setReadError('');setNotice('');setOther(false);setName(user?.displayName||'');setPhone(user?.phoneNumber||'');setConsent(false);setBusy(false);setLoading(false);requestKey.current=crypto.randomUUID();commandKeys.current.clear();}setUid(next);
 }),[]);
 useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
 useEffect(()=>{if(!active)return;const tick=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(tick);},[active]);
 useEffect(()=>{
  if(!active||bookingsOnly)return;let stopped=false;const abort=new AbortController();
  const load=async()=>{try{const value=await bikePolicy(abort.signal);if(!stopped){setPolicy(value);setPolicyError('');}}catch(e){if(!stopped)setPolicyError(message(e));}};
  void load();window.addEventListener('online',load);return()=>{stopped=true;abort.abort();window.removeEventListener('online',load);};
 },[active,policyRevision,bookingsOnly]);
 useEffect(()=>{
  if(!uid||!active)return;let stopped=false,running=false;const abort=new AbortController(),epoch=revision.current;
  const refresh=async()=>{if(running||document.hidden||!navigator.onLine)return;running=true;const mutation=mutationRevision.current;try{const value=await getBikeRides(abort.signal);if(!stopped&&scope.current===uid&&revision.current===epoch&&mutationRevision.current===mutation){setRecordsLoaded(true);if(!resumeHandled.current){resumeHandled.current=true;const current=resumeRide(value.rides);if(current&&!resumeIntent.current.bookingsOnly&&!resumeIntent.current.initialRideId&&!selection.current)setSelectedId(current.id);}if(selection.current&&value.rides.find(ride=>ride.id===selection.current?.id)?.state!==selection.current.state)setNotice('');setRides(prior=>mergeBikeSnapshots(expandedHistory.current?prior:prior.filter(ride=>pinnedIds.current.has(ride.id)),value.rides));if(!expandedHistory.current)setNextCursor(value.next_cursor||null);syncClock(value.server_time||value.rides.find(ride=>ride.server_time)?.server_time);setReadError('');}}catch(e){if(!stopped&&scope.current===uid){setReadError(message(e));if((e as {status?:number}).status===401)setRides([]);}}finally{running=false;}};
  void refresh();const interval=setInterval(()=>void refresh(),3000);window.addEventListener('online',refresh);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);window.addEventListener('repaido:bike-rides-updated',refresh);
  return()=>{stopped=true;abort.abort();clearInterval(interval);window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('repaido:bike-rides-updated',refresh);};
 },[uid,active]);
 useEffect(()=>{const area=confirmedArea(initialLocation);if(area)setPickup(prior=>prior||area);},[initialLocation?.lat,initialLocation?.lng,initialLocation?.confirmed]);
 const invalidateRoute=()=>{searchEpoch.current++;setRoute([]);setQuotes([]);setSearched(false);setPromotion(null);setSelectedQuote(null);setConsent(false);setError('');setNotice('');requestKey.current=crypto.randomUUID();};
 const search=async(background=false)=>{
  if(!uid){onSignIn();return;}if(!pickup||!dropoff){setError('Choose your pickup and drop-off.');return;}if(!navigator.onLine){setError('Reconnect to check available riders.');return;}if(searchRunning.current)return;
  const epoch=revision.current,routeEpoch=searchEpoch.current;searchRunning.current=true;if(!background){setLoading(true);setError('');setNotice('');onSearch?.();}
  try{const result=await searchBikes(pickup,dropoff);if(scope.current===uid&&revision.current===epoch&&routeEpoch===searchEpoch.current){setQuotes(result.quotes);setRoute(result.route?.points||[]);setPromotion(result.promotion);setSearched(true);setSearchReason(result.reason||'');syncClock(result.server_time);setClock(Date.now());if(!background)setError('');}}
  catch(e){if(scope.current===uid&&revision.current===epoch&&routeEpoch===searchEpoch.current)setError(message(e));}finally{searchRunning.current=false;if(revision.current===epoch)setLoading(false);}
 };
 // Quotes are read-only, short lived snapshots. Reconnect and visibility resume
 // real matching; a rider is reserved only by an explicit reviewed request.
 useEffect(()=>{if(!active||!searched||selectedQuote||!uid||!pickup||!dropoff)return;const update=()=>{if(!document.hidden&&navigator.onLine)void search(true);};const interval=setInterval(update,20000);window.addEventListener('online',update);document.addEventListener('visibilitychange',update);return()=>{clearInterval(interval);window.removeEventListener('online',update);document.removeEventListener('visibilitychange',update);};},[active,searched,selectedQuote,uid,pickup,dropoff]);
 const saveRide=(ride:BikeRide)=>{pinnedIds.current.add(ride.id);mutationRevision.current++;setRecordsLoaded(true);setRides(prior=>saveBikeSnapshot(prior,ride));setSelectedId(ride.id);syncClock(ride.server_time);};
 useEffect(()=>{
  if(!initialRideId){openedInitial.current='';return;}if(!uid||!active)return;
  const key=uid+':'+initialRideId;if(openedInitial.current===key)return;openedInitial.current=key;
  let stopped=false;const abort=new AbortController(),epoch=revision.current;setOpeningRide(true);setSelectedId('');setError('');
  void getBikeRide(initialRideId,abort.signal).then(ride=>{if(!stopped&&scope.current===uid&&revision.current===epoch){saveRide(ride);if(embedded)onHistoryChange?.(bikeFinished(ride.state));}}).catch(e=>{if(!stopped&&scope.current===uid&&revision.current===epoch)setError(message(e));}).finally(()=>{if(!stopped&&revision.current===epoch)setOpeningRide(false);});
  return()=>{stopped=true;abort.abort();};
 },[uid,active,initialRideId]);
 const loadOlder=async()=>{
  if(!nextCursor||pageBusy||!uid||!navigator.onLine)return;const epoch=revision.current,cursor=nextCursor;setPageBusy(true);setPageError('');
  try{const result=await getBikeRides(undefined,cursor);if(scope.current===uid&&revision.current===epoch){expandedHistory.current=true;setRides(prior=>mergeBikeSnapshots(prior,result.rides));setNextCursor(result.next_cursor||null);}}
  catch(e){if(scope.current===uid&&revision.current===epoch)setPageError(message(e));}finally{if(revision.current===epoch)setPageBusy(false);}
 };
 const book=async()=>{
  if(!uid){onSignIn();return;}if(!selectedQuote||!pickup||!dropoff||!consent)return;
  if(bikeQuoteExpired(selectedQuote,serverClock.current.seconds+(Date.now()-serverClock.current.at)/1000)){setError('This quote expired. Check riders again for the latest fare.');return;}
  const epoch=revision.current;setBusy(true);setError('');
  try{const ride=await bookBike({quote_id:selectedQuote.id,request_id:requestKey.current,pickup_address:pickup.address,dropoff_address:dropoff.address,rider_name:name.trim(),rider_phone:phone.trim(),for_someone_else:other,consent:true});if(scope.current===uid&&revision.current===epoch){saveRide(ride);setSelectedQuote(null);setQuotes([]);setSearched(false);setNotice(ride.state==='dispatch_pending'?'Finding your rider. No slot or free ride is reserved until matching completes.':ride.queued?'Next ride requested. Your rider still needs to accept.':'Request sent. Waiting for your rider to accept.');}}
  catch(e){if(scope.current===uid&&revision.current===epoch)setError(message(e));}finally{if(revision.current===epoch)setBusy(false);}
 };
 const run=async(ride:BikeRide,action:string,note?:string)=>{
  const epoch=revision.current,key=ride.id+':'+ride.version+':'+action;let command=commandKeys.current.get(key);if(!command){command=crypto.randomUUID();commandKeys.current.set(key,command);}setBusy(true);setError('');setNotice('');
  try{const value=await bikeCommand(ride,action,command,note);if(scope.current===uid&&revision.current===epoch){saveRide(value);commandKeys.current.delete(key);setNotice(action==='cash_reported'?'Payment reported. Your rider must confirm receipt.':action==='cancel'?'Ride cancelled.':action==='dispute'?'Support review requested.':'Arrival confirmed.');return true;}return false;}
  catch(e){if(scope.current===uid&&revision.current===epoch){setError(message(e));window.dispatchEvent(new Event('repaido:bike-rides-updated'));}return false;}finally{if(revision.current===epoch)setBusy(false);}
 };
 const activeRides=rides.filter(ride=>!bikeFinished(ride.state)),visibleRides=history?rides.filter(ride=>bikeFinished(ride.state)):activeRides;
 useEffect(()=>{onSummary?.({uid,loaded:recordsLoaded,busy:!recordsLoaded&&!readError||openingRide||pageBusy,error:readError||error,active:activeRides.length,history:rides.length-activeRides.length,focused:!!selected||openingRide});},[uid,recordsLoaded,readError,error,openingRide,pageBusy,activeRides.length,rides.length,!!selected,onSummary]);
 if(bookingsOnly&&embedded&&!selected&&!visibleRides.length&&!readError&&!error&&!notice&&!pageError&&!(history&&nextCursor))return null;

 return <section className="bike-rides" aria-label="Bike rides">
  {!bookingsOnly&&!selected&&<header className="bike-heading"><span className="bike-brand-icon" aria-hidden="true"><TwoWheeler size={24}/></span><div><strong>Bike</strong><small>One passenger · helmet required</small></div>{onSharedBike&&<button className="bike-soft-button" onClick={onSharedBike}>Shared bike<ArrowRight size={18} aria-hidden="true"/></button>}</header>}
  {bookingsOnly&&!embedded&&!uid&&<button className="bike-soft-button" onClick={onSignIn}>Sign in to see your bike rides</button>}
  {!online&&<p className="bike-notice bike-notice-warning" role="status">You’re offline. Reconnect for current riders, fares and location.</p>}
  {policyError&&<div className="bike-notice bike-notice-warning" role="alert"><span>{policyError}</span><button onClick={()=>setPolicyRevision(value=>value+1)}>Retry</button></div>}
  {!bookingsOnly&&!policy&&!policyError&&<p className="bike-loading" role="status">Loading bike availability…</p>}
  {openingRide&&!embedded&&<p className="bike-loading" role="status">Opening your bike ride…</p>}
  {selected?<BikeRideDetail ride={selected} serverNow={serverNow} online={online} busy={busy} onBack={()=>{resumeHandled.current=true;if(embedded)setHistory(bikeFinished(selected.state));setSelectedId('');}} onAction={run}/>:<>
   {!bookingsOnly&&<>
   {policy&&!policy.bookings_available&&<p className="bike-notice" role="status">Bike bookings are not open yet. Shared journeys remain separate.</p>}
   <div className="bike-workspace">
    <div className="bike-map"><JourneyMap origin={pickup||undefined} destination={dropoff||undefined} route={route} mapLabel="Bike pickup and drop-off map"/><span className="bike-map-label"><MapPin size={16} aria-hidden="true"/>{dropoff?'Your route':pickup?.city||'Choose your pickup'}</span></div>
    <form className="bike-route-sheet" onSubmit={event=>{event.preventDefault();void search();}}>
     <div className="bike-composer-heading"><h3>Where to?</h3><span className="bike-route-stage">{pickup&&dropoff?<><Check size={15} aria-hidden="true"/>Route ready</>:'Set your route'}</span></div>
     <div className="bike-route-fields">
      <button type="button" className="bike-location" onClick={()=>setPicking('pickup')}><MapPin size={20} aria-hidden="true"/><span><small>Pickup</small><strong>{pickup?.address||'Set pickup on map'}</strong></span></button>
      <button type="button" className="bike-route-swap" aria-label="Swap bike pickup and drop-off" disabled={!pickup||!dropoff} onClick={()=>{setPickup(dropoff);setDropoff(pickup);invalidateRoute();}}><ArrowDownUp size={20} aria-hidden="true"/></button>
      <button type="button" className="bike-location bike-location-dropoff" onClick={()=>setPicking('dropoff')}><Flag size={20} aria-hidden="true"/><span><small>Drop-off</small><strong>{dropoff?.address||'Where to?'}</strong></span><ChevronDown size={18} aria-hidden="true"/></button>
     </div>
     <div className="bike-route-footer"><label className="bike-passenger-select"><UserRound size={18} aria-hidden="true"/><select aria-label="Who is taking the bike ride?" value={other?'other':'self'} onChange={event=>{setOther(event.target.value==='other');setName(event.target.value==='self'?auth.currentUser?.displayName||'':'');setPhone(event.target.value==='self'?auth.currentUser?.phoneNumber||'':'');}}><option value="self">For me</option><option value="other">For someone else</option></select></label><button className="bike-primary" disabled={loading||!online||!policy?.bookings_available||!pickup||!dropoff} aria-busy={loading}>{loading?'Checking…':uid?'Find a bike':'Sign in to find a bike'}<ArrowRight size={20} aria-hidden="true"/></button></div>
     {policy&&<p className="bike-route-help">Routes up to {(policy.service_radius_metres/1000).toLocaleString('en-IN')} km · Review the fare before you request</p>}
    </form>
   </div>
   {policy?.promo_enabled&&policy.promo_ready&&policy.bookings_available&&<section className={'bike-promotion'+(promotion?.eligible?' is-eligible':'')} aria-label="Bike launch offer">
    <span className="bike-offer-icon" aria-hidden="true"><Ticket size={21}/></span><div><strong>{promotion?.reason==='phone_verification_required'?'Unlock launch offers':promotion?.eligible?'Eligible for a free ride':`${policy.weekly_free_limit} free rides a week`}</strong><small>{promotion?promotion.message||(promotion.eligible?'Your quoted fare is ₹0.':'Check the offer details for eligibility.'):`Eligible routes up to ${policy.free_distance_metres/1000} km · subject to availability`}</small></div>
    <details><summary aria-label="Launch offer details"><span>Details</span><ChevronDown size={18} aria-hidden="true"/></summary><div className="bike-offer-details"><p>Subject to a qualifying route, available rider and launch funding. Your ride is confirmed when the rider accepts.</p>{promotion?.reason==='phone_verification_required'&&<p>Verify your mobile to check your launch-ride allowance.</p>}{promotion&&promotion.reason!=='phone_verification_required'&&<p>{promotion.remaining} launch rides left this week.{promotion.next_eligible_at&&promotion.next_eligible_at>serverNow?` Next eligibility check after ${time(promotion.next_eligible_at)}.`:''}</p>}{policy.promo_ends_at&&<p>Offer ends {time(policy.promo_ends_at)}.</p>}</div></details>{promotion?.reason==='phone_verification_required'&&<button className="bike-verify-phone" onClick={()=>setVerifyPhone(true)}>Verify mobile</button>}
   </section>}
   {searched&&<section className="bike-results" aria-label="Available bike riders"><header><div><h4>{quotes.length?'Choose your rider':'No bike match yet'}</h4>{quotes.length>0&&<p className="bike-results-help">Pickup estimates · fare confirmed before booking</p>}</div><button className="bike-icon-button" aria-label="Refresh available bike riders" disabled={loading||!online} onClick={()=>void search()}><RefreshCw size={17} aria-hidden="true"/></button></header>{quotes.length===0&&<div className="bike-empty"><TwoWheeler size={28} aria-hidden="true"/><strong>{searchReason==='service_not_enabled'?'Bike bookings are not open yet':searchReason==='dispatch_unavailable'?'Matching is temporarily unavailable':searchReason==='paid_rides_unavailable'?'Paid rides are currently unavailable':'No rider is available for this route'}</strong><p>Try again shortly or explore a shared bike journey. No ride has been reserved.</p>{onSharedBike&&<button className="bike-soft-button" onClick={onSharedBike}>Find shared bikes<ArrowRight size={15} aria-hidden="true"/></button>}</div>}{quotes.map(quote=><BikeRiderChoice key={quote.id} quote={quote} expired={bikeQuoteExpired(quote,serverNow)} disabled={loading||!online||busy||(!quote.pricing.free&&!policy?.paid_ready)||!!quote.pricing.free&&!policy?.promo_ready} onRefresh={()=>void search()} onChoose={()=>{setSelectedQuote(quote);setConsent(false);setError('');requestKey.current=crypto.randomUUID();}}/>)}</section>}
   </>}
   {uid&&<section className="bike-my-rides" aria-label="Your bike bookings">{!embedded&&<header><h4>Your rides{activeRides.length>0&&<span>{activeRides.length}</span>}</h4><div className="bike-history-switch" role="group" aria-label="Bike ride history"><button aria-pressed={!history} onClick={()=>setHistory(false)}>Active</button><button aria-pressed={history} onClick={()=>setHistory(true)}>Past</button></div></header>}{visibleRides.map(ride=><button className="bike-booking-link" key={ride.id} onClick={()=>setSelectedId(ride.id)}><TwoWheeler size={19} aria-hidden="true"/><span><strong>{ride.dropoff_address}</strong><small>{bikeRideLabel(ride.state)} · {ride.vehicle_name}</small></span><ArrowRight size={16} aria-hidden="true"/></button>)}{!embedded&&!visibleRides.length&&<p className="bike-muted" role={!recordsLoaded?'status':undefined}>{!recordsLoaded?'Loading your rides…':history?'Your completed rides will appear here.':'No active bike rides.'}</p>}{history&&nextCursor&&<button className="bike-soft-button bike-load-older" disabled={pageBusy||!online} aria-busy={pageBusy} onClick={()=>void loadOlder()}>{pageBusy?'Loading older rides…':'Load older rides'}</button>}{pageError&&<p className="bike-notice bike-notice-warning" role="alert">{pageError}</p>}</section>}
  </>}
  {readError&&<p className="bike-notice bike-notice-warning" role="status">{readError} Your last update may be out of date.</p>}{error&&!selectedQuote&&<p className="bike-notice bike-notice-warning" role="alert">{error}</p>}{notice&&<p className="bike-notice bike-notice-success" role="status"><CheckCircle2 size={17} aria-hidden="true"/>{notice}</p>}
  {verifyPhone&&uid&&<BikePhoneVerification accountId={uid} onClose={()=>setVerifyPhone(false)} onSignIn={onSignIn} onVerified={()=>{setVerifyPhone(false);setQuotes([]);setPromotion(null);setSelectedQuote(null);setSearched(false);if(!other)setPhone(auth.currentUser?.phoneNumber||phone);void search();}}/>}
  {selectedQuote&&<Modal title="Review bike ride" className="bike-review-modal" onClose={()=>{if(!busy){setSelectedQuote(null);setError('');}}}><form className="bike-review" onSubmit={event=>{event.preventDefault();void book();}}><header><span className="bike-brand-icon" aria-hidden="true"><TwoWheeler size={25}/></span><div><strong>{selectedQuote.vehicle_name}</strong><small>{selectedQuote.rider_name} · {selectedQuote.queued?'Finishing another ride':`${minutes(selectedQuote.total_eta_seconds??selectedQuote.pickup_eta_seconds)} to pickup`}</small></div></header><div className="bike-review-route"><span><MapPin size={15} aria-hidden="true"/>{pickup?.address}</span><span><Flag size={15} aria-hidden="true"/>{dropoff?.address}</span></div><BikeFare pricing={selectedQuote.pricing}/><div className="bike-passenger-fields"><label>{other?'Passenger name':'Your name'}<input required minLength={2} maxLength={100} autoComplete={other?'off':'name'} value={name} onChange={event=>setName(event.target.value)}/></label><label>{other?'Passenger phone':'Your phone'}<input required type="tel" inputMode="tel" pattern="\+?[0-9]{10,15}" maxLength={16} autoComplete={other?'off':'tel'} value={phone} onChange={event=>setPhone(event.target.value)} placeholder="10-digit mobile number"/></label></div>{other&&<p className="bike-muted">Share updates and the pickup code with the passenger. You manage this booking.</p>}<label className="bike-consent"><input required type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/><span>I accept this fare and route{other?' and have permission to share the passenger’s details':''}. {selectedQuote.queued?'This requests the rider’s next slot; acceptance and timing are not guaranteed.':'The rider must accept before the ride is confirmed.'}</span></label>{selectedQuote.pricing.free?<p className="bike-payment-note">Eligible launch ride · You pay ₹0 for this quoted trip.</p>:<p className="bike-payment-note">Pay {money(selectedQuote.pricing.customer_total_paise)} directly to the rider after the trip. Payment reports need rider confirmation.</p>}{('terms' in selectedQuote||'cancellation_terms' in selectedQuote)&&<details className="bike-terms"><summary>Ride & cancellation terms</summary>{'terms' in selectedQuote&&<p>{String(selectedQuote.terms)}</p>}{'cancellation_terms' in selectedQuote&&<p>{String(selectedQuote.cancellation_terms)}</p>}</details>}{bikeQuoteExpired(selectedQuote,serverNow)&&<p className="bike-notice bike-notice-warning" role="status">This quote expired. Close and refresh available riders.</p>}{error&&<p className="bike-notice bike-notice-warning" role="alert">{error}</p>}<button className="bike-primary" disabled={busy||!online||!consent||bikeQuoteExpired(selectedQuote,serverNow)} aria-busy={busy}>{busy?'Sending request…':selectedQuote.queued?'Request next slot':'Request bike ride'}<ArrowRight size={16} aria-hidden="true"/></button></form></Modal>}
  {picking&&<LocationPickerModal isOpen title={picking==='pickup'?'Bike pickup':'Bike drop-off'} addressRequired initialLat={(picking==='pickup'?pickup:dropoff)?.lat??initialLocation?.lat} initialLng={(picking==='pickup'?pickup:dropoff)?.lng??initialLocation?.lng} initialAddress={(picking==='pickup'?pickup:dropoff)?.address} initialCity={(picking==='pickup'?pickup:dropoff)?.city||initialLocation?.city} locationLabel={picking==='pickup'?'bike pickup':'bike drop-off'} helpText="Choose a safe stopping point. Add the street and a nearby landmark; check both the address and map pin." pinConfirmationLabel="I checked this safe pickup or drop-off point." confirmLabel={picking==='pickup'?'Use this pickup':'Use this drop-off'} onClose={()=>setPicking(null)} onConfirmLocation={value=>{(picking==='pickup'?setPickup:setDropoff)(value);invalidateRoute();setPicking(null);}}/>}
 </section>;
}

export function BikeRideBookings({onSignIn,active=true,initialRideId,embedded,historyView,onHistoryChange,onSummary}:{onSignIn:()=>void;active?:boolean;initialRideId?:string;embedded?:boolean;historyView?:boolean;onHistoryChange?:(history:boolean)=>void;onSummary?:(summary:TransportBookingSummary)=>void}){return <BikeRides onSignIn={onSignIn} active={active} initialRideId={initialRideId} bookingsOnly embedded={embedded} historyView={historyView} onHistoryChange={onHistoryChange} onSummary={onSummary}/>;}

function BikeRiderChoice({quote,expired,disabled,onChoose,onRefresh}:{quote:BikeQuote;expired:boolean;disabled:boolean;onChoose:()=>void;onRefresh:()=>void}){
 return <article className={'bike-rider-choice'+(quote.queued?' is-next':'')+(quote.pricing.free?' is-free':'')}>
  <span className="bike-rider-avatar" aria-hidden="true"><TwoWheeler size={26}/></span>
  <div className="bike-rider-copy"><strong>{quote.rider_name}</strong><small>{quote.vehicle_name}</small></div>
  <div className="bike-rider-fare"><strong>{money(quote.pricing.customer_total_paise)}</strong><small>{quote.pricing.free?'Launch offer':(quote.pricing.surcharge_bps||0)>0?`${(quote.pricing.surcharge_bps||0)/100}% demand adjustment`:'Total fare'}</small></div>
  <div className="bike-rider-facts"><span className="bike-rider-eta"><Clock3 size={17} aria-hidden="true"/>~{minutes(quote.total_eta_seconds??quote.pickup_eta_seconds)} to pickup</span><span><Route size={17} aria-hidden="true"/>{(quote.distance_metres/1000).toFixed(1)} km trip</span>{quote.queued&&<span className="bike-queued-tag">Finishing a ride</span>}</div>
  <button className="bike-choice-action" disabled={disabled} onClick={expired?onRefresh:onChoose}>{expired?'Refresh fare':quote.queued?'Next slot':'Review'}<ArrowRight size={18} aria-hidden="true"/></button>
  {quote.queued&&<p className="bike-next-note">Request their next slot. The rider must accept; timing can change.</p>}
 </article>;
}

export function BikeFare({pricing}:{pricing:BikeQuote['pricing']}){
 return <div className="bike-fare-total-card"><span><small>Final ride fare</small><strong>{money(pricing.customer_total_paise)}</strong></span><span className="bike-fare-benefit">{pricing.free?'Launch benefit applied':(pricing.surcharge_bps||0)>0?`${(pricing.surcharge_bps||0)/100}% demand adjustment included`:'Agreed total'}</span></div>;
}

function BikeRideProgress({state}:{state:string}){
 const phase=['dispatch_pending','offered','queued'].includes(state)?0:['accepted','en_route','on_the_way','arrived'].includes(state)?1:state==='in_progress'?2:['completion_pending','payment_due','payment_reported','completed'].includes(state)?3:-1;
 if(phase<0)return null;
 return <ol className="bike-trip-progress" aria-label="Ride progress">{['Requested','Pickup','Riding','Arrival'].map((label,index)=><li key={label} className={index<phase||state==='completed'?'is-done':index===phase?'is-current':''} aria-current={index===phase&&state!=='completed'?'step':undefined}><span aria-hidden="true">{index<phase||state==='completed'?<Check size={14}/>:index+1}</span><small>{label}</small></li>)}</ol>;
}

function BikeRideDetail({ride,serverNow,online,busy,onBack,onAction}:{ride:BikeRide;serverNow:number;online:boolean;busy:boolean;onBack:()=>void;onAction:(ride:BikeRide,action:string,note?:string)=>Promise<boolean>}){
 const [cancel,setCancel]=useState(false),[note,setNote]=useState(''),[support,setSupport]=useState(false),[bellError,setBellError]=useState('');const bellEnabled=useSyncExternalStore(subscribeTransportBell,transportBellEnabled,()=>false),uid=auth.currentUser?.uid||'';const position=bikeFreshPosition(ride,serverNow),actions=ride.allowed_actions||[],finished=bikeFinished(ride.state),arrived=ride.state==='arrived',nearPickup=ride.state==='on_the_way'&&bikeStopInside(ride,'pickup',serverNow),nearDestination=ride.state==='in_progress'&&bikeStopInside(ride,'destination',serverNow),disabled=busy||!online;
 useEffect(()=>bindTransportBell(uid),[uid]);
 useEffect(()=>{if(bellEnabled&&(arrived||nearPickup||nearDestination))receiveTransportRequests(['bike:'+ride.id+':'+(nearDestination?'destination':'pickup')],uid);},[bellEnabled,arrived,nearPickup,nearDestination,ride.id,uid]);
 return <section className={'bike-live-ride'+(arrived||nearPickup||nearDestination?' has-arrived':'')} aria-label="Your bike ride">
  <header><button className="bike-soft-button" onClick={onBack}><ArrowLeft size={18} aria-hidden="true"/>All rides</button><span className={'bike-state'+(!finished?' is-live':'')} role="status">{bikeRideLabel(ride.state)}</span></header>
  <div className="bike-live-map"><JourneyMap origin={ride.pickup} destination={ride.dropoff} position={finished?null:position} route={ride.route?.points||[]} positionLabel="Your rider’s latest position" mapLabel="Your bike ride map"/></div>
  <div className="bike-live-sheet">
   <div className="bike-live-heading"><h4>{arrived?'Your rider is here':nearPickup?'Your rider is nearby':nearDestination?'You’re near your destination':ride.state==='in_progress'?'Enjoy the journey':ride.state==='queued'?'You requested the next slot':bikeRideLabel(ride.state)}</h4>{!finished&&<span className="bike-location-status">{position?`Location · ${Math.max(0,Math.floor(serverNow-position.received_at))}s ago`:'Waiting for a fresh rider location'}</span>}</div>
   <BikeRideProgress state={ride.state}/>
   {!finished&&!position&&<p className="bike-muted">Current GPS is unavailable. The map does not show an old position as live.</p>}
   {ride.state==='dispatch_pending'&&<p className="bike-muted">We’re matching your request in server order. A rider and launch benefit are not reserved until matching completes.</p>}
   {ride.failure_message&&<p className="bike-notice bike-notice-warning" role="status">{ride.failure_message}</p>}
   {ride.state==='queued'&&<p className="bike-muted">Your rider is finishing a trip. Arrival time can change; follow the request status above.</p>}
   <div className="bike-live-rider"><span className="bike-rider-avatar" aria-hidden="true"><TwoWheeler size={26}/></span><span><strong>{ride.rider_name}</strong><small>{ride.vehicle_name}</small></span>{ride.rider_phone&&!finished&&<a className="bike-icon-button" href={'tel:'+ride.rider_phone.replace(/[^+0-9]/g,'')} aria-label="Call your bike rider"><Phone size={21} aria-hidden="true"/></a>}</div>
   {ride.otp&&!finished&&ride.state!=='in_progress'&&<div className="bike-pickup-code"><span><ShieldCheck size={20} aria-hidden="true"/>Pickup code</span><strong>{ride.otp}</strong><small>Share with your rider only when you meet.</small></div>}
   <BikeFare pricing={ride.pricing}/>
   {ride.blockers?.map(blocker=><p className="bike-muted" key={blocker}>{blocker==='otp_locked_contact_support'?'Pickup code attempts are locked. Contact support for help.':'This ride needs attention. Review the latest status or contact support.'}</p>)}
   {actions.includes('confirm')&&<button className="bike-primary" disabled={disabled} onClick={()=>void onAction(ride,'confirm')}>Confirm safe arrival<CheckCircle2 size={20} aria-hidden="true"/></button>}
   {actions.includes('cash_reported')&&<><p className="bike-payment-note">Pay {money(ride.pricing.customer_total_paise)} directly to the rider. Report only after paying.</p><button className="bike-primary" disabled={disabled} onClick={()=>void onAction(ride,'cash_reported')}>I paid {money(ride.pricing.customer_total_paise)}</button></>}
   <details className="bike-trip-details"><summary><Route size={20} aria-hidden="true"/><span>Trip details<small>{ride.dropoff_address}</small></span><ChevronDown size={20} aria-hidden="true"/></summary><div className="bike-review-route"><span><MapPin size={18} aria-hidden="true"/>{ride.pickup_address}</span><span><Flag size={18} aria-hidden="true"/>{ride.dropoff_address}</span></div>{ride.for_someone_else&&<p className="bike-muted">For {ride.passenger_name}. Share ride updates and the pickup code with them.</p>}{ride.terms&&<div className="bike-trip-terms"><p>{ride.terms}</p>{ride.cancellation_terms&&<p>{ride.cancellation_terms}</p>}</div>}</details>
   {!finished&&<button className="bike-sound-toggle" aria-pressed={bellEnabled} onClick={()=>{if(bellEnabled){disableTransportBell();return;}void enableTransportBell(uid).then(()=>setBellError('')).catch(e=>setBellError(message(e)));}}><Bell size={19} aria-hidden="true"/>{bellEnabled?'Ride alerts on':'Enable ride alerts'}</button>}
   {bellError&&<p className="bike-muted" role="status">{bellError}</p>}
   <div className="bike-live-actions">{actions.includes('cancel')&&<button className="bike-soft-button" disabled={disabled} onClick={()=>setCancel(true)}>Cancel request</button>}{actions.includes('dispute')&&<button className="bike-soft-button" disabled={disabled} aria-expanded={support} onClick={()=>setSupport(!support)}>Report an issue</button>}<a className="bike-soft-button bike-emergency" href="tel:112"><ShieldCheck size={18} aria-hidden="true"/>Emergency · 112</a></div>
   {support&&<form className="bike-inline-form" onSubmit={event=>{event.preventDefault();void onAction(ride,'dispute',note).then(saved=>{if(saved)setSupport(false);});}}><label>What went wrong?<textarea required minLength={10} maxLength={1000} value={note} onChange={event=>setNote(event.target.value)}/></label><button className="bike-primary" disabled={disabled}>Send for review</button></form>}
  </div>
  {cancel&&<Modal title="Cancel this bike request?" onClose={()=>{if(!busy)setCancel(false);}}><div className="bike-cancel-review"><p>The rider will be notified. Review any cancellation terms in your fare before continuing.</p><button className="bike-primary" disabled={disabled} onClick={()=>void onAction(ride,'cancel').then(saved=>{if(saved)setCancel(false);})}>Confirm cancellation</button><button className="bike-soft-button" disabled={busy} onClick={()=>setCancel(false)}>Keep my ride</button></div></Modal>}
 </section>;
}
