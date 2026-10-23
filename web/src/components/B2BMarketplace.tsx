import {useEffect,useId,useMemo,useRef,useState,type FormEvent} from 'react';
import {Info,ArrowRight,Boxes,Clock,FileText,MapPin,RefreshCw,Send,Building2,Check,ChevronDown,Minus,Plus,Lock,Search} from '../icons';
import type {B2BListing,B2BRfqRequest,B2BQuotation,B2BPolicy,RFQUrgency} from '../types/b2b';
import {b2bMoney,b2bService} from '../services/b2bService';
import {useB2BIdentity} from '../services/b2bIdentity';
import {slabRatePaise} from '../services/b2bMath.mjs';
import {apiAssetUrl} from '../services/api';
import {BusinessTabs,BusinessEmptyState,InlineNotice} from './BusinessUI';
import {CustomerSearchField,Modal} from './ui';
import {PrimeBadge} from './ShopPrime';
import {B2BQuotationPdfModal} from './B2BQuotationPdfModal';
import {WholesaleArt,WholesaleCategoryArt} from './WholesaleArt';
import './b2b-marketplace.css';
import './market-refinement.css';
import './wholesale-experience.css';

export const b2bCategories=[{id:'hvac',label:'HVAC & cooling'},{id:'electrical',label:'Electrical'},{id:'plumbing',label:'Plumbing'},{id:'tools',label:'Tools'},{id:'refrigerants',label:'Refrigerants'},{id:'appliances',label:'Appliances'},{id:'hardware',label:'Hardware'}] as const;
export const b2bUnits=['Pieces','Boxes','Rolls','Meters','Bundles','Kg','Sets','Cartons','Packs'] as const;
export const rfqStatusLabel=(status:string)=>({pending:'Awaiting supplier',quoted:'Quotation ready',accepted:'Accepted',declined:'Declined',cancelled:'Cancelled'}[status]||status);
interface Props {
 onOpenCart?:()=>void;customerUser?:{name?:string;phone?:string;email?:string}|null;onSignIn?:()=>void;
 contractorMode?:boolean;onOpenContractorPortal?:()=>void;onSwitchToTenders?:()=>void;
 onNavigateToCustomerMarket?:(market:'parts'|'refurbished'|'used'|'exchange')=>void;
}
export function B2BMarketplace({customerUser,onSignIn,contractorMode=false,onSwitchToTenders,onOpenContractorPortal}:Props){
 const [policyOpen,setPolicyOpen]=useState(false);
 const [tab,setTab]=useState<'browse'|'rfqs'>('browse'),[listings,setListings]=useState<B2BListing[]>([]),[rfqs,setRfqs]=useState<B2BRfqRequest[]>([]);
 const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[cursor,setCursor]=useState<string|null>(null),[rfqCursor,setRfqCursor]=useState<string|null>(null);
 const [requestQuery,setRequestQuery]=useState(''),[requestFilter,setRequestFilter]=useState('all'),[requestQuantity,setRequestQuantity]=useState(1);
 const [loading,setLoading]=useState(true),[requestsLoading,setRequestsLoading]=useState(false),[loadingMore,setLoadingMore]=useState(false);
 const [error,setError]=useState(''),[requestError,setRequestError]=useState(''),[notice,setNotice]=useState(''),[policy,setPolicy]=useState<B2BPolicy|null>(null),[policyError,setPolicyError]=useState('');
 const [requestListing,setRequestListing]=useState<B2BListing|null>(null),[detail,setDetail]=useState<B2BListing|null>(null),[quotation,setQuotation]=useState<B2BQuotation|null>(null),[busy,setBusy]=useState('');
 const root=useRef<HTMLElement>(null),alive=useRef(true),catalogRequest=useRef(0),privateRequest=useRef(0),policyRequest=useRef(0),privateContext=useRef(0);
 const {actor,currentActor}=useB2BIdentity(()=>{privateRequest.current++;privateContext.current++;setRfqs([]);setRfqCursor(null);setQuotation(null);setRequestListing(null);setRequestQuery('');setRequestFilter('all');setRequestsLoading(false);setRequestError('');setNotice('');setBusy('');});
 const loadPolicy=async()=>{const id=++policyRequest.current;setPolicyError('');try{const data=await b2bService.getPolicy();if(alive.current&&id===policyRequest.current)setPolicy(data);}catch(e){if(alive.current&&id===policyRequest.current)setPolicyError((e as Error).message);}};
 const loadCatalog=async(more=false)=>{
   const id=++catalogRequest.current;more?setLoadingMore(true):setLoading(true);setError('');
   try{const data=await b2bService.getB2BListings({search:query.trim(),category,cursor:more?cursor||'':undefined});if(alive.current&&id===catalogRequest.current){setListings(old=>more?[...old,...data.items.filter(row=>!old.some(item=>item.id===row.id))]:data.items);setCursor(data.nextCursor);}}
   catch(e){if(alive.current&&id===catalogRequest.current)setError((e as Error).message);}
   finally{if(alive.current&&id===catalogRequest.current){setLoading(false);setLoadingMore(false);}}
 };
 const loadRequests=async(more=false)=>{
   const id=++privateRequest.current,scope=currentActor();setRequestError('');if(!scope){setRequestsLoading(false);setRequestError('Sign in to view your private requests.');return;}setRequestsLoading(true);
   try{const data=await b2bService.getCustomerRFQs(more?rfqCursor||'':'');if(alive.current&&id===privateRequest.current&&scope===currentActor()){setRfqs(old=>more?[...old,...data.items.filter(row=>!old.some(item=>item.id===row.id))]:data.items);setRfqCursor(data.nextCursor);}}
   catch(e){if(alive.current&&id===privateRequest.current&&scope===currentActor())setRequestError((e as Error).message);}
   finally{if(alive.current&&id===privateRequest.current&&scope===currentActor())setRequestsLoading(false);}
 };
 useEffect(()=>{alive.current=true;void loadPolicy();return()=>{alive.current=false;catalogRequest.current++;privateRequest.current++;privateContext.current++;policyRequest.current++;};},[]);
 useEffect(()=>{catalogRequest.current++;setListings([]);setCursor(null);setError('');setLoading(true);setLoadingMore(false);const timer=window.setTimeout(()=>void loadCatalog(),250);return()=>clearTimeout(timer);},[category,query]);
 useEffect(()=>{if(tab==='rfqs')void loadRequests();},[tab,actor]);
 const readyQuotes=useMemo(()=>rfqs.filter(r=>r.status==='quoted').length,[rfqs]);
 const shownRequests=useMemo(()=>rfqs.filter(r=>(requestFilter==='all'||r.status===requestFilter)&&(!requestQuery||`${r.itemTitle} ${r.shopName}`.toLowerCase().includes(requestQuery.trim().toLowerCase()))),[rfqs,requestFilter,requestQuery]);
 const filterCatalog=(update:()=>void)=>{catalogRequest.current++;setListings([]);setCursor(null);setError('');setLoading(true);setLoadingMore(false);update();};
 const formContext=privateContext.current,formActor=currentActor();
 const formIsCurrent=()=>alive.current&&formContext===privateContext.current&&formActor===currentActor();
 const openRequest=(item:B2BListing,quantity=item.moq)=>{setDetail(null);setNotice('');setRequestQuantity(quantity);setRequestListing(item);};
 const findProducts=()=>{setTab('browse');requestAnimationFrame(()=>{const input=root.current?.querySelector<HTMLInputElement>('.b2b-search input');if(!input)return;input.focus({preventScroll:true});input.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches||input.closest('.reduce-motion,[data-reduced-motion=true]')?'instant':'smooth'});});};
 const decide=async(id:string,action:'accept'|'decline')=>{
   const rfq=rfqs.find(row=>row.id===id);if(!rfq)throw Error('Refresh your requests before responding to this quotation.');
   if(busy)return;const scope=currentActor(),context=privateContext.current;setBusy(id);setRequestError('');
   try{const saved=await b2bService.decideQuotation(rfq,action);if(alive.current&&scope===currentActor()&&context===privateContext.current){setRfqs(rows=>rows.map(row=>row.id===id?saved:row));setQuotation(saved.quotation||null);setNotice(action==='accept'?'Quotation accepted. No payment has been collected and stock has not been reserved.':'Quotation declined. Your decision was saved.');}}
   finally{if(alive.current&&scope===currentActor()&&context===privateContext.current)setBusy('');}
 };
 return <section ref={root} className="b2b-hub-container wholesale-experience" data-view={tab} aria-label="B2B wholesale">
  <h1 className="sr-only">{contractorMode?'Contractor wholesale procurement':'Wholesale'}</h1>
  <div className="wholesale-utility" aria-label="Wholesale tools">
   {tab==='browse'?<div className="b2b-search"><CustomerSearchField label="Search wholesale listings" placeholder="Product, part number or supplier" value={query} onChange={value=>{const next=value.slice(0,120);if(next!==query)filterCatalog(()=>setQuery(next));}}/></div>:<button type="button" className="wholesale-find-supplies" onClick={findProducts}><Search size={18} aria-hidden="true"/><span>Find supplies</span><ArrowRight size={16} aria-hidden="true"/></button>}
   <button type="button" className="wholesale-tool" aria-label="Wholesale terms and payment information" title="Wholesale terms" onClick={()=>setPolicyOpen(true)}><Info size={18} aria-hidden="true"/></button>
   <button type="button" className="wholesale-tool" aria-label="Refresh" title={tab==='browse'?'Refresh wholesale listings':'Refresh quote requests'} aria-busy={tab==='browse'?loading:requestsLoading} onClick={()=>tab==='browse'?void loadCatalog():void loadRequests()} disabled={tab==='browse'?loading:requestsLoading}><RefreshCw size={18} aria-hidden="true"/></button>
  </div>
  {policyOpen&&<Modal title="Wholesale terms" onClose={()=>setPolicyOpen(false)}><InlineNotice action={policyError?<button className="b2b-text-button" onClick={()=>void loadPolicy()}>Retry payment availability</button>:undefined}>{policy?.acceptanceNote||'An inquiry or accepted quotation does not collect payment, reserve stock or confirm dispatch.'}{policyError&&<span> Payment availability could not be checked.</span>}{policy&&!policy.paymentsReady&&<span> Online wholesale checkout is unavailable.</span>}</InlineNotice></Modal>}
  {contractorMode&&(onSwitchToTenders||onOpenContractorPortal)&&<div className="b2b-context-actions">{onSwitchToTenders&&<button className="b2b-text-button" onClick={onSwitchToTenders}>Back to tenders<ArrowRight size={16}/></button>}{onOpenContractorPortal&&<button className="b2b-text-button" onClick={onOpenContractorPortal}>Contractor workspace<ArrowRight size={16}/></button>}</div>}
  <BusinessTabs className="wholesale-tabs" label="Wholesale sections" value={tab} onChange={setTab} panelId="b2b-content" items={[{id:'browse',label:'Browse wholesale',icon:<Boxes size={18}/>},{id:'rfqs',label:'My requests',icon:<FileText size={18}/>,count:readyQuotes||undefined}]}/>
  {notice&&<InlineNotice tone="success">{notice}</InlineNotice>}
  <div id="b2b-content" role="tabpanel" aria-label={tab==='browse'?'Browse wholesale':'My requests'}>
   {tab==='browse'?<>
    <div className="wholesale-catalogue-dock">
    <div className="b2b-category-rail" role="group" aria-label="Wholesale categories">{[{id:'all',label:'All wholesale'},...b2bCategories].map(item=><button type="button" key={item.id} aria-pressed={category===item.id} onClick={()=>{if(item.id!==category)filterCatalog(()=>setCategory(item.id));}}><WholesaleCategoryArt category={item.id}/><span>{item.label}</span></button>)}</div></div>
    <div className="wholesale-results-heading"><div><span className="wholesale-kicker">THE SUPPLY CATALOGUE</span><h2>{query?`Results for “${query}”`:category==='all'?'Find your next supply':b2bCategories.find(c=>c.id===category)?.label}</h2></div>{!loading&&!error&&<span role="status">{listings.length}{cursor?'+':''} {listings.length===1&&!cursor?'listing':'listings'} loaded</span>}</div>
    {error&&<InlineNotice tone="error" action={<button className="b2b-text-button" onClick={()=>void loadCatalog()}>Retry listings</button>}>{error}</InlineNotice>}
    {loading?<WholesaleLoading/>:!error&&!listings.length?<div className="wholesale-catalogue-empty"><BusinessEmptyState icon={<WholesaleArt/>} title={cursor?'No matches on this page yet':query||category!=='all'?'No matching wholesale listings':'Wholesale listings are on the way'} description={cursor?'Load more listings to continue checking the catalogue.':query||category!=='all'?'Try a different product name or category.':'Active listings from approved shops will appear here when published.'} action={query||category!=='all'?<button className="b2b-button b2b-secondary" onClick={()=>filterCatalog(()=>{setQuery('');setCategory('all');})}>Clear filters</button>:undefined}/></div>:null}
    <div className="b2b-product-grid">{listings.map(item=><article className="b2b-product-card" key={item.id}>
     <button className="b2b-product-open" aria-label={'View wholesale details for '+item.title} onClick={()=>setDetail(item)}><ProductImage item={item}/><div className="b2b-product-copy"><span className="b2b-overline">{b2bCategories.find(category=>category.id===item.category)?.label||item.category}</span><h2>{item.title}</h2><div className="b2b-rate"><strong>{b2bMoney(slabRatePaise(item,item.moq)/100)}</strong><span>/ {item.unit.toLowerCase()}</span></div><span className="b2b-fine">Listed unit rate · tax & freight extra</span><div className="b2b-product-facts"><span>MOQ {item.moq} {item.unit.toLowerCase()}</span>{item.bulkSlabs.length>0&&<span className="wholesale-quantity-tag">Quantity rates</span>}</div></div></button>
     <div className="wholesale-supplier-line"><span className="wholesale-supplier-icon" aria-hidden="true"><Building2 size={17}/></span><div><p className="b2b-supplier">{item.shopName}</p><span>{item.city||'Supplier location not listed'}</span></div><PrimeBadge prime={item.prime}/></div>
     <div className="b2b-card-footer"><span><Clock size={14} aria-hidden="true"/>{item.leadTimeDays}-day seller dispatch estimate · {item.stock} listed in stock</span><button className="b2b-button b2b-primary" disabled={item.stock<item.moq} onClick={()=>openRequest(item)}>{item.stock<item.moq?'Below minimum stock':'Request quotation'}<ArrowRight size={16} aria-hidden="true"/></button></div>
    </article>)}</div>
    {cursor&&<button className="b2b-button b2b-secondary b2b-load-more" disabled={loadingMore} onClick={()=>void loadCatalog(true)}>{loadingMore?'Loading more…':'Load more listings'}</button>}
   </>:<>
    {(rfqs.length>0||requestError)&&<div className="b2b-section-heading"><span className="wholesale-kicker">YOUR BUYING DESK</span><h2>Your buying conversations</h2><p><Lock size={13} aria-hidden="true"/>Only you and the relevant supplier can view your contact and delivery details.</p></div>}
    {requestError&&<InlineNotice tone="error" action={<><button className="b2b-text-button" onClick={()=>void loadRequests()}>Retry requests</button>{onSignIn&&requestError.toLowerCase().includes('sign')&&<button className="b2b-text-button" onClick={onSignIn}>Sign in</button>}</>}>{requestError}</InlineNotice>}
    {requestsLoading&&!rfqs.length?<p role="status" className="b2b-loading">Loading your private requests…</p>:!requestError&&!rfqs.length?<div className="wholesale-requests-empty"><WholesaleArt kind="requests"/><span className="wholesale-kicker">FROM REQUIREMENT TO QUOTATION</span><h2>Your first quote starts here</h2><p>Find the right product. Share your quantity.<br/>Keep the supplier’s rate and terms together.</p><ol className="wholesale-how-it-works"><li><Search size={17} aria-hidden="true"/><span>Find a product</span></li><li><Send size={17} aria-hidden="true"/><span>Send your inquiry</span></li><li><FileText size={17} aria-hidden="true"/><span>Review the quote</span></li></ol><button className="b2b-button b2b-primary" onClick={findProducts}>Browse wholesale<ArrowRight size={16} aria-hidden="true"/></button><small><Lock size={13} aria-hidden="true"/>Your contact details stay between you and the supplier.</small></div>:null}
    {!!rfqs.length&&<div className="wholesale-request-tools"><div className="wholesale-request-counts"><span><strong>{rfqs.length}</strong> requests loaded</span><span><strong>{readyQuotes}</strong> quoted requests</span></div><div className="wholesale-request-filters"><CustomerSearchField label="Search your loaded requests" placeholder="Product or supplier" value={requestQuery} onChange={setRequestQuery}/><label><span className="sr-only">Filter your loaded requests</span><select aria-label="Filter your loaded requests" value={requestFilter} onChange={e=>setRequestFilter(e.target.value)}>{['all','pending','quoted','accepted','declined','cancelled'].map(status=><option key={status} value={status}>{status==='all'?'All requests':rfqStatusLabel(status)}</option>)}</select><ChevronDown size={14} aria-hidden="true"/></label></div></div>}
    <div className="b2b-request-list">{shownRequests.map(rfq=><article className="b2b-request-card" data-status={rfq.status} key={rfq.id}><div className="b2b-request-top"><span className="b2b-status" data-status={rfq.status}>{rfqStatusLabel(rfq.status)}</span><time dateTime={new Date(rfq.createdAt).toISOString()}>{new Date(rfq.createdAt).toLocaleDateString('en-IN',{month:'short',day:'numeric'})}</time></div><h2>{rfq.itemTitle}</h2><p className="wholesale-request-supplier"><Building2 size={15} aria-hidden="true"/>{rfq.shopName}</p><div className="wholesale-request-facts"><span><Boxes size={15} aria-hidden="true"/>{rfq.quantityRequested} {rfq.unit.toLowerCase()}</span><span><MapPin size={15} aria-hidden="true"/>{rfq.deliveryCity} · {rfq.deliveryPincode}</span></div><WholesaleRequestProgress status={rfq.status}/>{rfq.quotation?<div className="b2b-request-quote"><div><small>Supplier’s quoted total</small><strong>{b2bMoney(rfq.quotation.grandTotal)}</strong><small>Including stated tax and freight</small></div><button className="b2b-button b2b-primary" onClick={()=>setQuotation(rfq.quotation!)}>View quotation<ArrowRight size={16} aria-hidden="true"/></button></div>:<p className="b2b-fine">Your inquiry was saved. The supplier has not issued a quotation yet.</p>}{rfq.status==='accepted'&&<p className="b2b-fine">Acceptance recorded · No payment collected · No dispatch confirmed</p>}</article>)}</div>
    {!!rfqs.length&&!shownRequests.length&&<div className="wholesale-filter-empty"><FileText size={24} aria-hidden="true"/><h3>No requests in this view</h3><p>Search another product or change the request status.</p><button className="b2b-button b2b-secondary" onClick={()=>{setRequestQuery('');setRequestFilter('all');}}>Clear request filters</button></div>}
    {rfqCursor&&<button className="b2b-button b2b-secondary b2b-load-more" disabled={requestsLoading} onClick={()=>void loadRequests(true)}>{requestsLoading?'Loading more…':'Load more requests'}</button>}
   </>}
  </div>
  {detail&&<WholesaleProductDetail key={detail.id} item={detail} onClose={()=>setDetail(null)} onRequest={openRequest}/>}
  {requestListing&&<RfqForm listing={requestListing} initialQuantity={requestQuantity} customerUser={customerUser} isCurrent={formIsCurrent} signedIn={!!actor} onSignIn={onSignIn} onClose={()=>setRequestListing(null)} onSaved={rfq=>{if(!formIsCurrent())return;setRequestListing(null);setRequestQuery('');setRequestFilter('all');setTab('rfqs');setNotice(`Your request for ${rfq.quantityRequested} ${rfq.unit.toLowerCase()} was saved for ${rfq.shopName}. No payment was collected.`);void loadRequests();}}/>}
  {quotation&&<B2BQuotationPdfModal quotation={quotation} onClose={()=>setQuotation(null)} onAccept={id=>decide(id,'accept')} onDecline={id=>decide(id,'decline')} isBuyer/>}
 </section>;
}
function ProductImage({item}:{item:B2BListing}){const [failed,setFailed]=useState(false);return <div className="b2b-product-image">{item.image&&!failed?<img src={apiAssetUrl(item.image)} alt={item.title} loading="lazy" onError={()=>setFailed(true)}/>:<span className="wholesale-photo-placeholder"><WholesaleCategoryArt category={item.category}/><small>Product photo not provided</small></span>}</div>;}

