// Isolated browser fixture; this entry is excluded from the production bundle.
import {createRoot} from 'react-dom/client';
import {ContractRecordsPanel} from '../src/components/ContractRecordsPanel';
import CustomerBookingCard from '../src/components/CustomerBookingCard';
import type {Job} from '../src/services/operations';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
import '../src/components/customer-bookings.css';
const params=new URLSearchParams(location.search),mode=params.get('mode')||'customer';
createRoot(document.getElementById('root')!).render(<main className="cc-hub customer-bookings-page" style={{maxWidth:960,padding:16,margin:'auto'}}><h1 style={{fontSize:'1.1rem'}}>Private project workspace</h1>{mode==='bookings'?<div style={{display:'grid',gap:20}}>{['en_route','in_progress','completion_pending','completed'].map((state,i)=><CustomerBookingCard key={state} onOpen={()=>{}} job={{id:'booking-'+i,state,allowed_actions:state==='completion_pending'?['accept_completion']:[],service_id:'ac-service',service_name:'AC service',starts_at:new Date().toISOString(),city:'Balasore',total_paise:99900,payment_status:'pay_after_service'} as Job}/>)}</div>:<ContractRecordsPanel projectId={params.get('project')||'experience-project'} accountKey={params.get('account')||'customer'} mode={mode==='contractor'?'contractor':'customer'}/>}</main>);
