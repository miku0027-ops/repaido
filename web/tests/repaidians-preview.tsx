import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import RepaidiansModal from '../src/components/repaidians/RepaidiansModal';
import {RepaidiansFab} from '../src/components/repaidians/RepaidiansFab';
import '../src/styles.css';
import '../src/design-system.css';
function Preview(){
  const [open,setOpen]=useState(true),[book,setBook]=useState(''),[account,setAccount]=useState('guest');
  useEffect(()=>{const change=(event:Event)=>setAccount((event as CustomEvent<string>).detail);window.addEventListener('repaidians-preview-account',change);return()=>window.removeEventListener('repaidians-preview-account',change);},[]);
  return <><h1>Repaido home preview</h1><input aria-label="Home search" defaultValue="Electrical"/><p role="status">{book}</p><RepaidiansFab onOpen={()=>setOpen(true)}/>{open&&<RepaidiansModal account={account} name="Preview member" city="Balasore" onDestination={card=>{setBook(`Opened ${card.source}:${card.id} · ${card.title}`);setOpen(false);}} onManage={source=>{setBook(`Manage ${source}`);setOpen(false);}} onClose={()=>setOpen(false)} onBook={trade=>{setBook(trade);setOpen(false);}}/>}</>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
