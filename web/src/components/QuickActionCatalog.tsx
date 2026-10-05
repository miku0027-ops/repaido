import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Package,ShoppingBag,Star,Users} from 'lucide-react';
import {apiFetch,apiAssetUrl} from '../services/api';
import {fetchLiveServices} from '../services/repaidoService';
import {cartService,type CartItem} from '../services/cartService';
import {formatMoney,categories as serviceCategories} from '../data';
import type {Service} from '../types';
import type {QuickMarket,QuickPanel} from './HomeQuickActions';

type Category={id:string;name:string};
type Entry={id:string;name:string;categories:string[];description:string;image?:string;price?:number;detail?:string;rating?:number|null;reviews?:number;service?:Service;cart?:Omit<CartItem,'quantity'>};
type Product={id:string;name:string;category:string;condition:string;price_paise:number;stock:number;shop_id:string;image_url?:string;warranty?:string};
type Listing={id:string;name:string;product_type:string;value_paise:number;condition:string;city:string;image_url?:string};
type Professional={id:string;name:string;categories:string[];bio:string;portrait_url?:string;rating:number|null;review_count:number;completed_tasks:number};
type HomeService={id:string;name:string;category:string;description:string};
const labels:Record<string,string>={phone:'Phones & tablets',computer:'Laptops & computers',television:'TVs & screens',audio:'Audio & sound',tools:'Tools',appliance:'Appliances',care:'Care',civil:'Floor plans',interiors:'Interiors',construction:'Construction'};
const label=(id:string)=>labels[id]||serviceCategories.find(c=>c.id===id)?.name||id.replace(/[_-]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());

interface Props{
  panel:QuickPanel;city:string;location?:{lat:number;lng:number};onLocation:()=>void;
  onMarket:(section:'spares'|'preowned',options?:QuickMarket)=>void;
  onHire:()=>void;onHome:(id:string)=>void;onService:(s:Service)=>void;onCatalogue:()=>void;onOpenCart?:()=>void;
}

