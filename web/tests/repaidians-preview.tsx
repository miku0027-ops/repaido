import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import RepaidiansModal from '../src/components/repaidians/RepaidiansModal';
import {RepaidiansFab} from '../src/components/repaidians/RepaidiansFab';
import '../src/styles.css';
import '../src/design-system.css';
function Preview(){
  const [open,setOpen]=useState(true),[book,setBook]=useState('');
  return <><h1>Repaido home preview</h1><input aria-label="Home search" defaultValue="Electrical"/><p role="status">{book}</p><RepaidiansFab onOpen={()=>setOpen(true)}/>{open&&<RepaidiansModal account="guest" name="Preview member" city="Balasore" onClose={()=>setOpen(false)} onBook={trade=>{setBook(trade);setOpen(false);}}/>}</>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
