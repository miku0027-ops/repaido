// Local browser harness: all data comes from the disposable API, never production.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Hiring,type Professional} from '../src/components/Hiring';
import ServiceLeaders from '../src/components/ServiceLeaders';
import {HomeEntry,HomeHub} from '../src/components/HomePlans';
import {HomeServiceDetails} from '../src/components/HomeServiceDetails';
import {fetchLiveServices} from '../src/services/repaidoService';
import {listenProfessionalActions} from '../src/services/professionalNavigation';
import type {Service} from '../src/types';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/customer-layout.css';
import '../src/spacing.css';
import '../src/strokes.css';

function Preview(){
 const [services,setServices]=useState<Service[]>([]),[home,setHome]=useState<{service:string;professional?:{id:string;name:string}}>(),[focused,setFocused]=useState<Professional>(),[selected,setSelected]=useState<Service>(),[last,setLast]=useState(''),[error,setError]=useState('');
 useEffect(()=>{void fetchLiveServices().then(setServices).catch(error=>setError(error.message));},[]);
 const openService=(id:string,professional?:{id:string;name:string})=>{const service=services.find(row=>row.id===id);if(service){setSelected(service);setHome(undefined);setLast(JSON.stringify({kind:'service',id,professional}));}};
 useEffect(()=>listenProfessionalActions({services,onService:(service,professional)=>{setSelected(service);setLast(JSON.stringify({kind:'service',id:service.id,professional}));},onHome:(service,professional)=>{setHome({service,professional});setLast(JSON.stringify({kind:'home',id:service,professional}));},onHire:professional=>{setFocused(professional);setLast(JSON.stringify({kind:'hire',professional:{id:professional.id,name:professional.name}}));},onUnavailable:setError}),[services]);
 return <div className="repaido-customer-shell"><header style={{padding:12,display:'flex',gap:12,alignItems:'center'}}><strong>Local-only customer checks</strong><button style={{minHeight:44,padding:8}} onClick={()=>{setFocused(undefined);setHome(undefined);setSelected(undefined);}}>Return to catalogue</button></header><main style={{padding:14,maxWidth:900,margin:'auto'}}>{error&&<p role="alert">{error}</p>}{focused?<Hiring initialProfessional={focused} city="Balasore" services={services} location={{lat:21.4934,lng:86.9135,confirmed:true}} onBooking={()=>setLast('booking')} onSignIn={()=>setLast('sign-in')} onRequests={()=>setLast('requests')} onHome={(service,professional)=>setHome({service,professional})} onService={openService}/>:<><HomeEntry city="Balasore" services={services} onOpen={()=>setHome({service:''})}/><ServiceLeaders category="electrician" city="Balasore" initiallyExpanded/></>}</main>{home&&<HomeHub key={home.service+home.professional?.id} initialService={home.service||undefined} preferredWorker={home.professional} services={services} onService={openService} city="Balasore" onClose={()=>setHome(undefined)} onSignIn={()=>setLast('sign-in')} onPlans={()=>{setHome(undefined);setLast('plan-requested');}}/>}{selected&&<HomeServiceDetails service={selected} onClose={()=>setSelected(undefined)} onBook={()=>setLast('service-reviewed')}/>}<output aria-label="Last profile action" style={{display:'block',padding:12,overflowWrap:'anywhere'}}>{last}</output></div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
