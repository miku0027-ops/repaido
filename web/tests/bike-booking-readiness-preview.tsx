// Disposable integration fixture. Auth and HTTP are controlled by the browser
// regression; the real Market, transport, bike and shared-bike components render.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {MarketWorkspace} from '../src/components/MarketWorkspace';
import {MobilityExperience} from '../src/components/MobilityExperience';
import {Compass,BriefcaseBusiness,CalendarCheck,Store,UserRound} from '../src/icons';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/customer-layout.css';
await auth.authStateReady();
(auth as any).currentUser={uid:'readiness-customer',displayName:'Readiness customer',phoneNumber:'+919876543210',getIdToken:async()=>'readiness-customer'};
(auth as any).onIdTokenChanged=(next:any)=>{const fn=typeof next==='function'?next:next.next;queueMicrotask(()=>fn(auth.currentUser));return()=>{};};
localStorage.setItem('repaido.token','readiness-customer');
function Preview(){
 const [tab,setTab]=useState('Market');
 return <div className="repaido-customer-shell"><div className="android-app-container"><header style={{padding:'12px 14px',background:'var(--ui-surface)',color:'var(--ui-ink)'}}><h1 style={{fontSize:16,margin:0}}>Booking readiness checks</h1></header><main id="android-main-content" style={{padding:12,paddingBottom:120,minWidth:0}}>{tab==='Market'?<MarketWorkspace value="mobility" onChange={()=>{}}><MobilityExperience initialMode="bike" onSignIn={()=>{document.getElementById('readiness-notice')!.textContent='Sign-in requested';}} initialLocation={{lat:21.4934,lng:86.9135,address:'Readiness pickup railway station',city:'Balasore',confirmed:true}}/></MarketWorkspace>:<h2>Explore destination reached</h2>}<p id="readiness-notice" role="status"/></main><nav className="android-bottom-nav" aria-label="Bottom Navigation">{[{label:'Explore',Icon:Compass},{label:'Services',Icon:BriefcaseBusiness},{label:'Bookings',Icon:CalendarCheck},{label:'Market',Icon:Store},{label:'Hire',Icon:UserRound}].map(({label,Icon})=><button key={label} className={'android-nav-item'+(tab===label?' active':'')} onClick={()=>setTab(label)}><Icon size={23} aria-hidden="true"/><span>{label}</span></button>)}</nav></div></div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
