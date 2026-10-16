import {SaveMarketItem} from './SaveMarketItem';
import {Card} from './Card';
import {useEffect,useRef,useState} from 'react';
import {Plus,MapPin,MessageCircle,Share2,PhoneCall,SlidersHorizontal,Search,RefreshCw} from 'lucide-react';
import {operation,currentPosition,money} from '../services/operations';
import {apiFetch,apiAssetUrl} from '../services/api';
import {Modal,CustomerSearchField,ActionStatus} from './ui';
import PublicSellerProfile from './PublicSellerProfile';
import {MarketInbox,MarketInboxButton} from './MarketInbox';
import {MarketChatModeration} from './MarketChatModeration';
import {MarketAccessModal,MarketAccessSummary} from './MarketAccessPanel';
import {LocationPickerModal} from './LocationPickerModal';
import './operations.css';
import './marketplace-read-states.css';
import {MarketListingForm} from './MarketListingForm';
import {onIdTokenChanged} from 'firebase/auth';
import {invalidateMarketplaceReads,marketMineSnapshot,marketSearchSnapshot,readMarketMine,readMarketSearch,type MarketSearch} from '../services/marketplaceReads';
import {auth} from '../firebase';
export type Mode='exchange'|'second_hand';
export type Item={
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
 if(!response.ok)throw Object.assign(new Error(body.detail?.message||(typeof body.detail==='string'?body.detail:null)||(response.status===404?'This listing is no longer available.':'Unable to load listings. Check your connection and retry.')),{status:response.status});
 return body as T;
}
type SearchFilters={pin:{lat:number;lng:number}|null;radius:number;category:string;budget:string;sort:string};
const defaultFilters=(pin:SearchFilters['pin']):SearchFilters=>({pin,radius:10,category:'all',budget:'',sort:'nearby'});
function marketArea(initial?:{lat:number;lng:number}):SearchFilters['pin']{
 const pin=(value:unknown)=>{const p=value as {lat?:number;lng?:number};return p&&typeof p.lat==='number'&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&typeof p.lng==='number'&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180?{lat:p.lat,lng:p.lng}:null;};
 if(initial)return pin(initial);
 try{const stored=JSON.parse(localStorage.getItem('repaido.place')||'null');return stored?.confirmed?pin(stored):null;}catch{return null;}
}

const types=['phone','computer','television','appliance','camera','audio','tools','other'];
const typeLabels:Record<string,string>={all:'All Finds',phone:'Phones & Tablets',computer:'Laptops & PCs',television:'TVs & Screens',appliance:'Appliances',camera:'Cameras',audio:'Audio & Sound',tools:'Workshop Tools',other:'Other'};

