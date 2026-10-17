import {useEffect,useRef,type RefObject} from 'react';
import {Check} from '../icons';

/** Shared keyboard-accessible stage navigation for service and collection tasks. */
export function TaskStageTabs({labels,value,current,completed,status,onChange,prefix='stage',panelId='agent-stage-panel',label='Task stages',buttonRefs}:{labels:readonly string[];value:number;current:number;completed:number;status:string;onChange:(index:number)=>void;prefix?:string;panelId?:string;label?:string;buttonRefs?:RefObject<(HTMLButtonElement|null)[]>}){
 const local=useRef<(HTMLButtonElement|null)[]>([]);
 useEffect(()=>{local.current[value]?.scrollIntoView({block:'nearest',inline:'nearest'});},[value]);
 const select=(index:number,focus=false)=>{const next=Math.max(0,Math.min(labels.length-1,index));onChange(next);if(focus)local.current[next]?.focus();};
 return <div className="agent-stage-tabs" role="tablist" aria-label={label}>{labels.map((name,index)=><button key={name} ref={element=>{local.current[index]=element;if(buttonRefs)buttonRefs.current[index]=element;}} role="tab" id={`${prefix}-${index}`} aria-selected={value===index} aria-controls={panelId} aria-label={`${name}, ${index<completed?'completed':index===current?status:'not reached'}`} data-complete={index<completed} tabIndex={value===index?0:-1} onClick={()=>select(index)} onKeyDown={event=>{if(['ArrowRight','ArrowLeft','Home','End'].includes(event.key)){event.preventDefault();select(event.key==='Home'?0:event.key==='End'?labels.length-1:value+(event.key==='ArrowRight'?1:-1),true);}}}><span className="agent-stage-number" aria-hidden="true">{index<completed?<Check size={14}/>:index+1}</span><span className="agent-stage-name">{name}</span></button>)}</div>;
}
