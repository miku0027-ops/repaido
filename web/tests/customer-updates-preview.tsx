import {StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CustomerNotificationDrawer} from '../src/components/CustomerNotificationDrawer';
import {OperationalJobs} from '../src/components/OperationalJobs';
import {AppExperience} from '../src/components/AppExperience';
import '../src/styles.css';
import '../src/design-system.css';
function Preview(){
  const [open,setOpen]=useState(false),[selected,setSelected]=useState<string>(),[count,setCount]=useState(0);
  return <><h1>Customer account</h1><button aria-label="Notifications" onClick={()=>setOpen(true)}>Notifications · {count}</button><OperationalJobs key={selected||'jobs'} initialJobId={selected}/><CustomerNotificationDrawer isOpen={open} onClose={()=>setOpen(false)} onOpenJob={id=>setSelected(id)} onUnreadCountChange={setCount}/><AppExperience/></>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Preview/></StrictMode>);
