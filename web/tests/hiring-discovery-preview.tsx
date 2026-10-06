// Local-only browser entry. Test data and authentication are supplied at the
// network boundary by hiring-discovery.browser.mjs, never by production UI.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Hiring} from '../src/components/Hiring';
import {fetchLiveServices} from '../src/services/repaidoService';
import type {Service} from '../src/types';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
import '../src/spacing.css';
import '../src/strokes.css';
import '../src/customer-layout.css';

function Preview(){
  const [services,setServices]=useState<Service[]>([]),[action,setAction]=useState(''),[error,setError]=useState('');
  useEffect(()=>{void fetchLiveServices().then(setServices).catch(error=>setError(error.message));},[]);
  return <><p style={{padding:12,fontSize:12}}>Local Hire browser test · fixture directory and account</p><main id="hire-preview" className="repaido-customer-shell">{error&&<p role="alert">{error}</p>}<Hiring services={services} city="Test city" onSignIn={()=>setAction('sign-in')} onBooking={id=>setAction('booking:'+id)} onRequests={()=>setAction('hire-requests')} onHome={(service,professional)=>setAction('home:'+service+(professional?':'+professional.id:''))} onService={id=>setAction('service:'+id)}/></main><output aria-label="Last Hire action">{action}</output></>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
