import {useEffect,useId,useRef,useState} from 'react';
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
  <div key={mode} className="market-discovery-hero"><div><h3>{spec.title}</h3><p>{spec.copy}</p><button onClick={()=>open()}>{spec.action}<ArrowRight size={15} aria-hidden="true"/></button></div><MarketplaceScene kind={mode}/></div>
  {mode==='sell'?<div className="market-selling-steps" aria-label="Listing steps"><span><Camera size={15} aria-hidden="true"/>Add photos</span><ChevronRight size={12} aria-hidden="true"/><span><Tag size={15} aria-hidden="true"/>Set a price</span><ChevronRight size={12} aria-hidden="true"/><span><Check size={15} aria-hidden="true"/>Review & list</span></div>:mode==='preowned'&&!valid?<div className="market-discovery-empty"><Package size={22} aria-hidden="true"/><div><p>Find items around your pickup area.</p><button onClick={onLocation}>Choose an area<ArrowRight size={14} aria-hidden="true"/></button></div></div>:<div className="market-discovery-stock" aria-busy={current.loading}>
   {current.loading?<div className="market-discovery-skeleton" role="status"><Package size={20} aria-hidden="true"/><span>Finding current listings…</span></div>:current.error?<div className="market-discovery-error" role="alert"><p>{current.error}</p><button onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={15} aria-hidden="true"/>Retry</button></div>:current.items.length?<><div className="market-discovery-topline"><span>{mode==='preowned'?'Within 10 km':mode==='rentals'?`Rental listings${location.city?' · '+location.city:''}`:'Available from shops'}</span><button onClick={()=>open()} aria-label={'See all '+spec.label.toLowerCase()+' items'}>See all<ArrowRight size={13} aria-hidden="true"/></button></div><div className="market-discovery-items">{current.items.map(item=><button key={item.id} className="market-discovery-item" onClick={()=>open(item.options)}><span className="market-discovery-thumb" aria-hidden="true">{item.image?<img src={apiAssetUrl(item.image)} alt="" loading="lazy" onError={event=>{event.currentTarget.hidden=true;}}/>:<Package size={23}/>}</span><span><strong>{item.name}</strong><span className="market-discovery-price">{money(item.price)}</span><small>{item.detail}</small></span><ArrowRight size={14} aria-hidden="true"/></button>)}</div></>:<div className="market-discovery-empty"><Package size={22} aria-hidden="true"/><div><p>{mode==='preowned'?'No used items nearby yet.':mode==='rentals'?'No available rentals in this city yet.':'No refurbished items are listed right now.'}</p><button onClick={()=>open()}>Browse the full catalogue<ArrowRight size={14} aria-hidden="true"/></button></div></div>}
  </div>}
 </section>;
}

/** Original illustrations distinguish the shopping journeys without advertising invented stock. */
function MarketplaceScene({kind}:{kind:MarketplaceMode}){
 const id=useId(),colour={refurbished:'#a9baff',preowned:'#8fd6b6',rentals:'#f0c892',sell:'#e7aed1'}[kind];
 return <svg className="market-discovery-scene" viewBox="0 0 140 124" aria-hidden="true" focusable="false"><defs><linearGradient id={id+'-wash'} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff"/><stop offset="1" stopColor={colour}/></linearGradient></defs><ellipse cx="70" cy="107" rx="52" ry="10" fill="#172e50" opacity=".12"/><path d="M14 94C-7 39 47 12 103 26s22 79-32 73" fill="none" stroke={colour} strokeWidth="2" strokeDasharray="3 5"/>
  <g className="market-discovery-object" stroke="#172e50" strokeWidth="2" strokeLinejoin="round">
   {kind==='refurbished'?<><path d="m37 17 50-7 17 9v78l-17 14-50-11Z" fill={colour}/><path d="m37 17 50 5v89l-50-11Z" fill={'url(#'+id+'-wash)'}/><path d="m46 31 32 3v52l-32-3Z" fill="#172e50"/><path d="m48 68 23-30 7 1v23l-15 22-15-1Z" fill={colour}/><path d="m55 96 13 1" strokeLinecap="round"/></>:kind==='preowned'?<><path d="m29 47 43-15 40 15v47l-43 17-40-18Z" fill={'url(#'+id+'-wash)'}/><path d="m29 47 40 18 43-18M69 65v46" fill="none"/><path d="M45 39V27c0-22 46-18 46 2v10" strokeWidth="5" fill="none"/><path d="m43 76 14 6m24-1 17-7" strokeLinecap="round"/></>:kind==='rentals'?<><path d="m20 65 49-19 49 18v33l-50 17-48-17Z" fill={'url(#'+id+'-wash)'}/><path d="m20 65 48 18 50-19M68 83v31" fill="none"/><path d="m48 61 25-39-1-9 8-6 7 7-2 9-25 42Z" fill={colour}/><path d="m85 25 19-6 6 13-11 17-15-4-16 28-10-5 20-34 6 5 8-2 3-7-7-5Z" fill="#172e50" stroke="none"/></>:<><path d="m30 28 51-14 33 34-34 55-54-31Z" fill={'url(#'+id+'-wash)'}/><circle cx="44" cy="35" r="5" fill="#172e50"/><path d="M43 35C7 40 14 4 53 8" fill="none"/><path d="m54 61 21-7m-23 17 32-11m-26 25 15-5" strokeLinecap="round"/></>}
  </g><g className="market-discovery-spark" fill={colour}><path d="m116 7 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z"/><circle cx="16" cy="75" r="5"/></g></svg>;
}
