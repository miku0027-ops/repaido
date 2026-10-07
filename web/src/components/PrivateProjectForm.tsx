import {useRef,useState,type FormEvent} from 'react';
import {House,ArrowRight} from 'lucide-react';
import {operation} from '../services/operations';
import {Modal} from './ui';
import {InlineNotice} from './BusinessUI';

/** Customer work stays a private project; commercial tender access is unchanged. */
export function PrivateProjectForm({onClose,onCreated}:{onClose:()=>void;onCreated:(id:string)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef({body:'',key:crypto.randomUUID()}),gate=useRef(false);
 const submit=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(gate.current)return;
  const data=new FormData(event.currentTarget),starts=new Date(String(data.get('starts_at'))).getTime()/1000,ends=new Date(String(data.get('ends_at'))).getTime()/1000;
  if(!Number.isFinite(starts)||!Number.isFinite(ends)||ends<=starts){setError('Choose an end time after the start time.');return;}
  const body={title:String(data.get('title')).trim(),scope:String(data.get('scope')).trim(),site:String(data.get('site')).trim(),starts_at:starts,ends_at:ends,budget_paise:Math.round(Number(data.get('budget'))*100),tender_id:null};
  const encoded=JSON.stringify(body);if(request.current.body!==encoded)request.current={body:encoded,key:crypto.randomUUID()};
  gate.current=true;setBusy(true);setError('');
  try{const project=await operation<{id:string}>('/contractor/projects/private',{method:'POST',body:JSON.stringify({...body,request_id:request.current.key})},{background:true});onCreated(project.id);}
  catch(error){setError((error as Error).message);}finally{gate.current=false;setBusy(false);}
 };
 return <Modal title="Post a private work request" className="contract-dialog private-work-dialog" onClose={()=>{if(!busy)onClose();}}><form className="contract-form" onSubmit={event=>void submit(event)}>
  <p className="private-work-intro"><House size={18}/>For your home or personal project. Your exact site and budget stay in your authorized workspace.</p>
  <div className="contract-form-grid"><label className="contract-field-wide">What do you need done?<input name="title" required minLength={3} maxLength={150} placeholder="For example, repair and repaint two rooms"/></label><label className="contract-field-wide">Work and expected outcome<textarea name="scope" required minLength={10} maxLength={4000} rows={3} placeholder="Describe the work, skills needed and what completion means."/></label><label className="contract-field-wide">Private site address<input name="site" required minLength={5} maxLength={300}/><small>Publish only a neighbourhood when you create your hiring notice.</small></label><label>Work starts<input name="starts_at" type="datetime-local" required/></label><label>Work ends<input name="ends_at" type="datetime-local" required/></label><label>Planned total budget (₹)<input name="budget" type="number" min={0} max={500000000} step="0.01" required/></label></div>
  <label className="contract-consent"><input type="checkbox" required/>I am authorized to request this work and will confirm the role, pay and dates before offering it.</label>
  {error&&<InlineNotice tone="error">{error}</InlineNotice>}
  <p className="contract-fineprint">Next: publish skills and joining terms, review applications, then send an offer. Workers join after accepting.</p>
  <button className="contract-primary" disabled={busy} aria-busy={busy}>{busy?'Creating request…':'Create request & plan hiring'}<ArrowRight size={16}/></button>
 </form></Modal>;
}