export function Marketplace({mode,manage=false,onSignIn,onShare,initialCreate=false,initialListingId,initialLocation,initialSearch=''}:{mode:Mode;manage?:boolean;onSignIn?:()=>void;onShare?:(reference:ListingReference)=>void;initialCreate?:boolean;initialListingId?:string;initialLocation?:{lat:number;lng:number};initialSearch?:string}){
 const [mine,setMine]=useState(manage),[rows,setRows]=useState<Item[]>([]),[query,setQuery]=useState(initialSearch),[map,setMap]=useState(false),[form,setForm]=useState(false),[detail,setDetail]=useState<Item|null>(null),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [inbox,setInbox]=useState<{listingId?:string}|null>(null),[accessOpen,setAccessOpen]=useState(false),[sellerProfile,setSellerProfile]=useState<{listingId?:string;chatId?:string}|null>(null);
 const [filters,setFilters]=useState<SearchFilters>(()=>defaultFilters(marketArea(initialLocation)));
 const [draft,setDraft]=useState(filters),[filterOpen,setFilterOpen]=useState(false),[locating,setLocating]=useState(false),[filterError,setFilterError]=useState('');
 const searchSnapshot=useRef({filters,query:initialSearch});
 const locationSequence=useRef(0);
 const closeFilters=()=>{locationSequence.current++;setLocating(false);setMap(false);setFilterOpen(false);setFilterError('');};
 useEffect(()=>()=>{locationSequence.current++;loadSequence.current++;},[]);
 const activeFilters=Number(filters.category!=='all')+Number(filters.radius!==10)+Number(!!filters.budget)+Number(filters.sort!=='nearby');
 const [uid,setUid]=useState(auth.currentUser?.uid||''),[rowsKey,setRowsKey]=useState(''),[detailOwner,setDetailOwner]=useState(auth.currentUser?.uid||'');
 const previousAccount=useRef(uid);
 const [guestResumeVersion,setGuestResumeVersion]=useState(0);
 const editorOwner=useRef({mounted:true,mode,epoch:0}),guestResume=useRef<{uid:string;mode:Mode;epoch:number}|null>(null);
 if(editorOwner.current.mode!==mode){editorOwner.current.mode=mode;editorOwner.current.epoch++;guestResume.current=null;}
 const editorEpoch=editorOwner.current.epoch;
 useEffect(()=>{editorOwner.current.mounted=true;return()=>{editorOwner.current.mounted=false;guestResume.current=null;};},[]);
 const closeListingForm=()=>{editorOwner.current.epoch++;guestResume.current=null;setForm(false);};
 useEffect(()=>onIdTokenChanged(auth,user=>setUid(user?.uid||'')),[]);
 const viewKey=(forMine:boolean,snapshot=searchSnapshot.current,actor=uid)=>JSON.stringify([actor,mode,forMine,snapshot.query,snapshot.filters.pin?.lat,snapshot.filters.pin?.lng,snapshot.filters.radius]);
 const currentViewKey=viewKey(mine);
 const searchBody=(snapshot:typeof searchSnapshot.current):MarketSearch|null=>snapshot.filters.pin?{mode,location:{lat:snapshot.filters.pin.lat,lng:snapshot.filters.pin.lng},radius_km:snapshot.filters.radius,query:snapshot.query}:null;
 const [listingError,setListingError]=useState('');
 const [rowsAreMine,setRowsAreMine]=useState(false);

 useEffect(()=>{if(initialCreate){setForm(true);}},[initialCreate]);
 const loadSequence=useRef(0),pendingLoad=useRef(false);
 const detailSequence=useRef(0);
 const loadInitialListing=async()=>{
   if(!initialListingId)return;
   const sequence=++detailSequence.current,actor=auth.currentUser?.uid||'';setListingError('');
   try{
     const item=await publicMarketRequest<Item>(`/listings/${encodeURIComponent(initialListingId)}`);
     if(sequence===detailSequence.current&&(auth.currentUser?.uid||'')===actor){if(item.mode===mode){setDetailOwner(actor);setDetail(item);}else setListingError('This listing belongs to another market section.');}
   }catch(e){if(sequence===detailSequence.current)setListingError((e as Error).message);}
 };
 useEffect(()=>{
   setDetail(null);setListingError('');void loadInitialListing();
   return()=>{detailSequence.current++;};
 },[initialListingId,mode,uid]);

 const load=async(forMine=mine,snapshot=searchSnapshot.current,background=false,force=false)=>{
   if(background&&pendingLoad.current)return;
   pendingLoad.current=true;
   const sequence=++loadSequence.current,actor=uid,key=viewKey(forMine,snapshot,actor),body=searchBody(snapshot);
   const cached=forMine?marketMineSnapshot():body?marketSearchSnapshot(body):null;
   if(cached){setRows(forMine?cached.filter(item=>item.mode===mode):cached);setRowsKey(key);setRowsAreMine(forMine);setLoaded(true);}
   if(!background){setBusy(!cached&&rowsKey!==key);setError('');}
   try{
     const items=forMine?await readMarketMine(force):body?await readMarketSearch(body,force):[];
     if(sequence===loadSequence.current&&(auth.currentUser?.uid||'')===actor){setRows(forMine?items.filter(item=>item.mode===mode):items);setRowsKey(key);setRowsAreMine(forMine);setLoaded(true);setError('');}
   }catch(e){
     if(sequence===loadSequence.current&&(auth.currentUser?.uid||'')===actor){if([401,402,403,404].includes((e as Error&{status?:number}).status||0)){setRows([]);setRowsKey('');}setError((e as Error).message);}
   }finally{
     if(sequence===loadSequence.current){pendingLoad.current=false;setBusy(false);}
   }
 };
 useEffect(()=>{loadSequence.current++;pendingLoad.current=false;void load();},[mine,mode,uid]);
 useEffect(()=>{if(previousAccount.current===uid)return;const wasGuest=!previousAccount.current;previousAccount.current=uid;const resume=wasGuest&&!!uid&&guestResume.current?.uid===uid&&guestResume.current.mode===mode&&guestResume.current.epoch===editorOwner.current.epoch;if(!wasGuest||!uid){editorOwner.current.epoch++;guestResume.current=null;}else if(resume){guestResume.current=null;}setDetail(null);setRowsAreMine(false);setMessage('');setError('');setInbox(null);setAccessOpen(false);setSellerProfile(null);setForm(resume);},[uid]);
 useEffect(()=>{
   const refreshed=()=>{invalidateMarketplaceReads();loadSequence.current++;pendingLoad.current=false;if(!document.hidden&&navigator.onLine)void load(mine,searchSnapshot.current,true,true);};
   window.addEventListener('repaido:operations-updated',refreshed);
   const id=window.setInterval(()=>{if(!document.hidden&&navigator.onLine)void load(mine,searchSnapshot.current,true,true);},60000);
   return()=>{clearInterval(id);window.removeEventListener('repaido:operations-updated',refreshed);};
 },[mine,mode,uid]);
 const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();await load();}catch(e){setError((e as Error).message);if((e as Error&{status?:number}).status===402)setAccessOpen(true);}finally{setBusy(false);}};

 
 const visibleRows=rowsKey===currentViewKey?rows:[];
 const displayedRows=mine?[...visibleRows]:visibleRows.filter(item=>(filters.category==='all'||item.product_type===filters.category)&&(!filters.budget||item.value_paise<=Number(filters.budget)*100));
 if(filters.sort==='price_low')displayedRows.sort((a,b)=>a.value_paise-b.value_paise);
 if(filters.sort==='price_high')displayedRows.sort((a,b)=>b.value_paise-a.value_paise);
 if(filters.sort==='nearby')displayedRows.sort((a,b)=>(a.distance_km??Infinity)-(b.distance_km??Infinity));

 return <section className="operations community-market">
  <div className="ops-heading">
    <div>
      <h2>{mode==='exchange'?'Let’s exchange':'Second-hand finds'}</h2>
      <p>{mode==='exchange'?'Find compatible swaps near you.':'Discover used items listed by sellers near you.'}</p>
    </div>
    <div className="market-view-actions"><MarketInboxButton onOpen={()=>setInbox({})}/><button type="button" aria-label="Refresh listings" disabled={busy} onClick={()=>{invalidateMarketplaceReads();void load(mine,searchSnapshot.current,false,true);}}><RefreshCw size={16} aria-hidden="true"/></button><button onClick={()=>setMine(v=>!v)} className="market-toggle-btn">{mine?'Browse nearby':'My listings'}</button></div>
  </div>
  
  <MarketAccessSummary onOpen={()=>setAccessOpen(true)}/>


  <button className="ops-primary market-create-btn" onClick={()=>setForm(true)}>
    <Plus size={16}/> {mode==='exchange'?'List for exchange':'Sell a used item'}
  </button>

  {!mine&&<form className="market-search market-search-compact" onSubmit={e=>{e.preventDefault();searchSnapshot.current={filters,query};void load(mine,searchSnapshot.current,false,true);}}>
    <div className="market-query"><CustomerSearchField label="Find a product" value={query} onChange={value=>setQuery(value.slice(0,120))} placeholder="Product, brand or model…"/></div>
    <button type="button" className={`market-filter-trigger ${activeFilters?'is-filtered':''}`} aria-haspopup="dialog" aria-label={`Open filters${activeFilters?`, ${activeFilters} active`:''}`} onClick={()=>{setDraft(filters);setFilterError('');setFilterOpen(true);}}><SlidersHorizontal size={15} aria-hidden="true"/><span>Filter</span>{activeFilters>0&&<span className="market-filter-count">{activeFilters}</span>}</button>
    <button type="submit" className="market-search-submit" aria-label="Search nearby" disabled={busy||!filters.pin}><Search size={16} aria-hidden="true"/></button>
  </form>}

  {!mine&&!filters.pin&&<p className="market-area-note" role="status">Choose an area to find nearby listings.<button type="button" onClick={()=>{setDraft(filters);setFilterOpen(true);}}>Choose area</button></p>}

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
    <div className="market-filter-actions"><button type="button" onClick={()=>{locationSequence.current++;setLocating(false);setFilterError('');setDraft(defaultFilters(marketArea(initialLocation)));}}>Reset</button><button type="submit" className="ops-primary" disabled={locating||!draft.pin}>Apply filters</button></div>
   </form>
  </Modal>}

  {message&&<ActionStatus title="Listing update">{message}</ActionStatus>}
  {listingError&&<div className="ops-error" role="alert">{listingError}<button onClick={()=>void loadInitialListing()}>Retry listing</button></div>}
  {error&&<div className="ops-error" role="alert">{error}<button onClick={()=>void load()}>Retry</button>{onSignIn&&error.toLowerCase().includes('sign')&&<button onClick={onSignIn}>Sign in</button>}</div>}
  {busy&&<p role="status" className="market-busy-msg">Updating listings…</p>}

  <div className="market-grid">
    {displayedRows.map(item=><Card className="market-card" key={item.id}>
      <button className="market-card-open" onClick={()=>{detailSequence.current++;setListingError('');setDetailOwner(uid);setDetail(item);}}>
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
        {['free_trial','access_paid'].includes(item.fee_status||'')&&<p className="market-fee-note">{published(item)?`Included in marketplace access${item.expires_at?` until ${new Date(item.expires_at*1000).toLocaleDateString('en-IN')}`:''}`:'Marketplace access ended'} · No automatic debit</p>}
        {['awaiting_fee','expired'].includes(item.status)&&<button disabled={busy} onClick={()=>setAccessOpen(true)}>Review marketplace access</button>}
        {(item.status==='awaiting_fee'||item.status==='expired')&&<button disabled={busy} onClick={()=>void run(()=>operation(`/market/${item.id}/publish-free`,{method:'POST'}))}>Publish with active access</button>}
        {!!item.fee_paise&&!['free_trial','access_paid','paid'].includes(item.fee_status||'')&&<button disabled={busy} onClick={()=>void run(()=>operation(`/market/${item.id}/payment-check`,{method:'POST'}))}>Check earlier listing payment</button>}
        {item.mode==='second_hand'&&published(item)&&onShare&&<button onClick={()=>onShare({source:'second_hand',id:item.id})}><Share2 size={16}/> Share on Repaidians</button>}
        {!['closed','suspended'].includes(item.status)&&<button disabled={busy} onClick={()=>void run(async()=>{await operation(`/market/${item.id}/close`,{method:'POST'});if(detail?.id===item.id)setDetail(null);})}>Close listing</button>}
      </div>}
    </Card>)}
  </div>

  {loaded&&rowsKey===currentViewKey&&!busy&&!error&&!displayedRows.length&&<p className="ops-empty">{mine?'You have no listings in this section yet.':'No listings match this category and area. Try another category, search or radius.'}</p>}
  {detail&&detailOwner===uid&&<MarketDetails key={uid+':'+detail.id} item={detail} onProfile={()=>setSellerProfile({listingId:detail.id})} own={mine&&rowsAreMine&&rows.some(row=>row.id===detail.id)} onMessage={()=>{setDetail(null);setInbox(mine&&rowsAreMine?{}:{listingId:detail.id});}} onShare={mine&&rowsAreMine&&rows.some(row=>row.id===detail.id)?onShare:undefined} onSignIn={onSignIn} onClose={()=>{detailSequence.current++;setDetail(null);}}/>}
  {form&&<MarketListingForm key={uid+':'+mode+':'+guestResumeVersion} mode={mode} onSignIn={onSignIn} onAccess={()=>setAccessOpen(true)} onGuestDraftClaimed={account=>{if(uid||!editorOwner.current.mounted||editorOwner.current.mode!==mode||editorOwner.current.epoch!==editorEpoch||(auth.currentUser?.uid||'')!==account)return;guestResume.current={uid:account,mode,epoch:editorEpoch};setGuestResumeVersion(version=>version+1);setForm(true);}} onCheckListings={()=>{invalidateMarketplaceReads();closeListingForm();setMine(true);void load(true,searchSnapshot.current,false,true);}} onClose={closeListingForm} onSaved={item=>{if((auth.currentUser?.uid||'')!==uid)return;closeListingForm();setMine(true);setMessage(published(item)?'Your listing was saved and published.':item.status==='published'?'Your existing listing was found, but its free period has ended. Review My listings before publishing again.':item.status==='awaiting_fee'?'Your listing was saved. Review marketplace access before publishing.':`Your listing was saved with status: ${item.status.replaceAll('_',' ')}.`);void load(true);}}/>}
  {inbox&&<MarketInbox key={uid+':'+(inbox.listingId||'inbox')} initialListingId={inbox.listingId} mode={mode} onClose={()=>setInbox(null)} onSignIn={onSignIn} onAccess={()=>setAccessOpen(true)} onOpenProfile={chatId=>setSellerProfile({chatId})}/>}
  {sellerProfile&&<PublicSellerProfile {...sellerProfile} onClose={()=>setSellerProfile(null)} onSignIn={onSignIn}/>}
  {accessOpen&&<MarketAccessModal key={'market-access:'+uid} onClose={()=>setAccessOpen(false)} onSignIn={onSignIn} onUpdated={()=>{invalidateMarketplaceReads();void load(mine,searchSnapshot.current,false,true);}}/>}
  {map&&<LocationPickerModal isOpen areaOnly title="Choose search area" confirmLabel="Use this area" initialLat={draft.pin?.lat} initialLng={draft.pin?.lng} onClose={()=>setMap(false)} onConfirmLocation={pin=>{locationSequence.current++;setLocating(false);setFilterError('');setDraft(v=>({...v,pin}));setMap(false);}}/>}
 </section>;
}

