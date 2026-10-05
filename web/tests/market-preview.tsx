import {createRoot} from 'react-dom/client';
import {SparePartsShop} from '../src/components/SparePartsShop';
import {ShopInventory} from '../src/components/Procurement';
import {ShopPrime} from '../src/components/ShopPrime';
import {auth} from '../src/firebase';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/customer-layout.css';
import '../src/components/operations.css';
const mode=new URLSearchParams(location.search).get('mode');
// Only this test preview supplies test authentication; production never imports it.
await auth.authStateReady();
if(mode)Object.defineProperty(auth,'currentUser',{value:{uid:'test-shop',getIdToken:async()=>'test-shop-token'},configurable:true});
createRoot(document.getElementById('root')!).render(mode?<main className="operations" style={{padding:16}}>{mode==='inventory'?<ShopInventory/>:<ShopPrime/>}</main>:<main className="repaido-customer-shell"><SparePartsShop/></main>);
