import {useEffect,useRef,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {auth} from '../firebase';

// Presentation contact fields are never an account boundary. Once Firebase has
// authenticated this view, a sign-out cannot fall back to a stale local token.
export function useB2BIdentity(onChange:()=>void){
 const sawFirebase=useRef(!!auth.currentUser),changed=useRef(onChange);
 changed.current=onChange;
 const currentActor=()=>auth.currentUser?.uid||(!sawFirebase.current?localStorage.getItem('repaido.token')||'':'');
 const [actor,setActor]=useState(currentActor),observed=useRef(actor);
 useEffect(()=>{
  const sync=()=>{const next=currentActor();if(next===observed.current)return;observed.current=next;changed.current();setActor(next);};
  const off=onIdTokenChanged(auth,user=>{if(user)sawFirebase.current=true;sync();});
  const storage=(event:StorageEvent)=>{if(event.key==='repaido.token'||event.key===null)sync();};
  window.addEventListener('storage',storage);window.addEventListener('repaido:identity-changed',sync);
  return()=>{off();window.removeEventListener('storage',storage);window.removeEventListener('repaido:identity-changed',sync);};
 },[]);
 return {actor,currentActor};
}
