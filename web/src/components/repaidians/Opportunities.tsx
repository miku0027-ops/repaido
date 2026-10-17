import {useEffect,useRef,useState} from 'react';
import {BriefcaseBusiness,Building2,ClipboardList,Layers3,Package,Plus,RefreshCw,SlidersHorizontal,Gavel} from '../../icons';
import {opportunities,trades,peekCommunityView,communityViewScope,rememberCommunityView,dropCommunityView} from '../../services/repaidiansService';
import type {CommunityOpportunity,OpportunityFilters,OpportunityReference,OpportunitySource,Trade} from '../../types/repaidians';
import {EmptyState} from './common';
import {OpportunityCard} from './OpportunityCard';

export interface OpportunitiesProps {
  onDestination:(card:CommunityOpportunity)=>void;onManage:(source:OpportunitySource|'applications')=>void;
  onShare?:(reference:OpportunityReference)=>void;city?:string;initialKind?:OpportunityFilters['kind'];revision?:number;
}
const kinds=[{id:'all',label:'All',icon:Layers3},{id:'tenders',label:'Tenders',icon:Gavel},{id:'jobs',label:'Jobs',icon:BriefcaseBusiness},{id:'products',label:'Products',icon:Package}] as const;
type OpportunityWindow={items:CommunityOpportunity[];cursor:string|null;indexing:boolean};
const unique=(cards:CommunityOpportunity[])=>[...new Map(cards.map(card=>[card.source+':'+card.id,card])).values()];

