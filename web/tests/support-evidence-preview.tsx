import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CalendarDays,Grid2X2,ShoppingBag,BriefcaseBusiness,Wrench} from 'lucide-react';
import {SupportCenter,SupportDialog,SupportQuickButton} from '../src/components/SupportWorkspace';
import '../src/styles.css';
import '../src/reference.css';
import '../src/design-system.css';
import '../src/customer-layout.css';
const params=new URLSearchParams(location.search);
function Preview(){
 const [open,setOpen]=useState(false);
 if(!params.has('launcher'))return <main><SupportCenter admin={params.has('admin')} initialCaseId={'a'.repeat(64)}/></main>;
 return <div className="repaido-customer-shell"><div className="android-app-container"><main style={{minHeight:1000,padding:20}}><h1>Support navigation fixture</h1><p>Private requests and actual case history.</p></main><nav className="android-bottom-nav" aria-label="Bottom Navigation"><SupportQuickButton onOpen={()=>setOpen(true)}/>{([[Grid2X2,'Explore'],[Wrench,'Services'],[CalendarDays,'Bookings'],[ShoppingBag,'Market'],[BriefcaseBusiness,'Hire']] as const).map(([Icon,label])=><button key={label} className={'android-nav-item '+(label==='Bookings'?'active':'')} data-bookings-nav={label==='Bookings'||undefined}><Icon size={20}/><span>{label}</span></button>)}</nav></div>{open&&<SupportDialog initialCaseId={params.has('new')?undefined:'a'.repeat(64)} onClose={()=>setOpen(false)} onSignIn={()=>setOpen(false)}/>}</div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
