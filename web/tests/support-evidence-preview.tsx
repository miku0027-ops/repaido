import {createRoot} from 'react-dom/client';
import {SupportCenter} from '../src/components/SupportWorkspace';
import '../src/styles.css';
import '../src/design-system.css';
const params=new URLSearchParams(location.search);
createRoot(document.getElementById('root')!).render(<main><SupportCenter admin={params.has('admin')} initialCaseId={'a'.repeat(64)}/></main>);
