// Disposable verification entry; production code supplies every map and read.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TransportRail} from '../src/components/TransportRail';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/mobility-experience.css';
import '../src/components/mobility-map-workspace.css';

function Preview(){
 const [far,setFar]=useState(false),[shared,setShared]=useState(false),[active,setActive]=useState(true),[account,setAccount]=useState('guest');
 return <main style={{maxWidth:900,margin:'auto',padding:12}}><h1>Public cab discovery</h1><div aria-label="Test scenario controls" style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
  <button onClick={()=>setFar(value=>!value)}>Change pickup</button><button onClick={()=>setShared(value=>!value)}>Change mode</button><button onClick={()=>setActive(value=>!value)}>Toggle active</button><button onClick={()=>setAccount(value=>value==='guest'?'other':'guest')}>Change account</button>
 </div><section className="local-business-hub mobility-experience" data-mode={shared?'shared':'cab'}><TransportRail mapView compact location={{lat:far?22.4934:21.4934,lng:86.9135,confirmed:true,city:'Balasore'}} modeFilter={shared?'shared':'cab'} accountKey={account} active={active} onSignIn={()=>{}}/></section></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
