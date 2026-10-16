// Only this local browser harness accepts synthetic Firebase identities.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {Marketplace,type Mode} from '../src/components/Marketplace';
import {MarketInbox} from '../src/components/MarketInbox';
import {MarketAccessModal} from '../src/components/MarketAccessPanel';
import {CustomerNotificationDrawer} from '../src/components/CustomerNotificationDrawer';
import {MarketChatModeration} from '../src/components/MarketChatModeration';
import {AppExperience} from '../src/components/AppExperience';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/customer-layout.css';
import '../src/components/compact-market.css';
import '../src/spacing.css';
import '../src/components/company-crm.css';
function Preview(){
 const [mode,setMode]=useState<Mode>('second_hand'),[uid,setUid]=useState(auth.currentUser?.uid||''),[inbox,setInbox]=useState<{listing?:string;chat?:string}|null>(null),[access,setAccess]=useState(false),[action,setAction]=useState(''),[notifications,setNotifications]=useState(false),[moderation,setModeration]=useState(false);
 useEffect(()=>{(window as any).__messageFixture={account:(id:string|null)=>{(window as any).__fixtureAccount(id);setUid(id||'');},mode:setMode,open:(listing?:string,chat?:string)=>setInbox({listing,chat}),close:()=>setInbox(null),access:()=>setAccess(true),notifications:()=>setNotifications(true),moderation:()=>setModeration(true)};},[]);
 return <div className="repaido-customer-shell"><header style={{padding:14,display:'flex',gap:10,flexWrap:'wrap'}}><strong>Local marketplace checks</strong><button onClick={()=>setInbox({})}>Test inbox</button><button onClick={()=>setAccess(true)}>Test access</button><button onClick={()=>setNotifications(true)}>Test notifications</button><button onClick={()=>setModeration(value=>!value)}>Test moderation</button></header><main style={{padding:14,maxWidth:980,margin:'auto'}}>{moderation?<div className="operations portal-company crm-workspace" style={{display:'block',width:'100%'}}><MarketChatModeration/></div>:<div className="market-experience"><Marketplace mode={mode} initialLocation={{lat:21.4934,lng:86.9135}} onSignIn={()=>setAction('sign-in')}/></div>}</main>{inbox&&<MarketInbox key={uid} mode={mode} initialListingId={inbox.listing} initialChatId={inbox.chat} onClose={()=>setInbox(null)} onSignIn={()=>setAction('sign-in')} onAccess={()=>setAccess(true)}/>} {access&&<MarketAccessModal key={uid} onClose={()=>setAccess(false)} onSignIn={()=>setAction('sign-in')}/>}<CustomerNotificationDrawer key={'notification:'+uid} isOpen={notifications} onClose={()=>setNotifications(false)} onOpenMarketChat={chat=>{setAction('notification:'+chat);setInbox({chat});}} onOpenJob={()=>setAction('wrong-job')}/><output aria-label="Last preview action">{action}</output><AppExperience/></div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
