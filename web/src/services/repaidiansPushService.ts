import {onAuthStateChanged} from 'firebase/auth';
import {app,auth} from '../firebase';
import {apiFetch} from './api';

export interface WorkPushStatus {supported:boolean;permission:NotificationPermission|'unavailable';enabled:boolean;reason?:string;}
type Registration={identity:string;deviceId:string;bearer:string;recipientFingerprint:string;};
let owned:Registration|null=null,activeCommand:Promise<unknown>|null=null,epoch=0;
let retirement:Promise<void>|null=null;
let restored=false,restoring:Promise<void>|null=null;
const META='repaidians.work-push.registration';
const UPDATE='repaidians:work-push';
const identityNow=()=>auth.currentUser?.uid||localStorage.getItem('repaido.token')||'guest';
let observedIdentity=identityNow();
const changed=()=>window.dispatchEvent(new Event(UPDATE));
async function fingerprint(identity:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity)))).map(value=>value.toString(16).padStart(2,'0')).join('');}
function forgetRegistration(){try{sessionStorage.removeItem(META);}catch{/* Push still works when session metadata is unavailable. */}}
async function rememberRegistration(registration:Registration){const account=await fingerprint(registration.identity);if(owned!==registration)return;try{sessionStorage.setItem(META,JSON.stringify({deviceId:registration.deviceId,account,recipientFingerprint:registration.recipientFingerprint}));}catch{/* Never persist bearer credentials or the push token. */}}
async function workerAccount(value:string|null,registration?:ServiceWorkerRegistration){
  if(!('serviceWorker'in navigator))return;
  const target=registration||await navigator.serviceWorker.getRegistration('/repaidians-push/');
  if(!target?.active)return;
  await new Promise<void>((resolve,reject)=>{
    const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(new Error('Could not secure browser notification settings. Retry.'));},5000);
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data?.ok?resolve():reject(new Error('Could not save browser notification settings. Retry.'));};
    target.active!.postMessage({type:'repaidians-work-push-account',fingerprint:value},[channel.port2]);
  });
}
async function verifiedIdentity(){
  const firebaseUser=auth.currentUser,identity=identityNow(),legacy=localStorage.getItem('repaido.token');
  const bearer=firebaseUser?await firebaseUser.getIdToken():legacy;
  if(identityNow()!==identity||(firebaseUser?auth.currentUser?.uid!==firebaseUser.uid:!!auth.currentUser))throw new Error('Your account changed. Reopen browser notifications.');
  return {identity,bearer};
}
export function subscribeWorkPush(listener:()=>void){window.addEventListener(UPDATE,listener);return()=>window.removeEventListener(UPDATE,listener);}
async function unregister(registration:Registration){
  const response=await apiFetch('/api/operations/devices/'+encodeURIComponent(registration.deviceId),{method:'DELETE',headers:{Authorization:'Bearer '+registration.bearer}},{background:true});
  if(!response.ok)throw new Error('Could not remove this browser from your previous account. Retry disabling notifications.');
}
async function removeSubscription(){const messaging=await import('firebase/messaging');if(await messaging.isSupported())await messaging.deleteToken(messaging.getMessaging(app));}
export async function syncWorkPushAccount(){
  const identity=identityNow();if(identity!==observedIdentity){observedIdentity=identity;epoch++;}
  if(retirement)return retirement;
  if(!owned||owned.identity===identityNow())return;
  const previous=owned;owned=null;forgetRegistration();epoch++;changed();
  // The old, verified account owns its registration. Remove it with its captured
  // in-memory bearer; never send the new account's credential for that cleanup.
  const cleanup=(async()=>{await workerAccount(null).catch(()=>{});await unregister(previous).catch(()=>{});await removeSubscription().catch(()=>{});})();retirement=cleanup;
  try{await cleanup;}finally{if(retirement===cleanup)retirement=null;}
}
async function restoreRegistration(){
  if(restored)return;if(restoring)return restoring;
  const task=(async()=>{
    await auth.authStateReady();let saved:{deviceId?:string;account?:string;recipientFingerprint?:string}|null=null;
    try{saved=JSON.parse(sessionStorage.getItem(META)||'null');}catch{forgetRegistration();}
    if(!saved||!saved.deviceId||!saved.account){await workerAccount(null).catch(()=>{});restored=true;return;}
    if(!/^[a-f0-9]{64}$/.test(saved.deviceId)||!/^[a-f0-9]{64}$/.test(saved.account)||!/^[a-f0-9]{64}$/.test(saved.recipientFingerprint||'')){forgetRegistration();await workerAccount(null).catch(()=>{});restored=true;return;}
    const identity=identityNow(),scope=await fingerprint(identity);
    if(identityNow()!==identity)return;
    if(scope!==saved.account||identity==='guest'){
      // Another account cannot revoke the old owner's device record. Retire
      // the browser subscription; FCM invalidation retires that record too.
      forgetRegistration();await workerAccount(null).catch(()=>{});await removeSubscription().catch(()=>{});restored=true;changed();return;
    }
    const verified=await verifiedIdentity();if(!verified.bearer)return;
    owned={identity:verified.identity,deviceId:saved.deviceId,bearer:verified.bearer,recipientFingerprint:saved.recipientFingerprint!};restored=true;
    if(!('Notification'in window)||Notification.permission!=='granted'){const previous=owned;owned=null;forgetRegistration();await workerAccount(null).catch(()=>{});await unregister(previous).catch(()=>{});await removeSubscription().catch(()=>{});}else{await workerAccount(owned.recipientFingerprint);}
    changed();
  })();restoring=task;
  try{await task;}finally{if(restoring===task)restoring=null;}
}
onAuthStateChanged(auth,()=>{void restoreRegistration().then(syncWorkPushAccount).catch(()=>{});});
window.addEventListener('storage',event=>{if(event.key==='repaido.token')void syncWorkPushAccount();});
export async function workPushStatus():Promise<WorkPushStatus>{
  await restoreRegistration();await syncWorkPushAccount();
  if(!window.isSecureContext||!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window))return {supported:false,permission:'unavailable',enabled:false,reason:'This browser does not support secure push notifications. Work updates remain available in Repaidians.'};
  const messaging=await import('firebase/messaging');
  if(!await messaging.isSupported())return {supported:false,permission:'unavailable',enabled:false,reason:'Push is unavailable in this browser. Work updates remain available in Repaidians.'};
  return {supported:true,permission:Notification.permission,enabled:!!owned&&owned.identity===identityNow()&&Notification.permission==='granted'};
}
export async function enableWorkPush():Promise<WorkPushStatus>{
  if(activeCommand)throw new Error('A browser notification change is already in progress.');
  if(!window.isSecureContext||!('Notification'in window)||!('serviceWorker'in navigator))throw new Error('Push notifications need a supported browser on a secure connection.');
  // Call from the explicit button activation, before asynchronous SDK setup.
  const permission=Notification.permission==='granted'?Promise.resolve('granted'):Notification.requestPermission();
  const command=(async()=>{
    if(await permission!=='granted')throw new Error('Notifications are blocked. Allow them in your browser settings, then enable work notifications again.');
    await auth.authStateReady();await restoreRegistration();await syncWorkPushAccount();const {identity,bearer}=await verifiedIdentity(),currentEpoch=epoch;
    if(!bearer)throw new Error('Sign in before enabling work notifications.');
    const messaging=await import('firebase/messaging');if(!await messaging.isSupported())throw new Error('This browser cannot receive push notifications.');
    const registration=await navigator.serviceWorker.register('/repaidians-work-push-sw.js',{scope:'/repaidians-push/'});
    if(!registration.active)await new Promise<void>((resolve,reject)=>{const worker=registration.installing||registration.waiting;if(!worker){reject(new Error('Could not activate browser notifications. Retry.'));return;}const timeout=setTimeout(()=>reject(new Error('Browser notifications took too long to start. Retry.')),15000);const ready=()=>{if(worker.state==='activated'){clearTimeout(timeout);worker.removeEventListener('statechange',ready);resolve();}else if(worker.state==='redundant'){clearTimeout(timeout);worker.removeEventListener('statechange',ready);reject(new Error('Browser notification setup failed. Retry.'));}};worker.addEventListener('statechange',ready);ready();});
    const token=await messaging.getToken(messaging.getMessaging(app),{serviceWorkerRegistration:registration,...(import.meta.env.VITE_FIREBASE_VAPID_KEY?{vapidKey:import.meta.env.VITE_FIREBASE_VAPID_KEY}:{})});
    if(!token)throw new Error('The browser did not provide a push subscription. Retry in a supported browser.');
    if(identityNow()!==identity||epoch!==currentEpoch){await removeSubscription().catch(()=>{});throw new Error('Your account changed. Enable notifications from your current account.');}
    const response=await apiFetch('/api/operations/devices',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+bearer},body:JSON.stringify({token,platform:'web',audience:'customer',promotional_capable:false})},{background:true});
    const body=await response.json().catch(()=>({}));if(!response.ok||!body.id||typeof body.user_id!=='string')throw new Error(typeof body.detail==='string'?body.detail:'Could not register browser notifications. Retry.');
    const next={identity,deviceId:String(body.id),bearer,recipientFingerprint:await fingerprint(body.user_id)};
    if(identityNow()!==identity||epoch!==currentEpoch){await unregister(next).catch(()=>{});await removeSubscription().catch(()=>{});throw new Error('Your account changed. Enable notifications from your current account.');}
    await workerAccount(next.recipientFingerprint,registration);
    if(identityNow()!==identity||epoch!==currentEpoch){await workerAccount(null).catch(()=>{});await unregister(next).catch(()=>{});await removeSubscription().catch(()=>{});throw new Error('Your account changed. Enable notifications from your current account.');}
    owned=next;await rememberRegistration(next);changed();return workPushStatus();
  })();activeCommand=command;
  try{return await command;}catch(error){if(!owned)await removeSubscription().catch(()=>{});throw error;}finally{if(activeCommand===command)activeCommand=null;}
}
export async function disableWorkPush():Promise<WorkPushStatus>{
  if(activeCommand)throw new Error('A browser notification change is already in progress.');
  const command=(async()=>{await auth.authStateReady();await restoreRegistration();await syncWorkPushAccount();const registration=owned;await workerAccount(null);if(registration){await unregister(registration);owned=null;forgetRegistration();epoch++;}await removeSubscription();changed();return workPushStatus();})();activeCommand=command;
  try{return await command;}finally{if(activeCommand===command)activeCommand=null;}
}
