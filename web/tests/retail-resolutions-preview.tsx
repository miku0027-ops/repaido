import {createRoot} from 'react-dom/client';
import {RetailOrderResolution, RetailShopResolutions, RetailResolutionAdmin} from '../src/components/RetailResolutions';
import {CustomerCartDrawer} from '../src/components/CustomerCartDrawer';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/customer-layout.css';
const mode = new URLSearchParams(location.search).get('mode') || 'customer';
const items = [{product_id: 'product-one', name: 'Refurbished mixer grinder', quantity: 2}];
createRoot(document.getElementById('root')!).render(<div className="repaido-customer-shell"><main>{mode === 'admin' ? <RetailResolutionAdmin/> : mode === 'shop' ? <RetailShopResolutions/> : mode === 'cart' ? <CustomerCartDrawer isOpen initialOrderId="order-one" onClose={()=>{}}/> : <RetailOrderResolution orderId="order-one" items={items}/>}</main></div>);
