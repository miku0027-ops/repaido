import {useEffect,useId,useRef,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {ArrowRight,ArrowLeftRight,Box,CheckCircle2,ChevronRight,Clock3,Package,RefreshCw,ShoppingBag,Store,UserRound,X} from 'lucide-react';
import {auth} from '../firebase';
import {apiAssetUrl} from '../services/api';
import {readSellerProfile,sellerProfileSnapshot,type PublicSeller,type SellerProfileItem,type SellerProfileMode} from '../services/marketProfiles';
import {Modal} from './ui';
import './seller-profile.css';

type Props={listingId?:string;chatId?:string;onClose:()=>void;onOpenListing?:(id:string,mode:'second_hand'|'exchange')=>void;onOpenRental?:(id:string)=>void;onOpenShop?:(id:string)=>void;onSignIn?:()=>void};
const money=(paise:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:paise%100?2:0}).format(paise/100);
function price(item:SellerProfileItem){if(item.mode!=='rentals')return money(item.value_paise||0);for(const [key,suffix] of [['daily_paise','day'],['weekly_paise','week'],['monthly_paise','30 days']] as const){if(item[key])return `${money(item[key]!)} / ${suffix}`;}return 'View rental rates';}
const labels={all:'All',second_hand:'For sale',exchange:'Exchange',rentals:'Rent'};
const icons={all:Box,second_hand:ShoppingBag,exchange:ArrowLeftRight,rentals:Clock3};

