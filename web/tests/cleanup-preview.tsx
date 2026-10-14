import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {ScrapHub} from '../src/components/LocalBusiness';
import {CleanupWorkspace} from '../src/components/CleanupWorkspace';
import {useCaptain} from '../src/components/CaptainClub';
import {AppExperience} from '../src/components/AppExperience';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
const mode=new URLSearchParams(location.search).get('mode')||'customer',uid=mode==='collector'?'worker':mode==='admin'?'admin':'customer';
await auth.authStateReady();
(auth as any).currentUser={uid,getIdToken:async()=>uid,getIdTokenResult:async()=>({claims:{}})};
(auth as any).onIdTokenChanged=(next:any)=>{queueMicrotask(()=>(typeof next==='function'?next:next.next)(auth.currentUser));return()=>{};};
localStorage.setItem('repaido.token',uid);
function GoldNav(){const captain=useCaptain();return <nav className="android-bottom-nav" data-captain-gold={captain.gold} aria-label="Gold navigation fixture"><button aria-current="page">Explore</button><button>Services</button><button>Bookings</button><button>Market</button><button>Hire</button></nav>;}
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:960,margin:'auto',padding:16}}><AppExperience/>{mode==='customer'?<ScrapHub onSignIn={()=>{}}/>:<CleanupWorkspace mode={mode==='admin'?'admin':'collector'}/>}{new URLSearchParams(location.search).has('goldnav')&&<GoldNav/>}</main>);
