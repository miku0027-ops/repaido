// Isolated identity/provider-boundary fixture. No SMS request is made.
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {BikeRides} from '../src/components/BikeRides';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
await auth.authStateReady();
const listeners=new Set<(user:any)=>void>();
(window as any).__bikePhoneVerified=false;
(window as any).__bikePhoneEvents=[];
(auth as any).currentUser={uid:'google-fixture-user',displayName:'Google fixture customer',phoneNumber:null,getIdToken:async(force:boolean)=>{if(force)(window as any).__bikePhoneEvents.push({action:'refresh',uid:auth.currentUser?.uid});return (window as any).__bikePhoneVerified?'fixture-verified-phone-token':'fixture-google-token';}};
(auth as any).onIdTokenChanged=(next:any)=>{const fn=typeof next==='function'?next:next.next;listeners.add(fn);queueMicrotask(()=>fn(auth.currentUser));return()=>listeners.delete(fn);};
(window as any).__bikePhoneSwitch=()=>{(auth as any).currentUser=null;listeners.forEach(fn=>fn(null));};
localStorage.setItem('repaido.token','fixture-google-token');
createRoot(document.getElementById('root')!).render(<main className="repaido-customer-shell" style={{maxWidth:680,margin:'auto',padding:12}}><h1 style={{fontSize:16}}>Bike mobile verification checks</h1><button style={{minHeight:44}} onClick={()=>(window as any).__bikePhoneSwitch()}>Sign out fixture</button><BikeRides initialLocation={{lat:21.4934,lng:86.9135,address:'Phone fixture pickup station',city:'Balasore',confirmed:true}} onSignIn={()=>{document.getElementById('fixture-action')!.textContent='Explicit sign-in requested';}}/><p id="fixture-action" role="status"/></main>);
