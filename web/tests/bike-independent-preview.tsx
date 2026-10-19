// Local browser evidence only; this entry is excluded from production builds.
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {BikeIndependentAdmin} from '../src/components/BikeIndependentAdmin';
import {BikeIndependentEarnings} from '../src/components/BikeIndependentEarnings';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
import '../src/components/company-crm.css';
import '../src/components/bike-ride-admin.css';
import '../src/components/bike-rider-workspace.css';
await auth.authStateReady();
(auth as any).currentUser={uid:'independent-qa',getIdToken:async()=>'local-independent-qa'};
(auth as any).onIdTokenChanged=(callback:(user:unknown)=>void)=>{queueMicrotask(()=>callback(auth.currentUser));return()=>{};};
const rider=new URLSearchParams(location.search).has('rider');
createRoot(document.getElementById('root')!).render(rider?<main style={{maxWidth:520,padding:16,margin:'auto'}}><h1>Local rider earnings preview</h1><div className="bike-rider-workspace"><BikeIndependentEarnings onChanged={async()=>{}}/></div></main>:<div className="operations portal-company"><main style={{padding:16,minWidth:0}}><h1>Local independent earnings preview</h1><section className="bike-admin"><BikeIndependentAdmin/></section></main></div>);
