import {Card} from '../Card';
import {useEffect,useState} from 'react';
import {ArrowUpRight,Bookmark,BriefcaseBusiness,Building2,Check,Crown,MapPin,Package,Share2} from 'lucide-react';
import {apiAssetUrl} from '../../services/api';
import {saveOpportunity} from '../../services/repaidiansService';
import type {CommunityOpportunity,OpportunityReference} from '../../types/repaidians';
import {tradeName} from './common';

const paise=(value:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:value%100?2:0}).format(value/100);
const conditions:Record<string,string>={new:'New',refurbished:'Refurbished',second_hand:'Second hand',used:'Second hand'};
const titleCase=(value:string)=>value.replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase());
const actionName=(kind:CommunityOpportunity['kind'])=>kind==='tender'?'View tender':kind==='job'?'View job':'View product';

export interface OpportunityCardProps {
  card:CommunityOpportunity;onDestination?:(card:CommunityOpportunity)=>void;
  onShare?:(reference:OpportunityReference)=>void;onSaved?:(card:CommunityOpportunity,saved:boolean)=>void;
  compact?:boolean;allowSave?:boolean;
}
export function OpportunityCard({card,onDestination,onShare,onSaved,compact=false,allowSave=true}:OpportunityCardProps){
  const [saved,setSaved]=useState(!!card.saved),[busy,setBusy]=useState(false),[error,setError]=useState(''),[imageFailed,setImageFailed]=useState(false);
  useEffect(()=>setSaved(!!card.saved),[card.source,card.id,card.saved]);
  useEffect(()=>setImageFailed(false),[card.imageUrl]);
  const amount=card.kind==='tender'?card.budgetPaise:card.pricePaise;
  const available=card.available!==false;
  const customerContract=card.action.route==='custom_contracts';
  const Icon=card.kind==='tender'?Building2:card.kind==='job'?BriefcaseBusiness:Package;
  const save=async()=>{
    if(busy)return;const next=!saved;setBusy(true);setError('');
    try{await saveOpportunity({source:card.source,id:card.id},next);setSaved(next);onSaved?.(card,next);}catch(error){setError((error as Error).message);}finally{setBusy(false);}
  };
  return <Card className={'rp-opportunity-card '+(compact?'rp-opportunity-card-compact':'')} data-kind={card.kind}>
    {!!card.imageUrl&&!imageFailed&&<div className="rp-opportunity-image"><img src={apiAssetUrl(card.imageUrl)} alt={card.title} loading="lazy" onError={()=>setImageFailed(true)}/></div>}
    <div className="rp-opportunity-body"><div className="rp-opportunity-badges"><span className="rp-opportunity-kind"><Icon size={14}/>{customerContract?'Customer contract':card.kind==='tender'?'Tender':card.kind==='job'?'Job':'Product'}</span>{card.condition&&<span className="rp-opportunity-condition" data-condition={card.condition}>{conditions[card.condition]||titleCase(card.condition)}</span>}{card.prime?.active&&<span className="rp-opportunity-prime"><Crown size={13}/>Prime shop</span>}{card.prime?.active&&card.prime.paid_placement&&<span className="rp-opportunity-placement">Paid placement</span>}</div>
      <h3>{card.title}</h3>{card.description&&<p className="rp-opportunity-description">{card.description}</p>}
      <div className="rp-opportunity-facts">{card.city&&<span><MapPin size={14}/>{card.city}</span>}{card.trade&&card.trade!=='all'&&<span>{tradeName(card.trade)}</span>}{card.ownerName&&<span>{card.ownerName}</span>}<span>{available?titleCase(card.status):'Unavailable'}</span>{card.kind==='job'&&card.openings!=null&&<span>{card.openings} {card.openings===1?'opening':'openings'}</span>}</div>
      {!!card.skills?.length&&<div className="rp-professional-skills" aria-label="Requested skills">{card.skills.slice(0,4).map(skill=><span key={skill}>{skill}</span>)}</div>}
      {amount!=null&&Number.isFinite(amount)&&<div className="rp-opportunity-price"><small>{card.kind==='tender'?'Listed budget':card.kind==='job'?'Listed pay':'Price'}</small><strong>{paise(amount)}{card.kind==='job'&&card.rateUnit==='day'?' / day':''}</strong></div>}
      {error&&<p className="rp-error" role="alert">{error}</p>}
      {(onDestination||allowSave||(card.shareable&&onShare))&&<div className="rp-opportunity-actions">{onDestination&&<button className="rp-primary" disabled={!available} onClick={()=>onDestination(card)}>{available?(customerContract?'Open contract':actionName(card.kind)):'Listing unavailable'}<ArrowUpRight size={17}/></button>}{allowSave&&<button className="rp-opportunity-save" disabled={busy||(!available&&!saved)} aria-label={saved?'Unsave opportunity':'Save opportunity'} aria-pressed={saved} aria-busy={busy} onClick={()=>void save()}>{saved?<Check size={18}/>:<Bookmark size={18}/>}</button>}{card.shareable&&onShare&&available&&<button className="rp-opportunity-share" aria-label="Share opportunity with Repaidians" onClick={()=>onShare({source:card.source,id:card.id})}><Share2 size={18}/></button>}</div>}
    </div>
  </Card>;
}
