// Disposable browser fixture; never part of a production entry point.
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {BikeRideAdmin} from '../src/components/BikeRideAdmin';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
import '../src/components/company-crm.css';
await auth.authStateReady();
(auth as any).currentUser={uid:'bike-admin-fixture',getIdToken:async()=>'bike-admin-fixture'};
(auth as any).onIdTokenChanged=(callback:(user:unknown)=>void)=>{queueMicrotask(()=>callback(auth.currentUser));return()=>{};};
localStorage.setItem('repaido.token','bike-admin-fixture');
createRoot(document.getElementById('root')!).render(<div className="operations portal-company"><main style={{padding:16,minWidth:0}}><h1>Bike operations test</h1><BikeRideAdmin/></main></div>);
