import {useEffect,useRef,useState} from 'react';
import {auth} from '../firebase';
import {ArrowRight,ShieldCheck} from '../icons';
import {Modal} from './ui';

/** Verify the booker's existing account. A passenger's contact number is never
 * used as identity proof or allowed to switch the booking account implicitly. */
export function BikePhoneVerification({accountId,onClose,onVerified,onSignIn}:{accountId:string;onClose:()=>void;onVerified:()=>void;onSignIn:()=>void}){
 const [phone,setPhone]=useState(auth.currentUser?.phoneNumber||''),[code,setCode]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[resendAt,setResendAt]=useState(0),[clock,setClock]=useState(Date.now());
 const mounted=useRef(true),request=useRef(0);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current++;void import('../services/repaidoService').then(service=>service.clearPhoneAccountRecovery());};},[]);
 useEffect(()=>{if(!sent)return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[sent]);
 const owns=()=>mounted.current&&auth.currentUser?.uid===accountId;
 const send=async()=>{
  if(busy)return;const attempt=++request.current;setBusy(true);setError('');setConflict(false);
  try{if(!owns())throw Error('Your account changed. Reopen mobile verification.');const service=await import('../services/repaidoService');if(!owns())return;await service.sendPhoneOtp(phone,'bike-phone-recaptcha',true);if(owns()&&attempt===request.current){setSent(true);setCode('');setResendAt(Date.now()+60000);setClock(Date.now());}}
  catch(e){if(owns()&&attempt===request.current)setError((e as Error).message||'Could not send a verification code. Try again.');}finally{if(owns()&&attempt===request.current)setBusy(false);}
 };
 const verify=async()=>{
  if(busy)return;const attempt=++request.current;setBusy(true);setError('');
  try{if(!owns())throw Error('Your account changed. Reopen mobile verification.');const service=await import('../services/repaidoService');if(!owns())return;await service.confirmPhoneOtp(code);if(!owns()||attempt!==request.current)return;await auth.currentUser!.getIdToken(true);if(owns()&&attempt===request.current)onVerified();}
  catch(e){if(owns()&&attempt===request.current){const service=await import('../services/repaidoService');const linked=service.canContinueWithPhoneAccount();if(owns()&&attempt===request.current){setConflict(linked);setError(linked?'This mobile number is linked to another Repaido account. Sign in with that mobile account to check its ride offers.':(e as Error).message||'Could not verify the code. Try again.');}}}finally{if(owns()&&attempt===request.current)setBusy(false);}
 };
 const remaining=Math.max(0,Math.ceil((resendAt-clock)/1000));
 return <Modal title="Verify your mobile" className="bike-phone-modal" onClose={onClose}><form className="bike-phone-verification" onSubmit={event=>{event.preventDefault();void(sent?verify():send());}}><span className="bike-brand-icon" aria-hidden="true"><ShieldCheck size={24}/></span><p>Verify your own mobile number to check launch ride offers. Your current Repaido account stays the same.</p><label>Mobile number<input type="tel" inputMode="tel" autoComplete="tel" required pattern="\+?[0-9]{10,15}" value={phone} disabled={sent||busy} onChange={event=>setPhone(event.target.value)} placeholder="10-digit mobile number"/></label>{sent&&<><label>6-digit code from SMS<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} value={code} disabled={busy||conflict} onChange={event=>setCode(event.target.value.replace(/\D/g,''))} autoFocus/></label><p className="bike-muted" role="status">Code sent to {phone}. Free-ride eligibility is checked after verification.</p></>}{error&&<p className="bike-notice bike-notice-warning" role="alert">{error}</p>}{conflict?<button type="button" className="bike-primary" onClick={()=>{onClose();onSignIn();}}>Open sign-in<ArrowRight size={16} aria-hidden="true"/></button>:<button className="bike-primary" disabled={busy||!navigator.onLine||sent&&code.length!==6} aria-busy={busy}>{busy?(sent?'Verifying…':'Sending code…'):sent?'Verify & check offers':'Send verification code'}<ArrowRight size={16} aria-hidden="true"/></button>}{sent&&<div className="bike-phone-actions"><button type="button" className="bike-soft-button" disabled={busy} onClick={()=>{request.current++;setSent(false);setCode('');setError('');setConflict(false);}}>Change number</button><button type="button" className="bike-soft-button" disabled={busy||remaining>0||!navigator.onLine} onClick={()=>void send()}>{remaining>0?`Resend in ${remaining}s`:'Resend code'}</button></div>}<p className="bike-muted">Verification does not reserve a rider or change an existing paid quote. Review the new quote before requesting a ride.</p><div id="bike-phone-recaptcha"/></form></Modal>;
}
