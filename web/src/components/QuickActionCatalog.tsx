import {useEffect,useRef,useState} from 'react';
import {ArrowRight,CalendarDays,Check,ChevronDown,Clock,MapPin,Package,Search,ShieldCheck,ShoppingBag,Star,Users} from 'lucide-react';
import {apiFetch,apiAssetUrl} from '../services/api';
import {fetchLiveServices} from '../services/repaidoService';
import {cartService,type CartItem} from '../services/cartService';
import {formatMoney,categories as serviceCategories} from '../data';
import type {Service} from '../types';
import {offerDate,type ProfessionalOffer} from './ProfessionalOffers';
import type {QuickMarket,QuickPanel} from './HomeQuickActions';
import {RepaidianBadge,type RepaidianBadgeMetadata} from './RepaidianBadge';
import './repaidian-professional.css';

type Category={id:string;name:string};
type Entry={repaidianBadge?:RepaidianBadgeMetadata|null;recurring?:boolean;scope?:string[];facts?:string[];offers?:ProfessionalOffer[];id:string;name:string;categories:string[];description:string;image?:string;price?:number;detail?:string;rating?:number|null;reviews?:number;service?:Service;cart?:Omit<CartItem,'quantity'>};
type Product={id:string;name:string;category:string;condition:string;price_paise:number;stock:number;shop_id:string;image_url?:string;warranty?:string};
type Listing={id:string;name:string;product_type:string;value_paise:number;condition:string;city:string;image_url?:string};
type Professional={repaidianBadge?:RepaidianBadgeMetadata|null;id:string;name:string;categories:string[];bio:string;portrait_url?:string;rating:number|null;review_count:number;completed_tasks:number;home_services?:string[];skills?:string[];languages?:string[];experience_years?:number;offers?:ProfessionalOffer[]};
type HomeService={id:string;name:string;category:string;description:string;recurring?:boolean;requirements?:{label:string}[];offers?:ProfessionalOffer[]};
const labels:Record<string,string>={phone:'Phones & tablets',computer:'Laptops & computers',television:'TVs & screens',audio:'Audio & sound',tools:'Tools',appliance:'Appliances',care:'Care',civil:'Floor plans',interiors:'Interiors',construction:'Construction'};
const homeArt=['maid','caretaker','interior-design','floor-plan','renovation','decor','civil-engineer','contractor'];
const repairArt:Record<string,string>={electrician:'icon-electrician.png',plumber:'icon-plumbing.png',plumbing:'icon-plumbing.png',cleaning:'icon-cleaning.png',appliance:'icon-appliance.png',gardening:'icon-gardening.png',vehicle:'icon-vehicle.png'};
const label=(id:string)=>labels[id]||serviceCategories.find(c=>c.id===id)?.name||id.replace(/[_-]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());

interface Props{
  panel:QuickPanel;city:string;location?:{lat:number;lng:number};onLocation:()=>void;
  onMarket:(section:'spares'|'refurbished'|'preowned',options?:QuickMarket)=>void;
  onHire:()=>void;onHome:(id:string,professional?:{id:string;name:string})=>void;onService:(s:Service)=>void;onCatalogue:()=>void;onOpenCart?:()=>void;
}

