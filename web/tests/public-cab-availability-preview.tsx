import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {PublicCabAvailability} from '../src/components/PublicCabAvailability';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/business-suites.css';
await auth.authStateReady();
const assign=(uid:string)=>(auth as any).currentUser={uid,getIdToken:async()=>uid};
assign('driver');
function Preview(){const [uid,setUid]=useState('driver'),[shown,setShown]=useState(true);return <main className="business-suite suite-driver" style={{maxWidth:700,margin:'20px auto',padding:12}}><h1 style={{fontSize:20}}>Availability sharing</h1><button onClick={()=>{const next=uid==='driver'?'other':'driver';assign(next);setUid(next);}}>Switch account</button><button onClick={()=>setShown(value=>!value)}>Toggle control</button>{shown&&<PublicCabAvailability accountKey={uid}/>}</main>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
