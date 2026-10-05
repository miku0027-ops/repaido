import {auth} from '../firebase';
import {operation} from './operations';
type Bridge={postMessage:(value:string)=>void;onmessage?:((event:{data:string})=>void)};
declare global {interface Window {RepaidoNative?:Bridge}}
const pending=new Map<string,{resolve:(v:string)=>void;reject:(e:Error)=>void}>();
export const nativeAvailable=()=>!!window.RepaidoNative;
export function nativeCall(action:string,payload:Record<string,unknown>={}):Promise<string>{
  const bridge=window.RepaidoNative;
  if(!bridge)return Promise.reject(new Error('Background tracking requires the updated Repaido Agent Android app.'));
  bridge.onmessage=event=>{try{const r=JSON.parse(event.data);const p=pending.get(r.id);if(!p)return;pending.delete(r.id);if(r.error)p.reject(new Error(r.error));else p.resolve(r.result);}catch{/* Ignore malformed native replies. */}};
  return new Promise((resolve,reject)=>{const id=crypto.randomUUID();pending.set(id,{resolve,reject});bridge.postMessage(JSON.stringify({id,action,...payload}));setTimeout(()=>{if(pending.delete(id))reject(new Error('Device did not respond. Reopen the app and retry.'));},['captureEvidence','saveReport'].includes(action)?600000:30000);});
}
export async function enableNativePush(audience:'customer'|'agent'=location.pathname.startsWith('/worker')?'agent':'customer'){
  const kind=await nativeCall('appKind').catch(()=>audience==='agent'?'agent':'unknown');
  const token=await nativeCall('pushToken');
  const r=await operation<{id:string}>('/devices',{method:'POST',body:JSON.stringify({token,platform:'android',audience:kind==='customer'?'customer':audience,promotional_capable:kind==='customer'})});
  localStorage.setItem('repaido.push-device',JSON.stringify({id:r.id,uid:auth.currentUser?.uid}));
}
export async function stopNativeSession(){
  if(nativeAvailable())await nativeCall('stopTracking');
  const saved=JSON.parse(localStorage.getItem('repaido.push-device')||'null');
  if(saved&&saved.uid===auth.currentUser?.uid)await operation(`/devices/${saved.id}`,{method:'DELETE'});
  localStorage.removeItem('repaido.push-device');
}
