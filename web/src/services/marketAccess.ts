import {auth} from '../firebase';
import {operation} from './operations';
import {createReadCache} from './readCache.mjs';

export type MarketAccess={active:boolean;status:'not_started'|'trial'|'paid'|'expired';trial_started_at:number|null;trial_ends_at:number|null;current_period_ends_at:number|null;amount_paise:number;currency:'INR';trial_days:number;payments_ready:boolean;auto_renew:false;server_now:number;payment_status?:string|null};
const cache=createReadCache({maxEntries:4});let account='';
function scope(){const uid=auth.currentUser?.uid||'';if(uid!==account){account=uid;cache.invalidate();}return uid;}
function valid(data:MarketAccess){return typeof data.active==='boolean'&&['not_started','trial','paid','expired'].includes(data.status)&&data.amount_paise===9900&&data.currency==='INR'&&data.trial_days===90&&Number.isFinite(data.server_now);}
export function invalidateMarketAccess(){cache.invalidate();window.dispatchEvent(new Event('repaido:market-access-updated'));}
export function rememberMarketAccess(data:MarketAccess,uid:string){
 if(scope()!==uid||!uid||!valid(data))return;
 const previous=cache.peek(uid,60000) as MarketAccess|null;
 cache.remember(uid,data);
 if(!previous||previous.status!==data.status||previous.current_period_ends_at!==data.current_period_ends_at||previous.payment_status!==data.payment_status)window.dispatchEvent(new Event('repaido:market-access-updated'));
}
window.addEventListener('repaido:operations-updated',()=>cache.invalidate());
export async function readMarketAccess(force=false):Promise<MarketAccess>{
 await auth.authStateReady();const uid=scope();if(!uid)throw Error('Sign in to manage your marketplace plan.');
 if(force)cache.invalidate(uid);
 return cache.read(uid,async()=>{
  const data=await operation<MarketAccess>('/market/access',{},{background:true,feedback:false,force});
  if(scope()!==uid)throw Error('Your account changed. Reopen your marketplace plan.');
  if(!valid(data))throw Error('Your marketplace access could not be confirmed. Please retry.');
  return data;
 },{freshMs:15000,force}) as Promise<MarketAccess>;
}
