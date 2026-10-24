// Isolated development fixture: the browser runner controls GPS callbacks.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LocationPickerModal} from '../src/components/LocationPickerModal';
import {ShopRegistration} from '../src/components/ShopRegistration';
import {PrivateProjectForm} from '../src/components/PrivateProjectForm';
import '../src/styles.css';
import '../src/design-system.css';
const first={lat:21.4934,lng:86.9135,address:'First house, Station Road',city:'Balasore'};
const second={lat:20.2961,lng:85.8245,address:'Second house, Market Road',city:'Bhubaneswar'};
function Preview(){
 const [open,setOpen]=useState(false),[point,setPoint]=useState(first),[saved,setSaved]=useState<typeof first|null>(null);
 return <main><h1>Location picker checks</h1><button type="button" onClick={()=>{setPoint(first);setOpen(true);}}>Open first address</button><button type="button" onClick={()=>{setPoint(second);setOpen(true);}}>Open second address</button><output aria-label="Saved location">{saved?JSON.stringify(saved):'No location saved'}</output><LocationPickerModal isOpen={open} addressRequired title="Confirm test location" initialLat={point.lat} initialLng={point.lng} initialAddress={point.address} initialCity={point.city} onClose={()=>setOpen(false)} onConfirmLocation={setSaved}/></main>;
}
const view=new URLSearchParams(location.search).get('view');
createRoot(document.getElementById('root')!).render(view==='shop'?<ShopRegistration>{()=>null}</ShopRegistration>:view==='private'?<PrivateProjectForm onClose={()=>{}} onCreated={()=>{}}/>:<Preview/>);
