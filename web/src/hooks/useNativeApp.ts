import {useEffect,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {enableNativePush,nativeAvailable,nativeCall} from '../services/native';

export type NativeAppKind='web'|'customer'|'agent'|'go_customer'|'go_driver';
/** Native identity comes from the origin-bound Android bridge, never a URL flag. */
export function useNativeApp(){
 const [kind,setKind]=useState<NativeAppKind>('web');
 useEffect(()=>{
  if(!nativeAvailable())return;
  let live=true,busy=false,account='';
  void nativeCall('appKind').then(value=>{if(live&&['customer','agent','go_customer','go_driver'].includes(value)){setKind(value as NativeAppKind);document.documentElement.dataset.nativeApp=value;}}).catch(()=>{});
  const saved=()=>{try{return JSON.parse(localStorage.getItem('repaido.push-device')||'null');}catch{return null;}};
  const sync=async()=>{
   if(!live||busy||document.hidden)return;
   const uid=auth.currentUser?.uid||'';
   if(!uid||saved()?.uid!==uid)return;
   busy=true;try{if(await nativeCall('pushStatus')==='enabled')await enableNativePush();}catch{/* Permission errors remain available from the explicit notification control. */}finally{busy=false;}
  };
  const unsubscribe=onIdTokenChanged(auth,user=>{
   const uid=user?.uid||'';
   if(uid!==account){account=uid;void nativeCall('bindPushAccount',{uid:saved()?.uid===uid?uid:''}).catch(()=>{});}
   if(uid)void sync();else void nativeCall('bindPushAccount',{uid:''}).catch(()=>{});
  });
  const resume=()=>{if(!document.hidden)void nativeCall('clearRideAlerts').catch(()=>{});void sync();};
  window.addEventListener('repaido:native-resume',resume);document.addEventListener('visibilitychange',resume);
  return()=>{live=false;unsubscribe();window.removeEventListener('repaido:native-resume',resume);document.removeEventListener('visibilitychange',resume);delete document.documentElement.dataset.nativeApp;};
 },[]);
 return kind;
}