function WholesaleLoading(){return <div className="wholesale-loading" role="status"><span className="sr-only">Loading live wholesale listings…</span>{[0,1,2].map(n=><div key={n} className="wholesale-skeleton" aria-hidden="true"><span/><div><i/><i/><i/></div></div>)}</div>;}

export function WholesaleRequestProgress({status}:{status:string}){
 if(status==='cancelled')return null;
 const step=status==='pending'?0:status==='quoted'?1:2;
 return <ol className="wholesale-request-progress" aria-label={`Inquiry progress: ${rfqStatusLabel(status)}`}>{['Requested','Quoted',status==='declined'?'Declined':'Accepted'].map((label,index)=><li key={label} data-done={index<=step} data-declined={status==='declined'&&index===2}><span aria-hidden="true">{index<step?<Check size={11}/>:index+1}</span>{label}</li>)}</ol>;
}

function WholesaleProductDetail({item,onClose,onRequest}:{item:B2BListing;onClose:()=>void;onRequest:(item:B2BListing,quantity:number)=>void}){
 const [quantity,setQuantity]=useState(item.moq),quantityId=useId();
 const valid=Number.isInteger(quantity)&&quantity>=item.moq&&quantity<=item.stock,rate=slabRatePaise(item,quantity)/100;
 return <Modal title={item.title} className="b2b-detail-modal wholesale-product-detail" onClose={onClose}>
  <div className="wholesale-detail-hero"><ProductImage item={item}/><div><span className="wholesale-kicker">{b2bCategories.find(c=>c.id===item.category)?.label}</span><strong>{b2bMoney(slabRatePaise(item,item.moq)/100)} <small>/ {item.unit.toLowerCase()}</small></strong><p>Listed unit rate at minimum quantity</p><div className="wholesale-detail-supplier"><Building2 size={18} aria-hidden="true"/><span>{item.shopName}<small>{item.city||'Supplier location not listed'}</small></span></div><PrimeBadge prime={item.prime}/></div></div>
  <section className="wholesale-detail-section"><h3>About this product</h3><p>{item.description||'No product description has been provided.'}</p></section>
  <section className="wholesale-quantity-planner" aria-label="Plan your quantity"><div><span className="wholesale-kicker">PLAN YOUR REQUIREMENT</span><h3>See your quantity rate</h3></div><div className="wholesale-planner-quantity"><label htmlFor={quantityId}>Quantity to inquire ({item.unit.toLowerCase()})</label><div className="wholesale-quantity-control"><button type="button" aria-label="Decrease inquiry quantity" disabled={quantity<=item.moq} onClick={()=>setQuantity(value=>Math.max(item.moq,value-1))}><Minus size={17}/></button><input id={quantityId} type="number" min={item.moq} max={item.stock} step="1" required value={quantity||''} onChange={e=>setQuantity(Number(e.target.value))}/><button type="button" aria-label="Increase inquiry quantity" disabled={quantity>=item.stock} onClick={()=>setQuantity(value=>Math.min(item.stock,value+1))}><Plus size={17}/></button></div></div>
   {valid?<div className="wholesale-planner-total" role="status"><span>{b2bMoney(rate)} × {quantity} {item.unit.toLowerCase()}</span><strong>{b2bMoney(rate*quantity)}</strong><small>Listed goods estimate · tax & freight quoted separately</small></div>:<p role="status" className="b2b-fine">Choose a whole quantity from {item.moq} to {item.stock} {item.unit.toLowerCase()}.</p>}
   {item.bulkSlabs.length>0&&<><h4>Supplier quantity rates</h4><ul className="b2b-slab-list">{item.bulkSlabs.map(slab=><li key={slab.minQty} data-current={valid&&quantity>=slab.minQty&&(slab.maxQty==null||quantity<=slab.maxQty)}><span>{slab.minQty}{slab.maxQty?`–${slab.maxQty}`:'+'} {item.unit.toLowerCase()}</span><strong>{b2bMoney(slab.pricePerUnit)} / unit</strong></li>)}</ul></>}
  </section>
  <section className="wholesale-detail-section"><h3>Product & supply details</h3><dl className="b2b-specs">{[['Part number',item.partNumber||'Not provided'],['HSN',item.hsnCode||'Not provided'],['Minimum quantity',`${item.moq} ${item.unit}`],['Listed stock',`${item.stock} ${item.unit}`],['Seller dispatch estimate',`${item.leadTimeDays} days`],...(item.supplyCapacity?[['Seller supply capacity',item.supplyCapacity]]:[]),...Object.entries(item.specifications)].map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></section>
  <p className="b2b-fine">Product specifications and availability are declared by the supplier. Your final rate, tax and freight are confirmed in a saved quotation.</p>
  <div className="wholesale-detail-action"><span><small>Inquiry quantity</small><strong>{valid?`${quantity} ${item.unit.toLowerCase()}`:'Check quantity'}</strong></span><button className="b2b-button b2b-primary" disabled={!valid} onClick={()=>onRequest(item,quantity)}>Request quotation<Send size={16} aria-hidden="true"/></button></div>
 </Modal>;
}

function RfqForm({listing,initialQuantity,customerUser,isCurrent,signedIn,onSignIn,onClose,onSaved}:{listing:B2BListing;initialQuantity:number;customerUser?:Props['customerUser'];isCurrent:()=>boolean;signedIn:boolean;onSignIn?:()=>void;onClose:()=>void;onSaved:(rfq:B2BRfqRequest)=>void}){
 const [quantity,setQuantity]=useState(initialQuantity),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const requestId=useRef(crypto.randomUUID()),alive=useRef(true);useEffect(()=>()=>{alive.current=false;},[]);
 const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();if(busy||!isCurrent())return;if(!signedIn){setError('Sign in to send your private quotation request.');return;}setBusy(true);setError('');const form=new FormData(event.currentTarget);try{
  const target=String(form.get('target')||'').trim();
  const rfq=await b2bService.createRFQ({requestId:requestId.current,listingId:listing.id,customerName:String(form.get('name')).trim(),customerPhone:String(form.get('phone')).trim(),customerEmail:String(form.get('email')||'').trim(),buyerCompanyName:String(form.get('company')||'').trim(),buyerGstin:String(form.get('gstin')||'').trim().toUpperCase(),deliveryAddress:String(form.get('address')).trim(),deliveryCity:String(form.get('city')).trim(),deliveryPincode:String(form.get('pincode')).trim(),quantityRequested:quantity,targetPricePerUnit:target?Number(target):undefined,urgency:form.get('urgency') as RFQUrgency,notes:String(form.get('notes')||'').trim()});if(alive.current&&isCurrent())onSaved(rfq);
 }catch(e){if(alive.current&&isCurrent())setError((e as Error).message);}finally{if(alive.current&&isCurrent())setBusy(false);}};
 const estimate=slabRatePaise(listing,quantity)*quantity/100;
 return <Modal title="Request quotation" className="b2b-form-modal wholesale-form-modal" onClose={()=>{if(!busy)onClose();}}><form className="b2b-form wholesale-rfq-form" onSubmit={submit} onInvalidCapture={event=>{const details=(event.target as HTMLElement).closest('details');if(details)details.open=true;}}>
  <div className="b2b-form-context"><span className="wholesale-form-product-icon" aria-hidden="true"><WholesaleCategoryArt category={listing.category}/></span><div><strong>{listing.title}</strong><span>{listing.shopName}</span></div></div>
  <fieldset className="wholesale-form-section"><legend><span>01</span>Your requirement</legend><div className="b2b-form-grid"><label>Quantity ({listing.unit.toLowerCase()})<input name="quantity" type="number" min={listing.moq} max={listing.stock} step="1" required value={quantity||''} onChange={event=>setQuantity(Number(event.target.value))}/></label><label>Target unit price (₹, optional)<input name="target" type="number" min="0.01" max="1000000" step="0.01" placeholder="Your target price"/></label></div>
   <p className="b2b-estimate" role="status">{Number.isInteger(quantity)&&quantity>=listing.moq&&quantity<=listing.stock?<>Listed goods estimate <strong>{b2bMoney(estimate)}</strong><span>Tax and freight will be quoted separately. This is not an order.</span></>:'Choose a whole quantity within the listed MOQ and stock.'}</p>
   <label>Delivery timing<select name="urgency" defaultValue="within_7_days"><option value="immediate">As soon as possible</option><option value="within_7_days">Within 7 days</option><option value="within_15_days">Within 15 days</option><option value="flexible">Flexible</option></select></label><label>Requirements or project reference (optional)<textarea name="notes" maxLength={2000} placeholder="Compatibility, documentation, delivery access or project reference"/></label>
  </fieldset>
  <fieldset className="wholesale-form-section"><legend><span>02</span>Your contact</legend><div className="b2b-form-grid"><label>Contact name<input name="name" required minLength={2} maxLength={100} autoComplete="name" defaultValue={customerUser?.name||''}/></label><label>Contact mobile<input name="phone" type="tel" required maxLength={16} pattern="\+?[0-9]{10,15}" autoComplete="tel" defaultValue={customerUser?.phone||''}/></label></div><label>Contact email<input name="email" type="email" required minLength={5} maxLength={254} autoComplete="email" defaultValue={customerUser?.email||''}/></label>
   <details className="wholesale-business-details"><summary>Business details (optional)<ChevronDown size={16} aria-hidden="true"/></summary><div className="b2b-form-grid"><label>Company (optional)<input name="company" maxLength={200} autoComplete="organization"/></label><label>Buyer GSTIN (optional)<input name="gstin" maxLength={15} pattern="[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][0-9A-Za-z]Z[0-9A-Za-z]" placeholder="Your 15-character GSTIN"/></label></div></details>
  </fieldset>
  <fieldset className="wholesale-form-section"><legend><span>03</span>Delivery details</legend><label>Delivery address<textarea name="address" required minLength={10} maxLength={500} autoComplete="street-address" placeholder="Enter the actual delivery address"/></label><div className="b2b-form-grid"><label>Delivery city<input name="city" required minLength={2} maxLength={80} autoComplete="address-level2"/></label><label>Delivery PIN code<input name="pincode" required inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} autoComplete="postal-code"/></label></div></fieldset>
  <label className="b2b-consent"><input type="checkbox" required/>Share these contact and delivery details with this supplier for this inquiry.</label>
  {error&&<InlineNotice tone="error" action={onSignIn&&error.toLowerCase().includes('sign')?<button type="button" className="b2b-text-button" onClick={onSignIn}>Sign in</button>:undefined}>{error}</InlineNotice>}
  <div className="wholesale-rfq-footer"><span><Lock size={13} aria-hidden="true"/>Sent privately to this supplier</span><button className="b2b-button b2b-primary" disabled={busy} aria-busy={busy}>{busy?'Saving request…':'Send quotation request'}<Send size={16} aria-hidden="true"/></button></div>
 </form></Modal>;
}
export default B2BMarketplace;
