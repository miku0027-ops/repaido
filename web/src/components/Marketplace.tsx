import {Card} from './Card';
import {useEffect,useRef,useState} from 'react';
import {Plus,MapPin,Tag,Sparkles,Share2,PhoneCall,SlidersHorizontal,Search} from 'lucide-react';
import {operation,currentPosition,money} from '../services/operations';
import {apiFetch,apiAssetUrl} from '../services/api';
import {auth} from '../firebase';
import {Modal,CustomerSearchField,ActionStatus} from './ui';
import {notifyFeedback} from '../services/actionFeedback';
import {loadCheckout} from './PaymentPanel';
import {LocationPickerModal} from './LocationPickerModal';
import './operations.css';
type Mode='exchange'|'second_hand';
type Item={
  id:string;
  mode:Mode;
  name:string;
  brand:string;
  product_type:string;
  desired_type?:string;
  desired_product?:string;
  value_paise:number;
  purchase_paise:number;
  age_months:number;
  manufacture_year:number;
  warranty:string;
  condition:string;
  reason:string;
  city:string;
  radius_km:number;
  status:string;
  image_url:string;
  distance_km?:number;
  value_difference_percent?:number;
  match_label?:string;
  fee_paise?:number;
  fee_status?:string;
  expires_at?:number|null;
  trial_started_at?:number;
  free_eligible?:boolean;
  matches?:Item[];
};
type ListingReference={source:'second_hand';id:string};
const published=(item:Item)=>item.status==='published'&&(!item.expires_at||item.expires_at>Date.now()/1000);
async function publicMarketRequest<T>(path:string,init?:RequestInit):Promise<T>{
 const response=await apiFetch(`/api/operations/market${path}`,init,{background:true});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(body.detail?.message||(typeof body.detail==='string'?body.detail:null)||(response.status===404?'This listing is no longer available.':'Unable to load listings. Check your connection and retry.'));
 return body as T;
}
type SearchFilters={pin:{lat:number;lng:number}|null;radius:number;category:string;budget:string;sort:string};
const defaultFilters=(pin:SearchFilters['pin']):SearchFilters=>({pin,radius:10,category:'all',budget:'',sort:'nearby'});
const types=['phone','computer','television','appliance','camera','audio','tools','other'];
const typeLabels:Record<string,string>={all:'All Finds',phone:'Phones & Tablets',computer:'Laptops & PCs',television:'TVs & Screens',appliance:'Appliances',camera:'Cameras',audio:'Audio & Sound',tools:'Workshop Tools',other:'Other'};

