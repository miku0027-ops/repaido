// Test-only Firebase session adapter; API fixture still checks every account.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {HomeDiscoveryHub} from '../src/components/HomeDiscoveryHub';
import {HydrationControls,useServiceHydration} from '../src/components/ServiceHydration';
import {AppExperience} from '../src/components/AppExperience';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
await auth.authStateReady();
const listeners=new Set<(user:unknown)=>void>();
function session(uid:string){
 (auth as any).currentUser={uid,phoneNumber:'+919876543210',getIdToken:async()=>uid,getIdTokenResult:async()=>({claims:{}})};
 localStorage.setItem('repaido.token',uid);listeners.forEach(listener=>listener(auth.currentUser));
}
(auth as any).onIdTokenChanged=(next:((user:unknown)=>void)|{next:(user:unknown)=>void})=>{
 const listener=typeof next==='function'?next:next.next;listeners.add(listener);queueMicrotask(()=>listener(auth.currentUser));return()=>listeners.delete(listener);
};
session('customer');
function Preview(){
 const [account,setAccount]=useState('customer'),[active,setActive]=useState(true);
 const hydration=useServiceHydration(account,'Balasore',active);
 return <main style={{maxWidth:960,margin:'auto',padding:16,background:'var(--ui-surface)'}}><AppExperience/>
  <div aria-label="Test controls">
   <button onClick={()=>setActive(value=>!value)}>Toggle home visibility</button>
   <button onClick={()=>{const uid=account==='customer'?'worker':'customer';session(uid);setAccount(uid);}}>Switch test account</button>
   <button onClick={()=>hydration.event({kind:'search',query:'AC'})}>Record repair search</button>
   <button onClick={()=>hydration.event({kind:'category_view',category:'plumber'})}>Record plumbing category</button>
   <button onClick={()=>hydration.event({kind:'category_view',category:'electrician'})}>Record electrical category</button>
   <button onClick={()=>hydration.event({kind:'search',category:'transport_shared'})}>Record shared search</button>
   <button onClick={()=>hydration.event({kind:'search',category:'transport_rental'})}>Record rental search</button>
  </div>
  <HydrationControls enabled={hydration.enabled} signedIn={hydration.signedIn} pending={hydration.pending} error={hydration.error} onChange={hydration.refresh} onSignIn={()=>{}}/>
  {active&&<HomeDiscoveryHub accountKey={account} location={{lat:21.4934,lng:86.9135,city:'Balasore',confirmed:true}} personalised={hydration.enabled} preferredFocus={hydration.feed?.preferred_discovery_focus} repairCategory={hydration.feed?.preferred_repair_category} transportMode={hydration.feed?.preferred_transport_mode||undefined} transportInterest={hydration.feed?.transport_interest} repairInterest={hydration.feed?.cards.some(card=>card.personalised)} onEvent={hydration.event} onBook={()=>{}} onHome={()=>{}} onLocation={()=>{}} onSignIn={()=>{}}/>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
