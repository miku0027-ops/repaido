// Test-only session adapter; all offer and booking checks use the isolated API.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {HomeDiscoveryHub} from '../src/components/HomeDiscoveryHub';
import {HomeGreeting} from '../src/components/HomeGreeting';
import {HomeServiceDiscovery} from '../src/components/HomeServiceDiscovery';
import ServiceStories from '../src/components/ServiceStories';
import LiveBooking from '../src/components/LiveBooking';
import {promotionService,useCampaigns,type Promotion} from '../src/components/Promotions';
import {AppExperience} from '../src/components/AppExperience';
import {seededServices} from '../src/data';
import type {CategoryId,Service} from '../src/types';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/reference.css';
import '../src/components/customer-experience.css';
import '../src/components/premium-discovery.css';
import '../src/customer-layout.css';
import '../src/components/operations.css';
import '../src/spacing.css';
await auth.authStateReady();
const listeners=new Set<(u:unknown)=>void>();
function session(uid:string){(auth as any).currentUser={uid,getIdToken:async()=>uid,getIdTokenResult:async()=>({claims:{}})};localStorage.setItem('repaido.token',uid);listeners.forEach(fn=>fn(auth.currentUser));}
(auth as any).onIdTokenChanged=(next:((u:unknown)=>void)|{next:(u:unknown)=>void})=>{const fn=typeof next==='function'?next:next.next;listeners.add(fn);queueMicrotask(()=>fn(auth.currentUser));return()=>listeners.delete(fn);};
session('customer');
function Preview(){
 const [uid,setUid]=useState('customer'),[selected,setSelected]=useState<{service:Service;promotion?:string}>(),[category,setCategory]=useState<CategoryId>('all');
 const feed=useCampaigns('Balasore','home');const open=(c:Promotion)=>setSelected({service:promotionService(c),promotion:c.id});
 return <main className="repaido-customer-shell" style={{maxWidth:900,margin:'auto'}}><AppExperience/><header style={{padding:16,display:'flex',justifyContent:'space-between',alignItems:'center'}}><img alt="Repaido" src="/brand/repaido-logo-primary.svg" style={{width:112}}/><button onClick={()=>{const next=uid==='customer'?'stranger':'customer';setUid(next);session(next);setSelected(undefined);}}>Switch test account</button></header><h1 className="sr-only">Home discovery</h1><div className="android-explore-screen" style={{display:'grid',gap:16}}>
 <HomeGreeting greeting="Hello, Tushar!" location="Station Road, Mallikashpur" onLocation={()=>{}} offers={feed.cards} onOffer={open}/>
 <HomeDiscoveryHub key={uid} accountKey={uid} transportMode="shared" preferredFocus="transport" personalised location={{lat:21.4934,lng:86.9135,city:'Balasore',confirmed:true}} onLocation={()=>{}} onSignIn={()=>{}} onEvent={()=>{}} onHome={()=>{}} onBook={service=>setSelected({service})}/>
 <HomeServiceDiscovery campaignFeed={feed} city="Balasore" activeCategory={category} onSelectCategory={setCategory} onOpen={open} onSignIn={()=>{}}/>
 <ServiceStories services={seededServices} selected={category} onSelect={setCategory}/>
 <button style={{color:'#0b132b',background:'#fff'}} onClick={()=>setSelected({service:seededServices.find(s=>s.id==='ac-service')!})}>Reopen AC booking</button>
 </div>{selected&&<LiveBooking key={uid+selected.service.id} service={selected.service} city="Balasore" promotionId={selected.promotion} onRemovePromotion={()=>setSelected(s=>s?{service:s.service}:undefined)} onPromotion={open} onSignIn={()=>{}} onClose={()=>setSelected(undefined)} onBooked={()=>setSelected(undefined)}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
