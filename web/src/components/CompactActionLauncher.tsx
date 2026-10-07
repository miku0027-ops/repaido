import {useEffect,useId,useRef,useState} from 'react';
import {BriefcaseBusiness,FilePlus2,Plus,UsersRound} from 'lucide-react';
import './compact-action-launcher.css';

export function CompactActionLauncher({onCommunity,onCustomContract,onQuickHire}:{onCommunity:()=>void;onCustomContract:()=>void;onQuickHire:()=>void}){
  const [open,setOpen]=useState(false),id=useId(),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),actions=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    actions.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target))setOpen(false);};
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  const close=()=>{setOpen(false);trigger.current?.focus();};
  const choose=(action:()=>void)=>{close();action();};
  return <div ref={root} className="compact-action-launcher" onBlur={event=>{if(event.relatedTarget instanceof Node&&!event.currentTarget.contains(event.relatedTarget))setOpen(false);}} onKeyDown={event=>{
    if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close();return;}
    if(!open||!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    const buttons=Array.from(actions.current?.querySelectorAll<HTMLButtonElement>('button')||[]),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
  }}>
    {open&&<div ref={actions} id={id} className="compact-action-list" role="group" aria-label="Quick actions">
      <button type="button" onClick={()=>choose(onCommunity)}><span className="compact-action-symbol"><UsersRound size={20} aria-hidden="true"/></span><span>Repaidians</span></button>
      <button type="button" onClick={()=>choose(onCustomContract)}><span className="compact-action-symbol"><FilePlus2 size={20} aria-hidden="true"/></span><span>Custom contract query</span></button>
      <button type="button" onClick={()=>choose(onQuickHire)}><span className="compact-action-symbol"><BriefcaseBusiness size={20} aria-hidden="true"/></span><span>Quick Hire</span></button>
    </div>}
    <button ref={trigger} type="button" className="compact-action-trigger" aria-label={open?'Close quick actions':'Open quick actions'} aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(value=>!value)}><Plus size={24} strokeWidth={1.9} aria-hidden="true"/></button>
  </div>;
}
