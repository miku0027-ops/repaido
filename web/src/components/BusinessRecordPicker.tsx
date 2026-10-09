import {ChevronLeft,ChevronRight} from 'lucide-react';
import {useEffect,useState} from 'react';

export function useSelectedBusinessRecord(rows:any[],initialId=''){
 const [selectedId,setSelectedId]=useState(initialId);
 const currentId=rows.find(row=>row.id===selectedId)?.id||rows[0]?.id||'';
 useEffect(()=>{if(currentId&&currentId!==selectedId)setSelectedId(currentId);},[currentId,selectedId]);
 return [currentId,setSelectedId] as const;
}

// A native picker keeps long work queues usable with touch, keyboard and text zoom.
export function BusinessRecordPicker({rows,value,onChange,label,describe}:{rows:any[];value:string;onChange:(id:string)=>void;label:string;describe:(row:any)=>string}){
 if(rows.length<2)return null;
 const index=rows.findIndex(row=>row.id===value);
 return <div className="business-record-picker">
  <label>{label}<select value={value} onChange={e=>onChange(e.target.value)}>{rows.map(row=><option key={row.id} value={row.id}>{describe(row)}</option>)}</select></label>
  <div className="business-record-pagination"><span>{index+1} of {rows.length}</span><button aria-label="Previous booking" disabled={index<=0} onClick={()=>onChange(rows[index-1].id)}><ChevronLeft size={18} aria-hidden="true"/></button><button aria-label="Next booking" disabled={index>=rows.length-1} onClick={()=>onChange(rows[index+1].id)}><ChevronRight size={18} aria-hidden="true"/></button></div>
 </div>;
}
