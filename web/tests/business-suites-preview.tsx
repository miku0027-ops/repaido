import RepaidiansModal from '../src/components/repaidians/RepaidiansModal';
// Isolated component entry, excluded from the production bundle.
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {LocalBusinessDesk,MobilityHub,ScrapHub} from '../src/components/LocalBusiness';
import LiveWorkerPortal from '../src/components/LiveWorkerPortal';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
const query=new URLSearchParams(location.search),mode=query.get('mode')||'cab_owner',uid=query.get('uid')||'worker';
await auth.authStateReady();
(auth as any).currentUser={uid,phoneNumber:'+919876543210',getIdToken:async()=>uid,getIdTokenResult:async()=>({claims:{}})};
localStorage.setItem('repaido.token',uid);
createRoot(document.getElementById('root')!).render(query.has('portal')?<LiveWorkerPortal onBack={()=>{}}/>:<main style={{maxWidth:1100,margin:'auto'}}>{mode==='mobility'?<MobilityHub initialLocation={{lat:21.4934,lng:86.9135,city:'Balasore',address:'Fixture pickup entrance 123',confirmed:true}} onSignIn={()=>{}}/>:mode==='scrap'?<ScrapHub onSignIn={()=>{}}/>:mode==='community'?<RepaidiansModal account={uid} name="Fixture member" city="Balasore" transportLocation={{lat:21.4934,lng:86.9135,confirmed:true}} onClose={()=>{}} onBook={()=>{}}/>:<LocalBusinessDesk role={mode as 'cab_owner'|'driver'|'scrap_owner'} onBack={()=>{}} accountControls={<button>Sign out</button>}/>}</main>);