export function Marketplace({mode,manage=false,onSignIn,onShare,initialCreate=false,initialListingId,initialLocation,initialSearch=''}:{mode:Mode;manage?:boolean;onSignIn?:()=>void;onShare?:(reference:ListingReference)=>void;initialCreate?:boolean;initialListingId?:string;initialLocation?:{lat:number;lng:number};initialSearch?:string}){
 const [mine,setMine]=useState(manage),[rows,setRows]=useState<Item[]>([]),[query,setQuery]=useState(initialSearch),[map,setMap]=useState(false),[form,setForm]=useState(false),[detail,setDetail]=useState<Item|null>(null),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [filters,setFilters]=useState<SearchFilters>(()=>defaultFilters(initialLocation||{lat:21.4934,lng:86.9135}));
 const [draft,setDraft]=useState(filters),[filterOpen,setFilterOpen]=useState(false),[locating,setLocating]=useState(false),[filterError,setFilterError]=useState('');
 const searchSnapshot=useRef({filters,query:initialSearch});
 const locationSequence=useRef(0);
 const closeFilters=()=>{locationSequence.current++;setLocating(false);setMap(false);setFilterOpen(false);setFilterError('');};
 useEffect(()=>()=>{locationSequence.current++;loadSequence.current++;},[]);
 const activeFilters=Number(filters.category!=='all')+Number(filters.radius!==10)+Number(!!filters.budget)+Number(filters.sort!=='nearby');
 const [listingError,setListingError]=useState('');
 const [rowsAreMine,setRowsAreMine]=useState(false);

 useEffect(()=>{if(initialCreate){setForm(true);}},[initialCreate]);
 const loadSequence=useRef(0);
 const detailSequence=useRef(0);
 const loadInitialListing=async()=>{
   if(!initialListingId)return;
   const sequence=++detailSequence.current;setListingError('');
   try{
     const item=await publicMarketRequest<Item>(`/listings/${encodeURIComponent(initialListingId)}`);
     if(sequence===detailSequence.current){if(item.mode===mode)setDetail(item);else setListingError('This listing belongs to another market section.');}
   }catch(e){if(sequence===detailSequence.current)setListingError((e as Error).message);}
 };
 useEffect(()=>{
   setDetail(null);setListingError('');void loadInitialListing();
   return()=>{detailSequence.current++;};
 },[initialListingId,mode]);

 const load=async(forMine=mine,snapshot=searchSnapshot.current)=>{
   const sequence=++loadSequence.current;
   setRowsAreMine(false);
   setBusy(true);
   setError('');
   try{
     let apiItems: Item[] = [];
     if(forMine){
       const d=await operation<{listings:Item[]}>('/market/mine');
       apiItems=d.listings.filter(x=>x.mode===mode);
     } else if(snapshot.filters.pin){
       const d=await publicMarketRequest<{items:Item[]}>('/search',{
           method:'POST',
           headers:{'Content-Type':'application/json'},
           body:JSON.stringify({mode,location:{lat:snapshot.filters.pin.lat,lng:snapshot.filters.pin.lng},radius_km:snapshot.filters.radius,query:snapshot.query})
       });
       apiItems=d.items;
     }
     
     if(sequence===loadSequence.current){setRows(apiItems);setRowsAreMine(forMine);setLoaded(true);}
   }catch(e){
     if(sequence===loadSequence.current){setRows([]);setError((e as Error).message);}
   }finally{
     if(sequence===loadSequence.current)setBusy(false);
   }
 };

 useEffect(()=>{void load();},[mine,mode]);
 useEffect(()=>{const id=window.setInterval(()=>{if(document.visibilityState==='visible')void load();},60000);return()=>clearInterval(id);},[mine,mode]);
 const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const pay=async(item:Item)=>{setBusy(true);setError('');try{const order=await operation<{key_id:string;order_id:string;amount:number;currency:string}>(`/market/${item.id}/payment-order`,{method:'POST'});await loadCheckout();const widget=new window.Razorpay!({key:order.key_id,order_id:order.order_id,amount:order.amount,currency:order.currency,name:'Repaido',description:`${mode==='exchange'?'Exchange':'Used item'} listing fee`,handler:()=>void run(()=>operation(`/market/${item.id}/payment-check`,{method:'POST'})),modal:{ondismiss:()=>setMessage('Checkout closed. If debited, use Check payment before retrying.')}});widget.on('payment.failed',()=>setError('Fee payment was not confirmed. Check payment before retrying.'));widget.open();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 
 const displayedRows=mine?[...rows]:rows.filter(item=>(filters.category==='all'||item.product_type===filters.category)&&(!filters.budget||item.value_paise<=Number(filters.budget)*100));
 if(filters.sort==='price_low')displayedRows.sort((a,b)=>a.value_paise-b.value_paise);
 if(filters.sort==='price_high')displayedRows.sort((a,b)=>b.value_paise-a.value_paise);
 if(filters.sort==='nearby')displayedRows.sort((a,b)=>(a.distance_km??Infinity)-(b.distance_km??Infinity));

 return <section className="operations community-market">
  <div className="ops-heading">
    <div>
      <h2>{mode==='exchange'?'Let’s exchange':'Second-hand finds'}</h2>
      <p>{mode==='exchange'?'Find compatible swaps near you.':'Discover used items listed by sellers near you.'}</p>
    </div>
    <button onClick={()=>setMine(v=>!v)} className="market-toggle-btn">{mine?'Browse nearby':'My listings'}</button>
  </div>
  
  <div className="market-policy">
    <Tag size={16}/>
    <span>{mode==='exchange'?'Your first eligible exchange listing is free for 30 days. No automatic charge.':'Eligible sellers can list during a 90-day free period starting with their first listing. No automatic charge.'}</span>
  </div>

  <button className="ops-primary market-create-btn" onClick={()=>setForm(true)}>
    <Plus size={16}/> {mode==='exchange'?'List for exchange':'Sell a used item'}
  </button>

  {!mine&&<form className="market-search market-search-compact" onSubmit={e=>{e.preventDefault();searchSnapshot.current={filters,query};void load();}}>
    <div className="market-query"><CustomerSearchField label="Find a product" value={query} onChange={value=>setQuery(value.slice(0,120))} placeholder="Product, brand or model…"/></div>
    <button type="button" className={`market-filter-trigger ${activeFilters?'is-filtered':''}`} aria-haspopup="dialog" aria-label={`Open filters${activeFilters?`, ${activeFilters} active`:''}`} onClick={()=>{setDraft(filters);setFilterError('');setFilterOpen(true);}}><SlidersHorizontal size={15} aria-hidden="true"/><span>Filter</span>{activeFilters>0&&<span className="market-filter-count">{activeFilters}</span>}</button>
    <button type="submit" className="market-search-submit" aria-label="Search nearby" disabled={busy||!filters.pin}><Search size={16} aria-hidden="true"/></button>
  </form>}

  {filterOpen&&<Modal title={mode==='exchange'?'Swap filters':'Pre-owned filters'} className="market-filter-modal" onClose={closeFilters}>
   <form className="market-filter-form" onSubmit={e=>{e.preventDefault();searchSnapshot.current={filters:draft,query};setFilters(draft);closeFilters();void load(mine,searchSnapshot.current);}}>
    <label>Product category<select value={draft.category} onChange={e=>setDraft(v=>({...v,category:e.target.value}))}>{['all',...types].map(t=><option key={t} value={t}>{typeLabels[t]}</option>)}</select></label>
    <div className="market-filter-fields">
     <label>Search radius<select value={draft.radius} onChange={e=>setDraft(v=>({...v,radius:Number(e.target.value)}))}>{[1,3,5,10,20,50,100].map(n=><option key={n} value={n}>{n} km</option>)}</select></label>
     <label>{mode==='exchange'?'Maximum item value (₹)':'Maximum price (₹)'}<input type="number" min="1" max="1000000" step="1" inputMode="numeric" placeholder="Any price" value={draft.budget} onChange={e=>setDraft(v=>({...v,budget:e.target.value}))}/></label>
    </div>
    <label>Sort results<select value={draft.sort} onChange={e=>setDraft(v=>({...v,sort:e.target.value}))}><option value="nearby">Nearest first</option><option value="price_low">Price: low to high</option><option value="price_high">Price: high to low</option></select></label>
    <fieldset className="market-filter-location"><legend>Search area</legend><p>{draft.pin?`${draft.pin.lat.toFixed(4)}, ${draft.pin.lng.toFixed(4)} · ${draft.radius} km radius`:'Choose an area to find nearby listings.'}</p><div>
     <button type="button" onClick={()=>setMap(true)}><MapPin size={14} aria-hidden="true"/>Choose area</button>
     <button type="button" disabled={locating} onClick={async()=>{const sequence=++locationSequence.current;setLocating(true);setFilterError('');try{const pin=await currentPosition(true);if(sequence===locationSequence.current)setDraft(v=>({...v,pin}));}catch(e){if(sequence===locationSequence.current)setFilterError((e as Error).message);}finally{if(sequence===locationSequence.current)setLocating(false);}}}>{locating?'Locating…':'Use my location'}</button>
    </div></fieldset>
    {filterError&&<p role="alert" className="ops-error">{filterError}</p>}
    <div className="market-filter-actions"><button type="button" onClick={()=>{locationSequence.current++;setLocating(false);setFilterError('');setDraft(defaultFilters(initialLocation||{lat:21.4934,lng:86.9135}));}}>Reset</button><button type="submit" className="ops-primary" disabled={locating||!draft.pin}>Apply filters</button></div>
   </form>
  </Modal>}

  {message&&<ActionStatus title="Listing update">{message}</ActionStatus>}
  {listingError&&<div className="ops-error" role="alert">{listingError}<button onClick={()=>void loadInitialListing()}>Retry listing</button></div>}
  {error&&<div className="ops-error" role="alert">{error}<button onClick={()=>void load()}>Retry</button>{onSignIn&&error.toLowerCase().includes('sign')&&<button onClick={onSignIn}>Sign in</button>}</div>}
  {busy&&<p role="status" className="market-busy-msg">Updating listings…</p>}

  <div className="market-grid">
    {displayedRows.map(item=><Card className="market-card" key={item.id}>
      <button className="market-card-open" onClick={()=>{detailSequence.current++;setListingError('');setDetail(item);}}>
        <div className="market-card-img-wrap">
          {published(item)&&item.image_url?<img src={apiAssetUrl(item.image_url)} alt={item.name} onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src='/images/icon-appliance.png';}}/>:<span className="market-image-placeholder">Photo saved privately</span>}
        </div>
        <div className="market-card-body">
          <div className="market-card-tag">{typeLabels[item.product_type] || item.product_type}</div>
          <strong>{item.name}</strong>
          <span className="market-card-sub">{item.brand} · {item.age_months}m old</span>
          <div className="market-card-price-row">
            <b>{money(item.value_paise)}</b>
            <span className="market-card-loc">{item.distance_km!==undefined?`${item.distance_km} km`:item.city}</span>
          </div>
        </div>
      </button>
      {mine&&rowsAreMine&&<div className="market-card-manage">
        <span className="status-chip">{item.status.replaceAll('_',' ')}</span>
        {item.fee_status==='free_trial'?<p className="market-fee-note">{published(item)?`Free listing${item.expires_at?` until ${new Date(item.expires_at*1000).toLocaleDateString('en-IN')}`:''}`:'Free listing inactive'} · No automatic charge</p>:<p className="market-fee-note">Listing fee: {money(item.fee_paise||0)}</p>}
        {item.free_eligible&&<button disabled={busy} onClick={()=>void run(()=>operation(`/market/${item.id}/publish-free`,{method:'POST'}))}>Publish free</button>}
        {(item.status==='awaiting_fee'||item.status==='expired'||(published(item)&&item.fee_status==='free_trial'))&&<button disabled={busy} onClick={()=>void pay(item)}>Pay listing fee · {money(item.fee_paise||0)}</button>}
        {item.fee_status!=='free_trial'&&item.fee_status!=='paid'&&<button disabled={busy} onClick={()=>void run(()=>operation(`/market/${item.id}/payment-check`,{method:'POST'}))}>Check payment</button>}
        {item.mode==='second_hand'&&published(item)&&onShare&&<button onClick={()=>onShare({source:'second_hand',id:item.id})}><Share2 size={16}/> Share on Repaidians</button>}
        {!['closed','suspended'].includes(item.status)&&<button disabled={busy} onClick={()=>void run(async()=>{await operation(`/market/${item.id}/close`,{method:'POST'});if(detail?.id===item.id)setDetail(null);})}>Close listing</button>}
      </div>}
    </Card>)}
  </div>

  {loaded&&!busy&&!error&&!displayedRows.length&&<p className="ops-empty">{mine?'You have no listings in this section yet.':'No listings match this category and area. Try another category, search or radius.'}</p>}
  {detail&&<MarketDetails key={detail.id} item={detail} onShare={mine&&rowsAreMine&&rows.some(row=>row.id===detail.id)?onShare:undefined} onSignIn={onSignIn} onClose={()=>{detailSequence.current++;setDetail(null);}}/>}
  {form&&<ListingForm mode={mode} onSignIn={onSignIn} onClose={()=>setForm(false)} onSaved={item=>{setForm(false);setMine(true);setMessage(item.status==='published'?'Your listing was saved and published.':item.status==='awaiting_fee'?'Your listing was saved. Pay its listing fee to publish it.':`Your listing was saved with status: ${item.status.replaceAll('_',' ')}.`);void load(true);}}/>}
  {map&&<LocationPickerModal isOpen areaOnly title="Choose search area" confirmLabel="Use this area" initialLat={draft.pin?.lat} initialLng={draft.pin?.lng} onClose={()=>setMap(false)} onConfirmLocation={pin=>{locationSequence.current++;setLocating(false);setFilterError('');setDraft(v=>({...v,pin}));setMap(false);}}/>}
 </section>;
}