export default function PublicSellerProfile({listingId,chatId,onClose,onOpenListing,onOpenRental,onOpenShop,onSignIn}:Props){
 const reference={listingId,chatId},referenceKey=JSON.stringify([listingId,chatId]);
 const [mode,setMode]=useState<SellerProfileMode>('all'),[actor,setActor]=useState(auth.currentUser?.uid||''),[profile,setProfile]=useState<PublicSeller|null>(()=>sellerProfileSnapshot(reference)),[loadedFor,setLoadedFor]=useState(''),[busy,setBusy]=useState(false),[moreBusy,setMoreBusy]=useState(false),[problem,setProblem]=useState<{message:string;status:number}|null>(null),[refresh,setRefresh]=useState(0);
 const sequence=useRef(0),heading=useId(),loadedKey=JSON.stringify([referenceKey,mode,chatId?actor:'public']);
 const shown=loadedFor===loadedKey?profile:null;
 useEffect(()=>onIdTokenChanged(auth,user=>{setActor(user?.uid||'');}),[]);
 useEffect(()=>{
  const id=++sequence.current,controller=new AbortController(),snapshot=sellerProfileSnapshot(reference,mode);setProfile(snapshot);setLoadedFor(loadedKey);setProblem(null);setBusy(!snapshot);setMoreBusy(false);
  readSellerProfile(reference,{mode,signal:controller.signal,force:refresh>0}).then(value=>{if(sequence.current===id){setProfile(value);setProblem(null);}}).catch(error=>{if(!controller.signal.aborted&&sequence.current===id){setProblem({message:error.message||'Could not load this seller. Please retry.',status:error.status||0});if([401,403,404].includes(error.status))setProfile(null);}}).finally(()=>{if(sequence.current===id)setBusy(false);});
  return()=>{++sequence.current;controller.abort();};
 },[referenceKey,mode,actor,refresh]);
 async function more(){if(!shown?.next_cursor||moreBusy)return;const id=sequence.current;setMoreBusy(true);setProblem(null);try{const value=await readSellerProfile(reference,{mode,cursor:shown.next_cursor,force:true});if(sequence.current!==id)return;setProfile(previous=>{if(!previous||previous.key!==value.key)return value;const items=new Map(previous.items.map(item=>[item.mode+':'+item.id,item]));for(const item of value.items)items.set(item.mode+':'+item.id,item);return {...value,items:[...items.values()]};});}catch(error){if(sequence.current===id){const e=error as Error&{status?:number};setProblem({message:e.message||'Could not load more items. Please retry.',status:e.status||0});if([401,403,404].includes(e.status||0))setProfile(null);}}finally{if(sequence.current===id)setMoreBusy(false);}}
 function open(item:SellerProfileItem){onClose();if(item.mode==='rentals'){if(onOpenRental)onOpenRental(item.id);else window.dispatchEvent(new CustomEvent('repaido:market-open-rental',{detail:{id:item.id}}));}else if(onOpenListing)onOpenListing(item.id,item.mode);else window.dispatchEvent(new CustomEvent('repaido:market-open-listing',{detail:{id:item.id,mode:item.mode}}));}
 function shop(id:string){onClose();if(onOpenShop)onOpenShop(id);else window.dispatchEvent(new CustomEvent('repaido:market-open-shop',{detail:{id}}));}
 const total=shown?shown.counts.second_hand+shown.counts.exchange+shown.counts.rentals:0;
 return <Modal title={shown?`${shown.name} · Seller profile`:'Seller profile'} className="public-seller-modal" frameless onClose={onClose}><div className="seller-profile-shell">
  <header className="seller-profile-top"><div><span>REPAIDO MARKET</span><h2 id={heading}>Seller profile</h2></div><button type="button" className="seller-icon-button" onClick={onClose} aria-label="Close seller profile"><X size={19} aria-hidden="true"/></button></header>
  <div className="seller-profile-scroll" aria-labelledby={heading} aria-busy={busy}>
   {busy&&!shown&&<div className="seller-state" role="status"><RefreshCw size={24} className="seller-spin" aria-hidden="true"/><strong>Opening this seller’s catalogue</strong><p>Finding their public listings.</p></div>}
   {problem&&<div className="seller-problem" role="alert"><p>{problem.message}</p><div>{problem.status===401&&onSignIn?<button type="button" onClick={onSignIn}>Sign in</button>:<button type="button" onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={15} aria-hidden="true"/>Retry</button>}</div></div>}
   {shown&&<><section className="seller-profile-identity"><div className="seller-avatar" aria-hidden="true"><UserRound size={28}/></div><div><span>{shown.label}</span><h3>{shown.name}</h3><p>{total}{!shown.counts_complete?'+':''} public {total===1?'listing':'listings'}{shown.shops.length?` · ${shown.shops.length}${!shown.shops_complete?'+':''} ${shown.shops.length===1?'shop':'shops'}`:''}</p></div></section>
    <p className="seller-profile-note">Explore their available items. Confirm the condition and collection details before agreeing to a purchase or exchange.</p>
    <div className="seller-profile-filters" role="group" aria-label="Seller listings">{(['all','second_hand','exchange','rentals'] as const).map(value=>{const Icon=icons[value],count=value==='all'?total:shown.counts[value];return <button type="button" key={value} aria-pressed={mode===value} onClick={()=>setMode(value)}><Icon size={15} aria-hidden="true"/><span>{labels[value]}</span><small>{count}{!shown.counts_complete?'+':''}</small></button>;})}</div>
    <section className="seller-profile-items" aria-label={labels[mode]+' listings'}>{shown.items.map(item=><button type="button" className="seller-item" key={item.mode+':'+item.id} onClick={()=>open(item)} aria-label={`View ${item.name}, ${price(item)}`}><div className="seller-item-image"><Package size={26} aria-hidden="true"/>{item.image_url&&<img src={apiAssetUrl(item.image_url)} alt="" loading="lazy" onError={e=>{e.currentTarget.style.display='none';}}/>}<span>{labels[item.mode]}</span></div><div className="seller-item-copy"><strong>{price(item)}</strong><h4>{item.name}</h4>{item.city&&<p>{item.city}</p>}<span className="seller-item-link">View item<ChevronRight size={13} aria-hidden="true"/></span></div></button>)}</section>
    {!shown.items.length&&<div className="seller-state"><Package size={28} aria-hidden="true"/><strong>No {mode==='all'?'public':labels[mode].toLowerCase()} listings right now</strong><p>Only available items are shown here.</p></div>}
    {shown.next_cursor&&<button type="button" className="seller-more" disabled={moreBusy} onClick={more}>{moreBusy?<><RefreshCw className="seller-spin" size={15} aria-hidden="true"/>Loading more items…</>:<>More items<ArrowRight size={15} aria-hidden="true"/></>}</button>}
    {!!shown.shops.length&&<section className="seller-profile-shops"><h3>Shops & rental catalogues</h3><p>Rentals are offered by the seller’s registered shops.</p>{shown.shops.map(s=><button type="button" key={s.id} onClick={()=>shop(s.id)}><Store size={20} aria-hidden="true"/><span><strong>{s.name}</strong>{s.city&&<small>{s.city}</small>}{s.verified&&<small className="seller-reviewed"><CheckCircle2 size={12} aria-hidden="true"/>Repaido reviewed shop</small>}</span><ChevronRight size={16} aria-hidden="true"/></button>)}</section>}
   </>}
  </div>
  <footer className="seller-profile-footer"><ShoppingBag size={14} aria-hidden="true"/><span>Personal listings and shop catalogues, in one place.</span><button type="button" onClick={()=>setRefresh(n=>n+1)} aria-label="Refresh seller profile" disabled={busy}><RefreshCw size={17} aria-hidden="true"/></button></footer>
 </div></Modal>;
}
