// Isolated browser entry. Never imported into production.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Bell,Grid2X2,ShoppingCart,UserRound} from 'lucide-react';
import {auth} from '../src/firebase';
import RepaidoBrand from '../src/components/RepaidoBrand';
import {HomeDiscoveryLayout} from '../src/components/HomeDiscoveryLayout';
import {HomeDiscoveryPreferences} from '../src/components/HomeDiscoveryPreferences';
import {HomeGreeting} from '../src/components/HomeGreeting';
import HomeQuickActions,{type QuickMarket} from '../src/components/HomeQuickActions';
import {useServiceHydration,HydrationControls} from '../src/components/ServiceHydration';
import type {MarketplaceDestination} from '../src/components/MarketplaceDiscovery';
import {SparePartsShop} from '../src/components/SparePartsShop';
import LiveBooking from '../src/components/LiveBooking';
import {AppExperience} from '../src/components/AppExperience';
import type {Service} from '../src/types';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/reference.css';
import '../src/customer-layout.css';
import '../src/components/premium-discovery.css';
import '../src/spacing.css';

await auth.authStateReady();
const listeners=new Set<(user:unknown)=>void>();
function session(uid:string){(auth as any).currentUser={uid,phoneNumber:'+919876543210',getIdToken:async()=>uid,getIdTokenResult:async()=>({claims:{}})};localStorage.setItem('repaido.token',uid);listeners.forEach(fn=>fn(auth.currentUser));}
(auth as any).onIdTokenChanged=(next:((user:unknown)=>void)|{next:(user:unknown)=>void})=>{const fn=typeof next==='function'?next:next.next;listeners.add(fn);queueMicrotask(()=>fn(auth.currentUser));return()=>listeners.delete(fn);};
session('customer');
const area={lat:21.4934,lng:86.9135,city:'Balasore',address:'Station Road, Balasore',confirmed:true};
function Preview(){
 const [uid,setUid]=useState('customer'),[place,setPlace]=useState(area),[visit,setVisit]=useState(0);
 const [now,setNow]=useState<Date|undefined>(()=>new Date('2026-10-14T08:00:00Z'));
 const [destination,setDestination]=useState<{section:MarketplaceDestination;options:QuickMarket}>();
 const [booking,setBooking]=useState<{service:Service;person?:{id:string;name:string}}>();
 const [preferences,setPreferences]=useState(false);
 const hydration=useServiceHydration(uid,place.city,!destination&&!booking);
 const [category,setCategory]=useState<any>('all');
 const market=(section:MarketplaceDestination,options:QuickMarket={})=>{(window as any).__elasticNavigation={section,options};setDestination({section,options});};
 const selectLocation=()=>setPlace({...area,lat:area.lat+.1,address:'Another fixture area'});
 const fresh=()=>{setVisit(v=>v+1);setDestination(undefined);setBooking(undefined);};
 useEffect(()=>{
  (window as any).__elastic={time:(stamp:string)=>setNow(new Date(stamp)),realTime:()=>setNow(undefined),newVisit:fresh,account:(account:string)=>{session(account);setUid(account);setDestination(undefined);setBooking(undefined);setVisit(v=>v+1);},location:(confirmed:boolean)=>setPlace({...area,confirmed}),suggested:()=>hydration.refresh()};
 });
 return <div className="repaido-customer-shell" style={{minHeight:'100vh',paddingBottom:88,maxWidth:1040,margin:'auto'}}><AppExperience/>
  <header className="repaido-home-header" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,padding:'12px 16px',height:64,background:'var(--ui-surface)'}}><RepaidoBrand size="sm"/><span style={{display:'flex',gap:20,color:'var(--ui-link)'}}><ShoppingCart size={20}/><Bell size={20}/><UserRound size={20}/></span></header>
  <main id="android-main-content"><h1 className="sr-only">Repaido home discovery</h1>{destination?<SparePartsShop authToken={uid} initialSection={destination.section} quickIntent={destination.options} onSignIn={()=>{}} onBackToExplore={fresh}/>:<div className="android-explore-screen">
   <HomeGreeting greeting="Hello, Tushar!" location={place.city} onLocation={selectLocation} onOffer={()=>{}} offers={[]}/>
   <HomeDiscoveryLayout key={uid+':'+visit} now={now} marketPersonalised={hydration.marketEnabled} repairVisits={hydration.feed?.repair_category_visits} discovery={{accountKey:uid,location:place,onLocation:selectLocation,onSignIn:()=>{},onPreferences:()=>setPreferences(true),onBook:(service,person)=>setBooking({service,person}),onHome:()=>{},onEvent:hydration.event,onMarket:market,personalised:hydration.enabled,preferredFocus:hydration.feed?.preferred_discovery_focus,marketMode:hydration.feed?.preferred_market_mode||undefined,repairCategory:hydration.feed?.preferred_repair_category,transportInterest:hydration.feed?.transport_interest,repairInterest:hydration.feed?.cards.some(c=>c.personalised)}} services={{city:place.city,activeCategory:category,onSelectCategory:setCategory,campaignFeed:{cards:[],seconds:8,busy:false,error:'',uid,retry:()=>{}},onOpen:()=>{},onSignIn:()=>{}}}>
    <HomeQuickActions city={place.city} location={place.confirmed?{lat:place.lat,lng:place.lng}:undefined} onLocation={selectLocation} onMarket={market} onHire={()=>{}} onHome={()=>{}} onService={service=>setBooking({service})} onCatalogue={()=>{}}/>
   </HomeDiscoveryLayout>
   <HydrationControls enabled={hydration.enabled} marketEnabled={hydration.marketEnabled} signedIn={hydration.signedIn} pending={hydration.pending} error={hydration.error} onChange={hydration.refresh} onSignIn={()=>{}}/>
  </div>}</main>
  {booking&&<LiveBooking service={booking.service} preferredWorker={booking.person} city={place.city} onSignIn={()=>{}} onClose={()=>setBooking(undefined)} onBooked={()=>setBooking(undefined)}/>}
  {preferences&&<HomeDiscoveryPreferences enabled={hydration.enabled} marketEnabled={hydration.marketEnabled} signedIn={hydration.signedIn} pending={hydration.pending} error={hydration.error} onChange={hydration.refresh} onClose={()=>setPreferences(false)} onSignIn={()=>{}}/>}
  <nav aria-label="Fixture bottom navigation" className="android-bottom-nav" style={{display:'flex',justifyContent:'space-between',gap:12,background:'#17285c',color:'white',position:'fixed',bottom:0,width:'100%',maxWidth:1040,padding:10,zIndex:40}}>{['Explore','Services','Bookings','Market','Hire'].map(name=><button key={name} style={{display:'grid',justifyItems:'center',gap:4,color:name==='Explore'?'#17285c':'#fff',background:name==='Explore'?'#fff':'transparent',border:0,borderRadius:12,padding:8,fontSize:11}}><Grid2X2 size={20}/>{name}</button>)}</nav>
 </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
