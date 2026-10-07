import {useEffect,useId,useRef,useState} from 'react';
import {CheckCircle2,ChevronDown,Mail,RefreshCw,ShieldCheck} from 'lucide-react';
import type {useAccountProfile} from '../hooks/useAccountProfile';
import {accountEmailError} from '../services/accountProfileService';
import './email-profile-completion.css';

type Props={account:ReturnType<typeof useAccountProfile>;onSaved?:()=>void;compact?:boolean};
export function EmailProfileCompletion({account,onSaved,compact=false}:Props){
 const id=useId(),profile=account.profile;
 const savedEmail=profile?.email&&!accountEmailError(profile.email)?profile.email:null;
 const [email,setEmail]=useState(savedEmail||''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[now,setNow]=useState(Date.now()/1000);
 const actor=useRef(profile?.id);actor.current=profile?.id;
 useEffect(()=>{setEmail(savedEmail||'');setError('');setMessage('');setBusy(false);},[profile?.id]);
 useEffect(()=>{setEmail(savedEmail||'');},[profile?.email]);
 const remaining=Math.max(0,Math.ceil((profile?.verification.next_request_at||0)-now));
 useEffect(()=>{setNow(Date.now()/1000);const until=profile?.verification.next_request_at||0;if(until<=Date.now()/1000)return;const timer=setInterval(()=>{const stamp=Date.now()/1000;setNow(stamp);if(stamp>=until)clearInterval(timer);},1000);return()=>clearInterval(timer);},[profile?.verification.next_request_at]);
 const run=async(task:()=>Promise<unknown>,success:string,after?:()=>void)=>{const identity=actor.current;setBusy(true);setError('');setMessage('');try{await task();if(actor.current!==identity)return;setMessage(success);after?.();}catch(problem){if(actor.current===identity)setError(problem instanceof Error?problem.message:'Email details could not be saved. Please retry.');}finally{if(actor.current===identity)setBusy(false);}};
 const disabled=busy||account.loading;
 if(!profile)return <section className="email-profile-completion" aria-label="Account email"><div className="email-profile-heading"><Mail size={21} aria-hidden="true"/><h3>Account email</h3></div>{account.loading?<p role="status">Loading your account details…</p>:<><p role="alert" className="email-profile-error">{account.error||'Your account details could not be loaded.'}</p><button type="button" className="email-profile-secondary" onClick={()=>void run(account.refresh,'Account details refreshed.')} disabled={busy}><RefreshCw size={16} aria-hidden="true"/>Retry account details</button></>}</section>;
 const verified=!!savedEmail&&profile.email_verified;
 const status=verified?'Email verified':savedEmail?'Email saved · Not verified':'Email required';
 const fields=<div className="email-profile-fields">
   <p className="email-profile-description">Add a real email address for account updates. It stays private. Saving an address does not verify that it belongs to you.</p>
   <form onSubmit={event=>{event.preventDefault();const invalid=accountEmailError(email);if(invalid){setError(invalid);return;}void run(()=>account.saveEmail(email),'Email saved. Ownership verification is separate.',onSaved);}}>
    <label htmlFor={id+'-email'}>Your email address<input id={id+'-email'} type="email" autoComplete="email" inputMode="email" required maxLength={254} value={email} disabled={disabled} aria-describedby={id+'-help'} onChange={event=>{setEmail(event.target.value);setError('');setMessage('');}} placeholder="you@example.com"/></label>
    <p id={id+'-help'} className="email-profile-help">{verified?'Changing your email requires verification of the new address.':'Use an address you can access.'}</p>
    <button className="email-profile-primary" disabled={disabled||email.trim()===savedEmail}>{busy?'Please wait…':savedEmail?'Update email':'Save email'}<CheckCircle2 size={17} aria-hidden="true"/></button>
   </form>
   {savedEmail&&!verified&&<div className="email-profile-verification"><strong>Verify ownership</strong>{profile.verification.ready?<><p>We’ll email a verification link. Open it while signed in to this same Repaido account.</p><button type="button" className="email-profile-secondary" disabled={disabled||remaining>0} onClick={()=>void run(account.requestVerification,'Verification email requested. Check your inbox and spam folder.')}><Mail size={16} aria-hidden="true"/>{remaining>0?'Resend in '+remaining+'s':profile.verification.challenge_id?'Send another verification email':'Send verification email'}</button>{profile.verification.challenge_id&&<p className="email-profile-help">A verification request is pending. Your email remains unverified until you confirm the link.</p>}</>:<p>Your address is saved. Email verification is not available yet. Please return here later.</p>}</div>}
 </div>;
 return <section className={'email-profile-completion'+(compact?' is-compact':'')} aria-labelledby={id+'-title'} aria-busy={disabled}>
  <div className="email-profile-heading"><span className="email-profile-icon">{verified?<ShieldCheck size={22} aria-hidden="true"/>:<Mail size={22} aria-hidden="true"/>}</span><div><h3 id={id+'-title'}>{profile.email_required?'Complete your account':'Your account email'}</h3><span className={'email-profile-status'+(verified?' is-verified':'')}>{status}</span></div></div>
  {savedEmail&&<p className="email-profile-address">{savedEmail}</p>}
  {compact?<details open={profile.email_required||undefined}><summary><span>{profile.email_required?'Add your email address':'Manage email & verification'}</span><ChevronDown size={17} aria-hidden="true"/></summary>{fields}</details>:fields}
  {(error||account.error)&&<div className="email-profile-notice"><p className="email-profile-error" role="alert">{error||account.error}</p><button type="button" className="email-profile-secondary" disabled={disabled} onClick={()=>void run(account.refresh,'Account details refreshed. Review your address and retry.')}><RefreshCw size={16} aria-hidden="true"/>Refresh account details</button></div>}
  {message&&<p className="email-profile-success" role="status">{message}</p>}
 </section>;
}
