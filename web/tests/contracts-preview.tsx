// Development-only entry: the browser suite forwards requests to its isolated API.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import TendersPlatform from '../src/components/TendersPlatform';
import ContractorPortal from '../src/components/ContractorPortal';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
import '../src/components/contractor-tenders.css';
import '../src/components/market-controls.css';
function Preview(){
 const parameters=new URLSearchParams(location.search);
 const [mode,setMode]=useState(parameters.get('mode')||'discovery'),[tenderId,setTenderId]=useState<string>();
 return <main className={mode==='workspace'?'operations ops-worker contractor-app':''}>{mode==='workspace'?<ContractorPortal initialTenderId={tenderId} initialTab={parameters.get('tab')==='Tenders'?'Tenders':undefined} onBackToCustomer={()=>setMode('discovery')}/>:<div className="market-experience"><TendersPlatform onOpenContractorPortal={id=>{setTenderId(id);setMode('workspace');}}/></div>}</main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
