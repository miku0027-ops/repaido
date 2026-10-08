// Isolated browser fixture, excluded from the production entry.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {auth} from '../src/firebase';
import {Marketplace} from '../src/components/Marketplace';
import {HireRequests} from '../src/components/Hiring';
import {AppExperience} from '../src/components/AppExperience';
import {Modal} from '../src/components/ui';
import {operation} from '../src/services/operations';
import {cartService} from '../src/services/cartService';
import '../src/styles.css';
import '../src/design-system.css';
await auth.authStateReady();
(auth as any).currentUser={uid:'feedback-fixture',getIdToken:async()=>'fixture-only'};
localStorage.setItem('repaido.token','fixture-only');
function Controls(){const[open,setOpen]=useState(false),[nested,setNested]=useState(false);const save=()=>void operation('/profile',{method:'PUT',body:'{}'}).catch(()=>{});return <><button onClick={()=>setOpen(true)}>Open test form</button><button onClick={()=>cartService.addItem({id:'fixture',title:'Test spare',price_paise:10000,stock:2})}>Add test spare</button>{open&&<Modal title="Test form" onClose={()=>setOpen(false)}><input aria-label="Preserved draft" defaultValue="Keep these details"/><button onClick={save}>Save profile</button><button onClick={()=>setNested(true)}>Open nested form</button>{nested&&<Modal title="Nested form" onClose={()=>setNested(false)}><button onClick={save}>Save nested profile</button></Modal>}</Modal>}</>;}
const mode=new URLSearchParams(location.search).get('mode');
createRoot(document.getElementById('root')!).render(<><main style={{maxWidth:960,margin:'auto',padding:16}}><h1>Feedback checks</h1>{mode==='hire'?<HireRequests onBooking={()=>{}}/>:mode==='controls'?<Controls/>:<Marketplace mode="second_hand" manage initialCreate/>}</main><AppExperience/></>);
