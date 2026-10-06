import {useState} from 'react';
import {ArrowUpRight,BriefcaseBusiness,Clock,LockKeyhole,MapPin,Users} from 'lucide-react';
import type {CommunityMember,CommunityTender} from '../../types/repaidians';
import {Author,EmptyState,LocalLabel,money,tradeName} from './common';
export function Tenders({tenders,bids,paid,memberFor,onProfile,onBid,onContact,onCreate}:{tenders:CommunityTender[];bids:string[];paid:boolean;memberFor:(id:string)=>CommunityMember;onProfile:(id:string)=>void;onBid:(id:string)=>void;onContact:(tender:CommunityTender)=>boolean;onCreate:()=>void}) {
  const [revealed,setRevealed]=useState<string[]>([]);
  if(!tenders.length)return <EmptyState title="Build a crew. Make a start." onCreate={onCreate}>Post a clear site requirement with its scope, budget and deadline.</EmptyState>;
  return <div className="rp-tenders"><div className="rp-board-intro"><BriefcaseBusiness size={24}/><div><h2>Good work starts with a clear brief.</h2><p>Crew requirements & subcontract opportunities.</p></div></div>{tenders.map(tender=>{
    const closed=tender.deadline<=Date.now(),hasBid=bids.includes(tender.id);
    return <article className="rp-tender" key={tender.id}><header><span className="rp-trade-badge">{tradeName(tender.trade)}</span><LocalLabel sample={tender.sample}/></header><h3>{tender.title}</h3><p>{tender.details}</p>
      <div className="rp-tender-facts"><span><MapPin size={15}/>{tender.location}</span><span><Users size={15}/>{tender.slots} {tender.slots===1?'position':'positions'}</span><span><Clock size={15}/>{closed?'Closed':'Closes '+new Date(tender.deadline).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span></div>
      <div className="rp-tender-budget"><small>Listed budget</small><strong>{money(tender.budgetRupees)}{tender.id==='sample-tender-electrical'&&<small> / person / day</small>}</strong></div>
      <Author member={memberFor(tender.authorId)} onOpen={()=>onProfile(tender.authorId)}/>
      <div className="rp-tender-actions"><button className="rp-primary" disabled={closed||hasBid} onClick={()=>onBid(tender.id)}>{hasBid?'Interest saved':closed?'Tender closed':'Submit interest'}<ArrowUpRight size={16}/></button><button className="rp-secondary" onClick={()=>{if(onContact(tender))setRevealed(ids=>[...ids,tender.id]);}}><LockKeyhole size={16}/>Contact</button></div>
      {paid&&revealed.includes(tender.id)&&<p className="rp-notice">{tender.contact||'This sample tender has no contact details. Interest is saved on this device only.'}</p>}
    </article>;
  })}</div>;
}
