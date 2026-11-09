import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import HomeQuickActions from '../src/components/HomeQuickActions';
import HomeServiceFinder from '../src/components/HomeServiceFinder';
import type {Service} from '../src/types';
import '../src/styles.css';
import '../src/design-system.css';

function Preview(){
  const [action,setAction]=useState('');
  if(new URLSearchParams(location.search).has('finder')){
    const services:Service[]=[0,19900,49900,50000,50001].map(price=>({id:`fixture-${price}`,name:`Fixture service ${price}`,category:'plumber',description:'Test-only listed scope',price,duration:45,image:'',imageAlt:'',included:[],excluded:[]}));
    return <main className="repaido-customer-shell"><HomeServiceFinder services={services} onPreview={service=>setAction(service.id)}/><output aria-label="Last action">{action}</output></main>;
  }
  return <main className="repaido-customer-shell"><HomeQuickActions city={new URLSearchParams(location.search).get('city')||'Test city'}
    location={new URLSearchParams(location.search).has('noLocation')?undefined:{lat:21.4934,lng:86.9135}}
    onLocation={()=>setAction('choose-location')}
    onMarket={(section,options)=>setAction(JSON.stringify({section,...options}))}
    onHire={()=>setAction('hire')} onHome={(id,professional)=>setAction(professional?JSON.stringify({service:id,professional}):'home:'+id)}
    onService={service=>setAction('service:'+service.id)} onCatalogue={()=>setAction('catalogue')}
    onOpenCart={()=>setAction('cart')}/><output aria-label="Last action">{action}</output></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
