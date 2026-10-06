import {useId, type ReactNode} from 'react';
import {AlertCircle, CheckCircle2, Info} from 'lucide-react';
import './business-ui.css';

/** Shared customer and partner workspace primitives; all colours follow app preferences. */
export function BusinessPageHeader({eyebrow,title,description,icon,actions,children}:{eyebrow:string;title:string;description?:string;icon?:ReactNode;actions?:ReactNode;children?:ReactNode}) {
  return <header className="business-page-header"><div className="business-header-copy"><span className="business-eyebrow">{icon}{eyebrow}</span><h1>{title}</h1>{description&&<p>{description}</p>}</div>{actions&&<div className="business-header-actions">{actions}</div>}{children&&<div className="business-header-detail">{children}</div>}</header>;
}

export function BusinessTabs<T extends string>({label,value,items,onChange,panelId}:{label:string;value:T;items:{id:T;label:string;icon?:ReactNode;count?:number}[];onChange:(id:T)=>void;panelId?:string}) {
  const id=useId();
  return <nav className="business-tabs" role="tablist" aria-label={label} onKeyDown={event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const current=items.findIndex(item=>item.id===value);
    const next=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowRight'?1:-1)+items.length)%items.length;
    const target=event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[next];
    if(target){event.preventDefault();onChange(items[next].id);target.focus();target.scrollIntoView({block:'nearest',inline:'nearest'});}
  }}>{items.map(item=><button type="button" role="tab" key={item.id} id={`${id}-${item.id}`} aria-selected={value===item.id} tabIndex={value===item.id?0:-1} aria-controls={panelId} onClick={()=>onChange(item.id)}>{item.icon}<span>{item.label}</span>{item.count!==undefined&&<small>{item.count}</small>}</button>)}</nav>;
}

export function InlineNotice({tone='info',children,action}:{tone?:'info'|'error'|'success';children:ReactNode;action?:ReactNode}) {
  const Icon=tone==='error'?AlertCircle:tone==='success'?CheckCircle2:Info;
  return <div className={`business-notice business-notice-${tone}`} role={tone==='error'?'alert':'status'}><Icon size={18} aria-hidden="true"/><div>{children}</div>{action&&<div className="business-notice-action">{action}</div>}</div>;
}

export function BusinessEmptyState({icon,title,description,action}:{icon?:ReactNode;title:string;description:string;action?:ReactNode}) {
  return <div className="business-empty">{icon&&<span className="business-empty-icon" aria-hidden="true">{icon}</span>}<h2>{title}</h2><p>{description}</p>{action&&<div className="business-empty-action">{action}</div>}</div>;
}
