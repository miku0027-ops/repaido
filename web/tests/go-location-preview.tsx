// Test entry only. Production Go components with a controlled auth boundary.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {RepaidoGo} from '../src/components/RepaidoGo';
import type {TravelMode} from '../src/components/MobilityExperience';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
import '../src/material-surfaces.css';
await auth.authStateReady();
(auth as any).currentUser=null;
(auth as any).onIdTokenChanged=(fn:any)=>{queueMicrotask(()=>fn(null));return()=>{};};
function Preview(){const [mode,setMode]=useState<TravelMode>('bike');return <main style={{maxWidth:700,margin:'auto'}}><RepaidoGo location={{lat:21.4934,lng:86.9135,city:'Balasore',address:'Balasore',confirmed:false}} initialMode={mode} onModeSelect={setMode} onSearch={()=>{}} onSignIn={()=>{}} onHome={()=>{}} onBookings={()=>{}}/></main>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
