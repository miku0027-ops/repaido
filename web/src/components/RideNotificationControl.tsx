import {useEffect,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {Bell,Check} from '../icons';
import {enableNativePush,nativeAvailable} from '../services/native';

export function RideNotificationControl({onSignIn}:{onSignIn?:()=>void}){
 return nativeAvailable()?<NativeRideNotificationControl onSignIn={onSignIn}/>:null;
}
function NativeRideNotificationControl({onSignIn}:{onSignIn?:()=>void}){
 const [uid,setUid]=useState(auth.currentUser?.uid||''),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>onIdTokenChanged(auth,user=>{setUid(user?.uid||'');setMessage('');}),[]);
 useEffect(()=>{const sync=()=>{try{setEnabled(!!uid&&JSON.parse(localStorage.getItem('repaido.push-device')||'null')?.uid===uid);}catch{setEnabled(false);}};sync();window.addEventListener('repaido:push-changed',sync);return()=>window.removeEventListener('repaido:push-changed',sync);},[uid]);
 return <div className="ride-notification-control"><button type="button" disabled={busy} onClick={()=>{
  if(!uid){onSignIn?.();setMessage('Sign in to receive ride alerts.');return;}
  setBusy(true);setMessage('');void enableNativePush().then(()=>setMessage('Ride notifications connected. Android controls sound and vibration.')).catch(error=>setMessage((error as Error).message)).finally(()=>setBusy(false));
 }}>{enabled?<Check size={18} aria-hidden="true"/>:<Bell size={18} aria-hidden="true"/>}{busy?'Connecting alerts…':enabled?'Check ride notifications':'Enable ride notifications'}</button>{message&&<p role="status">{message}</p>}</div>;
}
