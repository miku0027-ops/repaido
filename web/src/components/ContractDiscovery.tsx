import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowLeft,ArrowRight,BriefcaseBusiness,Clock,MapPin,RefreshCw,ShieldCheck} from '../icons';
import {CommunityError,opportunities,opportunityDetails} from '../services/repaidiansService';
import type {CommunityOpportunity,OpportunityPage} from '../types/repaidians';
import {ContractError,contractDate,contractMoney} from './customContractUI';
import './contract-discovery.css';

type DiscoveryProps={accountKey:string;city?:string;onOpen:(id:string)=>void;relatedOnly?:boolean};
// Retire the rendered cards as well as pending requests when the viewing scope changes.
export function ContractRequirementDiscovery(props:DiscoveryProps){return <RequirementDiscovery key={JSON.stringify([props.accountKey,props.city||''])} {...props}/>;}
function RequirementDiscovery({accountKey,city,onOpen,relatedOnly=false}:DiscoveryProps){
 const pending=useRef<{active:boolean;running:boolean;controller:AbortController}|null>(null);
 const [data,setData]=useState<OpportunityPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{const scope={active:true,running:false,controller:new AbortController()};pending.current=scope;
  const load=async(force=false)=>{if(scope.running||document.hidden)return;scope.running=true;setBusy(true);setError('');try{const value=await opportunities({kind:'requirements',city},scope.controller.signal,force);if(scope.active)setData(value);}catch(e){if(scope.active&&!scope.controller.signal.aborted){setError((e as Error).message);if(e instanceof CommunityError&&[401,402,403,404].includes(e.status))setData(null);}}finally{scope.running=false;if(scope.active)setBusy(false);}};
  void load(revision>0);const timer=setInterval(()=>void load(true),30000),visible=()=>{if(!document.hidden)void load(true);};document.addEventListener('visibilitychange',visible);return()=>{scope.active=false;scope.controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[accountKey,city,revision]);
 const more=async()=>{
  const scope=pending.current,cursor=data?.nextCursor;
  if(!scope?.active||scope.running||!cursor)return;
  scope.running=true;setBusy(true);setError('');
  try{const page=await opportunities({kind:'requirements',city,cursor},scope.controller.signal);if(scope.active)setData(old=>({...page,items:[...new Map([...(old?.items||[]),...page.items].map(card=>[card.id,card])).values()]}));}
  catch(e){if(scope.active&&!scope.controller.signal.aborted){setError((e as Error).message);if(e instanceof CommunityError&&[401,402,403,404].includes(e.status))setData(null);}}
  finally{scope.running=false;if(scope.active)setBusy(false);}
 };
 const items=(data?.items||[]).filter(card=>!relatedOnly||card.summaryOnly);
 if(!items.length&&!error&&!data?.nextCursor)return null;
 return <section className="contract-discovery" aria-label="Customer contract requirements" aria-busy={busy}><header><div><span>FROM CUSTOMERS</span><h2>{relatedOnly?'Related requirements':'Contract requirements'}</h2></div><button disabled={busy} aria-label="Refresh contract requirements" onClick={()=>setRevision(n=>n+1)}><RefreshCw size={16} aria-hidden="true"/></button></header><p>Matched to your trade, city and experience.</p><ContractError error={error} onRetry={()=>setRevision(n=>n+1)}/><div className="contract-discovery-rail" role="region" aria-label="Matching contract requirements" tabIndex={0}>{items.map(card=><article key={card.id}><span className="contract-discovery-kind"><BriefcaseBusiness size={16} aria-hidden="true"/>Customer requirement</span><h3>{card.title}</h3><p><MapPin size={14} aria-hidden="true"/>{card.city}</p>{card.budgetPaise!=null&&<strong>{contractMoney(card.budgetPaise)}<small>Planned budget</small></strong>}<button onClick={()=>onOpen(card.id)}>{card.summaryOnly?'View requirement':'Review requirement'}<ArrowRight size={16} aria-hidden="true"/></button></article>)}</div>{data?.nextCursor&&<button disabled={busy} onClick={()=>void more()}>More requirements<ArrowRight size={16} aria-hidden="true"/></button>}</section>;
}

/** Agents read the discovery projection, not private contract documents or proposals. */
type SummaryProps={id:string;accountKey:string;onBack:()=>void;renderFull?:()=>ReactNode};
export function ContractRequirementSummary(props:SummaryProps){return <RequirementSummary key={JSON.stringify([props.accountKey,props.id])} {...props}/>;}
function RequirementSummary({id,accountKey,onBack,renderFull}:SummaryProps){
 const [card,setCard]=useState<CommunityOpportunity|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[fullFallback,setFullFallback]=useState(false);
 useEffect(()=>{let active=true;setCard(null);setError('');setFullFallback(false);void opportunityDetails({source:'contract',id}).then(value=>{if(active)setCard(value);}).catch(e=>{if(active){if(e instanceof CommunityError&&e.status===404&&renderFull)setFullFallback(true);else setError((e as Error).message);}});return()=>{active=false;};},[id,accountKey,attempt]);
 if(renderFull&&(fullFallback||card&&!card.summaryOnly))return renderFull();
 return <section className="contract-requirement-summary"><button onClick={onBack}><ArrowLeft size={16} aria-hidden="true"/>Contract requirements</button><ContractError error={error} onRetry={()=>setAttempt(n=>n+1)}/>{!card&&!error&&<p role="status">Checking this requirement…</p>}{card&&<><span className="cc-eyebrow">Customer requirement</span><h2>{card.title}</h2><p><MapPin size={16} aria-hidden="true"/>{card.city} · {card.description}</p>{card.budgetPaise!=null&&<div className="cc-money"><strong>{contractMoney(card.budgetPaise)}</strong><small>Customer’s planned budget</small></div>}{card.deadline&&<p><Clock size={16} aria-hidden="true"/>Proposals until {contractDate(card.deadline)}</p>}<div className="cc-match"><ShieldCheck size={18} aria-hidden="true"/><p>This request is awaiting a contractor. Registered contractors submit proposals; confirmed workforce openings appear separately below.</p></div><p className="cc-note">Site details and private contractor proposals are shared through the authorized contract workspace.</p><button onClick={onBack}>Explore workforce openings<ArrowRight size={16} aria-hidden="true"/></button></>}</section>;
}
