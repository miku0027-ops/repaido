import {createRoot} from 'react-dom/client';
import {HireRequests} from '../src/components/Hiring';
import {RentalMarket} from '../src/components/Rentals';
import '../src/styles.css';
import '../src/design-system.css';
const view=new URLSearchParams(location.search).get('view');
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:900,margin:'auto',padding:16}}><h1>Activity destinations</h1>{view==='hiring'?<HireRequests initialRequestId="hire-two" onBooking={id=>{document.getElementById('opened-task')!.textContent=id;}}/>:<RentalMarket initialRentalId="rental-two" onSignIn={()=>{}}/>}<output id="opened-task" aria-label="Opened task"/></main>);
