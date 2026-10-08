// Development-only entry: the browser suite forwards requests to its isolated API.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import TendersPlatform from '../src/components/TendersPlatform';
import ContractorPortal from '../src/components/ContractorPortal';
import RepaidiansModal from '../src/components/repaidians/RepaidiansModal';
import {CustomContractHub} from '../src/components/CustomContracts';
import {WorkNetworkEntry} from '../src/components/WorkNetwork';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
import '../src/components/contractor-tenders.css';
import '../src/components/market-controls.css';
function Preview(){
 const parameters=new URLSearchParams(location.search);
 const [mode,setMode]=useState(parameters.get('mode')||'discovery'),[tenderId,setTenderId]=useState<string>();
 return <main className={mode==='workspace'?'operations ops-worker contractor-app':''}>{mode==='customer'||mode==='agent'?<CustomContractHub accountKey={localStorage.getItem('repaido.token')||'guest'} authenticated={!!localStorage.getItem('repaido.token')} mode={mode} focusContractId={parameters.get('contract')||undefined}/>:mode==='community'?<RepaidiansModal account={localStorage.getItem('repaido.token')||'guest'} name="Contract preview" city="Balasore" initialTab="opportunities" onClose={()=>setMode('discovery')} onBook={()=>{}} onDestination={()=>{throw Error('A customer contract must open its private contract workspace.');}}/>:mode==='workspace'?<ContractorPortal networkControls={<WorkNetworkEntry/>} initialTenderId={tenderId} initialTab={parameters.get('tab')==='Tenders'?'Tenders':undefined} onBackToCustomer={()=>setMode('discovery')}/>:<div className="market-experience"><TendersPlatform onOpenContractorPortal={id=>{setTenderId(id);setMode('workspace');}}/></div>}</main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