function ListingForm({mode,onClose,onSaved,onSignIn}:{mode:Mode;onClose:()=>void;onSaved:(item:Item)=>void;onSignIn?:()=>void}){
 const [pin,setPin]=useState<{lat:number;lng:number}|null>({lat:21.4934,lng:86.9135});
 const [map,setMap]=useState(false);
 const [file,setFile]=useState<File|null>(null);
 const [photoPreview,setPhotoPreview]=useState<string>('');
 const [value,setValue]=useState('');
 const [busy,setBusy]=useState(false);
 const [phase,setPhase]=useState<'idle'|'uploading'|'saving'>('idle');
 const submitting=useRef(false);
 const [error,setError]=useState('');
 const [requestId]=useState(()=>crypto.randomUUID());
 const [photoId,setPhotoId]=useState('');
 const [free,setFree]=useState<boolean|null>(null);
 const [eligibilityError,setEligibilityError]=useState('');

 useEffect(()=>{
   let cancelled=false;
   setFree(null);setEligibilityError('');
   operation<Record<Mode,boolean>>('/market/eligibility').then(d=>{if(!cancelled)setFree(d[mode]);}).catch(e=>{if(!cancelled)setEligibilityError((e as Error).message);});
   return()=>{cancelled=true;};
 },[mode]);
 useEffect(()=>{
   if(!file){setPhotoPreview('');return;}
   const preview=URL.createObjectURL(file);setPhotoPreview(preview);
   return()=>URL.revokeObjectURL(preview);
 },[file]);

 const handleFileSelect = (f: File | null) => {
   setPhotoId('');
   if(f&&(!['image/jpeg','image/png'].includes(f.type)||f.size>5*1024*1024)){
     setFile(null);setError('Choose a JPG or PNG photo no larger than 5 MB.');notifyFeedback({tone:'error',title:'Photo not selected',message:'Choose a JPG or PNG photo no larger than 5 MB.'},'market-photo');return;
   }
   setFile(f);setError('');
 };

 return <Modal title={mode==='exchange'?'List for Exchange':'Sell Your Used Item on Repaido'} className="market-form-modal" onClose={onClose}>
  <form className="operations market-form" aria-busy={busy} onSubmit={async e=>{
    e.preventDefault();
    if(submitting.current)return;
    submitting.current=true;
    const f=new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try{
      if(!pin)throw new Error('Choose the location of your item.');
      if(!file)throw new Error('Choose a product photo before saving your listing.');
      let pid=photoId;
      if(!pid){
        setPhase('uploading');
        await auth.authStateReady();
        const token=await auth.currentUser?.getIdToken();
        if(!token)throw new Error('Sign in to upload your product photo. Your draft will stay open.');
        const response=await apiFetch('/api/operations/market/photos',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':file.type},body:file});
        const body=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(body.detail?.message||(typeof body.detail==='string'?body.detail:null)||'Your photo was not saved. Please retry.');
        if(typeof body.id!=='string'||!body.id)throw new Error('Your photo was not confirmed. Please retry.');
        pid=body.id;setPhotoId(pid);
      }
      setPhase('saving');
      const saved=await operation<Item>('/market/listings',{
          method:'POST',
          body:JSON.stringify({
            request_id:requestId,
            mode,
            name:f.get('name'),
            brand:f.get('brand'),
            product_type:f.get('type'),
            desired_type:mode==='exchange'?f.get('desired_type'):null,
            desired_product:String(f.get('desired_product')||''),
            value_paise:Math.round(Number(value)*100),
            purchase_paise:Math.round(Number(f.get('purchase'))*100),
            age_months:Number(f.get('age')),
            manufacture_year:Number(f.get('year')),
            warranty:f.get('warranty'),
            condition:f.get('condition'),
            reason:f.get('reason'),
            city:f.get('city'),
            location:{lat:pin.lat,lng:pin.lng},
            radius_km:Number(f.get('radius')||10),
            photo_id:pid,
            share_contact:true
          })
      });
      if(!saved.id||!saved.status)throw new Error('The server did not confirm your listing. Check My listings before trying again.');
      onSaved(saved);
    }catch(e){
      setError((e as Error).message);
      notifyFeedback({tone:'error',title:'Listing not confirmed',message:(e as Error).message},'/market/listings');
    }finally{
      submitting.current=false;setPhase('idle');
      setBusy(false);
    }
  }}>
    <div className="market-form-promo-badge">
      <Sparkles size={14} className="text-amber-500"/>
      <span>{free===null?'Free eligibility will be confirmed by Repaido.':free?mode==='exchange'?'Eligible: your first exchange listing is free for 30 days.':'Eligible: this listing can use your seller’s 90-day free period.':'Your free period is unavailable. Save your listing, then review its fee before publishing.'}</span>
    </div>
    {file&&<ActionStatus title={phase==='uploading'?'Uploading photo…':photoId?'Photo uploaded':'Photo selected'} tone={photoId?'success':'info'}>{file.name} · {Math.max(1,Math.round(file.size/1024))} KB. {phase==='uploading'?'Please wait for upload confirmation.':photoId?'Your photo is saved; finish submitting the listing.':'This is a preview. The photo uploads when you submit the listing.'}</ActionStatus>}

    <div className="ops-grid">
      <label>Product Name<input name="name" required minLength={3} maxLength={120} placeholder="e.g. Voltas 1.5T Inverter Split AC / Dell Inspiron 15"/></label>
      <label>Brand / OEM<input name="brand" required minLength={2} maxLength={80} placeholder="e.g. Voltas / Daikin / Samsung / Dell"/></label>
      <label>Product Category
        <select name="type">
          {types.map(t=><option key={t} value={t}>{typeLabels[t]||t}</option>)}
        </select>
      </label>
      <label>{mode==='exchange'?'Estimated Value (₹)':'Selling Price (₹)'}<input value={value} onChange={e=>setValue(e.target.value)} type="number" min={100} max={1000000} step="1" required placeholder="Expected price"/></label>
      <label>Original Purchase Price (₹)<input name="purchase" type="number" min="1" max={1000000} step="1" required placeholder="Price you paid"/></label>
      <label>Age (months)<input name="age" type="number" min={0} max={600} required/></label>
      <label>Manufacture Year<input name="year" type="number" min={1970} max={new Date().getFullYear()} required/></label>
      <label>City / Location<input name="city" required defaultValue="Balasore" minLength={2} maxLength={80}/></label>
    </div>

    <label>Condition, Working Status & Included Accessories
      <textarea name="condition" required minLength={10} maxLength={1500} placeholder="Describe its working condition, any defects and included accessories."/>
    </label>
    <label>Warranty Status
      <textarea name="warranty" required minLength={3} maxLength={500} placeholder="State any remaining warranty and its terms, or write No warranty."/>
    </label>
    <label>Reason for Selling / Exchanging
      <textarea name="reason" required minLength={5} maxLength={500} placeholder="Tell buyers why you are selling or exchanging this item."/>
    </label>

    <div className="market-photo-section">
      <label className="market-photo-label">Product Photo (JPG/PNG)</label>
      <div className="market-photo-box">
        {photoPreview ? (
          <div className="market-photo-preview-wrap">
            <img src={photoPreview} alt="Selected preview" className="market-photo-thumb"/>
            <button type="button" disabled={busy} aria-label="Remove product photo" onClick={()=>handleFileSelect(null)} className="market-photo-remove">✕</button>
          </div>
        ) : (
          <div className="market-photo-placeholder">
            <span>No photo selected</span>
          </div>
        )}
        <div className="market-photo-controls">
          <input aria-label="Product photo" type="file" disabled={busy} accept="image/jpeg,image/png" onChange={e=>handleFileSelect(e.target.files?.[0]||null)}/>
          <span className="text-xs text-slate-500">Attach your own clear JPG or PNG photo, up to 5 MB.</span>
        </div>
      </div>
    </div>

    {mode==='exchange'&&<div className="ops-grid">
      <label>Wanted Product Type
        <select name="desired_type">{types.map(t=><option key={t} value={t}>{typeLabels[t]||t}</option>)}</select>
      </label>
      <label>Wanted Brand / Requirements
        <input name="desired_product" required minLength={3} maxLength={200} placeholder="e.g. Any 1.5 Ton Copper AC or Tablet"/>
      </label>
    </div>}

    <div className="market-form-loc-row">
      <button type="button" onClick={()=>setMap(true)} className="market-form-loc-btn">
        <MapPin size={15}/> {pin?'Location Set (Tap to Change)':'Confirm Location'}
      </button>
      <span className="market-policy-badge">{free===true?'No charge to publish during your eligible free period.':'No charge to save a draft. Review any listing fee before publishing.'}</span>
    </div>

    <label className="ops-check market-terms-check">
      <input type="checkbox" required/>
      <span>I confirm these details are accurate, agree to Marketplace guidelines, and consent to sharing my seller contact with eligible signed-in buyers.</span>
    </label>

    {eligibilityError&&<p role="status">Free eligibility could not be checked: {eligibilityError}</p>}
    {error&&<p role="alert" className="ops-error">{error}{onSignIn&&error.toLowerCase().includes('sign')&&<button type="button" onClick={onSignIn}>Sign in</button>}</p>}
    {!file&&<p className="hire-small">Add a product photo to enable submission.</p>}
    <button className="ops-primary market-submit-btn" disabled={busy||!file} aria-busy={busy}>
      {busy?phase==='uploading'?'Uploading photo…':'Saving listing…':free===true?'Publish listing':'Save listing'}
    </button>
  </form>
  {map&&<LocationPickerModal isOpen onClose={()=>setMap(false)} onConfirmLocation={p=>{setPin(p);setMap(false);}}/>}
 </Modal>;
}

function MarketDetails({item,onClose,onShare,onSignIn}:{item:Item;onClose:()=>void;onShare?:(reference:ListingReference)=>void;onSignIn?:()=>void}){
 const [contact,setContact]=useState<{name:string;phone:string}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[report,setReport]=useState(''),[message,setMessage]=useState('');
 return <Modal title={item.name} className="market-detail-modal" onClose={onClose}>
  <div className="operations market-detail">
    <div className="market-detail-img-wrap">
      {published(item)&&item.image_url?<img src={apiAssetUrl(item.image_url)} alt={item.name} onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src='/images/icon-appliance.png';}}/>:<span className="market-image-placeholder">Photo saved privately</span>}
    </div>
    
    <div className="market-detail-price-hero">
      <strong>{money(item.value_paise)}</strong>
    </div>

    <dl className="market-detail-specs">
      {[
        ['Brand / Model',item.brand],
        ['Category',typeLabels[item.product_type] || item.product_type],
        ['Original Cost',money(item.purchase_paise)],
        ['Age',`${item.age_months} months`],
        ['Manufacture Year',item.manufacture_year],
        ['Warranty',item.warranty],
        ['Condition',item.condition],
        ['Reason for Sale',item.reason],
        ['Location Area',item.city],
        ...(item.mode==='exchange'?[['Exchange Requirement',item.desired_product]]:[])
      ].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
    
    <p className="market-detail-disclaimer">
      Condition and warranty are supplied by the seller. Test and inspect the item before agreeing to a direct handover. Repaido does not collect the item’s sale price here.
    </p>

    {contact ? (
      <div className="market-contact-revealed">
        <PhoneCall size={18} className="text-emerald-700"/>
        <div>
          <strong>{contact.name || 'Seller'}</strong>
          <a href={`tel:${contact.phone}`} className="market-call-link">{contact.phone}</a>
        </div>
      </div>
    ) : published(item) ? (
      <button className="ops-primary market-contact-btn" disabled={busy} onClick={async()=>{
        setBusy(true);
        setError('');
        try{
          const c = await operation<{name:string;phone:string}>(`/market/${item.id}/contact`);
          setContact(c);
          setError('');
        }catch(e){
          setError((e as Error).message);
        }finally{
          setBusy(false);
        }
      }}>
        <PhoneCall size={16}/> {busy?'Loading seller details…':'View Seller Contact Details'}
      </button>
    ) : <p role="status">This listing is {item.status.replaceAll('_',' ')} and is not available for contact.</p>}
    {item.mode==='second_hand'&&published(item)&&onShare&&<button type="button" onClick={()=>onShare({source:'second_hand',id:item.id})}><Share2 size={16}/> Share on Repaidians</button>}

    <details className="market-report-details">
      <summary>Report an issue with this listing</summary>
      <label>Reason for report<textarea value={report} onChange={e=>setReport(e.target.value)} maxLength={500} placeholder="Describe the discrepancy..."/></label>
      <button disabled={busy||report.trim().length<10} onClick={async()=>{
        setBusy(true);
        setError('');setMessage('');
        try{
          await operation(`/market/${item.id}/report`,{method:'POST',body:JSON.stringify({reason:report})});
          setMessage('Report submitted to moderation team.');
        }catch(e){
          setError((e as Error).message);
        }finally{
          setBusy(false);
        }
      }}>{busy?'Submitting…':'Submit Report'}</button>
    </details>
    {error&&<p role="alert" className="ops-error">{error}{onSignIn&&error.toLowerCase().includes('sign')&&<button type="button" onClick={onSignIn}>Sign in</button>}</p>}
    {message&&<ActionStatus title="Report submitted">{message}</ActionStatus>}
  </div>
 </Modal>;
}
export function MarketplaceAdmin(){
 const [rows,setRows]=useState<Item[]>([]),[reports,setReports]=useState<{id:string;listing_id:string;reason:string}[]>([]),[error,setError]=useState(''),[reason,setReason]=useState('');
 const load=async()=>{try{const d=await operation<{listings:Item[];reports:typeof reports}>('/admin/market');setRows(d.listings);setReports(d.reports);}catch(e){setError((e as Error).message);}};useEffect(()=>{void load();},[]);
 return <section><h2>Community listings</h2><button onClick={()=>void load()}>Refresh</button><label>Moderation reason<textarea value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}<div className="market-grid">{rows.map(x=><Card className="ops-card" key={x.id}><h3>{x.name}</h3><p>{x.mode} · {x.status} · fee {x.fee_status}</p>{reports.filter(r=>r.listing_id===x.id).map(r=><p key={r.id}>Report: {r.reason}</p>)}<button disabled={reason.trim().length<10||x.status==='suspended'} onClick={()=>void operation(`/admin/market/${x.id}/hide`,{method:'POST',body:JSON.stringify({reason})}).then(load).catch(e=>setError(e.message))}>Hide listing</button></Card>)}</div></section>;
}
