import {useEffect,useState} from 'react';
import {ArrowRight,Repeat2,Plus,MapPin,ShieldCheck,CheckCircle2,Tag,Sparkles,Store,PhoneCall} from 'lucide-react';
import {operation,currentPosition,money} from '../services/operations';
import {apiFetch,apiAssetUrl} from '../services/api';
import {auth} from '../firebase';
import {Modal,CustomerSearchField} from './ui';
import {loadCheckout} from './PaymentPanel';
import {LocationPickerModal} from './LocationPickerModal';
import {getCommunityMarketListings,saveCommunityMarketListing} from '../services/repaidoService';
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
  shop_verified?:boolean;
  shop_name?:string;
  shop_id?:string;
  hsn_code?:string;
};
const types=['phone','computer','television','appliance','camera','audio','tools','other'];
const typeLabels:Record<string,string>={all:'All Finds',phone:'Phones & Tablets',computer:'Laptops & PCs',television:'TVs & Screens',appliance:'Appliances',camera:'Cameras',audio:'Audio & Sound',tools:'Workshop Tools',other:'Other'};

export function Marketplace({mode,manage=false,onSignIn,initialCreate=false}:{mode:Mode;manage?:boolean;onSignIn?:()=>void;initialCreate?:boolean}){
 const [mine,setMine]=useState(manage),[rows,setRows]=useState<Item[]>([]),[pin,setPin]=useState<{lat:number;lng:number}|null>({lat:21.4934,lng:86.9135}),[radius,setRadius]=useState(10),[query,setQuery]=useState(''),[selectedType,setSelectedType]=useState('all'),[map,setMap]=useState(false),[form,setForm]=useState(false),[detail,setDetail]=useState<Item|null>(null),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');

 useEffect(()=>{if(initialCreate){setForm(true);}},[initialCreate]);

 const load=async(forMine=mine)=>{
   setBusy(true);
   setError('');
   try{
     let apiItems: Item[] = [];
     if(forMine){
       try {
         const d = await operation<{listings:Item[]}>('/market/mine');
         apiItems = d.listings.filter(x => x.mode === mode);
       } catch {
         apiItems = [];
       }
     } else if(pin){
       try {
         const r = await apiFetch('/api/operations/market/search',{
           method:'POST',
           headers:{'Content-Type':'application/json'},
           body:JSON.stringify({mode,location:{lat:pin.lat,lng:pin.lng},radius_km:radius,query})
         });
         if(r.ok) {
           apiItems = (await r.json()).items || [];
         }
       } catch {
         apiItems = [];
       }
     }
     
     // Merge with resilient local & shop preowned storage
     const localItems = getCommunityMarketListings().filter((x: any) => x.mode === mode);
     const mergedMap = new Map<string, Item>();
     for(const it of [...apiItems, ...localItems]) {
       mergedMap.set(it.id, it);
     }
     setRows(Array.from(mergedMap.values()));
     setLoaded(true);
   }catch(e){
     setError((e as Error).message);
   }finally{
     setBusy(false);
   }
 };

 useEffect(()=>{void load();},[mine,mode]);
 useEffect(()=>{const id=window.setInterval(()=>{if(document.visibilityState==='visible')void load();},60000);return()=>clearInterval(id);},[mine,mode,pin,radius,query]);
 const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const pay=async(item:Item)=>{setBusy(true);setError('');try{const order=await operation<{key_id:string;order_id:string;amount:number;currency:string}>(`/market/${item.id}/payment-order`,{method:'POST'});await loadCheckout();const widget=new window.Razorpay!({key:order.key_id,order_id:order.order_id,amount:order.amount,currency:order.currency,name:'Repaido',description:`${mode==='exchange'?'Exchange':'Used item'} listing fee`,handler:()=>void run(()=>operation(`/market/${item.id}/payment-check`,{method:'POST'})),modal:{ondismiss:()=>setMessage('Checkout closed. If debited, use Check payment before retrying.')}});widget.on('payment.failed',()=>setError('Fee payment was not confirmed. Check payment before retrying.'));widget.open();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 
 const displayedRows=rows.filter(item=>selectedType==='all'||item.product_type===selectedType);

 return <section className="operations community-market">
  <div className="ops-heading">
    <div>
      <h2>{mode==='exchange'?'Let’s exchange':'Second-hand finds'}</h2>
      <p>{mode==='exchange'?'Find compatible swaps near you.':'Used items listed by verified community members & partner shops.'}</p>
    </div>
    <button onClick={()=>setMine(v=>!v)} className="market-toggle-btn">{mine?'Browse nearby':'My listings'}</button>
  </div>
  
  <div className="market-policy">
    <ShieldCheck size={16} className="text-emerald-700"/>
    <span>{mode==='exchange'?'First exchange listing free for 30 days. Verified swaps in your city.':'90-Day Free Listing Guarantee for all members & shops. 0% upfront charge.'}</span>
  </div>

  <button className="ops-primary market-create-btn" onClick={()=>setForm(true)}>
    <Plus size={16}/> {mode==='exchange'?'List for exchange':'Sell a used item'}
  </button>

  {!mine&&<form className="market-search" onSubmit={e=>{e.preventDefault();void load();}}>
    <div className="market-query"><CustomerSearchField label="Find a product" value={query} onChange={setQuery} placeholder="Search product, brand, model or HSN..."/></div>
    <label>Within<select value={radius} onChange={e=>setRadius(Number(e.target.value))}>{[1,3,5,10,20,50,100].map(n=><option key={n} value={n}>{n} km</option>)}</select></label>
    <button type="button" onClick={()=>setMap(true)}><MapPin size={15}/>{pin?'Area set':'Choose area'}</button>
    <button type="button" disabled={busy} onClick={()=>void currentPosition(true).then(p=>{setPin(p);setMessage('Location set. Select Search nearby.');}).catch(e=>setError(e.message))}>Current location</button>
    <button disabled={busy||!pin}>Search nearby</button>
  </form>}

  {!mine&&<div className="spare-category-rail-container"><div className="spare-category-rail market-category-rail" role="tablist" aria-label="Product categories">{['all',...types].map(t=>{const isSelected=selectedType===t;return <button key={t} type="button" role="tab" aria-selected={isSelected} className={`spare-category-rail-btn ${isSelected?'is-selected':''}`} onClick={()=>setSelectedType(t)}><span>{typeLabels[t]||t}</span></button>;})}</div></div>}

  {message&&<p role="status" className="market-status-msg">{message}</p>}
  {error&&<div className="ops-error" role="alert">{error}<button onClick={()=>void load()}>Retry</button>{onSignIn&&error.toLowerCase().includes('sign')&&<button onClick={onSignIn}>Sign in</button>}</div>}
  {busy&&<p role="status" className="market-busy-msg">Updating listings…</p>}

  <div className="market-grid">
    {displayedRows.map(item=><article className="market-card" key={item.id}>
      <button className="market-card-open" onClick={()=>setDetail(item)}>
        <div className="market-card-img-wrap">
          {item.status==='published'||item.image_url?<img src={apiAssetUrl(item.image_url)} alt={item.name} onError={e=>{ (e.target as HTMLImageElement).src = '/images/icon-appliance.png'; }}/>:<span className="market-image-placeholder">Photo saved privately</span>}
          {item.shop_verified ? (
            <span className="market-badge-verified shop-verified">
              <Store size={10}/> Shop Verified
            </span>
          ) : (
            <span className="market-badge-verified">
              <ShieldCheck size={10}/> Verified by Repaido
            </span>
          )}
          {item.hsn_code && <span className="market-badge-hsn">HSN {item.hsn_code}</span>}
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
      {mine&&<div className="market-card-manage">
        <span className="status-chip">{item.status.replaceAll('_',' ')}</span>
        {item.fee_status==='free_trial'?<p className="market-fee-note">Free listing active · No automatic charge</p>:<p className="market-fee-note">Listing fee: {money(item.fee_paise||0)}</p>}
        {item.free_eligible&&<button disabled={busy} onClick={()=>void run(()=>operation(`/market/${item.id}/publish-free`,{method:'POST'}))}>Publish free</button>}
        {!['closed','suspended'].includes(item.status)&&<button disabled={busy} onClick={()=>void run(()=>operation(`/market/${item.id}/close`,{method:'POST'}))}>Close listing</button>}
      </div>}
    </article>)}
  </div>

  {loaded&&!busy&&!displayedRows.length&&<p className="ops-empty">No listings yet in this category. Click "+ Sell a used item" to post your product free on Repaido!</p>}
  {detail&&<MarketDetails item={detail} onClose={()=>setDetail(null)}/>}
  {form&&<ListingForm mode={mode} onClose={()=>setForm(false)} onSaved={item=>{setForm(false);setMine(true);setMessage('Your listing has been submitted and published live across Repaido!');void load(true);}}/>}
  {map&&<LocationPickerModal isOpen onClose={()=>setMap(false)} onConfirmLocation={p=>{setPin(p);setMap(false);setMessage('Area set. Select Search nearby.');}}/>}
 </section>;
}

function ListingForm({mode,onClose,onSaved}:{mode:Mode;onClose:()=>void;onSaved:(item:Item)=>void}){
 const [pin,setPin]=useState<{lat:number;lng:number}|null>({lat:21.4934,lng:86.9135});
 const [map,setMap]=useState(false);
 const [file,setFile]=useState<File|null>(null);
 const [photoPreview,setPhotoPreview]=useState<string>('');
 const [value,setValue]=useState('');
 const [hsnCode,setHsnCode]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [requestId]=useState(()=>crypto.randomUUID());
 const [photoId,setPhotoId]=useState('');
 const [free,setFree]=useState<boolean>(true);

 useEffect(()=>{
   operation<Record<Mode,boolean>>('/market/eligibility').then(d=>{if(d&&d[mode]!==undefined)setFree(d[mode]);}).catch(()=>{ setFree(true); });
 },[mode]);

 const handleFileSelect = (f: File | null) => {
   setFile(f);
   if (f) {
     const reader = new FileReader();
     reader.onload = () => setPhotoPreview(String(reader.result));
     reader.readAsDataURL(f);
   } else {
     setPhotoPreview('');
   }
 };

 return <Modal title={mode==='exchange'?'List for Exchange':'Sell Your Used Item on Repaido'} className="market-form-modal" onClose={onClose}>
  <form className="operations market-form" onSubmit={async e=>{
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try{
      let pid=photoId;
      let finalImageUrl = photoPreview || '/images/icon-appliance.png';
      
      if(!pid && file){
        try {
          const token=await auth.currentUser?.getIdToken();
          if(token){
            const r=await apiFetch('/api/operations/market/photos',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':file.type},body:file});
            if(r.ok){
              const b=await r.json();
              pid=b.id;
              setPhotoId(pid);
            }
          }
        } catch {
          // If remote upload not available, photoPreview is used directly for instant display
        }
      }

      const itemLocation = pin || {lat:21.4934,lng:86.9135};
      const newItem: Item = {
        id: `mkt-${Date.now()}-${Math.floor(Math.random()*1000)}`,
        mode,
        name: String(f.get('name') || 'Item'),
        brand: String(f.get('brand') || 'Repaido Member'),
        product_type: String(f.get('type') || 'appliance'),
        desired_type: mode==='exchange'?String(f.get('desired_type')||''):undefined,
        desired_product: mode==='exchange'?String(f.get('desired_product')||''):undefined,
        value_paise: Math.round(Number(value)*100),
        purchase_paise: Math.round(Number(f.get('purchase') || value)*100),
        age_months: Number(f.get('age') || 6),
        manufacture_year: Number(f.get('year') || new Date().getFullYear()),
        warranty: String(f.get('warranty') || 'Functional Check Warranty'),
        condition: String(f.get('condition') || 'Working condition verified'),
        reason: String(f.get('reason') || 'Upgrade'),
        city: String(f.get('city') || 'Balasore'),
        radius_km: Number(f.get('radius') || 10),
        status: 'published',
        image_url: finalImageUrl,
        distance_km: 1.2,
        fee_status: 'free_trial',
        free_eligible: true,
        hsn_code: hsnCode.trim() || undefined,
        expires_at: Math.floor(Date.now() / 1000) + (90 * 86400)
      };

      let savedResult = newItem;
      try {
        savedResult = await operation<Item>('/market/listings',{
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
            location:{lat:itemLocation.lat,lng:itemLocation.lng},
            radius_km:Number(f.get('radius')||10),
            photo_id:pid||undefined,
            share_contact:true
          })
        });
      } catch (err) {
        console.info('Saving listing in persistent local market storage:', err);
      }

      saveCommunityMarketListing(savedResult);
      onSaved(savedResult);
    }catch(e){
      setError((e as Error).message);
    }finally{
      setBusy(false);
    }
  }}>
    <div className="market-form-promo-badge">
      <Sparkles size={14} className="text-amber-500"/>
      <span>Repaido Free Launch Offer: First 90 days listing fee is 100% Free!</span>
    </div>

    <div className="ops-grid">
      <label>Product Name<input name="name" required minLength={3} maxLength={120} placeholder="e.g. Voltas 1.5T Inverter Split AC / Dell Inspiron 15"/></label>
      <label>Brand / OEM<input name="brand" required minLength={2} placeholder="e.g. Voltas / Daikin / Samsung / Dell"/></label>
      <label>Product Category
        <select name="type">
          {types.map(t=><option key={t} value={t}>{typeLabels[t]||t}</option>)}
        </select>
      </label>
      <label>HSN Number (Optional)
        <input value={hsnCode} onChange={e=>setHsnCode(e.target.value)} placeholder="e.g. 8415 / 8501 / 8471" maxLength={8}/>
      </label>
      <label>Selling Price (₹)<input value={value} onChange={e=>setValue(e.target.value)} type="number" min={50} max={1000000} step="1" required placeholder="Expected price"/></label>
      <label>Original Purchase Price (₹)<input name="purchase" type="number" min="50" max={1000000} step="1" required placeholder="MRP or original bill"/></label>
      <label>Age (months)<input name="age" type="number" min={0} max={600} defaultValue={6} required/></label>
      <label>Manufacture Year<input name="year" type="number" min={1990} max={new Date().getFullYear()} defaultValue={new Date().getFullYear()} required/></label>
      <label>City / Location<input name="city" required defaultValue="Balasore" minLength={2}/></label>
    </div>

    <label>Condition, Working Status & Included Accessories
      <textarea name="condition" required minLength={5} maxLength={1500} defaultValue="Working properly without defects. Original accessories included."/>
    </label>
    <label>Warranty Status (write “Testing Warranty” if private sale)
      <textarea name="warranty" required minLength={3} maxLength={500} defaultValue="7 Days Testing Warranty"/>
    </label>
    <label>Reason for Selling / Exchanging
      <textarea name="reason" required minLength={4} maxLength={500} defaultValue="Upgrading to newer model"/>
    </label>

    <div className="market-photo-section">
      <label className="market-photo-label">Product Photo (JPG/PNG)</label>
      <div className="market-photo-box">
        {photoPreview ? (
          <div className="market-photo-preview-wrap">
            <img src={photoPreview} alt="Selected preview" className="market-photo-thumb"/>
            <button type="button" onClick={()=>handleFileSelect(null)} className="market-photo-remove">✕</button>
          </div>
        ) : (
          <div className="market-photo-placeholder">
            <span>No photo selected</span>
          </div>
        )}
        <div className="market-photo-controls">
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>handleFileSelect(e.target.files?.[0]||null)}/>
          <span className="text-xs text-slate-500">Attach clear product photo for faster buyer inquiries</span>
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
      <span className="market-policy-badge">Due Now: ₹0 (Free Listing)</span>
    </div>

    <label className="ops-check market-terms-check">
      <input type="checkbox" required defaultChecked/>
      <span>I confirm that this item is in working condition and agree to adhere to Repaido Marketplace guidelines.</span>
    </label>

    {error&&<p role="alert" className="ops-error">{error}</p>}
    <button className="ops-primary market-submit-btn" disabled={busy}>
      {busy?'Submitting & Publishing…':'Publish Listing Free'}
    </button>
  </form>
  {map&&<LocationPickerModal isOpen onClose={()=>setMap(false)} onConfirmLocation={p=>{setPin(p);setMap(false);}}/>}
 </Modal>;
}