export function Opportunities({onDestination,onManage,onShare,city:initialCity='',initialKind='all',revision=0}:OpportunitiesProps){
  const [kind,setKind]=useState<OpportunityFilters['kind']>(initialKind),[mode,setMode]=useState<OpportunityFilters['mode']>('all'),[trade,setTrade]=useState<Trade|'all'>('all'),[city,setCity]=useState(initialCity);
  const [items,setItems]=useState<CommunityOpportunity[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(true),[moreBusy,setMoreBusy]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[indexing,setIndexing]=useState(false);
  const generation=useRef(0),loadedFilters=useRef(''),currentItems=useRef(items),lastChange=useRef({revision,refresh});currentItems.current=items;
  useEffect(()=>setKind(initialKind),[initialKind]);
  useEffect(()=>{
    const update=()=>{if(!document.hidden)setRefresh(value=>value+1);};
    const timer=setInterval(update,30000);
    window.addEventListener('repaido:operations-updated',update);document.addEventListener('visibilitychange',update);
    return()=>{clearInterval(timer);window.removeEventListener('repaido:operations-updated',update);document.removeEventListener('visibilitychange',update);};
  },[]);
  useEffect(()=>{
    const controller=new AbortController(),owner=communityViewScope();generation.current++;setError('');
    const filterKey=JSON.stringify([kind,mode,trade,city.trim()]),key='opportunities:'+filterKey;
    const force=lastChange.current.revision!==revision||lastChange.current.refresh!==refresh;lastChange.current={revision,refresh};
    const cached=peekCommunityView<OpportunityWindow>(key),same=loadedFilters.current===filterKey;loadedFilters.current=filterKey;
    if(!force&&cached){setItems(cached.items);setCursor(cached.cursor);setIndexing(cached.indexing);setBusy(false);return()=>controller.abort();}
    const extent=Math.max(12,cached?.items.length|| (same?currentItems.current.length:0));
    if(!same){setItems(cached?.items||[]);setCursor(cached?.cursor||null);setIndexing(cached?.indexing||false);}setBusy(true);
    const timer=setTimeout(()=>{void (async()=>{
      let cards:CommunityOpportunity[]=[],next:string|null=null,indexing=false,pages=0;
      do{const data=await opportunities({kind,mode,trade,city:city.trim(),limit:Math.min(50,extent-cards.length),...(next?{cursor:next}:{})},controller.signal,force);
        cards=unique([...cards,...data.items]);next=data.nextCursor;indexing=!!data.indexing;
      }while(next&&cards.length<extent&&++pages<Math.ceil(extent/12));
      if(controller.signal.aborted||owner!==communityViewScope())return;setItems(cards);setCursor(next);setIndexing(indexing);if(cards.length<=240)rememberCommunityView(key,{items:cards,cursor:next,indexing},owner);
    })().catch(error=>{if(!controller.signal.aborted){if([401,402,403,404].includes((error as {status?:number}).status||0)){setItems([]);setCursor(null);dropCommunityView(key);}setError((error as Error).message);}}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});},150);
    return()=>{clearTimeout(timer);controller.abort();};
  },[kind,mode,trade,city,revision,refresh]);
  const loadMore=async()=>{
    if(!cursor||moreBusy)return;const current=generation.current;setMoreBusy(true);setError('');
    try{const data=await opportunities({kind,mode,trade,city:city.trim(),cursor,limit:12});if(current!==generation.current)return;setItems(old=>{const items=unique([...old,...data.items]);if(items.length<=240)rememberCommunityView('opportunities:'+loadedFilters.current,{items,cursor:data.nextCursor,indexing:!!data.indexing});return items;});setCursor(data.nextCursor);setIndexing(!!data.indexing);}catch(error){if(current===generation.current)setError((error as Error).message);}finally{if(current===generation.current)setMoreBusy(false);}
  };
  const saved=(card:CommunityOpportunity,active:boolean)=>setItems(old=>mode==='saved'&&!active?old.filter(item=>item.source!==card.source||item.id!==card.id):old.map(item=>item.source===card.source&&item.id===card.id?{...item,saved:active}:item));
  return <section className="rp-opportunities" aria-label="Professional opportunities">
    <div className="rp-section-heading"><div><h2>Work, projects & products</h2><p className="rp-fine">Published opportunities from across Repaido.</p></div><button className="rp-secondary" aria-label="Refresh opportunities" disabled={busy} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={20}/></button></div>
    <div className="rp-opportunities-tabs" role="group" aria-label="Opportunity category">{kinds.map(item=><button key={item.id} aria-pressed={kind===item.id} onClick={()=>setKind(item.id)}><item.icon size={20}/>{item.label}</button>)}</div>
    <div className="rp-opportunities-modes" role="group" aria-label="Opportunity source">{([{id:'all',label:'Discover'},{id:'saved',label:'Saved opportunities'},{id:'mine',label:'My listings'}] as const).map(item=><button key={item.id} aria-pressed={mode===item.id} onClick={()=>setMode(item.id)}>{item.label}</button>)}</div>
    <details className="rp-opportunities-filters"><summary><SlidersHorizontal size={20}/>Filter opportunities{(trade!=='all'||city.trim())&&<span>Active</span>}</summary><div className="rp-form-grid"><label>Opportunity trade<select value={trade} onChange={event=>setTrade(event.target.value as Trade|'all')}><option value="all">All trades</option>{trades.map(trade=><option key={trade.id} value={trade.id}>{trade.name}</option>)}</select></label><label>Opportunity city<input maxLength={80} placeholder="Any city" value={city} onChange={event=>setCity(event.target.value)}/></label></div>{(trade!=='all'||city.trim())&&<button className="rp-secondary" onClick={()=>{setTrade('all');setCity('');}}>Clear opportunity filters</button>}</details>
    <button className="rp-secondary rp-opportunities-applications" onClick={()=>onManage('applications')}><ClipboardList size={20}/>My applications</button>
    <details className="rp-opportunities-manage"><summary><Plus size={20}/>Create a listing</summary><p className="rp-fine">Publish in the relevant Repaido workspace, then share the listing with your community.</p><div className="rp-opportunities-manage-actions"><button onClick={()=>onManage('contract')}><Building2 size={20}/>New tender</button><button onClick={()=>onManage('career')}><BriefcaseBusiness size={20}/>Post a job</button><button onClick={()=>onManage('inventory')}><Package size={20}/>Shop inventory</button><button onClick={()=>onManage('second_hand')}><Package size={20}/>Sell second hand</button></div></details>
    {busy&&!items.length&&<p role="status" className="rp-opportunities-loading">Finding published opportunities…</p>}
    {error&&<div className="rp-error" role="alert"><p>{error}</p><button className="rp-secondary" onClick={()=>setRefresh(value=>value+1)}>Retry opportunities</button></div>}
    {!busy&&indexing&&<p className="rp-fine" role="status">Listings are being refreshed. More opportunities may appear shortly.</p>}
    <div className="rp-opportunities-grid">{items.map(card=><OpportunityCard key={card.source+':'+card.id} card={card} onDestination={onDestination} onShare={onShare} onSaved={saved}/>)}</div>
    {cursor&&!busy&&<button className="rp-load-more" disabled={moreBusy} onClick={()=>void loadMore()}>{moreBusy?'Loading opportunities…':'More opportunities'}</button>}
    {!busy&&!error&&!items.length&&<EmptyState title={mode==='saved'?'No saved opportunities':mode==='mine'?'No listings yet':'No matches yet'}>{mode==='saved'?'Save a project, job or product to find it here later.':mode==='mine'?'Your published contracts, jobs and products will appear here.':'Try a different trade or city, or check back for new listings.'}</EmptyState>}
  </section>;
}
