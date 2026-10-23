import {StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CustomerAuthJourney,type AccountJourneyComplete} from '../src/components/CustomerAuthJourney';
import {CustomerWelcome,CustomerInterestRail,HomeEntrance} from '../src/components/CustomerWelcome';
import {seededServices} from '../src/data';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/spacing.css';
import '../src/strokes.css';
import '../src/customer-layout.css';
import '../src/material-surfaces.css';
function Preview(){
 const [open,setOpen]=useState(false),[edit,setEdit]=useState(false),[result,setResult]=useState<AccountJourneyComplete|null>(null),[welcome,setWelcome]=useState(false),[action,setAction]=useState('');
 const close=()=>{setOpen(false);setEdit(false);};
 const service=(s:any)=>{setAction('service:'+s.id);setWelcome(false);},destination=(s:string)=>{setAction('destination:'+s);setWelcome(false);};
 return <main style={{maxWidth:1000,margin:'auto',padding:16}}><h1>Explore Repaido</h1><p>Browse services as a guest.</p><button onClick={()=>setOpen(true)}>Sign in or create account</button><output>{action}</output>
  {result?.setup&&<CustomerInterestRail setup={result.setup} services={seededServices} onService={service} onDestination={destination} onEdit={()=>{setEdit(true);setOpen(true);}}/>}
  {open&&<CustomerAuthJourney city="Balasore" editInterests={edit} onClose={close} onComplete={value=>{setResult(value);setWelcome(!edit);close();}}/>}
  {welcome&&result?.setup&&<CustomerWelcome setup={result.setup} name={result.user.name} created={result.created} services={seededServices} city="Balasore" onService={service} onDestination={destination} onClose={()=>setWelcome(false)} onOffer={offer=>{setAction('offer:'+offer.id+':'+offer.offer_price_paise);setWelcome(false);}}/>}
  <HomeEntrance active={!open&&!welcome} name={result?.user.name||''}/>
 </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Preview/></StrictMode>);
