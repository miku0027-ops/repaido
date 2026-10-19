// Real shared components under a transformed panel and an existing booking dialog.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {JourneyMap} from '../src/components/JourneyTracking';
import {Modal} from '../src/components/ui';
import '../src/styles.css';
import '../src/design-system.css';
function Preview(){
 const [booking,setBooking]=useState(false);
 return <main style={{padding:16,minHeight:'150vh'}}><h1>Journey map checks</h1><button style={{minHeight:44}} onClick={()=>setBooking(true)}>Open booking map</button>{booking&&<Modal title="Booking map" onClose={()=>setBooking(false)}><div style={{transform:'translateY(0px)',isolation:'isolate',overflow:'hidden'}}><JourneyMap origin={{lat:21.4934,lng:86.9135}} destination={{lat:21.5014,lng:86.9235}} position={{lat:21.4954,lng:86.9155}} mapLabel="Booking journey map"/></div><label>Booking note<input aria-label="Booking note" defaultValue="Keep this booking open"/></label></Modal>}</main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
