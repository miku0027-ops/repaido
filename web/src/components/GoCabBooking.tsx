import {useEffect,useId,useRef,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {CalendarDays,Check,Clock3,RefreshCw,ShieldCheck} from '../icons';
import {business,businessDocument,businessPublic,type BusinessLocation} from '../services/localBusiness';
import {money} from '../services/operations';
import {cabWindowValid,soonestCabWindow,validateRideStops} from '../services/rideRoute.mjs';
import {usePublicCabAreas} from '../hooks/usePublicCabAreas';
import {GoogleJourneyMap} from './GoogleJourneyMap';
import {GoVehicleArt} from './GoVehicleArt';
import {GoLocationPicker} from './GoLocationPicker';
import {RideDateTimeField} from './MobilityFormControls';
import {QuoteBreakdown} from './LocalBusiness';
import {RideRouteFields} from './RideRouteFields';
import {SlideAction} from './SlideAction';
import {useCustomerRideWorkspace} from './RideWorkspace';
import type {TransportArea} from './TransportRail';
import './go-booking.css';

type Mode='cab'|'self_drive'|'rental';
type Window={starts_at:number;ends_at:number};
type Vehicle={id:string;name:string;seats:number;transmission:string;owner_name:string;nearby_km:number;daily_paise:number;per_km_paise:number;base_paise:number;terms:string};
type Quote={id:string;vehicle_id:string;expires_at:number;vehicle:Vehicle};
const location=(area?:TransportArea):BusinessLocation|null=>area?.confirmed&&Number.isFinite(area.lat)&&Number.isFinite(area.lng)?{lat:area.lat!,lng:area.lng!,address:area.address||'',city:area.city||''}:null;
const shortTime=(value:number)=>new Date(value*1000).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'});

/** Route, actual availability, fare and consent remain in one Go screen.
 * Cab uses the API's soonest permitted slot; rental dates stay explicit. */
export function GoCabBooking({pickupRequest=0,onPickup,mode,initialLocation,active,onSignIn,onSearch}:{pickupRequest?:number;onPickup?:(area:TransportArea)=>void;mode:Mode;initialLocation?:TransportArea;active:boolean;onSignIn:()=>void;onSearch:()=>void}){
 const rental=mode==='self_drive',scheduled=mode!=='cab',openRide=useCustomerRideWorkspace(),help=useId();
 const [uid,setUid]=useState(auth.currentUser?.uid||''),[pickup,setPickup]=useState(location(initialLocation)),[dropoff,setDropoff]=useState<BusinessLocation|null>(null);
 const [picking,setPicking]=useState<'pickup'|'dropoff'|null>(null),[start,setStart]=useState(''),[end,setEnd]=useState('');
 const handledPickup=useRef(pickupRequest);
 useEffect(()=>{if(!active)setPicking(null);},[active]);
 const [bookingWindow,setBookingWindow]=useState<Window|null>(null),[vehicles,setVehicles]=useState<Vehicle[]>([]),[quote,setQuote]=useState<Quote|null>(null);
 const [phase,setPhase]=useState<'planning'|'searching'|'found'|'empty'>('planning'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[consent,setConsent]=useState(false);
 useEffect(()=>{if(active&&pickupRequest&&handledPickup.current!==pickupRequest&&!busy){handledPickup.current=pickupRequest;setPicking('pickup');}},[pickupRequest,active,busy]);
 const [phone,setPhone]=useState(auth.currentUser?.phoneNumber||''),[license,setLicense]=useState<File|null>(null),[now,setNow]=useState(Date.now()),[online,setOnline]=useState(navigator.onLine);
 const account=useRef(uid),generation=useRef(0),running=useRef(false),intent=useRef({body:'',key:crypto.randomUUID()}),uploadedLicense=useRef<{file:File;id:string}|null>(null);
 const publicCabs=usePublicCabAreas(pickup||undefined,active&&!rental,uid||'guest',0);
 const stops=validateRideStops(pickup,dropoff,Infinity,true);
 const dates={starts_at:new Date(start).getTime()/1000,ends_at:new Date(end).getTime()/1000};
 const datesReady=!scheduled||cabWindowValid(dates,now);
 const validation=!online?'Reconnect to check available vehicles.':!stops.ready?stops.message:!datesReady?'Choose pickup from five minutes to 180 days ahead and a return 15 minutes to 30 days later.':stops.message;
 const ready=online&&stops.ready&&datesReady;
 const freshQuote=!!quote&&quote.expires_at>now/1000&&cabWindowValid(bookingWindow,now);
 const reset=()=>{generation.current++;setPhase('planning');setVehicles([]);setQuote(null);setConsent(false);setError('');setBookingWindow(null);intent.current={body:'',key:crypto.randomUUID()};};
 useEffect(()=>onIdTokenChanged(auth,user=>{
  const next=user?.uid||'';
  if(account.current!==next){account.current=next;reset();setPicking(null);setPickup(location(initialLocation));setDropoff(null);setStart('');setEnd('');setBusy(false);running.current=false;setPhone(user?.phoneNumber||'');setLicense(null);uploadedLicense.current=null;}setUid(next);
 }),[]);
 const areaKey=JSON.stringify(initialLocation),appliedArea=useRef(areaKey);
 useEffect(()=>{if(appliedArea.current===areaKey||busy)return;appliedArea.current=areaKey;reset();setPickup(location(initialLocation));},[areaKey,busy]);
 useEffect(()=>{
  const update=()=>{setNow(Date.now());setOnline(navigator.onLine);};
  const timer=active?setInterval(update,1000):undefined;
  window.addEventListener('online',update);window.addEventListener('offline',update);
  return()=>{if(timer)clearInterval(timer);window.removeEventListener('online',update);window.removeEventListener('offline',update);};
 },[active]);
 useEffect(()=>()=>{generation.current++;},[]);

 async function run(task:(current:()=>boolean)=>Promise<void>){
  if(running.current)return;
  const epoch=generation.current,account=auth.currentUser?.uid;
  running.current=true;setBusy(true);setError('');
  const current=()=>generation.current===epoch&&auth.currentUser?.uid===account;
  try{await task(current);}catch(e){if(current()){setError((e as Error).message||'Could not check availability. Try again.');setPhase(old=>old==='searching'?'planning':old);}}
  finally{if(generation.current===epoch){running.current=false;if(current())setBusy(false);}}
 }
 async function search(){
  if(!ready)return;
  if(!auth.currentUser){onSignIn();return;}
  await run(async current=>{
   const slot=scheduled?dates:soonestCabWindow();
   setBookingWindow(slot);setQuote(null);setConsent(false);setPhase('searching');setVehicles([]);onSearch();
   const result=await businessPublic<{vehicles:Vehicle[]}>('/vehicles/search',{...slot,pickup:{lat:pickup!.lat,lng:pickup!.lng},mode:rental?'rental':'cab'});
   if(!current())return;
   setVehicles(result.vehicles);setPhase(result.vehicles.length?'found':'empty');
  });
 }
 async function review(vehicle:Vehicle){
  if(!auth.currentUser){onSignIn();return;}
  if(!cabWindowValid(bookingWindow)){setError('The pickup window moved. Search again for a fresh time and fare.');return;}
  await run(async current=>{
   const value=await business<Quote>('/quotes',{...bookingWindow,pickup:{lat:pickup!.lat,lng:pickup!.lng},dropoff:{lat:dropoff!.lat,lng:dropoff!.lng},mode:rental?'rental':'cab',trip:scheduled?'round_trip':'one_way',vehicle_id:vehicle.id});
   if(current()){setQuote(value);setConsent(false);intent.current={body:'',key:crypto.randomUUID()};}
  });
 }
 async function book(){
  if(!auth.currentUser){onSignIn();return;}
  if(!quote||!consent)return;
  if(!freshQuote){setError('This fare or pickup window expired. Search again before requesting.');return;}
  if(!/^\+?[0-9]{10,15}$/.test(phone)){setError('Enter a valid contact phone number.');return;}
  await run(async current=>{
   let licenseId:string|undefined;
   if(rental){
    if(!license)throw Error('Add your driving licence photo for the owner’s review.');
    if(uploadedLicense.current?.file!==license)uploadedLicense.current={file:license,id:(await businessDocument(license)).id};
    if(!current())return;
    licenseId=uploadedLicense.current!.id;
   }
   const body={quote_ids:[quote.id],pickup_address:pickup!.address,dropoff_address:dropoff!.address,phone,consent:true,license_document_id:licenseId};
   const serialized=JSON.stringify(body);
   if(intent.current.body!==serialized)intent.current={body:serialized,key:crypto.randomUUID()};
   const saved=await business<{id:string}>('/rides',{...body,request_id:intent.current.key});
   if(current()){setQuote(null);setVehicles([]);setPhase('planning');openRide?.('cab',saved.id);}
  });
 }

 return <section className="bike-rides go-vehicle-booking" aria-label={rental?'Self-drive booking':scheduled?'Cab rental booking':'Quick cab booking'}>
  <header className="bike-heading"><div><small>{rental?'Your dates · your keys':scheduled?'Your route · your driver':'With a driver · fare before you request'}</small></div></header>
  {picking&&<GoLocationPicker key={uid+':'+picking} stop={picking} initial={picking==='pickup'?pickup:dropoff} near={pickup||initialLocation} onClose={()=>setPicking(null)} onConfirm={value=>{reset();if(picking==='pickup'){setPickup(value);onPickup?.({...value,confirmed:true});}else setDropoff(value);setPicking(null);}}/>}
  <div className="bike-workspace" hidden={!!picking}>
   <div className="bike-map go-booking-map" data-phase={phase}>
    <GoogleJourneyMap origin={pickup||undefined} destination={dropoff||undefined} nearby={publicCabs.areas.map(row=>row.position)} nearbyLabel="Driver-shared cab area · approximate location" vehicleKind={rental?'self_drive':'cab'} cameraPhase={phase} mapLabel="Repaido Go pickup map"/>
    <span className="bike-map-label"><GoVehicleArt kind={mode} size={35}/>{phase==='searching'?'Checking your route':phase==='found'?'Available options':phase==='empty'?'Try another route':pickup?.city||'Choose your pickup'}</span>
    {phase==='searching'&&<div className="go-map-searching" role="status"><span aria-hidden="true"/><strong>Checking available {rental?'cars':'cabs'}…</strong></div>}
   </div>
   <form className="bike-route-sheet" onSubmit={event=>{event.preventDefault();void (quote?book():search());}}>
    <div className="bike-composer-heading"><h3>{scheduled?'Plan your rental':'Where to?'}</h3><span className="go-slot-tag"><Clock3 size={15} aria-hidden="true"/>{scheduled?'Choose dates':'Soonest pickup'}</span></div>
    {scheduled&&<div className="go-booking-dates"><RideDateTimeField label={rental?'Pickup date & time':'Hire starts'} value={start} disabled={busy} onChange={value=>{reset();setStart(value);}}/><RideDateTimeField label={rental?'Return date & time':'Hire ends'} value={end} disabled={busy} min={start||undefined} onChange={value=>{reset();setEnd(value);}}/></div>}
    <RideRouteFields pickup={pickup} dropoff={dropoff} kind="cab" disabled={busy} onPick={setPicking} onSwap={()=>{reset();setPickup(dropoff);setDropoff(pickup);}}/>
    <div className="bike-route-footer" hidden={!!quote}><SlideAction submit label={quote?'Send booking request':rental?'Find available cars':scheduled?'Find a rental cab':'Find a cab'} pendingLabel={quote?'Sending request…':'Checking availability…'} busy={busy} disabled={quote?!online||!freshQuote:!ready} describedBy={help} validationMessage={quote?freshQuote?'Review the fare and accept the terms below.':'Fare expired · search again for availability.':validation}/></div>
    <p id={help} className="bike-route-help">{bookingWindow?<><CalendarDays size={14} aria-hidden="true"/>Pickup from {shortTime(bookingWindow.starts_at)} · {scheduled?'Your selected dates':'2-hour booking window'}</>:scheduled?'Choose dates and stops together. Review the full quote next.':'The next available booking slot starts at least five minutes ahead.'}</p>
    {bookingWindow&&!scheduled&&<p className="go-booking-caption">Your owner confirms the pickup. This slot is not a live arrival estimate.</p>}
    {error&&<p className="go-booking-error" role="alert">{error}</p>}
    {phase==='empty'&&<div className="go-booking-empty" role="status"><GoVehicleArt kind={mode} size={80}/><strong>No available {rental?'cars':'cabs'} for this request</strong><p>Change your stops{scheduled?' or dates':''}, or check again. No booking has been made.</p></div>}
    {vehicles.length>0&&<section className="go-booking-options" aria-label="Available vehicles"><header><h4>Choose your {rental?'car':'cab'}</h4><span>{vehicles.length} {vehicles.length===1?'option':'options'}</span></header>{vehicles.map(vehicle=><article key={vehicle.id} className="go-vehicle-option" data-selected={quote?.vehicle_id===vehicle.id}><GoVehicleArt kind={mode} size={82}/><div><strong>{vehicle.name}</strong><small>{vehicle.seats} seats · {vehicle.transmission}</small><small>{vehicle.owner_name} · {vehicle.nearby_km} km nearby</small><span>{money(rental?vehicle.daily_paise:vehicle.per_km_paise)}/{rental?'day':'km'}{!rental&&` + ${money(vehicle.base_paise)} base`}</span></div><button type="button" disabled={busy} onClick={()=>void review(vehicle)} aria-pressed={quote?.vehicle_id===vehicle.id}>{quote?.vehicle_id===vehicle.id?<><Check size={16} aria-hidden="true"/>Selected</>:'Calculate full price'}</button></article>)}</section>}
    {quote&&<section className="go-booking-review" aria-label="Review your booking"><header><ShieldCheck size={20} aria-hidden="true"/><h4>Your fare, before you request</h4></header><QuoteBreakdown quote={quote}/><p className="go-booking-terms">{quote.vehicle.terms}</p><label>Contact phone<input type="tel" autoComplete="tel" pattern="\+?[0-9]{10,15}" required disabled={busy} value={phone} onChange={event=>setPhone(event.target.value)}/></label>{rental&&<label>Driving licence photo · private<input type="file" accept="image/jpeg,image/png" required disabled={busy} onChange={event=>setLicense(event.target.files?.[0]||null)}/><small>Only the accepted owner can review your licence.</small></label>}<label className="go-booking-consent"><input type="checkbox" required disabled={busy} checked={consent} onChange={event=>setConsent(event.target.checked)}/><span>I agree to these vehicle terms and the quoted total, with ₹500 credited advance after owner acceptance.</span></label><p className="go-booking-caption">No charge now. Cancellation before the journey starts returns the advance.</p>{!freshQuote&&<button type="button" onClick={()=>{setQuote(null);void search();}}>Refresh fare and availability<RefreshCw size={16} aria-hidden="true"/></button>}</section>}
    {quote&&<div className="go-review-action"><SlideAction submit label="Send booking request" pendingLabel="Sending request…" busy={busy} disabled={!online||!freshQuote} validationMessage={consent?'Terms accepted · slide to request.':'Accept the terms and confirm your contact details.'}/></div>}
   </form>
  </div>
  {!rental&&publicCabs.areas.length>0&&<p className="go-live-availability">Driver-shared cab areas · approximate positions. Exact tracking follows your assigned ride.</p>}
 </section>;
}

