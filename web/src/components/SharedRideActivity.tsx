import {useId} from 'react';
import {Check,ChevronDown,Clock3} from '../icons';
import {sharedRideActivity} from '../services/sharedRideActivity.mjs';
const when=(at:number)=>new Date(at*1000).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
export function SharedRideActivity({row,mine}:{row:any;mine:any}){
 const id=useId(),model=sharedRideActivity(row,mine);
 return <details className="shared-activity"><summary aria-controls={id}><span className="shared-activity-heading"><Clock3 size={16} aria-hidden="true"/>Ride activity<ChevronDown size={16} aria-hidden="true"/></span><ol className="shared-progress" aria-label="Your ride progress">{model.steps.map((step,i)=><li key={step.label} data-done={step.done} aria-current={!model.terminal&&model.current===i?'step':undefined}><span aria-hidden="true">{step.done?<Check size={12}/>:i+1}</span><small>{step.label}</small></li>)}</ol></summary><div id={id} className="shared-activity-body"><p>{model.note}</p>{model.activity.length>0?<ol>{model.activity.map((item,i)=><li key={item.label+i}><span aria-hidden="true"/><div><strong>{item.label}</strong><time dateTime={new Date(item.at*1000).toISOString()}>{when(item.at)}</time></div></li>)}</ol>:<p>Recorded updates will appear here as your ride progresses.</p>}<small>Times shown in India Standard Time.</small></div></details>;
}
