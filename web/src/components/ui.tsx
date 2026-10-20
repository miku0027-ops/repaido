import { useEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { X, ArrowUpRight, Search, CheckCircle2, AlertCircle, Info } from '../icons';
import './app-experience.css';
import RepaidoBrand from './RepaidoBrand';
import {acquireModalScrollLock} from '../services/modalScrollLock';

export function Brand({compact=false}:{compact?:boolean}) {
  return <RepaidoBrand size={compact ? 'sm' : 'md'} />;
}
export function CustomerSearchField({label,placeholder,value,onChange}:{label:string;placeholder:string;value:string;onChange:(value:string)=>void}) {
  return <div className="customer-search-field"><Search size={18} aria-hidden="true"/><input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={e=>onChange(e.target.value)}/>{value&&<button type="button" aria-label={`Clear ${label.toLowerCase()}`} onClick={()=>onChange('')}><X size={18} aria-hidden="true"/></button>}</div>;
}
export function Field({label,error,id,className='',...props}:InputHTMLAttributes<HTMLInputElement>&{label:string;error?:string;id:string}) {
  const describedBy = [props['aria-describedby'], error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  return <div className="space-y-2"><label htmlFor={id} className="block text-sm font-medium">{label}</label><input {...props} id={id} aria-invalid={!!error} aria-describedby={describedBy} className={`field ${error?'border-danger':''} ${className}`}/>{error&&<p id={`${id}-error`} className="text-sm text-danger" role="alert">{error}</p>}</div>;
}
export function Modal({title,children,onClose,className='',frameless=false,dismissible=true,suspended=false}:{title:string;children:ReactNode;onClose:()=>void;className?:string;frameless?:boolean;dismissible?:boolean;suspended?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);
  // A text-selection drag can finish on the backdrop. Keep the form open unless
  // the pointer both starts and finishes outside the dialog.
  const backdropPress=useRef(false);
  const outside=(dialog:HTMLDialogElement,x:number,y:number)=>{const r=dialog.getBoundingClientRect();return x<r.left||x>r.right||y<r.top||y>r.bottom;};
  useEffect(()=>{
    if(suspended)return;
    const dialog=ref.current,focus=document.activeElement as HTMLElement|null;
    dialog?.showModal();dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const unlock=acquireModalScrollLock();
    return()=>{
      dialog?.close();unlock();
      const openDialogs=document.querySelectorAll('dialog[open]'),remaining=openDialogs[openDialogs.length-1];
      if(focus?.isConnected&&(!remaining||remaining.contains(focus)))focus.focus();
    };
  },[suspended]);
  useEffect(()=>{
    const dialog=ref.current;
    const containFocus=(event:KeyboardEvent)=>{
      if(event.key!=='Tab'||!dialog||event.defaultPrevented)return;
      const openDialogs=document.querySelectorAll('dialog[open]');
      if(openDialogs[openDialogs.length-1]!==dialog)return;
      const controls=Array.from(dialog.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex],[contenteditable="true"]')).filter(element=>{
        if(element.tabIndex<0||element.matches(':disabled')||element.closest('[hidden],[inert]')||!element.getClientRects().length)return false;
        const style=getComputedStyle(element);
        if(style.visibility==='hidden'||style.visibility==='collapse')return false;
        // Closed details can retain descendant layout boxes in Chromium while
        // their content is absent from native keyboard navigation.
        for(let parent=element.parentElement;parent&&parent!==dialog;parent=parent.parentElement){
          if(parent instanceof HTMLDetailsElement&&!parent.open){
            const summary=parent.querySelector(':scope > summary');
            if(!summary?.contains(element))return false;
          }
        }
        return true;
      });
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    dialog?.addEventListener('keydown',containFocus);
    return()=>dialog?.removeEventListener('keydown',containFocus);
  },[]);
  return <dialog ref={ref} className={`modal w-[calc(100%-32px)] max-w-lg rounded-2xl border bg-white p-6 text-ink md:p-8 ${className}`} aria-label={title} onCancel={e=>{e.preventDefault();e.stopPropagation();if(dismissible)onClose();}} onPointerDown={e=>{backdropPress.current=e.button===0&&e.target===e.currentTarget&&outside(e.currentTarget,e.clientX,e.clientY);}} onPointerCancel={()=>{backdropPress.current=false;}} onClick={e=>{const beganOutside=backdropPress.current;backdropPress.current=false;if(dismissible&&beganOutside&&e.target===e.currentTarget&&outside(e.currentTarget,e.clientX,e.clientY))onClose();}}>{!frameless&&<div className="app-modal-heading mb-6 flex items-start justify-between gap-4"><h2 className="pt-4 text-2xl font-semibold tracking-tight">{title}</h2>{dismissible&&<button type="button" onClick={onClose} className="button-secondary shrink-0" aria-label="Close dialog"><X size={20}/></button>}</div>}{children}</dialog>;
}
export function Empty({title,description,action}:{title:string;description:string;action?:ReactNode}) {return <div className="app-empty-state rounded-2xl border px-6 py-16 text-center"><h2 className="text-xl font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-md text-muted">{description}</p>{action&&<div className="mt-6">{action}</div>}</div>;}
export function ArrowLink(){return <ArrowUpRight size={18} strokeWidth={1.8} aria-hidden="true"/>;}
export function ActionStatus({title,children,tone='success'}:{title:string;children?:ReactNode;tone?:'success'|'info'|'error'}){const Icon=tone==='error'?AlertCircle:tone==='success'?CheckCircle2:Info;return <div className="action-inline-status" data-tone={tone} role={tone==='error'?'alert':'status'}><Icon size={20} aria-hidden="true"/><div><strong>{title}</strong>{children&&<p>{children}</p>}</div></div>;}
