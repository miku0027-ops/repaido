import {createRoot} from 'react-dom/client';
import {BusinessAccounts} from '../src/components/BusinessAccounts';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/customer-layout.css';
createRoot(document.getElementById('root')!).render(<div className="repaido-customer-shell"><main><BusinessAccounts onSignIn={()=>{}}/></main></div>);