export default function QuickActionCatalog({panel,city,location,onLocation,onMarket,onHire,onHome,onService,onCatalogue,onOpenCart}:Props){
  const [entries,setEntries]=useState<Entry[]>([]),[categories,setCategories]=useState<Category[]>([]);
  const [category,setCategory]=useState('all'),[budget,setBudget]=useState(0);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [query,setQuery]=useState(''),[area,setArea]=useState(location?'nearby':'city'),[total,setTotal]=useState(0);
  const categoryRail=useRef<HTMLElement>(null);
  useEffect(()=>{
    categoryRail.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  },[category]);
  const hireCategory=panel==='hire'?category:'all';
  useEffect(()=>{
    const controller=new AbortController();
    setEntries([]);setError('');setLoading(true);
    const request=async<T,>(path:string,body?:object):Promise<T>=>{
      const response=await apiFetch(path,{signal:controller.signal,...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})},{background:true});
      if(!response.ok)throw Error('The live catalog could not load. Please retry.');
      return response.json();
    };
    const load=async()=>{
      let rows:Entry[]=[];let catalog:Category[]=[];
      if(panel==='used'){
        if(!location){setLoading(false);return;}
        const data=await request<{items:Listing[]}>('/api/operations/market/search',{mode:'second_hand',location,radius_km:10,query:''});
        rows=data.items.map(item=>({id:item.id,name:item.name,categories:[item.product_type],description:item.condition,image:item.image_url,price:item.value_paise,detail:item.city}));
      }else if(panel==='refurbished'){
        const data=await request<{items:Product[];shops:{id:string;name:string}[]}>('/api/operations/products/catalog');
        rows=data.items.filter(p=>p.condition==='refurbished'&&p.stock>0).map(p=>{
          const shop=data.shops.find(s=>s.id===p.shop_id);
          return {id:p.id,name:p.name,categories:[p.category],description:p.warranty||'See the shop listing for condition and warranty details.',image:p.image_url,price:p.price_paise,detail:shop?.name,cart:{id:p.id,title:p.name,price_paise:p.price_paise,image_url:p.image_url,shop_id:p.shop_id,shop_name:shop?.name,category:p.category,condition:p.condition,stock:p.stock}};
        });
      }else if(panel==='hire'){
        const data=await request<{professionals:Professional[];categories:Category[];total?:number}>('/api/operations/hiring/leaderboard',{city,location:area==='nearby'?location||null:null,radius_km:20,category:hireCategory==='all'?'':hireCategory});
        catalog=data.categories;setTotal(data.total??data.professionals.length);
        rows=data.professionals.map(p=>({id:p.id,name:p.name,categories:[...p.categories,...(p.home_services||[]).map(id=>'home:'+id)],description:p.bio||'Explore this professional’s reviewed skills and work history.',image:p.portrait_url,repaidianBadge:p.repaidianBadge,rating:p.rating,reviews:p.review_count,detail:`${p.completed_tasks} completed tasks`,facts:[...(p.experience_years!==undefined?[`${p.experience_years} years’ experience`]:[]),...(p.languages?.length?[p.languages.map(l=>l.trim()).join(' · ')]:[])],scope:p.skills,offers:p.offers}));
      }else if(panel==='home'){
        const data=await request<{services:HomeService[]}>('/api/operations/home/catalog?city='+encodeURIComponent(city));
        rows=data.services.map(s=>({id:s.id,name:s.name,categories:[s.category],description:s.description,recurring:s.recurring,scope:s.requirements?.map(f=>f.label),offers:s.offers}));
      }else{
        const data=await fetchLiveServices();
        rows=data.map(s=>({id:s.id,name:s.name,categories:[s.category],description:s.description,image:repairArt[s.category]?'/images/'+repairArt[s.category]:s.image,price:s.price,detail:`${s.duration} minutes`,scope:s.included,service:s}));
      }
      if(controller.signal.aborted)return;
      if(!catalog.length)catalog=[...new Set(rows.flatMap(e=>e.categories))].map(id=>({id,name:label(id)}));
      setCategories(catalog);setEntries(rows);setLoading(false);
    };
    void load().catch(e=>{if(!controller.signal.aborted){setError((e as Error).message);setLoading(false);}});
    return()=>controller.abort();
  },[panel,city,location?.lat,location?.lng,hireCategory,attempt,area]);

  const shown=entries.filter(e=>(category==='all'||e.categories.includes(category))&&(!budget||e.price!==undefined&&e.price<=budget)&&(!query||[e.name,e.description,...(e.scope||[])].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const choose=(entry:Entry)=>{
    if(panel==='used')onMarket('preowned',{listingId:entry.id,location,search:entry.name});
    else if(panel==='refurbished'&&entry.cart&&onOpenCart){cartService.addItem(entry.cart,1);onOpenCart();}
    else if(panel==='refurbished')onMarket('refurbished',{condition:'refurbished',search:entry.name});
    else if(panel==='hire')onHire();
    else if(panel==='home')onHome(entry.id);
    else if(entry.service)onService(entry.service);
  };
  const grouped=panel==='home'?categories.map(c=>({id:c.id,name:c.name,entries:shown.filter(e=>e.categories.includes(c.id))})).filter(g=>g.entries.length):[{id:'results',name:'',entries:shown}];
  return <section className="quick-dedicated-container" aria-busy={loading}>
    <p className="quick-catalog-note">{panel==='used'?'Published owner listings within 10 km of your selected location.':panel==='refurbished'?'Refurbished products from shops with current confirmed stock.':panel==='hire'?'Listed professional profiles in your service area. Availability is checked when requesting.':panel==='home'?'Choose a Home service to review its scope and request a quote.':'Current service prices and scope from the live catalog.'}</p>
    {panel==='home'&&<div className="quick-trust-note"><ShieldCheck size={17} aria-hidden="true"/><span>Agree the scope and price before work begins</span></div>}
    {panel==='hire'&&<><label className="quick-search"><Search size={18} aria-hidden="true"/><input aria-label="Search professionals by name or skill" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name or skill, e.g. electrician" type="search"/></label><div className="quick-area-switch" role="group" aria-label="Professional search area"><button aria-pressed={area==='nearby'} onClick={()=>location?setArea('nearby'):onLocation()}>Nearby</button><button aria-pressed={area==='city'} onClick={()=>setArea('city')}>Across {city}</button></div><p className="quick-result-count"><MapPin size={13} aria-hidden="true"/> {area==='city'?`Approved profiles across ${city}. Availability checked on request.`:'Within 20 km and the professional’s service range. Switch to city to broaden your search.'}</p></>}
    {panel==='used'&&<button className="quick-secondary-link" onClick={()=>onMarket('preowned',{sell:true,location})}>Create a used-item listing <ArrowRight size={14}/></button>}
    {panel==='used'&&!location?<div className="quick-catalog-state"><p>Choose your location to see nearby owner listings.</p><button className="quick-buy-now-btn" onClick={onLocation}>Choose location</button></div>:<>
      <nav ref={categoryRail} className="quick-filter-pills-row" aria-label="Categories">
        {[{id:'all',name:'All categories'},...categories].map(c=><button type="button" key={c.id} className={`quick-pill ${category===c.id?'active':''}`} aria-pressed={category===c.id} onClick={()=>setCategory(c.id)}>{c.name}</button>)}
      </nav>
      {panel==='refurbished'&&<div className="quick-budget-chips-row" role="group" aria-label="Budget">
        {[{value:0,name:'Any price'},{value:200000,name:'Up to ₹2,000'},{value:500000,name:'Up to ₹5,000'},{value:1500000,name:'Up to ₹15,000'}].map(b=><button key={b.value} className={`quick-pill ${budget===b.value?'active':''}`} aria-pressed={budget===b.value} onClick={()=>setBudget(b.value)}>{b.name}</button>)}
      </div>}
      {loading?<p className="quick-catalog-state" role="status">Loading live listings…</p>:error?<div className="quick-catalog-state" role="alert"><p>{error}</p><button className="quick-secondary-link" onClick={()=>setAttempt(a=>a+1)}>Retry</button></div>:<>
        <p className="quick-result-count" role="status">{shown.length} {panel==='hire'?(shown.length===1?'professional':'professionals'):panel==='repair'||panel==='home'?(shown.length===1?'service':'services'):(shown.length===1?'item':'items')}{category!=='all'?` in ${categories.find(c=>c.id===category)?.name||label(category)}`:''}</p>
        {panel==='hire'&&total>entries.length&&<p className="quick-catalog-note">Showing {entries.length} of {total} profiles. Browse the full directory to search more profiles.</p>}
        {!shown.length&&<div className="quick-catalog-state"><p>No current listings match this category{budget?' and budget':''}.</p>{(category!=='all'||budget>0||query)&&<button className="quick-secondary-link" onClick={()=>{setCategory('all');setBudget(0);setQuery('');}}>Clear filters</button>}</div>}
        <div className="quick-products-grid">{grouped.map(group=><section className="quick-category-group" key={group.id} aria-label={group.name||'Matching results'}>
          {group.name&&<div className="quick-group-heading"><h3>{group.name}</h3><span>{group.entries.length} {group.entries.length===1?'service':'services'}</span></div>}
          {group.entries.map(entry=>{const artIndex=panel==='home'?homeArt.indexOf(entry.id):-1;const Title=panel==='home'?'h4':'h3';return <article className="quick-product-card" key={entry.id}>
            <div className="quick-card-heading"><span className="repaidian-avatar-frame quick-repaidian-avatar"><span className={`quick-product-thumb-wrap ${artIndex>=0?'quick-service-art':''}`} aria-hidden="true" style={artIndex>=0?{backgroundPosition:`${artIndex%4*100/3}% ${artIndex<4?0:100}%`}:undefined}>
              {artIndex<0&&(entry.image?<img src={apiAssetUrl(entry.image)} alt="" className="quick-product-thumb" loading="lazy" onError={e=>{e.currentTarget.hidden=true;}}/>:panel==='hire'?<Users size={32}/>:<Package size={32}/>)}</span>{panel==='hire'&&<RepaidianBadge badge={entry.repaidianBadge} variant="avatar"/>}</span>
              <div className="quick-card-title-block"><span className="quick-card-eyebrow">{panel==='home'?(entry.recurring?'Ongoing home support':'Plan your project'):entry.categories.map(c=>categories.find(x=>x.id===c)?.name||label(c)).slice(0,2).join(' · ')}</span><div className="repaidian-professional-name"><Title className="quick-product-title">{entry.name}</Title>{panel==='hire'&&<RepaidianBadge badge={entry.repaidianBadge}/>}</div></div>
            </div>
            <div className="quick-product-info"><p className="quick-product-description">{entry.description}</p>
              <div className="quick-card-facts">{panel==='home'&&<span><CalendarDays size={14} aria-hidden="true"/>{entry.recurring?'7-day starter or monthly plan':'Scope & estimate first'}</span>}{entry.detail&&<span>{panel==='repair'&&<Clock size={14} aria-hidden="true"/>}{entry.detail}</span>}{entry.facts?.map(f=><span key={f}>{f}</span>)}</div>
              {entry.rating!=null&&!!entry.reviews&&<span className="quick-pro-rating"><Star size={14} aria-hidden="true"/>{entry.rating.toFixed(1)} · {entry.reviews} verified reviews</span>}
              {!!entry.scope?.length&&<details className="quick-scope"><summary>{panel==='home'?'What we’ll help you plan':panel==='hire'?'Skills & expertise':'What’s included'}<ChevronDown size={16} aria-hidden="true"/></summary><ul>{entry.scope.map((item,i)=><li key={i}><Check size={14} aria-hidden="true"/>{item}</li>)}</ul></details>}
              {!!entry.offers?.length&&<div className="quick-offer-list">{entry.offers.map(offer=><div className="quick-offer" key={offer.id}><strong>{offer.bps/100}% off the first service period</strong><p>By {offer.worker_name} · until {offerDate(offer.ends_at)}</p><details><summary>Saving & terms</summary><p>{offer.terms}</p><p>Your exact saving is calculated from the agreed service fee in your written quote.</p></details><button className="quick-offer-select" onClick={()=>onHome(offer.service_id,{id:offer.worker_id,name:offer.worker_name})}>Request with {offer.worker_name}<ArrowRight size={15} aria-hidden="true"/></button></div>)}</div>}
              <div className="quick-card-footer"><div className="quick-card-price">{entry.price!==undefined?<><span>Listed price</span><strong className="quick-price">{formatMoney(entry.price)}</strong></>:panel==='home'?<><span>Built around your requirements</span><strong>Personalised quote</strong></>:null}</div>
                <button className="quick-buy-now-btn" onClick={()=>choose(entry)}>{panel==='refurbished'&&onOpenCart?<><ShoppingBag size={15}/> Add to cart</>:panel==='hire'?'Compare professionals':panel==='repair'?'View service':panel==='home'?'View scope & quote':'View listing'}<ArrowRight size={16} aria-hidden="true"/></button></div>
            </div>
          </article>;})}
        </section>)}</div>
      </>}
    </>}
    <div className="quick-modal-footer-nav"><button className="quick-secondary-link" onClick={()=>panel==='used'?onMarket('preowned',{location}):panel==='refurbished'?onMarket('refurbished',{condition:'refurbished'}):panel==='hire'?onHire():panel==='home'?onHome(''):onCatalogue()}>Browse full {panel==='used'?'marketplace':panel==='refurbished'?'shop catalog':panel==='hire'?'professional directory':'service catalog'} <ArrowRight size={14}/></button></div>
  </section>;
}
