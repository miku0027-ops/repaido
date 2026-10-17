import {useEffect,useRef,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {Check,ChevronDown,Flag,RefreshCw,ShieldCheck,X} from '../icons';
import {auth} from '../firebase';
import {operation} from '../services/operations';
import './market-chat-moderation.css';

type Status='open'|'resolved'|'dismissed';
type Report={id:string;chat_id:string;listing_id:string;reason:string;message_id:string|null;message_context:string|null;status:Status;created_at:number;resolved_at?:number;note?:string};
type Page={reports:Report[];next_cursor:string|null};
type Resolution={status:'resolved'|'dismissed';note:string};
const actor=()=>auth.currentUser?.uid||localStorage.getItem('repaido.token')||'';
const label=(status:Status)=>status==='open'?'Open':status==='resolved'?'Resolved':'Dismissed';
const timestamp=(value:number)=>new Date(value*1000).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
function validPage(value:Page){return Array.isArray(value?.reports)&&value.reports.every(row=>row&&typeof row.id==='string'&&typeof row.reason==='string'&&typeof row.listing_id==='string'&&['open','resolved','dismissed'].includes(row.status)&&typeof row.created_at==='number')&&(value.next_cursor===null||typeof value.next_cursor==='string');}

/** Only reported excerpts are shown. This is deliberately not a private inbox. */
export function MarketChatModeration(){
 const [identity,setIdentity]=useState(actor),[status,setStatus]=useState<Status>('open'),[revision,setRevision]=useState(0);
 const [state,setState]=useState<{identity:string;status:Status;reports:Report[];cursor:string|null}>({identity:'',status:'open',reports:[],cursor:null});
 const [notes,setNotes]=useState<Record<string,string>>({}),[pending,setPending]=useState<Record<string,Resolution>>({});
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[actionId,setActionId]=useState('');
 const epoch=useRef(0),mounted=useRef(true),controllers=useRef(new Set<AbortController>());
 useEffect(()=>{mounted.current=true;const changed=()=>setIdentity(actor());const off=onIdTokenChanged(auth,changed);window.addEventListener('storage',changed);return()=>{mounted.current=false;off();window.removeEventListener('storage',changed);for(const controller of controllers.current)controller.abort();controllers.current.clear();};},[]);
 useEffect(()=>{setNotes({});setPending({});setActionId('');setError('');setNotice('');},[identity]);
 const current=(account:string,signal?:AbortSignal)=>mounted.current&&actor()===account&&!signal?.aborted;
 useEffect(()=>{
  const account=identity,request=++epoch.current,controller=new AbortController();controllers.current.add(controller);
  setBusy(true);setLoading(false);setError('');setNotice('');
  void operation<Page>('/admin/market/chats/reports?'+new URLSearchParams({status}),{signal:controller.signal},{background:true,feedback:false}).then(value=>{
   if(!current(account,controller.signal)||request!==epoch.current)return;if(!validPage(value))throw new Error('Report data could not be confirmed. Refresh to retry.');setState({identity:account,status,reports:value.reports,cursor:value.next_cursor});
  }).catch(problem=>{if(current(account,controller.signal)&&request===epoch.current){setState({identity:account,status,reports:[],cursor:null});setError((problem as Error).message||'Reports could not be loaded.');}}).finally(()=>{controllers.current.delete(controller);if(current(account,controller.signal)&&request===epoch.current)setBusy(false);});
  return()=>{controller.abort();controllers.current.delete(controller);};
 },[identity,status,revision]);
 const visible=state.identity===identity&&state.status===status?state.reports:[];
 const cursor=state.identity===identity&&state.status===status?state.cursor:null;
 const more=async()=>{
  if(!cursor||loading||busy)return;const account=identity,request=epoch.current,controller=new AbortController();controllers.current.add(controller);setLoading(true);setError('');
  try{const value=await operation<Page>('/admin/market/chats/reports?'+new URLSearchParams({status,cursor}),{signal:controller.signal},{background:true,feedback:false});if(!current(account,controller.signal)||request!==epoch.current)return;if(!validPage(value))throw new Error('The next report page could not be confirmed. Retry this page.');setState(previous=>({...previous,reports:[...new Map([...previous.reports,...value.reports].map(row=>[row.id,row])).values()],cursor:value.next_cursor}));}
  catch(problem){if(current(account,controller.signal)&&request===epoch.current)setError((problem as Error).message||'The next reports could not be loaded.');}
  finally{controllers.current.delete(controller);if(current(account,controller.signal)&&request===epoch.current)setLoading(false);}
 };
 const resolve=async(report:Report,decision:'resolved'|'dismissed')=>{
  if(actionId)return;const account=identity,command=pending[report.id]||{status:decision,note:(notes[report.id]||'').trim()};if(command.note.length<10)return;
  const controller=new AbortController();controllers.current.add(controller);setActionId(report.id);setError('');setNotice('');
  try{const value=await operation<{status:Status}>('/admin/market/chats/reports/'+encodeURIComponent(report.id)+'/resolve',{method:'POST',body:JSON.stringify(command),signal:controller.signal},{background:true,feedback:false});if(!current(account,controller.signal))return;if(value.status!==command.status)throw new Error('Resolution could not be confirmed. Retry the same action.');setPending(previous=>{const next={...previous};delete next[report.id];return next;});setNotes(previous=>{const next={...previous};delete next[report.id];return next;});setState(previous=>({...previous,reports:previous.reports.filter(row=>row.id!==report.id)}));setNotice(command.status==='resolved'?'Report resolved. The decision and review note were saved.':'Report dismissed. The decision and review note were saved.');}
  catch(problem){if(current(account,controller.signal)){const failure=problem as Error&{status?:number};if(!failure.status||failure.status>=500)setPending(previous=>({...previous,[report.id]:command}));setError(failure.message||'The decision could not be saved. Your note is retained.');}}
  finally{controllers.current.delete(controller);if(current(account,controller.signal))setActionId('');}
 };
 return <section className="market-chat-moderation" aria-labelledby="market-chat-moderation-title">
  <header><div><span className="market-moderation-icon"><ShieldCheck size={18} aria-hidden="true"/></span><div><h3 id="market-chat-moderation-title">Marketplace message reports</h3><p>Review reported concerns with only the referenced message excerpt.</p></div></div><button type="button" className="market-moderation-refresh" aria-label="Refresh marketplace message reports" disabled={busy||!!actionId} onClick={()=>setRevision(value=>value+1)}><RefreshCw size={16} className={busy?'is-refreshing':''} aria-hidden="true"/><span>Refresh</span></button></header>
  <div className="market-moderation-filters" role="group" aria-label="Message report status">{(['open','resolved','dismissed'] as Status[]).map(value=><button key={value} type="button" aria-pressed={status===value} disabled={!!actionId} onClick={()=>setStatus(value)}>{label(value)}</button>)}</div>
  {error&&<p className="market-moderation-error" role="alert">{error}</p>}{notice&&<p className="market-moderation-notice" role="status">{notice}</p>}
  {busy&&<p className="market-moderation-empty" role="status">Loading {status} reports…</p>}
  {!busy&&!error&&!visible.length&&<p className="market-moderation-empty"><Check size={18} aria-hidden="true"/>No {status} marketplace message reports.</p>}
  <div className="market-moderation-list">{visible.map(report=>{
   const draft=notes[report.id]||'',retry=pending[report.id],working=actionId===report.id;
   return <article className="market-moderation-report" key={report.id} aria-label={'Marketplace report '+report.id.slice(0,8)}>
    <div className="market-moderation-report-heading"><span><Flag size={14} aria-hidden="true"/>Report #{report.id.slice(0,8)}</span><span className={'market-moderation-state is-'+report.status}>{label(report.status)}</span><time dateTime={new Date(report.created_at*1000).toISOString()}>{timestamp(report.created_at)}</time></div>
    <p className="market-moderation-reason">{report.reason}</p>
    <div className="market-moderation-reference">Listing <code>{report.listing_id.slice(0,16)}</code>{report.message_id&&<span>· Message #{Number(report.message_id.split(':').at(-1))||report.message_id.slice(-8)}</span>}</div>
    {report.message_context?<details className="market-moderation-excerpt"><summary>Reported message excerpt<ChevronDown size={14} aria-hidden="true"/></summary><blockquote>{report.message_context}</blockquote><small>Contact details are removed. Unrelated private messages are not shown.</small></details>:<p className="market-moderation-muted">No individual message was referenced in this report.</p>}
    {report.status==='open'?<div className="market-moderation-review"><label htmlFor={'market-moderation-note-'+report.id}>Review note<textarea aria-label="Review note" id={'market-moderation-note-'+report.id} rows={2} maxLength={1000} value={retry?.note||draft} disabled={!!retry||working} placeholder="Record the review and action taken (at least 10 characters)." onChange={event=>setNotes(previous=>({...previous,[report.id]:event.target.value}))}/></label>{retry&&<p role="status" className="market-moderation-muted">Confirmation is pending. Retry the same decision and note to avoid a conflicting resolution.</p>}<div className="market-moderation-actions">{retry?<button type="button" disabled={!!actionId} onClick={()=>void resolve(report,retry.status)}><RefreshCw size={14} aria-hidden="true"/>{working?'Confirming…':'Retry '+label(retry.status).toLowerCase()+' decision'}</button>:<><button type="button" disabled={!!actionId||draft.trim().length<10} onClick={()=>void resolve(report,'resolved')}><Check size={14} aria-hidden="true"/>{working?'Saving…':'Resolve report'}</button><button type="button" disabled={!!actionId||draft.trim().length<10} onClick={()=>void resolve(report,'dismissed')}><X size={14} aria-hidden="true"/>Dismiss report</button></>}</div></div>:<div className="market-moderation-outcome"><strong>Review note</strong><p>{report.note||'No review note was recorded.'}</p>{report.resolved_at&&<small>Reviewed {timestamp(report.resolved_at)}</small>}</div>}
   </article>;
  })}</div>
  {cursor&&<button type="button" className="market-moderation-more" disabled={loading||busy||!!actionId} onClick={()=>void more()}>{loading?'Loading more…':'Load more reports'}<ChevronDown size={16} aria-hidden="true"/></button>}
 </section>;
}
