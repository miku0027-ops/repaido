// Local-only composition. Browser checks supply every API response.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {CustomerLiveRide} from '../src/components/CustomerLiveRide';
import {BikeRideBookings} from '../src/components/BikeRides';
import {BikeRiderWorkspace} from '../src/components/BikeRiderWorkspace';
import {BusinessCabRideWorkspace} from '../src/components/BusinessCabRideWorkspace';
import {useBusinessRecords} from '../src/components/LocalBusiness';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
await auth.authStateReady();
const mode=new URLSearchParams(location.search).get('mode')||'customer',listeners=new Set<(user:any)=>void>();
function emit(uid:string){(auth as any).currentUser=uid?{uid,displayName:'Local rider test',phoneNumber:'+919999999999',getIdToken:async()=>uid}:null;if(uid)localStorage.setItem('repaido.token',uid);else localStorage.removeItem('repaido.token');for(const next of listeners)next(auth.currentUser);}
(auth as any).onIdTokenChanged=(next:any)=>{const listener=typeof next==='function'?next:next.next;listeners.add(listener);queueMicrotask(()=>listener(auth.currentUser));return()=>listeners.delete(listener);};
emit(mode==='customer'?'customer-ui':'rider-ui');
(window as any).__rideFixture={emit};
function Owner(){const records=useBusinessRecords('rides');return <BusinessCabRideWorkspace records={records} role="cab_owner"/>;}
function Preview(){const [tab,setTab]=useState('home');return <main style={{maxWidth:900,margin:'auto',padding:16}}><h1>Local ride home</h1><button onClick={()=>setTab(value=>value==='home'?'rides':'home')}>Change app section</button><button onClick={()=>emit('')}>Sign out fixture</button>{mode==='customer'?<CustomerLiveRide>{tab==='home'?<p>Home content</p>:<BikeRideBookings onSignIn={()=>{}}/>}</CustomerLiveRide>:mode==='owner'?<Owner/>:<BikeRiderWorkspace background={tab!=='rides'} readPosition={async()=>({lat:21.4934,lng:86.9135,accuracy:8,captured_at:Date.now()/1000})}/>}</main>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
