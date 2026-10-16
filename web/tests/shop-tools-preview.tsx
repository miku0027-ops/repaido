import {createRoot} from 'react-dom/client';
import ShopTools from '../src/components/ShopTools';
import '../src/styles.css';
import '../src/design-system.css';
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:820,margin:'0 auto',padding:16}}><ShopTools/></main>);
