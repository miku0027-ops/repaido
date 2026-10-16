import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CampaignOutcomes} from '../src/components/CampaignOutcomes';
import {CompatibilityFinder} from '../src/components/SaveMarketItem';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
import '../src/components/company-crm.css';
import '../src/components/shop-tools.css';
import '../src/components/homes.css';
function Preview(){
 const [campaign,setCampaign]=useState('campaign-a'),[category,setCategory]=useState('AC');
 return new URLSearchParams(location.search).get('mode')==='compatibility'?<main className="homes-panel"><h1>Parts compatibility check</h1><label>Category fixture<select aria-label="Category fixture" value={category} onChange={e=>setCategory(e.target.value)}><option value="AC">AC</option><option value="Washing Machine">Washing Machine</option></select></label><CompatibilityFinder category={category}/></main>:<main className="operations portal-company" style={{maxWidth:1100,margin:'auto',padding:12}}><h1>Campaign reporting check</h1><label>Campaign fixture<select aria-label="Campaign fixture" value={campaign} onChange={e=>setCampaign(e.target.value)}><option value="campaign-a">Campaign A</option><option value="campaign-b">Campaign B</option></select></label><CampaignOutcomes campaignId={campaign}/></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