export default function QuickActionCatalog({panel,city,location,onLocation,onMarket,onHire,onHome,onService,onCatalogue,onOpenCart}:Props){
  const [entries,setEntries]=useState<Entry[]>([]),[categories,setCategories]=useState<Category[]>([]);
  const [category,setCategory]=useState('all'),[budget,setBudget]=useState(0);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
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
        const data=await request<{professionals:Professional[];categories:Category[]}>('/api/operations/hiring/leaderboard',{city,location:location||null,radius_km:20,category:hireCategory==='all'?'':hireCategory});
        catalog=data.categories;
        rows=data.professionals.map(p=>({id:p.id,name:p.name,categories:p.categories,description:p.bio,image:p.portrait_url,rating:p.rating,reviews:p.review_count,detail:`${p.completed_tasks} completed tasks`}));
      }else if(panel==='home'){
        const data=await request<{services:HomeService[]}>('/api/operations/home/catalog');
        rows=data.services.map(s=>({id:s.id,name:s.name,categories:[s.category],description:s.description}));
      }else{
        const data=await fetchLiveServices();
        rows=data.map(s=>({id:s.id,name:s.name,categories:[s.category],description:s.description,image:s.image,price:s.price,detail:`${s.duration} minutes`,service:s}));
      }
      if(controller.signal.aborted)return;
      if(!catalog.length)catalog=[...new Set(rows.flatMap(e=>e.categories))].map(id=>({id,name:label(id)}));
      setCategories(catalog);setEntries(rows);setLoading(false);
    };
    void load().catch(e=>{if(!controller.signal.aborted){setError((e as Error).message);setLoading(false);}});
    return()=>controller.abort();
  },[panel,city,location?.lat,location?.lng,hireCategory,attempt]);

  const shown=entries.filter(e=>(category==='all'||e.categories.includes(category))&&(!budget||e.price!==undefined&&e.price<=budget));
  const choose=(entry:Entry)=>{
    if(panel==='used')onMarket('preowned',{listingId:entry.id,location,search:entry.name});
    else if(panel==='refurbished'&&entry.cart&&onOpenCart){cartService.addItem(entry.cart,1);onOpenCart();}
    else if(panel==='refurbished')onMarket('spares',{condition:'refurbished',search:entry.name});
    else if(panel==='hire')onHire();
    else if(panel==='home')onHome(entry.id);
    else if(entry.service)onService(entry.service);
  };
  return <section className="quick-dedicated-container" aria-busy={loading}>
    <p className="quick-catalog-note">{panel==='used'?'Published owner listings within 10 km of your selected location.':panel==='refurbished'?'Refurbished products from shops with current confirmed stock.':panel==='hire'?'Listed professional profiles in your service area. Availability is checked when requesting.':panel==='home'?'Choose a Home service to review its scope and request a quote.':'Current service prices and scope from the live catalog.'}</p>
    {panel==='used'&&<button className="quick-secondary-link" onClick={()=>onMarket('preowned',{sell:true,location})}>Create a used-item listing <ArrowRight size={14}/></button>}
    {panel==='used'&&!location?<div className="quick-catalog-state"><p>Choose your location to see nearby owner listings.</p><button className="quick-buy-now-btn" onClick={onLocation}>Choose location</button></div>:<>
      <nav ref={categoryRail} className="quick-filter-pills-row" aria-label="Categories">
        {[{id:'all',name:'All categories'},...categories].map(c=><button type="button" key={c.id} className={`quick-pill ${category===c.id?'active':''}`} aria-pressed={category===c.id} onClick={()=>setCategory(c.id)}>{c.name}</button>)}
      </nav>
      {panel==='refurbished'&&<div className="quick-budget-chips-row" role="group" aria-label="Budget">
        {[{value:0,name:'Any price'},{value:200000,name:'Up to ₹2,000'},{value:500000,name:'Up to ₹5,000'},{value:1500000,name:'Up to ₹15,000'}].map(b=><button key={b.value} className={`quick-pill ${budget===b.value?'active':''}`} aria-pressed={budget===b.value} onClick={()=>setBudget(b.value)}>{b.name}</button>)}
      </div>}
      {loading?<p className="quick-catalog-state" role="status">Loading live listings…</p>:error?<div className="quick-catalog-state" role="alert"><p>{error}</p><button className="quick-secondary-link" onClick={()=>setAttempt(a=>a+1)}>Retry</button></div>:<>
        <p className="quick-result-count" role="status">{shown.length} {panel==='hire'?'professionals':panel==='repair'||panel==='home'?'services':'items'}{category!=='all'?` in ${categories.find(c=>c.id===category)?.name||label(category)}`:''}</p>
        {!shown.length&&<div className="quick-catalog-state"><p>No current listings match this category{budget?' and budget':''}.</p>{(category!=='all'||budget>0)&&<button className="quick-secondary-link" onClick={()=>{setCategory('all');setBudget(0);}}>Clear filters</button>}</div>}
        <div className="quick-products-grid">{shown.map(entry=><article className="quick-product-card" key={entry.id}>
          <div className="quick-product-thumb-wrap">{entry.image?<img src={apiAssetUrl(entry.image)} alt="" className="quick-product-thumb" loading="lazy" onError={e=>{e.currentTarget.hidden=true;}}/>:panel==='hire'?<Users size={26} aria-hidden="true"/>:<Package size={26} aria-hidden="true"/>}</div>
          <div className="quick-product-info"><h3 className="quick-product-title">{entry.name}</h3><p className="quick-product-description">{entry.description}</p>{entry.detail&&<p className="quick-product-seller">{entry.detail}</p>}
            {entry.price!==undefined&&<strong className="quick-price">{formatMoney(entry.price)}</strong>}
            {entry.rating!=null&&!!entry.reviews&&<span className="quick-pro-rating"><Star size={12} aria-hidden="true"/>{entry.rating.toFixed(1)} · {entry.reviews} reviews</span>}
            <button className="quick-buy-now-btn" onClick={()=>choose(entry)}>{panel==='refurbished'&&onOpenCart?<><ShoppingBag size={14}/> Add to cart</>:panel==='hire'?'Compare professionals':panel==='repair'?'View service':panel==='home'?'View scope & quote':'View listing'}<ArrowRight size={14} aria-hidden="true"/></button>
          </div>
        </article>)}</div>
      </>}
    </>}
    <div className="quick-modal-footer-nav"><button className="quick-secondary-link" onClick={()=>panel==='used'?onMarket('preowned',{location}):panel==='refurbished'?onMarket('spares',{condition:'refurbished'}):panel==='hire'?onHire():panel==='home'?onHome(''):onCatalogue()}>Browse full {panel==='used'?'marketplace':panel==='refurbished'?'shop catalog':panel==='hire'?'professional directory':'service catalog'} <ArrowRight size={14}/></button></div>
  </section>;
}
