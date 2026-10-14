import {useEffect,useRef,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {operation} from './operations';

export type BookingOffer={campaign_id:string;version:number;discount_paise:number;original_price_paise:number;price_paise:number;terms:string;title:string;ends_at:number};

/** Account-scoped intent. Saving a selection never reserves money or a booking. */
export function useBookingOffer(serviceId:string,city:string,promotionId?:string,onRemove?:()=>void){
 const [uid,setUid]=useState<string>(),[retry,setRetry]=useState(0);
 const intent=useRef({id:promotionId,owner:auth.currentUser?.uid||''});
 if(intent.current.id!==promotionId)intent.current={id:promotionId,owner:auth.currentUser?.uid||''};
 // Guest intent can follow the first sign-in, but never another signed-in account.
 if(promotionId&&uid&&!intent.current.owner)intent.current.owner=uid;
 const requestedPromotion=promotionId&&(!intent.current.owner||intent.current.owner===uid)?promotionId:undefined;
 const key=JSON.stringify([uid,serviceId,city,requestedPromotion]);
 const current=useRef(key);current.current=key;
 const [state,setState]=useState<{key:string;offer:BookingOffer|null;error:string;pending:boolean}>({key:'',offer:null,error:'',pending:false});
 useEffect(()=>onIdTokenChanged(auth,u=>setUid(u?.uid||'')),[]);
 useEffect(()=>{
  let alive=true;
  if(uid===undefined||!serviceId)return;
  if(!uid){setState({key,offer:null,error:requestedPromotion?'Sign in to use this offer.':'',pending:false});return;}
  setState({key,offer:null,error:'',pending:true});
  const load=requestedPromotion
   ?operation<BookingOffer>('/campaigns/select',{method:'POST',body:JSON.stringify({campaign_id:requestedPromotion,service_id:serviceId,city})},{background:true,feedback:false})
   :operation<{offer:BookingOffer|null}>('/campaigns/selection?'+new URLSearchParams({service_id:serviceId,city}),{}, {background:true,feedback:false,force:true}).then(r=>r.offer);
  void load.then(offer=>{if(alive)setState({key,offer,error:'',pending:false});}).catch(e=>{if(alive)setState({key,offer:null,error:e.message||'Your offer could not be checked.',pending:false});});
  return()=>{alive=false;};
 },[key,retry,uid,serviceId,city,requestedPromotion]);
 const offer=state.key===key?state.offer:null;
 useEffect(()=>{
  if(!offer)return;
  const timer=setTimeout(()=>setRetry(n=>n+1),Math.min(2147483647,Math.max(1,offer.ends_at*1000-Date.now())));
  return()=>clearTimeout(timer);
 },[offer]);
 const remove=async()=>{
  setState({key,offer:null,error:'',pending:true});
  try{
   if(uid)await operation('/campaigns/selection',{method:'DELETE',body:JSON.stringify({service_id:serviceId,city})},{background:true,feedback:false});
   if(current.current!==key)return;
   setState({key,offer:null,error:'',pending:false});onRemove?.();
  }catch(e){if(current.current===key)setState({key,offer:null,error:(e as Error).message,pending:false});}
 };
 return {offer,requestedPromotion,error:state.key===key?state.error:'',pending:uid===undefined||!!serviceId&&(state.key!==key||state.pending),retry:()=>setRetry(n=>n+1),remove};
}
