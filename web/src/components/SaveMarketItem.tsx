import {apiFetch} from '../services/api';
import {useEffect,useRef,useState} from 'react';
import {auth} from '../firebase';
import {onIdTokenChanged} from 'firebase/auth';
import {operation} from '../services/operations';
export function SaveMarketItem({kind,id,label}:{kind:'shop'|'professional'|'product'|'second_hand'|'exchange';id:string;label:string}){
 const [saved,setSaved]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[uid,setUid]=useState(auth.currentUser?.uid||'');
 const epoch=useRef(0),mutation=useRef(0),scope=useRef('');scope.current=[uid,kind,id].join(':');
 useEffect(()=>onIdTokenChanged(auth,u=>{setUid(u?.uid||'');}),[]);
 useEffect(()=>{
  let active=true;setSaved('');setError('');setBusy(false);mutation.current=0;
  const load=async()=>{if(mutation.current)return;const request=++epoch.current;setLoading(!!uid);if(!uid)return;
   try{const data=await operation<{id:string|null}>('/customer-hub/saved/status?'+new URLSearchParams({kind,reference:id}),{}, {feedback:false});if(active&&request===epoch.current){setSaved(data.id||'');setError('');}}
   catch(e){if(active&&request===epoch.current)setError((e as Error).message);}
   finally{if(active&&request===epoch.current)setLoading(false);}
  };void load();const refresh=()=>{void load();};window.addEventListener('repaido:operations-updated',refresh);
  return()=>{active=false;epoch.current++;window.removeEventListener('repaido:operations-updated',refresh);};
 },[uid,kind,id]);
 return <div className="market-save-control"><button type="button" disabled={busy||loading} aria-pressed={!!saved} onClick={async()=>{
  if(mutation.current||loading)return;const context=scope.current,request=++epoch.current;mutation.current=request;setBusy(true);setError('');
  const current=()=>scope.current===context&&request===epoch.current&&uid===(auth.currentUser?.uid||'');
  try{if(saved){await operation('/customer-hub/saved/'+saved,{method:'DELETE'});if(current())setSaved('');}else{const data=await operation<{id:string}>('/customer-hub/saved',{method:'POST',body:JSON.stringify({kind,reference:id,label})});if(current())setSaved(data.id);}}
  catch(e){if(current())setError((e as Error).message);}
  finally{if(mutation.current===request)mutation.current=0;if(current())setBusy(false);}
 }}>{loading?'Checking saved item…':busy?'Updating…':['product','second_hand','exchange'].includes(kind)?(saved?'Saved item':'Save item'):(saved?'Following · unfollow':'Follow '+(kind==='shop'?'shop':'professional'))}</button>{error&&<p role="alert">{error}</p>}</div>;
}
export function CompatibilityFinder({category}:{category:string}){
 const [model,setModel]=useState(''),[result,setResult]=useState<{items:{id:string;title:string;compatibility:string;match:string}[];scope:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const sequence=useRef(0),pending=useRef<AbortController|null>(null);
 const reset=()=>{sequence.current++;pending.current?.abort();pending.current=null;setResult(null);setError('');setBusy(false);};
 useEffect(()=>{reset();return()=>{sequence.current++;pending.current?.abort();};},[category]);
 const search=async()=>{
  const id=++sequence.current;pending.current?.abort();const controller=new AbortController();pending.current=controller;setResult(null);setBusy(true);setError('');
  try{const response=await apiFetch('/api/operations/customer-hub/compatibility?'+new URLSearchParams({category,model}),{signal:controller.signal});const data=await response.json();if(!response.ok)throw Error(data.detail?.message||'Could not check compatibility.');if(id===sequence.current)setResult(data);}
  catch(e){if(id===sequence.current&&!controller.signal.aborted)setError((e as Error).message);}finally{if(id===sequence.current){pending.current=null;setBusy(false);}}
 };
 return <details className="home-thread"><summary>Find parts for your model</summary><form className="homes-form" onSubmit={e=>{e.preventDefault();void search();}}><label>Appliance model or part number<input value={model} minLength={2} maxLength={100} required onChange={e=>{reset();setModel(e.target.value);}}/></label><button disabled={busy}>Check supplier declarations</button></form>{error&&<p role="alert">{error}</p>}{result&&<><p>{result.scope}</p>{!result.items.length&&<p>No declared match. Ask the shop before buying.</p>}{result.items.map(x=><article key={x.id}><strong>{x.title}</strong><p>{x.compatibility}</p><small>{x.match}</small><button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('repaido:activity-open',{detail:{kind:'product',id:x.id}}))}>View item</button></article>)}</>}</details>;
}
