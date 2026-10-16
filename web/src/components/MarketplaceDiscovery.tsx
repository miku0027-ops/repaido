import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Camera,Check,ChevronRight,Package,Recycle,RefreshCw,ShoppingBag,Tag,Wrench} from 'lucide-react';
import {apiAssetUrl,apiFetch} from '../services/api';
import {createReadCache} from '../services/readCache.mjs';
import {marketplaceCategory} from '../services/homeDiscoveryPlan.mjs';
import {money} from '../services/operations';
import type {QuickMarket} from './HomeQuickActions';
import type {DiscoveryEvent} from './ServiceHydration';
import type {TransportArea} from './TransportRail';

export type MarketplaceMode='refurbished'|'preowned'|'rentals'|'sell';
export type MarketplaceDestination='refurbished'|'preowned'|'rentals';
type Item={id:string;name:string;image?:string;price:number;detail:string;options:QuickMarket};
const catalogCache=createReadCache({maxEntries:16});
const modes=[
 {id:'refurbished' as const,label:'Refurbished',Icon:Recycle,title:'A fresh start for good tech.',copy:'Shop refurbished devices and appliances.',action:'Shop refurbished'},
 {id:'preowned' as const,label:'Used',Icon:ShoppingBag,title:'Good finds, close to home.',copy:'Browse items listed by nearby owners.',action:'Browse used items'},
 {id:'rentals' as const,label:'Rent',Icon:Wrench,title:'Use it. Return it. Sorted.',copy:'Rent the tools you need for your next job.',action:'Browse rentals'},
 {id:'sell' as const,label:'Sell',Icon:Tag,title:'Make room for something new.',copy:'List an item and connect with local buyers.',action:'Sell an item'}
];

