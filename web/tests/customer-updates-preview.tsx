import {StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CustomerNotificationDrawer} from '../src/components/CustomerNotificationDrawer';
import {OperationalJobs} from '../src/components/OperationalJobs';
import {AppExperience} from '../src/components/AppExperience';
import {auth} from '../src/firebase';
import RepaidiansModal from '../src/components/repaidians/RepaidiansModal';
import '../src/styles.css';
import '../src/design-system.css';
// The backend still verifies the disposable SQLite session; model only the
// signed-in Firebase client state expected by the current booking components.
await auth.authStateReady();
const fixtureToken=localStorage.getItem('repaido.token')||'';
const fixtureUid=new URLSearchParams(location.search).get('account')||'customer-updates-fixture';
(auth as any).currentUser=fixtureToken?{uid:fixtureUid,getIdToken:async()=>fixtureToken,getIdTokenResult:async()=>({claims:{}})}:null;
(auth as any).onIdTokenChanged=(next:any)=>{queueMicrotask(()=>(typeof next==='function'?next:next.next)(auth.currentUser));return()=>{};};
function Preview(){
  const [open,setOpen]=useState(false),[selected,setSelected]=useState<string>(),[count,setCount]=useState(0);
  const [communityJob,setCommunityJob]=useState<string>();
  const account=new URLSearchParams(location.search).get('account')||'guest';
  return <><h1>Customer account</h1><button aria-label="Notifications" onClick={()=>setOpen(true)}>Notifications · {count}</button><OperationalJobs key={selected||'jobs'} initialJobId={selected}/><CustomerNotificationDrawer isOpen={open} onClose={()=>setOpen(false)} onOpenJob={id=>setSelected(id)} onOpenCommunityJob={setCommunityJob} onUnreadCountChange={setCount}/>{communityJob&&<RepaidiansModal account={account} name="Discovery agent" city="Balasore" initialJobId={communityJob} onClose={()=>setCommunityJob(undefined)} onBook={()=>{}}/>}<AppExperience/></>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Preview/></StrictMode>);