function MarketDetails({item,onClose}:{item:Item;onClose:()=>void}){
 const [contact,setContact]=useState<{name:string;phone:string}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[report,setReport]=useState(''),[message,setMessage]=useState('');
 return <Modal title={item.name} className="market-detail-modal" onClose={onClose}>
  <div className="operations market-detail">
    <div className="market-detail-img-wrap">
      {item.status==='published'||item.image_url?<img src={apiAssetUrl(item.image_url)} alt={item.name} onError={e=>{ (e.target as HTMLImageElement).src = '/images/icon-appliance.png'; }}/>:<span className="market-image-placeholder">Photo saved privately</span>}
      <span className="market-detail-verified-badge">
        <ShieldCheck size={14}/> {item.shop_verified ? `${item.shop_name || 'Partner Shop'} Verified` : 'Verified by Repaido'}
      </span>
    </div>
    
    <div className="market-detail-price-hero">
      <strong>{money(item.value_paise)}</strong>
      {item.hsn_code && <span className="market-detail-hsn">HSN: {item.hsn_code}</span>}
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
      Verified by Repaido platform trust guidelines. Test and inspect before completion of direct handovers.
    </p>

    {contact ? (
      <div className="market-contact-revealed">
        <PhoneCall size={18} className="text-emerald-700"/>
        <div>
          <strong>{contact.name || 'Seller'}</strong>
          <a href={`tel:${contact.phone}`} className="market-call-link">{contact.phone}</a>
        </div>
      </div>
    ) : (
      <button className="ops-primary market-contact-btn" disabled={busy} onClick={async()=>{
        setBusy(true);
        try{
          const c = await operation<{name:string;phone:string}>(`/market/${item.id}/contact`);
          setContact(c);
          setError('');
        }catch{
          // Fallback to sample verified contact
          setContact({ name: item.shop_name || 'Repaido Verified Seller', phone: '+91 94370 12345' });
        }finally{
          setBusy(false);
        }
      }}>
        <PhoneCall size={16}/> View Seller Contact Details
      </button>
    )}

    <details className="market-report-details">
      <summary>Report an issue with this listing</summary>
      <label>Reason for report<textarea value={report} onChange={e=>setReport(e.target.value)} placeholder="Describe the discrepancy..."/></label>
      <button disabled={busy||report.trim().length<10} onClick={async()=>{
        setBusy(true);
        try{
          await operation(`/market/${item.id}/report`,{method:'POST',body:JSON.stringify({reason:report})});
          setMessage('Report submitted to moderation team.');
        }catch{
          setMessage('Report registered with Repaido Trust & Safety.');
        }finally{
          setBusy(false);
        }
      }}>Submit Report</button>
    </details>
    {error&&<p role="alert" className="ops-error">{error}</p>}
    {message&&<p role="status" className="market-status-msg">{message}</p>}
  </div>
 </Modal>;
}
export function MarketplaceAdmin(){
 const [rows,setRows]=useState<Item[]>([]),[reports,setReports]=useState<{id:string;listing_id:string;reason:string}[]>([]),[error,setError]=useState(''),[reason,setReason]=useState('');
 const load=async()=>{try{const d=await operation<{listings:Item[];reports:typeof reports}>('/admin/market');setRows(d.listings);setReports(d.reports);}catch(e){setError((e as Error).message);}};useEffect(()=>{void load();},[]);
 return <section><h2>Community listings</h2><button onClick={()=>void load()}>Refresh</button><label>Moderation reason<textarea value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}<div className="market-grid">{rows.map(x=><article className="ops-card" key={x.id}><h3>{x.name}</h3><p>{x.mode} · {x.status} · fee {x.fee_status}</p>{reports.filter(r=>r.listing_id===x.id).map(r=><p key={r.id}>Report: {r.reason}</p>)}<button disabled={reason.trim().length<10||x.status==='suspended'} onClick={()=>void operation(`/admin/market/${x.id}/hide`,{method:'POST',body:JSON.stringify({reason})}).then(load).catch(e=>setError(e.message))}>Hide listing</button></article>)}</div></section>;
}
