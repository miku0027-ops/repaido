import {apiFetch} from './api';
import {operation} from './operations';
export const business=<T=any,>(path:string,body?:object,method='POST',options:{feedback?:boolean;force?:boolean}={})=>operation<T>('/local-business'+path,body?{method,body:JSON.stringify(body)}:{}, {background:true,...options});
export async function businessPublic<T=any>(path:string,body?:object):Promise<T>{const r=await apiFetch('/api/operations/local-business'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await r.json();if(!r.ok)throw Error(data.detail?.message||'Could not load local services.');return data;}
export async function businessDocument(file:File,feedback=true){if(!['image/jpeg','image/png'].includes(file.type)||file.size>5*1024*1024)throw Error('Choose a JPEG or PNG photo under 5 MB.');return operation<{id:string}>('/local-business/documents',{method:'POST',headers:{'Content-Type':file.type},body:file},{feedback,background:!feedback});}
export async function businessPrivatePhoto(path:string){
 if(!path.startsWith('/')||path.startsWith('//')||/[?#]/.test(path))throw Error('Expected a private business photo path.');
 const {auth}=await import('../firebase');await auth.authStateReady();
 const scope=()=>auth.currentUser?.uid||localStorage.getItem('repaido.token')||'',owner=scope();
 const token=auth.currentUser?await auth.currentUser.getIdToken():localStorage.getItem('repaido.token');
 if(!token)throw Error('Sign in to view this private photo.');if(scope()!==owner)throw Error('Your account changed. Reopen this photo.');
 const r=await apiFetch('/api/operations/local-business'+path,{headers:{Authorization:'Bearer '+token}},{background:true});if(!r.ok)throw Error('Private evidence could not load.');
 const blob=await r.blob();if(scope()!==owner)throw Error('Your account changed. Reopen this photo.');return URL.createObjectURL(blob);
}
export function businessAmount(value:FormDataEntryValue|null){const raw=String(value||'0');if(!/^\d+(\.\d{1,2})?$/.test(raw))throw Error('Enter a non-negative amount with up to two decimal places.');const [rupees,paise='']=raw.split('.');const result=Number(rupees)*100+Number(paise.padEnd(2,'0'));if(!Number.isSafeInteger(result))throw Error('Amount is too large.');return result;}
export type BusinessLocation={lat:number;lng:number;address:string;city:string};

// A lost response is checked against the server command receipt before the
// caller sees success. An unavailable check preserves the original error/key.
export async function submitWeighingQuote(id:string,body:{command_id:string;[key:string]:unknown}){
 const {withActionFeedback}=await import('./actionFeedback');
 return withActionFeedback('/local-business/scrap/'+id+'/evaluation',{method:'POST',body:JSON.stringify(body)},async()=>{
  try{return await business('/scrap/'+id+'/evaluation',body,'POST',{feedback:false});}
  catch(error){
   if((error as {status?:number}).status&&(error as {status:number}).status<500)throw error;
   try{const saved=await business('/scrap/'+id,undefined,'GET',{feedback:false,force:true});if(saved.evaluation_command_id===body.command_id)return saved;}catch{/* Uncertainty must not become success. */}
   throw error;
  }
 });
}

export async function submitScrapRequest(body:{photo_document_id:string;[key:string]:unknown}){
 const {withActionFeedback}=await import('./actionFeedback');
 return withActionFeedback('/local-business/scrap',{method:'POST',body:JSON.stringify(body)},async()=>{
  try{return await business('/scrap',body,'POST',{feedback:false});}
  catch(error){
   if((error as {status?:number}).status&&(error as {status:number}).status<500)throw error;
   try{
    const saved=await business<{collections:any[]}>('/scrap',undefined,'GET',{feedback:false,force:true});
    const row=saved.collections.find(item=>item.photo_document_id===body.photo_document_id&&['material','description','estimated_kg','address','city','starts_at','phone'].every(key=>item[key]===body[key]));
    if(row)return row;
   }catch{/* A failed lookup leaves the request unconfirmed. */}
   throw error;
  }
 });
}
