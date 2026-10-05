import {useEffect,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {operation} from './operations';

const personalName=(value?:string|null)=>{
  const name=value?.trim()||'';
  return /^(worker|agent|technician|specialist|customer|user|repaido member|customer \([^)]*\))$/i.test(name)?'':name;
};
// Display-only metadata from the signed-in person's own profile. Never grants a role.
export function useCustomerIdentity(user:{id?:string;name:string}|null,portal:string){
  const [identity,setIdentity]=useState<{uid:string;name:string;agentLabel:string}|null>(null);
  useEffect(()=>{
    if(portal!=='customer')return;
    let generation=0;
    const unsubscribe=onIdTokenChanged(auth,account=>{
      const request=++generation;
      setIdentity(account?{uid:account.uid,name:personalName(account.displayName),agentLabel:''}:null);
      if(!account?.phoneNumber)return;
      void operation<{worker:{name:string;role:string;status:string}|null}>('/worker/me').then(({worker})=>{
        if(request!==generation||auth.currentUser?.uid!==account.uid||!worker)return;
        const agentLabel=worker.status==='approved'?`Repaido ${worker.role==='specialist'?'specialist':'agent'}`:worker.status==='pending'?'Agent application pending':'';
        setIdentity({uid:account.uid,name:personalName(account.displayName)||personalName(worker.name),agentLabel});
      }).catch(()=>{/* Optional account badge unavailable; never infer approval from local storage. */});
    });
    return()=>{generation++;unsubscribe();};
  },[portal]);
  const ownsIdentity=!!identity&&identity.uid===auth.currentUser?.uid&&(!user?.id||user.id===identity.uid);
  const name=(ownsIdentity?identity.name:'')||personalName(user?.name);
  return {name,accountLabel:name||'My account',agentLabel:ownsIdentity?identity.agentLabel:''};
}
