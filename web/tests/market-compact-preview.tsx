// Isolated browser fixture. This entry is not imported by the application bundle.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {Bell,BriefcaseBusiness,CalendarDays,Grid2X2,ShoppingCart,Store,UserRound,Wrench} from 'lucide-react';
import {MarketWorkspace,type MarketDestination} from '../src/components/MarketWorkspace';
import {SparePartsShop} from '../src/components/SparePartsShop';
import {B2BMarketplace} from '../src/components/B2BMarketplace';
import {TendersPlatform} from '../src/components/TendersPlatform';
import {MobilityHub,ScrapHub} from '../src/components/LocalBusiness';
import RepaidoBrand from '../src/components/RepaidoBrand';
import {auth} from '../src/firebase';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/market-controls.css';
import '../src/components/compact-market.css';

await auth.authStateReady();
(auth as any).currentUser={uid:'isolated-market-customer',phoneNumber:'+919876543210',getIdToken:async()=>'isolated-market-customer',getIdTokenResult:async()=>({claims:{}})};
localStorage.setItem('repaido.token','isolated-market-customer');
const area={lat:21.4934,lng:86.9135,city:'Balasore',address:'Station Road, Balasore',confirmed:true};
function Preview(){
 const [destination,setDestination]=useState<MarketDestination>('spares');
 return <div className="repaido-customer-shell" style={{minHeight:'100vh',paddingBottom:88}}>
  <header className="repaido-home-header" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,padding:'12px 16px',height:64,position:'sticky',top:0,zIndex:40,background:'var(--ui-surface)'}}><RepaidoBrand size="sm"/><span style={{display:'flex',gap:20,color:'var(--ui-link)'}}><ShoppingCart size={20}/><Bell size={20}/><UserRound size={20}/></span></header>
  <main id="android-main-content" style={{'--customer-header-height':'64px'} as React.CSSProperties}><MarketWorkspace value={destination} onChange={setDestination}>
   {destination==='spares'?<SparePartsShop onContracts={()=>setDestination('tenders')} authToken="isolated-market-customer" onSignIn={()=>{}}/>:
    destination==='b2b'?<B2BMarketplace customerUser={{name:'Fixture customer',phone:'9876543210',email:'customer@market.fixture'}} onSignIn={()=>{}}/>:
    destination==='tenders'?<TendersPlatform onOpenContractorPortal={()=>{}} onOpenB2BMarket={()=>setDestination('b2b')}/>:
    destination==='mobility'?<MobilityHub initialLocation={area} onSignIn={()=>{}}/>:<ScrapHub onSignIn={()=>{}}/>}
  </MarketWorkspace></main>
  <nav className="android-bottom-nav" aria-label="Fixture bottom navigation" style={{position:'fixed',bottom:0,left:0,width:'100%',display:'grid',gridTemplateColumns:'repeat(5,1fr)',padding:8,background:'#17285c',color:'white',gap:4,zIndex:40}}>{[{name:'Explore',Icon:Grid2X2},{name:'Services',Icon:Wrench},{name:'Bookings',Icon:CalendarDays},{name:'Market',Icon:Store},{name:'Hire',Icon:BriefcaseBusiness}].map(({name,Icon})=><button key={name} style={{display:'grid',justifyItems:'center',gap:3,color:name==='Market'?'#17285c':'#fff',background:name==='Market'?'#fff':'transparent',padding:6,border:0,borderRadius:12,fontSize:11}}><Icon size={20}/>{name}</button>)}</nav>
 </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
