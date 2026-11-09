// Isolated local fixture; the browser runner intercepts every API request.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {auth} from '../src/firebase';
import LiveBooking from '../src/components/LiveBooking';
import {TaskSlideshowRail} from '../src/components/OperationalJobs';
import {seededServices} from '../src/data';
import type {Job} from '../src/services/operations';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/reference.css';
import '../src/components/customer-bookings.css';

await auth.authStateReady();
const user={uid:'booking-ui-fixture',getIdToken:async()=>'booking-ui-fixture'};
(auth as any).currentUser=user;
(auth as any).onIdTokenChanged=(listener:(value:typeof user)=>void)=>{queueMicrotask(()=>listener(user));return()=>{};};
const service=seededServices[0];
const jobs=Array.from({length:5},(_,index)=>({
  id:'booking-fixture-'+index,service_id:service.id,service_name:'Fixture visit '+(index+1),
  category:service.category,state:'accepted',allowed_actions:[],starts_at:'2026-11-10T10:00:00+05:30',
  city:'Balasore',total_paise:service.price,payment_status:'pay_after_service',
} as Job));

function Preview(){
  const [open,setOpen]=useState(true),[selected,setSelected]=useState('');
  if(new URLSearchParams(location.search).get('mode')==='booking')return open?<LiveBooking service={service} city="Balasore" onClose={()=>setOpen(false)} onSignIn={()=>{}} onBooked={()=>{}}/>:<p>Booking closed</p>;
  return <main className="customer-bookings-page" style={{maxWidth:960,padding:16,margin:'auto'}}>
    <h1>Booking slideshow checks</h1><div className="reference-bookings">
      <TaskSlideshowRail jobs={jobs} worker={false} onOpenReport={setSelected} onOpenJob={setSelected}/>
    </div><p role="status">{selected?'Opened '+selected:'Choose a booking'}</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
