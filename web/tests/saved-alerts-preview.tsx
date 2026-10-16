import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SaveMarketItem} from '../src/components/SaveMarketItem';
import {CustomerActivityHub,type ActivityLaunch} from '../src/components/CustomerActivityHub';
import {CustomerNotificationDrawer} from '../src/components/CustomerNotificationDrawer';
import '../src/styles.css';
import '../src/design-system.css';
function Preview(){
 const [id,setId]=useState('one'),[inbox,setInbox]=useState(false),[launch,setLaunch]=useState<ActivityLaunch>(),[opened,setOpened]=useState(false);
 return <main style={{maxWidth:850,margin:'auto',padding:16}}><h1>Saved updates checks</h1><button onClick={()=>setId(x=>x==='one'?'two':'one')}>Switch item</button><SaveMarketItem kind="product" id={id} label={'Item '+id}/><button onClick={()=>setInbox(true)}>Open inbox</button><CustomerActivityHub launch={launch}/>{opened&&<p>Saved destination opened</p>}<CustomerNotificationDrawer isOpen={inbox} onClose={()=>setInbox(false)} onOpenSaved={()=>{setOpened(true);setLaunch({view:'saved',token:Date.now()});}}/></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
