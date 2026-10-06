import {useEffect,useRef,useState} from 'react';
import {BriefcaseBusiness,Building2,ClipboardList,Layers3,Package,Plus,SlidersHorizontal} from 'lucide-react';
import {opportunities,trades} from '../../services/repaidiansService';
import type {CommunityOpportunity,OpportunityFilters,OpportunityReference,OpportunitySource,Trade} from '../../types/repaidians';
import {EmptyState} from './common';
import {OpportunityCard} from './OpportunityCard';

export interface OpportunitiesProps {
  onDestination:(card:CommunityOpportunity)=>void;onManage:(source:OpportunitySource|'applications')=>void;
  onShare?:(reference:OpportunityReference)=>void;city?:string;initialKind?:OpportunityFilters['kind'];revision?:number;
}
const kinds=[{id:'all',label:'All',icon:Layers3},{id:'tenders',label:'Tenders',icon:Building2},{id:'jobs',label:'Jobs',icon:BriefcaseBusiness},{id:'products',label:'Products',icon:Package}] as const;
const unique=(cards:CommunityOpportunity[])=>[...new Map(cards.map(card=>[card.source+':'+card.id,card])).values()];

export function Opportunities({onDestination,onManage,onShare,city:initialCity='',initialKind='all',revision=0}:OpportunitiesProps){
  const [kind,setKind]=useState<OpportunityFilters['kind']>(initialKind),[mode,setMode]=useState<OpportunityFilters['mode']>('all'),[trade,setTrade]=useState<Trade|'all'>('all'),[city,setCity]=useState(initialCity);
  const [items,setItems]=useState<CommunityOpportunity[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(true),[moreBusy,setMoreBusy]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[indexing,setIndexing]=useState(false);
  const generation=useRef(0),loadedFilters=useRef('');
  useEffect(()=>setKind(initialKind),[initialKind]);
  useEffect(()=>{
    const controller=new AbortController();generation.current++;setBusy(true);setError('');const filterKey=JSON.stringify([kind,mode,trade,city.trim()]);if(loadedFilters.current!==filterKey)setItems([]);loadedFilters.current=filterKey;setCursor(null);setIndexing(false);
    const timer=setTimeout(()=>{void opportunities({kind,mode,trade,city:city.trim(),limit:12},controller.signal).then(data=>{if(controller.signal.aborted)return;setItems(data.items);setCursor(data.nextCursor);setIndexing(!!data.indexing);}).catch(error=>{if(!controller.signal.aborted)setError((error as Error).message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});},150);
    return()=>{clearTimeout(timer);controller.abort();};
  },[kind,mode,trade,city,revision,refresh]);
  const loadMore=async()=>{
    if(!cursor||moreBusy)return;const current=generation.current;setMoreBusy(true);setError('');
    try{const data=await opportunities({kind,mode,trade,city:city.trim(),cursor,limit:12});if(current!==generation.current)return;setItems(old=>unique([...old,...data.items]));setCursor(data.nextCursor);setIndexing(!!data.indexing);}catch(error){if(current===generation.current)setError((error as Error).message);}finally{setMoreBusy(false);}
  };
  const saved=(card:CommunityOpportunity,active:boolean)=>setItems(old=>mode==='saved'&&!active?old.filter(item=>item.source!==card.source||item.id!==card.id):old.map(item=>item.source===card.source&&item.id===card.id?{...item,saved:active}:item));
  return <section className="rp-opportunities" aria-label="Professional opportunities">
    <div className="rp-section-heading"><div><h2>Work, projects & products</h2><p className="rp-fine">Published opportunities from across Repaido.</p></div><BriefcaseBusiness size={23}/></div>
    <div className="rp-opportunities-tabs" role="group" aria-label="Opportunity category">{kinds.map(item=><button key={item.id} aria-pressed={kind===item.id} onClick={()=>setKind(item.id)}><item.icon size={17}/>{item.label}</button>)}</div>
    <div className="rp-opportunities-modes" role="group" aria-label="Opportunity source">{([{id:'all',label:'Discover'},{id:'saved',label:'Saved opportunities'},{id:'mine',label:'My listings'}] as const).map(item=><button key={item.id} aria-pressed={mode===item.id} onClick={()=>setMode(item.id)}>{item.label}</button>)}</div>
    <details className="rp-opportunities-filters"><summary><SlidersHorizontal size={17}/>Filter opportunities{(trade!=='all'||city.trim())&&<span>Active</span>}</summary><div className="rp-form-grid"><label>Opportunity trade<select value={trade} onChange={event=>setTrade(event.target.value as Trade|'all')}><option value="all">All trades</option>{trades.map(trade=><option key={trade.id} value={trade.id}>{trade.name}</option>)}</select></label><label>Opportunity city<input maxLength={80} placeholder="Any city" value={city} onChange={event=>setCity(event.target.value)}/></label></div>{(trade!=='all'||city.trim())&&<button className="rp-secondary" onClick={()=>{setTrade('all');setCity('');}}>Clear opportunity filters</button>}</details>
    <button className="rp-secondary rp-opportunities-applications" onClick={()=>onManage('applications')}><ClipboardList size={17}/>My applications</button>
    <details className="rp-opportunities-manage"><summary><Plus size={17}/>Create a listing</summary><p className="rp-fine">Publish in the relevant Repaido workspace, then share the listing with your community.</p><div className="rp-opportunities-manage-actions"><button onClick={()=>onManage('contract')}><Building2 size={17}/>New tender</button><button onClick={()=>onManage('career')}><BriefcaseBusiness size={17}/>Post a job</button><button onClick={()=>onManage('inventory')}><Package size={17}/>Shop inventory</button><button onClick={()=>onManage('second_hand')}><Package size={17}/>Sell second hand</button></div></details>
    {busy&&<p role="status" className="rp-opportunities-loading">Finding published opportunities…</p>}
    {error&&<div className="rp-error" role="alert"><p>{error}</p><button className="rp-secondary" onClick={()=>setRefresh(value=>value+1)}>Retry opportunities</button></div>}
    {!busy&&indexing&&<p className="rp-fine" role="status">Listings are being refreshed. More opportunities may appear shortly.</p>}
    <div className="rp-opportunities-grid">{items.map(card=><OpportunityCard key={card.source+':'+card.id} card={card} onDestination={onDestination} onShare={onShare} onSaved={saved}/>)}</div>
    {cursor&&!busy&&<button className="rp-load-more" disabled={moreBusy} onClick={()=>void loadMore()}>{moreBusy?'Loading opportunities…':'More opportunities'}</button>}
    {!busy&&!error&&!items.length&&<EmptyState title={mode==='saved'?'Keep the right opportunities close.':mode==='mine'?'Your next listing starts here.':'No published opportunities match yet.'}>{mode==='saved'?'Save a project, job or product to find it here later.':mode==='mine'?'Your published tenders, jobs and products will appear here. Use Create a listing to get started.':'Try another trade or city. Published tenders, jobs and products appear as their owners make them available.'}</EmptyState>}
  </section>;
}
