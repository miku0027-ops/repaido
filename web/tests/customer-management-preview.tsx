// Development-only fixtures use disposable data and never enter the production bundle.
import {useEffect,useState} from 'react';
import {CustomerNotificationDrawer} from '../src/components/CustomerNotificationDrawer';
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {CustomerBookingNavigation,ContributeBookings,type BookingService} from '../src/components/ContributeBookings';
import {SupportQuickButton,SupportDialog} from '../src/components/SupportWorkspace';
import OperationsAdmin from '../src/components/OperationsAdmin';
import {SparePartsShop} from '../src/components/SparePartsShop';
import {MarketWorkspace} from '../src/components/MarketWorkspace';
import {AppExperience} from '../src/components/AppExperience';
import RepaidoBrand from '../src/components/RepaidoBrand';
import {CalendarDays,Grid2X2,Store,BriefcaseBusiness,Wrench} from '../src/icons';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/customer-layout.css';
import '../src/components/market-controls.css';
import '../src/components/compact-market.css';
await auth.authStateReady();
const view=new URLSearchParams(location.search).get('view')||'contribute';
const authListeners=new Set<any>(),tokenListeners=new Set<any>();
const fixture={emit(uid:string){(auth as any).currentUser={uid,email:uid+'@example.test',getIdToken:async()=>uid,getIdTokenResult:async()=>({claims:{admin:uid.startsWith('admin-')}})};localStorage.setItem('repaido.token',uid);for(const listener of [...authListeners,...tokenListeners])listener(auth.currentUser);}};
(auth as any).onAuthStateChanged=(listener:any)=>{authListeners.add(listener);queueMicrotask(()=>listener(auth.currentUser));return()=>authListeners.delete(listener);};
(auth as any).onIdTokenChanged=(listener:any)=>{tokenListeners.add(listener);queueMicrotask(()=>listener(auth.currentUser));return()=>tokenListeners.delete(listener);};
fixture.emit(view==='admin'?'admin-a':'customer');(window as any).__managementFixture=fixture;
function Preview(){
 const [tab,setTab]=useState<BookingService>('contribute'),[support,setSupport]=useState(false),[market,setMarket]=useState(view==='market'),[notifications,setNotifications]=useState(false),[caseId,setCaseId]=useState('');
 useEffect(()=>{const open=(event:Event)=>{setCaseId((event as CustomEvent).detail.caseId);setSupport(true);};window.addEventListener('repaido:open-support',open);return()=>window.removeEventListener('repaido:open-support',open);},[]);
 if(view==='admin')return <OperationsAdmin onBack={()=>{}}/>;
 return <div className="repaido-customer-shell" style={{paddingBottom:110}}><header style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8,padding:16,borderBottom:'1px solid #a4b3c9',background:'var(--ui-surface)'}}><RepaidoBrand size="sm"/><button style={{minHeight:44,padding:10,border:'1px solid #91a4bd',borderRadius:10}} onClick={()=>fixture.emit(auth.currentUser?.uid==='customer'?'worker2':'customer')}>Switch account</button><button style={{minHeight:44,padding:8,border:'1px solid #91a4bd',borderRadius:10}} aria-label="Open notifications" onClick={()=>setNotifications(true)}>Notifications</button></header><main id="android-main-content" style={{maxWidth:1100,margin:'auto',padding:14}}>{market?<MarketWorkspace value="spares" onChange={()=>{}}><SparePartsShop authToken="fixture" onSignIn={()=>{}}/></MarketWorkspace>:<div className="customer-bookings-page"><CustomerBookingNavigation value={tab} onChange={setTab}/>{tab==='contribute'?<ContributeBookings onSignIn={()=>{}} onArrangePickup={()=>setMarket(true)}/>:<h2>{tab} bookings</h2>}</div>}</main><nav className="android-bottom-nav" aria-label="Bottom Navigation" style={{position:'fixed',bottom:0,left:0,display:'flex',width:'100%',padding:8,background:'#17285c',gap:4,zIndex:40}}><SupportQuickButton onOpen={()=>setSupport(true)}/>{[{name:'Explore',Icon:Grid2X2},{name:'Services',Icon:Wrench},{name:'Bookings',Icon:CalendarDays},{name:'Market',Icon:Store},{name:'Hire',Icon:BriefcaseBusiness}].map(({name,Icon})=><button key={name} data-bookings-nav={name==='Bookings'?true:undefined} className={'android-nav-item '+(name==='Bookings'?'active':'')} style={{display:'flex',flex:1,flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,padding:6,border:0,minHeight:60,borderRadius:12,fontSize:11,background:name==='Bookings'?'#fff':'transparent',color:name==='Bookings'?'#17285c':'#fff'}}><Icon size={20}/><span>{name}</span></button>)}</nav>{support&&<SupportDialog initialCaseId={caseId} onClose={()=>setSupport(false)} onSignIn={()=>{}}/>}<CustomerNotificationDrawer isOpen={notifications} onClose={()=>setNotifications(false)}/><AppExperience/></div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
