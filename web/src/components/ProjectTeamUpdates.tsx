import {useCallback,useEffect,useRef,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {Bell,CheckCheck,ChevronRight,RefreshCw,Users} from '../icons';
import {operation} from '../services/operations';
import {Modal} from './ui';
import './project-team-updates.css';

type TeamUpdate={id:string;kind:string;project_id:string;title:string;body:string;created_at:number;read_at?:number|null;event?:string};
type Snapshot={account:string;rows:TeamUpdate[]};

/** Private project notices use the same durable inbox and read receipts as the app bell. */
export function ProjectTeamUpdates({onOpen}:{onOpen:(projectId:string)=>void}){
 const sawFirebase=useRef(!!auth.currentUser);
 const actor=useCallback(()=>{
  if(auth.currentUser)return auth.currentUser.uid;
  if(sawFirebase.current)return '';
  try{return localStorage.getItem('repaido.token')||'';}catch{return '';}
 },[]);
 const [account,setAccount]=useState(actor),accountRef=useRef(account);
 const [snapshot,setSnapshot]=useState<Snapshot>({account,rows:[]});
 const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[saving,setSaving]=useState('');
 const refreshRef=useRef<(force?:boolean)=>Promise<void>>(async()=>{}),marking=useRef(false),generation=useRef(0);
 useEffect(()=>{
  const changed=()=>{
   if(auth.currentUser)sawFirebase.current=true;
   const next=actor();if(next===accountRef.current)return;
   accountRef.current=next;generation.current++;marking.current=false;
   setAccount(next);setSnapshot({account:next,rows:[]});setOpen(false);setError('');setSaving('');
  };
  const unsubscribe=onIdTokenChanged(auth,changed);
  const storage=(event:StorageEvent)=>{if(event.key==='repaido.token'||event.key===null)changed();};
  window.addEventListener('storage',storage);window.addEventListener('repaido:identity-changed',changed);
  return()=>{unsubscribe();window.removeEventListener('storage',storage);window.removeEventListener('repaido:identity-changed',changed);};
 },[actor]);
 useEffect(()=>{
  let active=true,running=false;const revision=++generation.current;
  const refresh=async(force=false)=>{
   if(!account||account!==actor()||running)return;
   running=true;setLoading(true);
   try{
    const result=await operation<{notifications:TeamUpdate[]}>('/notifications',{}, {background:true,force});
    if(!active||revision!==generation.current||account!==actor())return;
    const rows=result.notifications.filter(row=>row.kind==='project_team'&&typeof row.project_id==='string'&&row.project_id.length>0&&Number.isFinite(row.created_at));
    setSnapshot({account,rows});setError('');
   }catch(reason){if(active&&revision===generation.current&&account===actor()){const failure=reason as Error&{status?:number};if([401,403].includes(failure.status||0))setSnapshot({account,rows:[]});setError(failure.message);}}
   finally{running=false;if(active&&revision===generation.current&&account===actor())setLoading(false);}
  };
  refreshRef.current=refresh;void refresh();
  const update=()=>{if(!document.hidden)void refresh();};
  const timer=setInterval(update,45000);
  window.addEventListener('focus',update);window.addEventListener('repaido:operations-updated',update);document.addEventListener('visibilitychange',update);
  return()=>{active=false;generation.current++;clearInterval(timer);window.removeEventListener('focus',update);window.removeEventListener('repaido:operations-updated',update);document.removeEventListener('visibilitychange',update);};
 },[account,actor]);
 const rows=snapshot.account===actor()?snapshot.rows:[];
 const unread=rows.filter(row=>!row.read_at).length;
 const openProject=async(row:TeamUpdate)=>{
  if(marking.current||account!==actor())return;
  marking.current=true;const revision=generation.current;setSaving(row.id);setError('');
  try{
   if(!row.read_at){
    const receipt=await operation<{read_at:number}>(`/notifications/${encodeURIComponent(row.id)}/read`,{method:'POST'},{background:true});
    if(revision!==generation.current||account!==actor())return;
    setSnapshot(previous=>previous.account===account?{...previous,rows:previous.rows.map(item=>item.id===row.id?{...item,read_at:receipt.read_at}:item)}:previous);
   }
   if(revision!==generation.current||account!==actor())return;
   setOpen(false);onOpen(row.project_id);
  }catch(reason){if(revision===generation.current&&account===actor())setError((reason as Error).message);}
  finally{if(revision===generation.current){marking.current=false;setSaving('');}}
 };
 return <>
  <button type="button" className="project-updates-trigger" aria-label={`Project updates${unread?`, ${unread} unread`:''}`} aria-haspopup="dialog" onClick={()=>{setOpen(true);void refreshRef.current(true);}}>
   <Bell size={18} aria-hidden="true"/>{unread>0&&<span className="project-updates-count" aria-hidden="true">{unread>9?'9+':unread}</span>}
  </button>
  {open&&account===actor()&&<Modal title="Project updates" className="project-updates-dialog" onClose={()=>setOpen(false)}>
   <div className="project-updates-toolbar"><span>{unread?`${unread} unread`:'You’re up to date'}</span><button type="button" disabled={loading} aria-label="Refresh project updates" onClick={()=>void refreshRef.current(true)}><RefreshCw size={18} aria-hidden="true"/></button></div>
   {error&&<p className="project-updates-error" role="alert">{error}<button type="button" onClick={()=>void refreshRef.current(true)}>Retry</button></p>}
   {loading&&!rows.length&&!error&&<p className="project-updates-empty" role="status">Checking your project updates…</p>}
   {!loading&&!rows.length&&!error&&<div className="project-updates-empty"><Users size={28} aria-hidden="true"/><strong>Your next chapter starts here</strong><p>Joining and team confirmations will appear here.</p></div>}
   <ul className="project-updates-list">{rows.map(row=><li key={row.id}><button type="button" className={!row.read_at?'is-unread':undefined} disabled={!!saving} aria-busy={saving===row.id} onClick={()=>void openProject(row)}>
    <span className="project-update-symbol" aria-hidden="true">{row.event==='team_confirmed'?<Users size={21}/>:<CheckCheck size={21}/>}</span>
    <span className="project-update-copy"><strong>{row.title}</strong><span>{row.body}</span><time dateTime={new Date(row.created_at*1000).toISOString()}>{new Date(row.created_at*1000).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'})}</time></span><ChevronRight size={18} aria-hidden="true"/>
   </button></li>)}</ul>
  </Modal>}
 </>;
}
