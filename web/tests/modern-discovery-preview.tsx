// Isolated integration entry. This file is excluded from the production bundle.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {HomeDiscoveryHub} from '../src/components/HomeDiscoveryHub';
import LiveBooking from '../src/components/LiveBooking';
import {ShareMilestone} from '../src/components/ShareMilestone';
import {LiveVideoHub} from '../src/components/repaidians/LiveVideo';
import {HomeHub} from '../src/components/HomePlans';
import RepaidiansModal from '../src/components/repaidians/RepaidiansModal';
import {AppExperience} from '../src/components/AppExperience';
import type {Service} from '../src/types';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
import '../src/components/repaidians/repaidians.css';
const query=new URLSearchParams(location.search),uid=query.get('uid')||'customer';
await auth.authStateReady();
(auth as any).currentUser={uid,phoneNumber:'+919876543210',getIdToken:async()=>uid,getIdTokenResult:async()=>({claims:{}})};
localStorage.setItem('repaido.token',uid);
function Preview(){
 const [booking,setBooking]=useState<{service:Service;person?:{id:string;name:string}}>(),[home,setHome]=useState<{service:string;person:{id:string;name:string}}>();
 if(query.has('community'))return <RepaidiansModal account={uid} name="Fixture member" city="Balasore" onClose={()=>{}} onBook={()=>{}}/>;
 return <main className={query.has('live')?'rp-shell':undefined} style={{maxWidth:960,margin:'auto',padding:16,background:'var(--ui-surface)'}}><AppExperience/>{query.has('live')?<LiveVideoHub account={uid} professional={uid==='worker'} onSignIn={()=>{}}/>:<><HomeDiscoveryHub accountKey={uid} location={{lat:21.4934,lng:86.9135,city:'Balasore',address:'Fixture pickup entrance 123',confirmed:true}} onLocation={()=>{}} onSignIn={()=>{}} onEvent={()=>{}} onBook={(service,person)=>setBooking({service,person})} onHome={(service,person)=>setHome({service,person})}/>{query.get('job')&&<ShareMilestone source="service" id={query.get('job')!}/>}</>}{booking&&<LiveBooking service={booking.service} preferredWorker={booking.person} city="Balasore" onClose={()=>setBooking(undefined)} onSignIn={()=>{}} onBooked={()=>setBooking(undefined)}/>} {home&&<HomeHub initialService={home.service} preferredWorker={home.person} city="Balasore" onClose={()=>setHome(undefined)} onSignIn={()=>{}} onPlans={()=>setHome(undefined)}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
