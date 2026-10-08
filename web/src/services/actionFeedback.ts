import {actionMessages} from './actionMessages.mjs';
export type FeedbackTone='pending'|'success'|'error'|'info';
export type Feedback={id:number;key:string;title:string;message:string;tone:FeedbackTone;at:number};
let sequence=0;
let snapshot:Feedback[]=[];
const listeners=new Set<()=>void>();
const publish=()=>listeners.forEach(fn=>fn());
export const actionFeedback={subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},getSnapshot:()=>snapshot};
export function dismissFeedback(id:number){snapshot=snapshot.filter(item=>item.id!==id);publish();}
export function clearFeedback(key?:string){snapshot=key?snapshot.filter(item=>item.key!==key):[];publish();}
export function notifyFeedback(value:Pick<Feedback,'title'|'message'|'tone'>,key='notice'){
 const id=++sequence;snapshot=[...snapshot.filter(item=>item.key!==key&&(value.tone==='pending'||item.message!==value.message||item.tone!==value.tone)),{...value,id,key,at:Date.now()}].slice(-3);publish();return id;
}
export async function withActionFeedback<T>(path:string,init:RequestInit,task:()=>Promise<T>):Promise<T>{
 const messages=actionMessages(path,init);
 if(!messages)return task();
 const key=path.split('?')[0],id=notifyFeedback({title:messages.pending,message:'Please wait for confirmation before submitting again.',tone:'pending'},key);
 const finish=(value:Pick<Feedback,'title'|'message'|'tone'>)=>{snapshot=snapshot.map(item=>item.id===id?{...item,...value,at:Date.now()}:item);publish();};
 try{const result=await task();finish(messages.result(result as any) as Pick<Feedback,'title'|'message'|'tone'>);return result;}
 catch(error){const e=error as Error;finish({tone:'error',title:e.name==='TimeoutError'||e.name==='AbortError'||e instanceof TypeError?'Confirmation unavailable':'Action needs attention',message:e.name==='TimeoutError'||e.name==='AbortError'||e instanceof TypeError?'We could not confirm completion. Check your saved records before retrying.':e.message||'This action was not confirmed. Please try again.'});throw error;}
}
