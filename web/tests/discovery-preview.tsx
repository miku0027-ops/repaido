import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Discovery from '../src/components/Discovery';
import RepaidoBrand from '../src/components/RepaidoBrand';
import {fetchLiveServices} from '../src/services/repaidoService';
import type {Service} from '../src/types';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/premium-discovery.css';
import '../src/spacing.css';
import '../src/strokes.css';
import '../src/customer-layout.css';
function Preview(){
 const [services,setServices]=useState<Service[]>([]),[city,setCity]=useState('Balasore'),[chosen,setChosen]=useState(''),[error,setError]=useState('');
 useEffect(()=>{void fetchLiveServices().then(setServices).catch(e=>setError(e.message));},[]);
 return <main className="repaido-customer-shell"><header style={{padding:'16px'}}><RepaidoBrand/></header>{error&&<p role="alert">{error}</p>}<Discovery services={services} city={city} onCity={setCity} items={[]} subtotal={0} onAdd={s=>setChosen(s.id)} onChange={()=>{}} onProceed={()=>{}} preview={false}/><output aria-label="Chosen service">{chosen}</output></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
