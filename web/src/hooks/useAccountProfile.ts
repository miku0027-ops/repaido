import {useCallback,useEffect,useRef,useState} from 'react';
import {type AccountProfile,readAccountProfile,saveAccountEmail,requestEmailVerification,confirmEmailVerification} from '../services/accountProfileService';

export function useAccountProfile(uid?:string) {
  const [state,setState]=useState<{uid?:string;profile:AccountProfile|null;loading:boolean;error:string}>({profile:null,loading:false,error:''});
  const current=useRef(uid);current.current=uid;
  const generation=useRef(0);
  const run=useCallback(async(action:()=>Promise<AccountProfile>)=>{
    if(!uid)throw Error('Sign in to complete your account profile.');
    const revision=++generation.current;
    setState(previous=>({uid,profile:previous.uid===uid?previous.profile:null,loading:true,error:''}));
    try{
      const profile=await action();
      if(current.current!==uid||generation.current!==revision)throw Error('Your account changed. Reopen your profile.');
      setState({uid,profile,loading:false,error:''});return profile;
    }catch(error){
      if(current.current===uid&&generation.current===revision)setState(previous=>({...previous,loading:false,error:error instanceof Error?error.message:'Account details could not load. Please retry.'}));
      throw error;
    }
  },[uid]);
  const refresh=useCallback(()=>run(()=>readAccountProfile(uid!)),[uid,run]);
  useEffect(()=>{
    generation.current++;setState({uid,profile:null,loading:!!uid,error:''});
    if(!uid)return;
    void refresh().catch(()=>{});
    const changed=()=>void refresh().catch(()=>{});
    window.addEventListener('repaido:account-profile-updated',changed);
    return()=>{generation.current++;window.removeEventListener('repaido:account-profile-updated',changed);};
  },[uid,refresh]);
  // No snapshot from another identity is exposed, even during the first render.
  const profile=state.uid===uid?state.profile:null;
  return {profile,loading:state.uid===uid?state.loading:!!uid,error:state.uid===uid?state.error:'',refresh,
    saveEmail:(email:string)=>run(()=>saveAccountEmail(uid!,email,profile?.version??0)),
    requestVerification:()=>run(()=>requestEmailVerification(uid!,profile?.version??0)),
    confirmVerification:(challenge:string,token:string)=>run(()=>confirmEmailVerification(uid!,challenge,token))};
}
