import {startTaskBell} from './taskBell.mjs';

let context:AudioContext|null=null,account='',enabled=false;
const listeners=new Set<()=>void>(),seen=new Set<string>();
let primed=false;
const changed=()=>listeners.forEach(listener=>listener());
export function bindTransportBell(uid:string){if(uid===account)return;account=uid;enabled=false;seen.clear();primed=false;void context?.close();context=null;changed();}
export const transportBellEnabled=()=>enabled&&context?.state==='running';
export function subscribeTransportBell(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export async function enableTransportBell(uid:string){bindTransportBell(uid);if(!context)context=new AudioContext();const active=context;await active.resume();if(account!==uid||context!==active)throw Error('Your account changed. Enable the bell for your current account.');if(active.state!=='running')throw Error('Sound could not start. Allow sound for this site and try again.');enabled=true;changed();}
export function disableTransportBell(){enabled=false;void context?.suspend();changed();}
export function repeatTransportBell(){return transportBellEnabled()?startTaskBell(context):()=>{};}
export function receiveTransportNotes(notes:any[],uid:string){
 bindTransportBell(uid);const updates=notes.filter(n=>n.kind==='local_business'&&['departure_reminder','rescheduled'].includes(n.event_type));
 const newNotes=updates.filter(n=>!seen.has(n.id)&&!n.read_at&&!n.read&&Date.now()/1000-n.created_at<900);
 updates.forEach(n=>seen.add(n.id));if(seen.size>500){const latest=updates.map(n=>n.id);seen.clear();latest.forEach(id=>seen.add(id));}
 if(primed&&newNotes.length&&transportBellEnabled()){const stop=startTaskBell(context);setTimeout(stop,1100);}primed=true;
}
