import {createRoot} from 'react-dom/client';
import {RentalMarket} from '../src/components/Rentals';
import {Homes} from '../src/components/Homes';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/customer-layout.css';
const params=new URLSearchParams(location.search),tab=params.get('tab');
createRoot(document.getElementById('root')!).render(<div className="repaido-customer-shell"><main>{params.has('admin')?<Homes admin/>:params.has('listing')||params.has('tab')?<Homes initialListingId={params.get('listing')||undefined} initialTab={tab==='mine'||tab==='enquiries'?tab:'browse'}/>:<RentalMarket onSignIn={()=>{}}/>}</main></div>);
