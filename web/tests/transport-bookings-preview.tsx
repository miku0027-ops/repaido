// Isolated customer shell; browser tests provide every private API response.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {auth} from '../src/firebase';
import {TransportBookings} from '../src/components/LocalBusiness';
import {CustomerBookingNavigation} from '../src/components/ContributeBookings';
import RepaidoBrand from '../src/components/RepaidoBrand';
import {CalendarDays,Compass,HomeRepair,Store,PersonSearch} from '../src/icons';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/customer-layout.css';
await auth.authStateReady();
const query=new URLSearchParams(location.search),listeners=new Set<(user:any)=>void>();
function session(uid:string){(auth as any).currentUser={uid,displayName:'Preview customer',phoneNumber:'+919876543210',getIdToken:async()=>uid};localStorage.setItem('repaido.token',uid);for(const listener of listeners)listener(auth.currentUser);}
(auth as any).onIdTokenChanged=(next:any)=>{const listener=typeof next==='function'?next:next.next;listeners.add(listener);queueMicrotask(()=>listener(auth.currentUser));return()=>listeners.delete(listener);};
session('transport-customer');
if(query.get('text')==='200')document.documentElement.style.fontSize='200%';
document.documentElement.dataset.theme=query.get('theme')==='dark'?'dark':'light';
function Preview(){const[account,setAccount]=useState(auth.currentUser!.uid);return <div className="repaido-customer-shell" style={{paddingBottom:110}}><header style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:16,background:'var(--ui-surface)'}}><RepaidoBrand size="sm"/><button style={{minHeight:44,padding:8,border:'1px solid var(--ui-line)',borderRadius:10}} onClick={()=>{session(account==='transport-customer'?'transport-other':'transport-customer');setAccount(auth.currentUser!.uid);}}>Switch account</button></header><main id="android-main-content" style={{maxWidth:900,margin:'auto',padding:14}}><h1 style={{fontSize:16,marginBottom:12}}>Your bookings</h1><CustomerBookingNavigation value="rides" onChange={()=>{}}/><TransportBookings key={account} onSignIn={()=>{}} initialRideId={query.get('ride')||undefined} initialBikeRideId={query.get('bike')||undefined} initialSharedRideId={query.get('shared')||undefined}/></main><nav className="android-bottom-nav" aria-label="Bottom Navigation" style={{position:'fixed',bottom:0,left:0,display:'flex',width:'100%',padding:8,background:'#17285c',gap:4,zIndex:40}}>{[{name:'Explore',Icon:Compass},{name:'Services',Icon:HomeRepair},{name:'Bookings',Icon:CalendarDays},{name:'Market',Icon:Store},{name:'Hire',Icon:PersonSearch}].map(({name,Icon})=><button key={name} className={'android-nav-item '+(name==='Bookings'?'active':'')} style={{display:'flex',flex:1,flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,padding:6,border:0,minHeight:60,borderRadius:12,fontSize:11,background:name==='Bookings'?'#fff':'transparent',color:name==='Bookings'?'#17285c':'#fff'}}><Icon size={20} aria-hidden="true"/><span>{name}</span></button>)}</nav></div>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
