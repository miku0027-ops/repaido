// Isolated routing fixture: the browser test supplies all HTTP responses.
// This entry point is never imported by the production app.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import {CustomerNotificationDrawer} from '../src/components/CustomerNotificationDrawer';
import '../src/styles.css';
import '../src/design-system.css';
await auth.authStateReady();
const listeners=new Set<(user:any)=>void>(),events:string[]=[];
function session(uid:string){
  (auth as any).currentUser={uid,displayName:'Notification fixture',getIdToken:async()=>uid};
  localStorage.setItem('repaido.token',uid);
  for(const listener of listeners)listener(auth.currentUser);
}
(auth as any).onIdTokenChanged=(next:any)=>{const listener=typeof next==='function'?next:next.next;listeners.add(listener);queueMicrotask(()=>listener(auth.currentUser));return()=>listeners.delete(listener);};
session('bike-notification-account-one');
(window as any).bikeNotificationFixture={events,switchAccount:()=>session('bike-notification-account-two')};
function Preview(){
  const [open,setOpen]=useState(true);
  return <main><h1>Bike notification routing checks</h1><output aria-label="Notification fixture events">{events.join('|')}</output><CustomerNotificationDrawer isOpen={open} onClose={()=>{events.push('close');setOpen(false);}} onOpenBikeRide={id=>events.push('bike:'+id)} onOpenSharedRide={id=>events.push('shared:'+id)}/></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
