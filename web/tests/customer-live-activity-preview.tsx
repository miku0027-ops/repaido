// Local-only account fixture. The browser suite intercepts every API read.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {CustomerLiveActivity} from '../src/components/CustomerLiveActivity';
import '../src/styles.css';
import '../src/design-system.css';
await auth.authStateReady();
const listeners=new Set<(user:any)=>void>();
(auth as any).onIdTokenChanged=(next:any)=>{const listener=typeof next==='function'?next:next.next;listeners.add(listener);queueMicrotask(()=>listener(auth.currentUser));return()=>listeners.delete(listener);};
function account(uid:string,legacy=false){(auth as any).currentUser=uid&&!legacy?{uid,getIdToken:async()=>uid}:null;localStorage.setItem('repaido.token',uid);for(const listener of listeners)listener(auth.currentUser);}
account('activity-alpha',new URLSearchParams(location.search).has('legacy'));
function Preview(){const [uid,setUid]=useState('activity-alpha'),[target,setTarget]=useState('');return <main className="repaido-customer-shell" style={{maxWidth:760,margin:'auto',paddingBlock:16}}><h1 style={{fontSize:16,padding:16}}>Local Home activity checks</h1><button style={{minHeight:44,margin:16}} onClick={()=>{const next=uid==='activity-alpha'?'activity-beta':'activity-alpha';account(next);setUid(next);}}>Switch account</button><CustomerLiveActivity accountId={uid} onOpen={value=>setTarget(JSON.stringify(value))} onOpenAll={()=>setTarget('all-bookings')}/><output aria-label="Opened target">{target}</output></main>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
