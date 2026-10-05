// Local visual/accessibility fixture, excluded from the production entry and public directory.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {PromotionRail} from '../src/components/Promotions';
import '../src/styles.css';
import '../src/design-system.css';
function Preview(){
 const [selected,setSelected]=useState('');
 return <main style={{padding:16,maxWidth:1000,margin:'auto'}}><h1 style={{fontSize:'1rem'}}>Local-only promotion checks</h1><div style={{display:'flex',gap:8,flexWrap:'wrap',marginBlock:24}}><label>Text size <select style={{background:"var(--ui-surface)",color:"var(--ui-ink)"}} defaultValue="100" onChange={e=>{document.documentElement.style.fontSize=`${e.target.value}%`;}}>{[100,125,200].map(n=><option key={n}>{n}</option>)}</select></label><label><input type="checkbox" onChange={e=>document.documentElement.classList.toggle('reduce-motion',e.target.checked)}/>Reduced motion</label><label><input type="checkbox" onChange={e=>document.documentElement.dataset.theme=e.target.checked?'dark':'light'}/>Night theme</label></div><PromotionRail city="Balasore" onOpen={c=>setSelected(c.service?.name||c.title)}/><p role="status">{selected}</p></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
if(import.meta.env.DEV)void import('../src/dev/uiAudit').then(m=>m.startUiAudit());
