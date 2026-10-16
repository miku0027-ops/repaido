// Local test harness. The browser runner supplies synthetic Firebase identities.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {Marketplace,type Mode} from '../src/components/Marketplace';
import {HomeDiscoveryHub} from '../src/components/HomeDiscoveryHub';
import {AppExperience} from '../src/components/AppExperience';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/customer-layout.css';
import '../src/components/compact-market.css';
import '../src/spacing.css';
const area={lat:21.4934,lng:86.9135,city:'Balasore',address:'Local fixture area',confirmed:true};
function Preview(){
 const [view,setView]=useState('market'),[mode,setMode]=useState<Mode>('second_hand'),[uid,setUid]=useState(auth.currentUser?.uid||''),[mounted,setMounted]=useState(true),[action,setAction]=useState('');
 useEffect(()=>{(window as any).__marketFixture={account:(id:string)=>{(window as any).__fixtureAccount(id);setUid(id);},view:setView,mode:setMode,mount:setMounted};},[]);
 return <div className="repaido-customer-shell"><header style={{padding:14,display:'flex',gap:10,flexWrap:'wrap'}}><strong>Local-only listing checks</strong><button style={{minHeight:44,padding:8}} onClick={()=>setView(view==='market'?'discovery':'market')}>Switch preview</button></header><main style={{padding:14,maxWidth:980,margin:'auto'}}>{view==='discovery'?<HomeDiscoveryHub key={uid} preferredFocus="repair" personalised location={area} accountKey={uid} onLocation={()=>setAction('location')} onPreferences={()=>setAction('preferences')} onSignIn={()=>setAction('sign-in')} onBook={(service,person)=>setAction(JSON.stringify({kind:'book',id:service.id,person}))} onHome={(service,person)=>setAction(JSON.stringify({kind:'home',id:service,person}))} onMarket={(section,options)=>setAction(JSON.stringify({kind:'market',section,options}))} onEvent={()=>{}}/>:mounted&&<div className="market-experience"><Marketplace mode={mode} initialLocation={area} onSignIn={()=>setAction('sign-in')}/></div>}</main><output aria-label="Last preview action" style={{display:'block',padding:14,overflowWrap:'anywhere'}}>{action}</output><AppExperience/></div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
