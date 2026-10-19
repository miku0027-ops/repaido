import {lazy,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AsyncWorkspace} from '../src/components/AsyncWorkspace';
import '../src/styles.css';
import '../src/design-system.css';
function Preview(){
 const [open,setOpen]=useState(false),[dialog,setDialog]=useState(false),[attempt,setAttempt]=useState(0);
 const Pending=useMemo(()=>lazy(()=>new Promise<{default:()=>React.JSX.Element}>((resolve,reject)=>{
  (window as any).finishWorkspace=()=>resolve({default:()=> <h2>Loaded workspace</h2>});
  (window as any).failWorkspace=()=>reject(Error('Download fixture failed'));
 })),[attempt]);
 return <main style={{maxWidth:640,margin:'auto',padding:12}}><h1>Workspace loading checks</h1><button onClick={()=>{setAttempt(value=>value+1);setDialog(false);setOpen(true);}}>Open workspace</button><button onClick={()=>{setAttempt(value=>value+1);setDialog(true);setOpen(true);}}>Open registration</button>{open&&<AsyncWorkspace key={attempt} label={dialog?'Partner registration':'Worker workspace'} dialog={dialog} onBack={()=>setOpen(false)}><Pending/></AsyncWorkspace>}</main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