function MarketDetails({item,onClose,onShare,onSignIn,onMessage,own,onProfile}:{item:Item;own:boolean;onProfile:()=>void;onClose:()=>void;onShare?:(reference:ListingReference)=>void;onSignIn?:()=>void;onMessage:()=>void}){
 const [contact,setContact]=useState<{name:string;phone:string}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[report,setReport]=useState(''),[message,setMessage]=useState('');
 return <Modal title={item.name} className="market-detail-modal" onClose={onClose}>
  <div className="operations market-detail">
    <div className="market-detail-img-wrap">
      {published(item)&&item.image_url?<img src={apiAssetUrl(item.image_url)} alt={item.name} onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src='/images/icon-appliance.png';}}/>:<span className="market-image-placeholder">Photo saved privately</span>}
    </div>
    
    <SaveMarketItem kind={item.mode} id={item.id} label={item.name}/><div className="market-detail-price-hero">
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

    {published(item)&&<button type="button" className="ops-primary market-chat-seller" onClick={onMessage}><MessageCircle size={17} aria-hidden="true"/>{own?'View buyer messages':'Message seller'}</button>}
    <button type="button" className="market-seller-profile" onClick={onProfile}>View seller profile & listings</button>
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
 return <section><MarketChatModeration/><h2>Community listings</h2><button onClick={()=>void load()}>Refresh</button><label>Moderation reason<textarea value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}<div className="market-grid">{rows.map(x=><Card className="ops-card" key={x.id}><h3>{x.name}</h3><p>{x.mode} · {x.status} · fee {x.fee_status}</p>{reports.filter(r=>r.listing_id===x.id).map(r=><p key={r.id}>Report: {r.reason}</p>)}<button disabled={reason.trim().length<10||x.status==='suspended'} onClick={()=>void operation(`/admin/market/${x.id}/hide`,{method:'POST',body:JSON.stringify({reason})}).then(load).catch(e=>setError(e.message))}>Hide listing</button></Card>)}</div></section>;
}
