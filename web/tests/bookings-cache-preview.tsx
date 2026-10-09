// Development-only fixture. The browser runner intercepts every API request.
import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import {auth} from '../src/firebase';
import {AppExperience} from '../src/components/AppExperience';
import {OperationalJobs} from '../src/components/OperationalJobs';
import {HomePlans} from '../src/components/HomePlans';
import {HireRequests} from '../src/components/Hiring';
import {TransportBookings} from '../src/components/LocalBusiness';
import {Marketplace} from '../src/components/Marketplace';
import {CustomContractHub} from '../src/components/CustomContracts';
import LiveWorkerPortal from '../src/components/LiveWorkerPortal';
import {operation} from '../src/services/operations';
import {communityRequest} from '../src/services/repaidiansService';
import {actionFeedback} from '../src/services/actionFeedback';
import {loadingState} from '../src/services/loading';
import '../src/styles.css';
import '../src/design-system.css';
await auth.authStateReady();
const listeners=new Set<(user:any)=>void>();
const fixture:any={feedback:[],loading:[],emit(uid='fixture-a'){
 (auth as any).currentUser={uid,phoneNumber:'+919999999999',getIdToken:async()=>uid,getIdTokenResult:async()=>({claims:{}})};
 localStorage.setItem('repaido.token',uid);listeners.forEach(listener=>listener(auth.currentUser));
}};
(auth as any).onIdTokenChanged=(listener:(user:any)=>void)=>{listeners.add(listener);queueMicrotask(()=>listener(auth.currentUser));return()=>listeners.delete(listener);};
fixture.emit();(window as any).__bookingFixture=fixture;
actionFeedback.subscribe(()=>fixture.feedback.push(...actionFeedback.getSnapshot().map(item=>item.title)));
loadingState.subscribe(()=>fixture.loading.push(...loadingState.getSnapshot().map(item=>item.path)));
function Preview(){
 const [tab,setTab]=useState('Visits'),[account,setAccount]=useState('fixture-a');
 useEffect(()=>{
  const receipts=()=>{
   for(const path of ['/coupons/launch','/discovery/events','/worker/availability'])void operation(path,{method:'POST',body:'{"heartbeat":true}'},{background:true}).catch(()=>{});
   for(const path of ['/usage','/work/behavior'])void communityRequest(path,{method:'POST',body:'{"active":true}'}).catch(()=>{});
  };
  receipts();const timer=setInterval(receipts,8000);return()=>clearInterval(timer);
 },[]);
 if(new URLSearchParams(location.search).get('mode')==='worker')return <><LiveWorkerPortal onBack={()=>{}}/><AppExperience/></>;
 if(new URLSearchParams(location.search).get('mode')==='market')return <><Marketplace mode="second_hand"/><AppExperience/></>;
 return <><main style={{maxWidth:960,margin:'auto',padding:16}}><h1>Booking checks</h1><nav aria-label="Bookings">{['Visits','Home plans','Hiring','Contracts','Rides'].map(value=><button key={value} onClick={()=>setTab(value)}>{value}</button>)}</nav>
  <button onClick={()=>void operation('/profile',{method:'PUT',body:'{}'}).catch(()=>{})}>Save test profile</button>
  <button onClick={()=>{fixture.emit('fixture-b');setAccount('fixture-b');}}>Switch test account</button>
  <section aria-label="Selected bookings" key={account}>{tab==='Visits'?<OperationalJobs kind="visits"/>:tab==='Home plans'?<HomePlans onJob={()=>{}}/>:tab==='Hiring'?<><HireRequests onBooking={()=>{}}/><OperationalJobs kind="hiring"/></>:tab==='Contracts'?<CustomContractHub accountKey={account} authenticated mode="customer"/>:<TransportBookings onSignIn={()=>{}}/>}</section>
 </main><AppExperience/></>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
