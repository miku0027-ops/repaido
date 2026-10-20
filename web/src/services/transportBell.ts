import {startTransportChime} from './taskBell.mjs';

let context:AudioContext|null=null,account='',enabled=false;
const listeners=new Set<()=>void>(),seen=new Set<string>();
let primed=false;
let stopChime=()=>{};
const requestsSeen=new Set<string>();
const changed=()=>listeners.forEach(listener=>listener());
export function bindTransportBell(uid:string){if(uid===account)return;stopChime();account=uid;enabled=false;seen.clear();requestsSeen.clear();primed=false;void context?.close();context=null;changed();}
export const transportBellEnabled=()=>enabled&&context?.state==='running';
export function subscribeTransportBell(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export async function enableTransportBell(uid:string){bindTransportBell(uid);if(!context)context=new AudioContext();const active=context;await active.resume();if(account!==uid||context!==active)throw Error('Your account changed. Enable the bell for your current account.');if(active.state!=='running')throw Error('Sound could not start. Allow sound for this site and try again.');enabled=true;changed();}
export function disableTransportBell(){stopChime();enabled=false;void context?.suspend();changed();}
function chime(){if(!transportBellEnabled()||typeof document!=='undefined'&&document.hidden)return;stopChime();stopChime=startTransportChime(context);}
export function receiveTransportRequests(ids:string[],uid:string){
 bindTransportBell(uid);const fresh=ids.some(id=>!requestsSeen.has(id));ids.forEach(id=>requestsSeen.add(id));
 if(requestsSeen.size>500){requestsSeen.clear();ids.forEach(id=>requestsSeen.add(id));}
 if(fresh)chime();
}
export function receiveTransportNotes(notes:any[],uid:string){
 bindTransportBell(uid);const updates=notes.filter(n=>n.kind==='local_business'&&['departure_reminder','rescheduled','destination_arrival'].includes(n.event_type));
 const newNotes=updates.filter(n=>!seen.has(n.id)&&!n.read_at&&!n.read&&Date.now()/1000-n.created_at>=0&&Date.now()/1000-n.created_at<(n.event_type==='destination_arrival'?75:900));
 updates.forEach(n=>seen.add(n.id));if(seen.size>500){const latest=updates.map(n=>n.id);seen.clear();latest.forEach(id=>seen.add(id));}
 if(primed&&newNotes.length)chime();primed=true;
}

/** An acknowledged pickup alarm; lifecycle owner must always call the cleanup. */
export function startPickupAlarm(uid:string){
 let stop=()=>{};
 const ring=()=>{if(account===uid&&transportBellEnabled()){stop();stop=startTransportChime(context);}};
 ring();const timer=setInterval(ring,2200);
 return()=>{clearInterval(timer);stop();};
}
