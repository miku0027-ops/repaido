import {useState} from 'react';
import {ArrowRight,Boxes,ChevronDown,Gift,PackagePlus,Recycle,ShoppingBag,Ticket,Trophy,Wrench} from '../icons';
import {Modal} from './ui';
import {CaptainClub} from './CaptainClub';
import {MarketBenefits} from './MarketBenefits';
import OpportunityCarousel,{type Opportunity} from './OpportunityCarousel';
import './market-discovery-hub.css';

type Destination='spares'|'rentals'|'exchange'|'preowned'|'sell'|'contracts'|'refurbished';
const destinations=[
 {id:'spares',title:'Buy spares',Icon:Boxes},
 {id:'refurbished',title:'Refurbished',Icon:Recycle},
 {id:'rentals',title:'Rent equipment',Icon:Wrench},
 {id:'exchange',title:'Direct swap',Icon:Gift},
 {id:'preowned',title:'Pre-owned',Icon:ShoppingBag},
 {id:'contracts',title:'Contracts',Icon:PackagePlus},
] as const;

export default function MarketOpportunities({onChoose,onSignIn}:{onChoose:(id:Destination)=>void;onSignIn?:()=>void}){
 const [detail,setDetail]=useState<Opportunity|null>(null);
 const [perks,setPerks]=useState<'shortcuts'|'offers'|'rewards'|null>(null);
 const choose=(id:Destination)=>{setPerks(null);onChoose(id);};
 const browse=(scope:string)=>{setPerks(null);if(scope==='rental')onChoose('rentals');else if(scope==='refurbished')onChoose('refurbished');else if(scope==='purchase')onChoose('spares');else if(scope==='listing')onChoose('preowned');else location.assign(scope==='hire'?'/?tab=hire':'/?tab=services');};

 return <>
  <section className="market-highlights market-discovery-hub" aria-label="Market highlights">
   <header className="market-highlight-heading"><span><ShoppingBag size={14} aria-hidden="true"/>REPAIDO MARKET</span><small>Local finds. Useful choices.</small></header>
   <OpportunityCarousel variant="market-compact" onOpen={setDetail} footerAction={<button type="button" className="market-benefits-trigger" aria-haspopup="dialog" aria-expanded={perks!==null} onClick={()=>setPerks('shortcuts')}><Ticket size={16} aria-hidden="true"/><span>Benefits</span><ChevronDown size={14} aria-hidden="true"/></button>}/>
  </section>
  {detail&&<Modal title={detail.title} className="market-highlight-detail" onClose={()=>setDetail(null)}><img src={`/images/banners/${detail.image}.jpg`} alt={detail.alt}/><p>{detail.body}</p><details open><summary>How it works & terms</summary><p>{detail.terms}</p></details><button className="ops-primary" onClick={()=>{onChoose(detail.id as Destination);setDetail(null);}}>{detail.cta}<ArrowRight size={16} aria-hidden="true"/></button></Modal>}
  {perks&&<Modal key={perks} title={perks==='shortcuts'?'Market shortcuts':perks==='offers'?'Your offers & coupons':'Your Captain rewards'} className="market-perks-dialog" onClose={()=>setPerks(null)}>
   {perks==='shortcuts'?<>
    <nav className="market-shortcut-benefits" aria-label="Market benefits">
     <button type="button" onClick={()=>setPerks('offers')}><Ticket size={20} aria-hidden="true"/><span>Offers & coupons</span><ArrowRight size={16} aria-hidden="true"/></button>
     <button type="button" onClick={()=>setPerks('rewards')}><Trophy size={20} aria-hidden="true"/><span>My rewards</span><ArrowRight size={16} aria-hidden="true"/></button>
     <button type="button" onClick={()=>choose('sell')}><PackagePlus size={20} aria-hidden="true"/><span>Sell an item</span><ArrowRight size={16} aria-hidden="true"/></button>
    </nav>
    <nav className="market-shortcut-destinations" aria-label="Shopping shortcuts">{destinations.map(({id,title,Icon})=><button type="button" key={id} onClick={()=>choose(id)}><Icon size={18} aria-hidden="true"/><span>{title}</span><ArrowRight size={14} aria-hidden="true"/></button>)}</nav>
   </>:<>
    <button type="button" className="market-shortcut-back" onClick={()=>setPerks('shortcuts')}>All market shortcuts<ArrowRight size={14} aria-hidden="true"/></button>
    {perks==='offers'?<MarketBenefits onSignIn={onSignIn} onBrowse={browse}/>:<CaptainClub onSignIn={onSignIn}/>}
   </>}
  </Modal>}
 </>;
}
