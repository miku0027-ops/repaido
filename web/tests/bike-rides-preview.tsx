// Isolated presentation fixture. All network responses are supplied by the
// browser test; this entry point is never imported by the production app.
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {MobilityExperience} from '../src/components/MobilityExperience';
import {BikeRideBookings,BikeRides} from '../src/components/BikeRides';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
await auth.authStateReady();
const listeners=new Set<(user:any)=>void>();
function session(uid:string){(auth as any).currentUser=uid?{uid,displayName:'Fixture customer',phoneNumber:'+919876543210',getIdToken:async()=>uid}:null;localStorage.setItem('repaido.token',uid);for(const listener of listeners)listener(auth.currentUser);}
(auth as any).onIdTokenChanged=(next:any)=>{const listener=typeof next==='function'?next:next.next;listeners.add(listener);queueMicrotask(()=>listener(auth.currentUser));return()=>listeners.delete(listener);};
session(new URLSearchParams(location.search).get('guest')==='1'?'':'bike-customer-fixture');
createRoot(document.getElementById('root')!).render(<main className="repaido-customer-shell" style={{maxWidth:800,margin:'0 auto',padding:12,minWidth:0}}><h1 style={{fontSize:16,marginBottom:14}}>Bike customer checks</h1><button style={{minHeight:44}} onClick={()=>session(auth.currentUser?'':'bike-customer-second')}>Switch account</button>{new URLSearchParams(location.search).get('mode')==='bookings'?<BikeRideBookings initialRideId={new URLSearchParams(location.search).get('ride')||undefined} onSignIn={()=>{document.getElementById('fixture-notice')!.textContent='Sign-in requested';}}/>:new URLSearchParams(location.search).get('mode')==='integration'?<MobilityExperience initialMode="bike" onSignIn={()=>{}} initialLocation={{lat:21.4934,lng:86.9135,address:'Fixture pickup railway station',city:'Balasore',confirmed:true}}/>:<BikeRides initialRideId={new URLSearchParams(location.search).get('ride')||undefined} initialLocation={{lat:21.4934,lng:86.9135,address:'Fixture pickup railway station',city:'Balasore',confirmed:true}} onSignIn={()=>{document.getElementById('fixture-notice')!.textContent='Sign-in requested';}} onSharedBike={()=>{document.getElementById('fixture-notice')!.textContent='Shared bike opened';}}/>}<p id="fixture-notice" role="status"/></main>);
