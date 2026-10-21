import {createContext,useContext,useEffect,useId,useRef,useState,type ReactNode,type RefObject} from 'react';
import {ArrowLeft,ArrowRight,Car,ChevronDown,ChevronUp,Headphones,ShieldCheck,TwoWheeler} from '../icons';
import {Modal} from './ui';
import './ride-workspace.css';
import './go-ride-design.css';
import {MotionPage} from './MotionPage';

export type RideKind='bike'|'cab';
export const CustomerRideContext=createContext<((kind:RideKind,id:string)=>void)|null>(null);
export const useCustomerRideWorkspace=()=>useContext(CustomerRideContext);
// Keep minimization across a workspace remount in this page session. Reloading
// still restores the active trip; no addresses, people or GPS enter storage.
const minimizedRides=new Set<string>();
export function useRideMinimized(key:string){
 const [,refresh]=useState(0);
 return [minimizedRides.has(key),(value:boolean)=>{if(value){if(minimizedRides.size>=100)minimizedRides.clear();minimizedRides.add(key);}else minimizedRides.delete(key);refresh(prior=>prior+1);}] as const;
}
const RideSheetContext=createContext<{expanded:boolean;setExpanded:(value:boolean)=>void;id:string;shell:RefObject<HTMLDivElement|null>}|null>(null);
export function RideSheetHandle(){
 const sheet=useContext(RideSheetContext),start=useRef<{id:number;y:number}|null>(null),dragged=useRef(false);
 if(!sheet)return null;
 const Icon=sheet.expanded?ChevronDown:ChevronUp;
 const reset=()=>{start.current=null;sheet.shell.current?.style.removeProperty('--ride-sheet-drag');sheet.shell.current?.removeAttribute('data-sheet-dragging');};
 return <button type="button" className="ride-sheet-handle" aria-label={sheet.expanded?'Show more map':'Expand ride details'} aria-expanded={sheet.expanded} aria-controls={sheet.id}
  onClick={event=>{if(event.detail===0||!dragged.current)sheet.setExpanded(!sheet.expanded);dragged.current=false;}}
  onPointerDown={event=>{if(event.button!==0||start.current!==null)return;start.current={id:event.pointerId,y:event.clientY};dragged.current=false;event.currentTarget.setPointerCapture(event.pointerId);}}
  onPointerMove={event=>{if(start.current===null||start.current.id!==event.pointerId)return;const distance=event.clientY-start.current.y;const delta=sheet.expanded?Math.max(0,Math.min(200,distance)):Math.min(0,Math.max(-160,distance));if(Math.abs(distance)>4){dragged.current=true;sheet.shell.current?.setAttribute('data-sheet-dragging','true');sheet.shell.current?.style.setProperty('--ride-sheet-drag',delta+'px');}}}
  onPointerCancel={()=>{reset();dragged.current=true;}}
  onPointerUp={event=>{if(start.current?.id!==event.pointerId)return;if(Math.abs(event.clientY-start.current.y)>30)sheet.setExpanded(event.clientY<start.current.y);reset();}}
  onLostPointerCapture={reset}
  onKeyDown={event=>{if(event.key==='Escape')reset();if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();reset();sheet.setExpanded(event.key==='ArrowUp');}}}
 ><span aria-hidden="true"/><Icon size={18} aria-hidden="true"/></button>;
}

/** One native top-layer screen. Pending requests can only end through the
 * server's accept/reject/cancel/expiry path, never an accidental backdrop tap. */
export function RideWorkspace({title,kind,status,locked=false,onMinimize,children,open=true,returnLabel='Minimize ride'}:{title:string;kind:RideKind;status:string;locked?:boolean;onMinimize:()=>void;children:ReactNode;open?:boolean;returnLabel?:string}){
 const [help,setHelp]=useState(false),[checkout,setCheckout]=useState(false),[expanded,setExpanded]=useState(false),id=useId(),shell=useRef<HTMLDivElement>(null),Icon=kind==='bike'?TwoWheeler:Car;
 useEffect(()=>{const update=(event:Event)=>setCheckout((event as CustomEvent<{active:boolean}>).detail.active);window.addEventListener('repaido:ride-checkout',update);return()=>window.removeEventListener('repaido:ride-checkout',update);},[]);
 return <Modal title={title} className="ride-workspace-dialog" frameless suspended={checkout||!open} dismissible={!locked} onClose={onMinimize}>
  <RideSheetContext.Provider value={{expanded,setExpanded,id,shell}}><div ref={shell} className={'ride-workspace-shell'+(expanded?' is-expanded':'')}>
   <header className="ride-workspace-topbar">
    {!locked&&<button type="button" className="ride-workspace-icon" aria-label={returnLabel} onClick={onMinimize}><ArrowLeft size={21} aria-hidden="true"/></button>}
    <span className="ride-workspace-brand"><Icon size={22} aria-hidden="true"/><span><small>REPAIDO</small><h2>{title}</h2></span></span>
    <span className="ride-workspace-status" role="status"><i aria-hidden="true"/>{status}</span>
    <button type="button" className="ride-workspace-icon" aria-label="Ride help and safety" onClick={()=>setHelp(true)}><ShieldCheck size={21} aria-hidden="true"/></button>
   </header>
   <MotionPage id={id} step={status} variant="ride" className="ride-workspace-content">{children}</MotionPage>
  </div></RideSheetContext.Provider>
  {help&&<Modal title="Ride help & safety" onClose={()=>setHelp(false)}><div className="ride-safety-actions"><p>Stop somewhere safe before using ride controls.</p><a href="tel:112"><ShieldCheck size={20} aria-hidden="true"/>Emergency · 112</a><a href="/?section=support" target="_blank" rel="noopener noreferrer"><Headphones size={20} aria-hidden="true"/>Contact Repaido support</a><button type="button" onClick={()=>setHelp(false)}>Back to ride</button></div></Modal>}
 </Modal>;
}

export function ResumeRide({kind,status,onOpen}:{kind:RideKind;status:string;onOpen:()=>void}){
 const Icon=kind==='bike'?TwoWheeler:Car;
 return <button type="button" className="ride-resume-banner" onClick={onOpen}><Icon size={23} aria-hidden="true"/><span><strong>Return to your {kind} ride</strong><small>{status}</small></span><ArrowRight size={22} aria-hidden="true"/></button>;
}
