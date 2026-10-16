// Dedicated local browser harness. The runner injects only test authentication.
import {createRoot} from 'react-dom/client';
import {MarketInbox} from '../src/components/MarketInbox';
import {CommunityMissionsAdmin} from '../src/components/CommunityMissions';
import {CaptainClub} from '../src/components/CaptainClub';
import {AppExperience} from '../src/components/AppExperience';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/customer-layout.css';
import '../src/components/operations.css';
import '../src/spacing.css';
const params = new URLSearchParams(location.search), mode = params.get('mode');
createRoot(document.getElementById('root')!).render(<div className="repaido-customer-shell"><main style={{maxWidth:1000,margin:'0 auto',padding:16}}><h1 style={{fontSize:'1.2rem',margin:'0 0 16px'}}>Local ecosystem lifecycle checks</h1>{mode==='admin'?<CommunityMissionsAdmin/>:mode==='market'?<MarketInbox initialChatId={params.get('chat')||undefined} mode="second_hand" onClose={()=>{}}/>:<CaptainClub/>}<AppExperience/></main></div>);
