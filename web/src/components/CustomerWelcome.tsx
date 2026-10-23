import {useEffect,useRef,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {ArrowRight,Car,Check,Gift,ShoppingBag,Sparkles,X} from '../icons';
import {auth} from '../firebase';
import type {Service} from '../types';
import {formatMoney} from '../data';
import {onboardingRequest,type CustomerSetup} from '../services/customerOnboarding';
import {Modal} from './ui';
import RepaidoBrand from './RepaidoBrand';
import ServiceImage from './ServiceImage';
import {AccountJourneyArt} from './AccountJourneyArt';
import {useCampaigns,type Promotion} from './Promotions';
import './account-journey.css';
import './customer-welcome.css';

export function useCustomerSetup(active=true){
 const [value,setValue]=useState<CustomerSetup|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const [uid,setUid]=useState(auth.currentUser?.uid||'');
 const identity=useRef(uid);
 useEffect(()=>onIdTokenChanged(auth,member=>{const next=member?.uid||'';if(identity.current!==next){identity.current=next;setValue(null);setError('');}setUid(next);setRevision(n=>n+1);}),[]);
 useEffect(()=>{const refresh=()=>setRevision(n=>n+1);window.addEventListener('repaido:onboarding-updated',refresh);return()=>window.removeEventListener('repaido:onboarding-updated',refresh);},[]);
 useEffect(()=>{if(!uid||!active)return;let alive=true;setError('');void onboardingRequest(uid).then(data=>{if(alive&&auth.currentUser?.uid===uid)setValue(data);}).catch(()=>{if(alive&&auth.currentUser?.uid===uid)setError('Your interests could not load. You can still explore all services.');});return()=>{alive=false;};},[uid,revision,active]);
 return {data:value?.id===uid&&auth.currentUser?.uid===uid?value:null,error,retry:()=>setRevision(n=>n+1)};
}
type CatalogueProps={setup:CustomerSetup;services:Service[];onService:(service:Service)=>void;onDestination:(kind:'transport'|'market'|'services')=>void};
function InterestCatalogue({setup,services,onService,onDestination}:CatalogueProps){
 const categories=[setup.primary_category,...setup.categories.filter(c=>c!==setup.primary_category)].filter(Boolean);
 const selected=categories.flatMap(category=>{const service=services.find(s=>s.category===category);return service?[service]:[];});
 return <div className="welcome-catalogue" aria-label="Suggested services">
  {categories.map(category=>{
   if(category==='transport')return <button type="button" key={category} className="welcome-destination welcome-go" onClick={()=>onDestination('transport')}><span className="welcome-destination-art"><Car size={32}/></span><strong>Your next ride</strong><small>Bike & cab options</small><span className="welcome-card-action">Explore Go<ArrowRight size={16}/></span></button>;
   if(category==='market')return <button type="button" key={category} className="welcome-destination welcome-market" onClick={()=>onDestination('market')}><span className="welcome-destination-art"><ShoppingBag size={30}/></span><strong>A useful local find</strong><small>Spares, rentals & more</small><span className="welcome-card-action">Explore Market<ArrowRight size={16}/></span></button>;
   const service=selected.find(s=>s.category===category);
   return service?<button type="button" className="welcome-service-card" key={service.id} onClick={()=>onService(service)}><ServiceImage service={service} decorative className="welcome-service-image"/><strong>{service.name}</strong><small>{service.duration} min · {formatMoney(service.price)}</small><span className="welcome-card-action">View service<ArrowRight size={16}/></span></button>:null;
  })}
  {!selected.length&&!categories.includes('transport')&&!categories.includes('market')&&<button type="button" className="welcome-destination" onClick={()=>onDestination('services')}><span className="welcome-destination-art"><Sparkles size={30}/></span><strong>A little help, your way</strong><small>Discover available services</small><span className="welcome-card-action">Explore services<ArrowRight size={16}/></span></button>}
 </div>;
}
export function CustomerInterestRail({setup,services,onService,onDestination,onEdit}:CatalogueProps&{onEdit:()=>void}){
 if(setup.required)return <aside className="customer-setup-notice"><span><strong>Make yourself at home</strong><small>Finish your account when you’re ready to book.</small></span><button type="button" onClick={onEdit}>Finish setup<ArrowRight size={16}/></button></aside>;
 if(!setup.categories.length)return null;
 return <section className="customer-interest-rail"><div className="welcome-section-heading"><div><span><Sparkles size={14}/>YOUR REPAIDO</span><h2>A little help, picked by you</h2></div><button type="button" onClick={onEdit}>Edit interests</button></div><InterestCatalogue setup={setup} services={services} onService={onService} onDestination={onDestination}/></section>;
}
export function CustomerWelcome({setup,name,created,services,city,onClose,onService,onDestination,onOffer}:CatalogueProps&{name:string;created:boolean;city:string;onClose:()=>void;onOffer:(offer:Promotion)=>void}){
 const feed=useCampaigns(city,'launch'),[now,setNow]=useState(Date.now());
 const account=useRef(setup.id);
 useEffect(()=>onIdTokenChanged(auth,member=>{if(member?.uid!==account.current)onClose();}),[onClose]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),10000);return()=>clearInterval(timer);},[]);
 const offers=feed.uid===setup.id?feed.cards.filter(c=>c.ends_at*1000>now).slice(0,2):[];
 const first=name.trim().split(/\s+/)[0];
 return <Modal title={created?'Welcome to Repaido':'Your Repaido is ready'} className="account-welcome-dialog" frameless onClose={onClose}>
  <div className="account-journey-header"><RepaidoBrand size="sm"/><button type="button" className="welcome-close" aria-label="Close welcome and explore Repaido" onClick={onClose}><X size={20}/></button></div>
  <div className="account-welcome-hero"><AccountJourneyArt celebrate/><span className="welcome-ready"><Check size={14}/>{created?'You’re all set':'Made a little more yours'}</span><h2>{created?`Welcome${first?', '+first:''}!`:'Your Repaido, your way.'}</h2><p>{setup.categories.length?'A little everyday help, starting with what matters to you.':'Your next repair, ride or local find starts here.'}</p></div>
  <div className="account-welcome-content"><div className="welcome-section-heading"><h3>{setup.categories.length?'Start with your interests':'Find your everyday help'}</h3></div><InterestCatalogue setup={setup} services={services} onService={onService} onDestination={onDestination}/>
   {offers.length>0&&<section className="welcome-offers" aria-label="Available welcome offers"><h3><Gift size={18}/>A little something for you</h3>{offers.map(offer=><article key={offer.id}><div><small>{offer.reason}</small><h4>{offer.title}</h4><p>{offer.body}</p>{offer.discount_paise>0&&<p className="welcome-offer-price"><strong>{formatMoney(offer.offer_price_paise)}</strong><del>{formatMoney(offer.price_paise)}</del><span>Save {formatMoney(offer.discount_paise)}</span></p>}</div><details><summary>Offer details</summary><p>{offer.terms}</p><p>Ends {new Date(offer.ends_at*1000).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata',timeZoneName:'short'})}. Availability and final price are checked before confirmation.</p></details><button type="button" onClick={()=>{if(offer.ends_at*1000<=Date.now()){feed.retry();return;}onOffer(offer);}}>View offer<ArrowRight size={16}/></button></article>)}</section>}
   {feed.busy&&<p className="welcome-feed-note" role="status">Checking available offers…</p>}{feed.error&&<p className="welcome-feed-note">{feed.error}</p>}
   <button type="button" className="account-journey-primary" onClick={onClose}>Explore my Repaido<ArrowRight size={18}/></button>
  </div>
 </Modal>;
}

export function HomeEntrance({active,name}:{active:boolean;name:string}){
 const shown=useRef(false),started=useRef(false),[visible,setVisible]=useState(false);
 const close=()=>{shown.current=true;setVisible(false);};
 useEffect(()=>{
  if(!active){if(started.current)shown.current=true;setVisible(false);return;}
  if(shown.current)return;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('reduce-motion')||document.querySelector('dialog[open]:not(.home-entrance-dialog)')){shown.current=true;return;}
  started.current=true;setVisible(true);
  const timer=setTimeout(()=>{shown.current=true;setVisible(false);},1400);
  return()=>clearTimeout(timer);
 },[active]);
 if(!visible||!active)return null;
 return <Modal title="Welcome to Repaido" frameless className="home-entrance-dialog" onClose={close}><RepaidoBrand size="sm"/><AccountJourneyArt celebrate/><h2>{name?`Good to see you, ${name.trim().split(/\s+/)[0]}.`:'A little care. Every day.'}</h2><p>Your everyday help is right here.</p><button type="button" onClick={close}>Start exploring<ArrowRight size={16}/></button></Modal>;
}