export function MarketplaceDiscovery({location,accountKey,active,suggestedMode,onMarket,onEvent,onLocation}:{
 location:TransportArea;accountKey:string;active:boolean;suggestedMode?:MarketplaceMode;
 onMarket:(section:MarketplaceDestination,options?:QuickMarket)=>void;onEvent:(event:DiscoveryEvent)=>void;onLocation:()=>void;
}){
 const [manual,setManual]=useState<MarketplaceMode|null>(null),[attempt,setAttempt]=useState(0);
 const lastRead=useRef({key:'',attempt:0});
 const mode=manual||suggestedMode||'refurbished',spec=modes.find(item=>item.id===mode)!;
 const valid=location.confirmed&&Number.isFinite(location.lat)&&Number.isFinite(location.lng);
 const key=JSON.stringify([accountKey,mode,location.city,valid?location.lat:null,valid?location.lng:null]);
 const [state,setState]=useState<{key:string;items:Item[];loading:boolean;error:string}>({key:'',items:[],loading:false,error:''});
 useEffect(()=>{setManual(null);},[accountKey]);
 useEffect(()=>{
  if(!active||mode==='sell'||mode==='preowned'&&!valid)return;
  let alive=true;
  const force=lastRead.current.key===key&&lastRead.current.attempt!==attempt;lastRead.current={key,attempt};
  const cached=force?null:catalogCache.peek(key,30000) as Item[]|null;
  setState({key,items:cached||[],loading:!cached,error:''});
  void catalogCache.read(key,async()=>{
   const body=mode==='preowned'?{mode:'second_hand',location:{lat:location.lat,lng:location.lng},radius_km:10,query:''}:null;
   const response=await apiFetch('/api/operations/'+(mode==='refurbished'?'products/catalog':mode==='rentals'?'rentals/catalog':'market/search'),{
    ...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)
   },{background:true,feedback:false});
   if(!response.ok)throw Error('Items could not load. Try again.');
   const data=await response.json();
   return (data.items||[]).filter((item:any)=>mode==='refurbished'?item.condition==='refurbished'&&item.stock>0:mode==='rentals'?item.available_units>0&&(!location.city||item.shop?.city===location.city):true).slice(0,2).map((item:any):Item=>({
    id:item.id,name:item.name,image:item.image_url,price:mode==='preowned'?item.value_paise:mode==='rentals'?item.daily_paise||item.weekly_paise||item.monthly_paise:item.price_paise,
    detail:mode==='preowned'?item.city:mode==='rentals'?`${item.daily_paise?'per day':item.weekly_paise?'per week':'per month'} · ${money(item.deposit_paise)} deposit`:item.warranty||'Refurbished',
    options:mode==='preowned'?{listingId:item.id,location:{lat:location.lat!,lng:location.lng!}}:mode==='refurbished'?{productId:item.id,condition:'refurbished'}:{rentalId:item.id}
   }));
  },{freshMs:30000,force}).then(items=>{if(alive)setState({key,items,loading:false,error:''});}).catch(()=>{if(alive)setState({key,items:[],loading:false,error:'These items could not load. Check your connection and try again.'});});
  return()=>{alive=false;};
 },[key,active,attempt]);
 const snapshot=state.key!==key&&active?catalogCache.peek(key,30000) as Item[]|null:null;
 const current=state.key===key?state:snapshot?{key,items:snapshot,loading:false,error:''}:{key,items:[],loading:active&&mode!=='sell'&&(mode!=='preowned'||valid),error:''};
 const open=(options?:QuickMarket)=>onMarket(mode==='sell'?'preowned':mode,mode==='sell'?{sell:true}:options|| (mode==='refurbished'?{condition:'refurbished'}:{}));
 return <section className="marketplace-discovery" data-mode={mode} aria-label="Marketplace discovery">
  <div className="market-discovery-modes" role="group" aria-label="Marketplace service type">{modes.map(({id,label,Icon})=><button key={id} aria-pressed={id===mode} onClick={()=>{setManual(id);setAttempt(0);onEvent({kind:'category_view',category:marketplaceCategory(id)});}}><Icon size={17} aria-hidden="true"/><span>{label}</span></button>)}</div>
  <div key={mode} className="market-discovery-hero"><div><h3>{spec.title}</h3><p>{spec.copy}</p><button onClick={()=>open()}>{spec.action}<ArrowRight size={15} aria-hidden="true"/></button></div><img className="market-discovery-photo" src={'/images/banners/'+(mode==='preowned'?'sell':mode)+'.jpg'} alt="" loading="lazy" decoding="async"/></div>
  {mode==='sell'?<div className="market-selling-steps" aria-label="Listing steps"><span><Camera size={15} aria-hidden="true"/>Add photos</span><ChevronRight size={12} aria-hidden="true"/><span><Tag size={15} aria-hidden="true"/>Set a price</span><ChevronRight size={12} aria-hidden="true"/><span><Check size={15} aria-hidden="true"/>Review & list</span></div>:mode==='preowned'&&!valid?<div className="market-discovery-empty"><Package size={22} aria-hidden="true"/><div><p>Find items around your pickup area.</p><button onClick={onLocation}>Choose an area<ArrowRight size={14} aria-hidden="true"/></button></div></div>:<div className="market-discovery-stock" aria-busy={current.loading}>
   {current.loading?<div className="market-discovery-skeleton" role="status"><Package size={20} aria-hidden="true"/><span>Finding current listings…</span></div>:current.error?<div className="market-discovery-error" role="alert"><p>{current.error}</p><button onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={15} aria-hidden="true"/>Retry</button></div>:current.items.length?<><div className="market-discovery-topline"><span>{mode==='preowned'?'Within 10 km':mode==='rentals'?`Rental listings${location.city?' · '+location.city:''}`:'Available from shops'}</span><button onClick={()=>open()} aria-label={'See all '+spec.label.toLowerCase()+' items'}>See all<ArrowRight size={13} aria-hidden="true"/></button></div><div className="market-discovery-items">{current.items.map(item=><button key={item.id} className="market-discovery-item" onClick={()=>open(item.options)}><span className="market-discovery-thumb" aria-hidden="true">{item.image?<img src={apiAssetUrl(item.image)} alt="" loading="lazy" onError={event=>{event.currentTarget.hidden=true;}}/>:<Package size={23}/>}</span><span><strong>{item.name}</strong><span className="market-discovery-price">{money(item.price)}</span><small>{item.detail}</small></span><ArrowRight size={14} aria-hidden="true"/></button>)}</div></>:<div className="market-discovery-empty"><Package size={22} aria-hidden="true"/><div><p>{mode==='preowned'?'No used items nearby yet.':mode==='rentals'?'No available rentals in this city yet.':'No refurbished items are listed right now.'}</p><button onClick={()=>open()}>Browse the full catalogue<ArrowRight size={14} aria-hidden="true"/></button></div></div>}
  </div>}
 </section>;
}
