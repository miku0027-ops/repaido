import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import HomeQuickActions from '../src/components/HomeQuickActions';
import '../src/styles.css';
import '../src/design-system.css';

function Preview(){
  const [action,setAction]=useState('');
  return <main className="repaido-customer-shell"><HomeQuickActions city={new URLSearchParams(location.search).get('city')||'Test city'}
    location={new URLSearchParams(location.search).has('noLocation')?undefined:{lat:21.4934,lng:86.9135}}
    onLocation={()=>setAction('choose-location')}
    onMarket={(section,options)=>setAction(JSON.stringify({section,...options}))}
    onHire={()=>setAction('hire')} onHome={(id,professional)=>setAction(professional?JSON.stringify({service:id,professional}):'home:'+id)}
    onService={service=>setAction('service:'+service.id)} onCatalogue={()=>setAction('catalogue')}
    onOpenCart={()=>setAction('cart')}/><output aria-label="Last action">{action}</output></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
