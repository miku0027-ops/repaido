// Only the authentication boundary is controlled. This entry renders the real
// customer App and is excluded from the production bundle.
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import App from '../src/App';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/customer-layout.css';

await auth.authStateReady();
const callbacks=new Set<(user:any)=>void>();
function emit(uid:string){
 const user=uid?{uid,displayName:'Local customer',email:uid+'@fixture.test',emailVerified:true,phoneNumber:'+919876543210',photoURL:null,getIdToken:async()=>uid,getIdTokenResult:async()=>({claims:{phone_number:'+919876543210',firebase:{sign_in_provider:'phone'}}})}:null;
 (auth as any).currentUser=user;
 if(user){localStorage.setItem('repaido.token',uid);localStorage.setItem('repaido.user',JSON.stringify({id:uid,name:user.displayName,phone:user.phoneNumber}));}
 else{localStorage.removeItem('repaido.token');localStorage.removeItem('repaido.user');}
 for(const callback of callbacks)callback(user);
}
(auth as any).onIdTokenChanged=(next:any)=>{const callback=typeof next==='function'?next:next.next;callbacks.add(callback);queueMicrotask(()=>{if(callbacks.has(callback))callback(auth.currentUser);});return()=>callbacks.delete(callback);};
const uid=new URLSearchParams(location.search).get('uid')||'customer';
if(!/^[A-Za-z0-9_-]{1,100}$/.test(uid))throw Error('Use an isolated fixture account ID.');
emit(uid);
(window as any).__customerRidesFixture={emit};
createRoot(document.getElementById('root')!).render(<App/>);
