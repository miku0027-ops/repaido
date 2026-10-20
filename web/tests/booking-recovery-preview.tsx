// Development-only boundary fixture; HTTP is forwarded to the isolated API.
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {BookingPaymentRecovery} from '../src/components/BookingPaymentRecovery';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
await auth.authStateReady();
const uid=new URLSearchParams(location.search).get('account')||'customer';
(auth as any).currentUser={uid,getIdToken:async()=>uid};
(auth as any).onIdTokenChanged=(next:any)=>{const callback=typeof next==='function'?next:next.next;queueMicrotask(()=>callback(auth.currentUser));return()=>{};};
localStorage.setItem('repaido.token',uid);
createRoot(document.getElementById('root')!).render(<main className="repaido-customer-shell" style={{maxWidth:680,margin:'auto',padding:12}}><h1 style={{fontSize:18}}>Booking payment checks</h1><BookingPaymentRecovery/></main>);
