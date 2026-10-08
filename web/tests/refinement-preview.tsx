// Isolated test entry. Never included in the production bundle.
import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import {auth} from '../src/firebase';
import {Hiring} from '../src/components/Hiring';
import {CustomContracts} from '../src/components/CustomContracts';
import {LocalBusinessDesk,MobilityHub,ScrapHub} from '../src/components/LocalBusiness';
import {LiveTrackingView} from '../src/components/LiveTrackingView';
import {operation,type Job} from '../src/services/operations';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
import '../src/components/market-refinement.css';
const p=new URLSearchParams(location.search),mode=p.get('mode')||'hiring',uid=p.get('uid')||'customer';
await auth.authStateReady();
(auth as any).currentUser={uid,phoneNumber:'+919876543210',getIdToken:async()=>uid};
localStorage.setItem('repaido.token',uid);
const pin={lat:21.4934,lng:86.9135,city:'Balasore',address:'Fixture pickup entrance 123',confirmed:true};
function Tracking(){const[job,setJob]=useState<Job|null>(null);useEffect(()=>{void operation<Job>('/jobs/tracking-fixture').then(setJob);},[]);return job?<LiveTrackingView job={job} onClose={()=>{}}/>:<p>Opening visit</p>;}
function Preview(){return <main style={{maxWidth:900,margin:'auto',padding:16}}><h1 style={{fontSize:16}}>Isolated app preview</h1>{mode==='hiring'?<Hiring services={[]} city="Balasore" location={pin} onSignIn={()=>{}} onHome={()=>{}} onRequests={()=>{}} onBooking={()=>{}}/>:mode==='contracts'?<CustomContracts accountKey={uid} authenticated/>:mode==='mobility'?<MobilityHub initialLocation={pin} onSignIn={()=>{}}/>:mode==='scrap'?<ScrapHub onSignIn={()=>{}}/>:mode==='tracking'?<Tracking/>:<LocalBusinessDesk role={mode==='scrap-desk'?'scrap_owner':'cab_owner'} onBack={()=>{}}/>}</main>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
