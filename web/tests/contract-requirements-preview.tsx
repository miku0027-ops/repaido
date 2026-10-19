// Development-only harness for delayed discovery requests and account changes.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {ContractRequirementDiscovery,ContractRequirementSummary} from '../src/components/ContractDiscovery';
import '../src/styles.css';
import '../src/design-system.css';
function Preview(){
 const [account,setAccount]=useState('first'),[city,setCity]=useState('Balasore'),[selected,setSelected]=useState('');
 return <main style={{maxWidth:720,margin:'auto',padding:12}}><h1>Requirement discovery checks</h1><button onClick={()=>setCity(value=>value==='Balasore'?'Cuttack':'Balasore')}>Switch city</button><button onClick={()=>{localStorage.setItem('repaido.token','second');window.dispatchEvent(new Event('repaido:identity-changed'));setAccount('second');}}>Switch account</button><ContractRequirementDiscovery accountKey={account} city={city} onOpen={setSelected}/>{selected&&<ContractRequirementSummary accountKey={account} id={selected} onBack={()=>setSelected('')}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
