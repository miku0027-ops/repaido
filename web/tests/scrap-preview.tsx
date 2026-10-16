import {useCallback,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ScrapWizard,ScrapRecords} from '../src/components/ScrapCollection';
import {HomeServicesGrid} from '../src/components/HomeServicesGrid';
import {operation} from '../src/services/operations';
import '../src/styles.css';
import '../src/design-system.css';

function Preview(){
 const fixture=JSON.parse(localStorage.getItem('scrap.fixture')||'{}');
 const [actor,setActor]=useState<'customer'|'collector'>('customer'),[creating,setCreating]=useState(true),[rows,setRows]=useState<any[]>([]),[error,setError]=useState('');
 const uid=fixture[actor]?.id||'',collector=actor==='collector';
 const refresh=useCallback(async()=>{try{const response=await operation<{collections:any[]}>('/local-business/scrap',{}, {background:true,force:true});setRows(response.collections);setError('');}catch(problem){setError((problem as Error).message);}},[uid]);
 useEffect(()=>{localStorage.setItem('repaido.token',fixture[actor]?.token||'');setRows([]);void refresh();const timer=setInterval(()=>void refresh(),2000);return()=>clearInterval(timer);},[uid,refresh]);
 return <div className="repaido-customer-shell" style={{maxWidth:720,margin:'auto',padding:16}}><h1>Scrap lifecycle test</h1><button onClick={()=>{setActor(value=>value==='customer'?'collector':'customer');setCreating(false);}}>Switch to {collector?'customer':'collector'}</button><button onClick={()=>{setActor('customer');setCreating(true);}}>New pickup</button>
 {creating&&!collector?<ScrapWizard initialLocation={{lat:21.4934,lng:86.9135,address:'Fixture pickup entrance 123, Balasore',city:'Balasore'}} onClose={()=>setCreating(false)} onSaved={()=>{setCreating(false);void refresh();}} onSignIn={()=>setError('Fixture sign-in unavailable')}/>:<ScrapRecords key={uid} records={{uid,rows,error,refresh,busy:false,loaded:true}} owner={collector}/>}
 <HomeServicesGrid forceHydrated={false} activeCategory="all" onSelectCategory={()=>{}} city="Balasore"/>
 </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
