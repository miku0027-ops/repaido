// Only the Firebase identity boundary is stubbed. Every bike HTTP response comes
// from the real isolated application launched by bike-fullstack.browser.mjs.
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {BikeRides} from '../src/components/BikeRides';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
await auth.authStateReady();
(auth as any).currentUser={uid:'customer',displayName:'Local customer',phoneNumber:'+919876543210',getIdToken:async()=>'customer'};
(auth as any).onIdTokenChanged=(next:any)=>{const callback=typeof next==='function'?next:next.next;queueMicrotask(()=>callback(auth.currentUser));return()=>{};};
localStorage.setItem('repaido.token','customer');
createRoot(document.getElementById('root')!).render(<main className="repaido-customer-shell" style={{maxWidth:720,margin:'auto',padding:12}}><h1 style={{fontSize:16}}>Real HTTP bike integration</h1><BikeRides initialLocation={{lat:21.4934,lng:86.9135,address:'Local pickup railway station entrance',city:'Balasore',confirmed:true}} onSignIn={()=>{throw Error('The local session unexpectedly expired.');}}/></main>);
