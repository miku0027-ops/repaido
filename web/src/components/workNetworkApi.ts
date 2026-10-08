import {notifyFeedback} from '../services/actionFeedback';
import {useCallback,useEffect,useRef,useState} from 'react';
import {operation} from '../services/operations';
export type NetworkRow=Record<string,any>;
export const network=(path:string,body?:object,method=body?'POST':'GET')=>operation<NetworkRow>('/network'+path,{method,...(body?{body:JSON.stringify(body)}:{})},{background:true});
export const contractCall=(path:string,body?:object,method=body?'POST':'GET')=>operation<NetworkRow>('/contractor'+path,{method,...(body?{body:JSON.stringify(body)}:{})},{background:true});
export const networkMoney=(v:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(v/100);
export const networkDate=(v:number|string)=>new Date(typeof v==='number'?v*1000:v).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
export function useNetworkRead(path:string,interval=0,contract=false){
 const [data,setData]=useState<NetworkRow|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);const generation=useRef(0);
 const refresh=useCallback(async()=>{const current=++generation.current;setBusy(true);try{const next=await (contract?contractCall(path):network(path));if(current===generation.current){setData(next);setError('');}}catch(e){if(current===generation.current)setError((e as Error).message);}finally{if(current===generation.current)setBusy(false);}},[path,contract]);
 useEffect(()=>{setData(null);void refresh();const timer=interval?setInterval(()=>{if(!document.hidden)void refresh();},interval):undefined;return()=>{generation.current++;clearInterval(timer);};},[refresh,interval]);
 return {data,error,busy,refresh,setData};
}
export function useNetworkAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');const gate=useRef(false);const run=async(action:()=>Promise<unknown>)=>{if(gate.current)return;gate.current=true;setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);notifyFeedback({tone:'error',title:'Action needs attention',message:(e as Error).message},'network-action');}finally{gate.current=false;setBusy(false);}};return {busy,error,run};}
export function useRequestKey(){const key=useRef({payload:'',id:''});const get=(payload:object)=>{const encoded=JSON.stringify(payload);if(key.current.payload!==encoded)key.current={payload:encoded,id:crypto.randomUUID()};return key.current.id;};get.clear=()=>{key.current={payload:'',id:''};};return get;}
