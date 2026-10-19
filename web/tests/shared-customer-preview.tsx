// Isolated component fixture; the browser supplies every network response.
import {useCallback,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {SharedRideBookings} from '../src/components/SharedRides';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
await auth.authStateReady();
const listeners=new Set<(user:any)=>void>();
function session(uid:string){(auth as any).currentUser=uid?{uid,displayName:'Shared customer fixture',getIdToken:async()=>uid}:null;localStorage.setItem('repaido.token',uid);listeners.forEach(listener=>listener(auth.currentUser));}
(auth as any).onIdTokenChanged=(next:any)=>{const listener=typeof next==='function'?next:next.next;listeners.add(listener);queueMicrotask(()=>listener(auth.currentUser));return()=>listeners.delete(listener);};session('customer');
function Preview(){const [history,setHistory]=useState(false),[refresh,setRefresh]=useState(0),[summary,setSummary]=useState<any>(null),params=new URLSearchParams(location.search),embedded=params.has('embedded');const receive=useCallback((value:any)=>setSummary(value),[]);return <main className="local-business-hub" style={{maxWidth:700,margin:'auto',padding:12}}><h1 style={{fontSize:16}}>Shared customer checks</h1><button style={{minHeight:44}} onClick={()=>session(auth.currentUser?'':'second-customer')}>Switch account</button>{embedded&&<><div aria-label="Parent ride filters"><button onClick={()=>setHistory(false)}>Active rides</button><button onClick={()=>setHistory(true)}>Past rides</button><button onClick={()=>setRefresh(value=>value+1)}>Refresh all rides</button></div><output aria-label="Shared summary" style={{display:'block',fontSize:12}}>{JSON.stringify(summary)}</output></>}<SharedRideBookings embedded={embedded} historyView={embedded?history:undefined} refreshToken={refresh} onSummary={receive} onHistoryChange={setHistory} initialRecordId={params.get('ride')||''} onSignIn={()=>{}}/></main>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
