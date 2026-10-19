// Isolated, local-only composition using the same customer styles as the market.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import MarketOpportunities from '../src/components/MarketOpportunities';
import OpportunityCarousel from '../src/components/OpportunityCarousel';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/customer-layout.css';
import '../src/components/compact-market.css';
function Preview(){
 const [action,setAction]=useState('');
 return <div className="repaido-customer-shell"><main style={{padding:12,maxWidth:900,margin:'auto'}}><h1 style={{fontSize:'1rem',margin:'0 0 12px'}}>Market highlights review</h1><div className="stores-hub-header"><MarketOpportunities onChoose={setAction} onSignIn={()=>setAction('sign-in')}/></div><output aria-label="Chosen destination">{action}</output><section aria-label="Unchanged home carousel" style={{marginTop:32}}><OpportunityCarousel variant="home" onOpen={slide=>setAction(slide.id)}/></section><section aria-label="Unchanged ribbon carousel" style={{marginTop:16}}><OpportunityCarousel onOpen={slide=>setAction(slide.id)}/></section></main></div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
