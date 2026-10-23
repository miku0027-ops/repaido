import {useEffect,useRef,useState,type FormEvent} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {ArrowLeft,ArrowRight,Check,Phone,ShieldCheck,Sparkles,X} from '../icons';
import {auth} from '../firebase';
import {Modal} from './ui';
import RepaidoBrand from './RepaidoBrand';
import {AccountJourneyArt} from './AccountJourneyArt';
import {signInWithGoogle,sendPhoneOtp,confirmPhoneOtp,cancelPhoneVerification,canContinueWithPhoneAccount,continueWithPhoneAccount,type RepaidoUser} from '../services/repaidoService';
import {accountEmailError} from '../services/accountProfileService';
import {finishCustomerSession,onboardingRequest,type CustomerSetup} from '../services/customerOnboarding';
import './account-journey.css';

type Step='method'|'code'|'profile'|'interests'|'checking';
export type AccountJourneyComplete={user:RepaidoUser;created:boolean;setup?:CustomerSetup};
function GoogleMark(){return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>;}

export function CustomerAuthJourney({initialMode='signin',editInterests=false,city,onClose,onComplete}:{initialMode?:'create'|'signin';editInterests?:boolean;city:string;onClose:()=>void;onComplete:(result:AccountJourneyComplete)=>void}){
 const [mode,setMode]=useState(initialMode),[step,setStep]=useState<Step>(auth.currentUser?'checking':'method');
 const [phone,setPhone]=useState(''),[code,setCode]=useState(''),[name,setName]=useState(''),[email,setEmail]=useState('');
 const [setup,setSetup]=useState<CustomerSetup|null>(null),[selected,setSelected]=useState<string[]>([]),[primary,setPrimary]=useState(''),[adapt,setAdapt]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[resendAt,setResendAt]=useState(0),[clock,setClock]=useState(Date.now());
 const owner=useRef(auth.currentUser?.uid),created=useRef(false),generation=useRef(0),mounted=useRef(true),locked=useRef(false),heading=useRef<HTMLHeadingElement>(null);
 const isCreate=mode==='create'||created.current||!!setup?.required;
 const seconds=Math.max(0,Math.ceil((resendAt-clock)/1000));
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;locked.current=false;cancelPhoneVerification();};},[]);
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{heading.current?.focus({preventScroll:true});},[step]);
 useEffect(()=>onIdTokenChanged(auth,member=>{if(owner.current&&member?.uid!==owner.current){generation.current++;owner.current=undefined;created.current=false;locked.current=false;setNotice('');setPrimary('');setAdapt(false);setBusy(false);setSetup(null);setSelected([]);setName('');setEmail('');setCode('');setPhone('');setStep('method');setError('Your account changed. Choose how to sign in again.');cancelPhoneVerification();}}),[]);
 const run=async(action:(live:()=>boolean)=>Promise<void>)=>{
  if(locked.current)return;locked.current=true;const revision=++generation.current;setBusy(true);setError('');setNotice('');
  const live=()=>mounted.current&&revision===generation.current;
  try{await action(live);}catch(problem){if(live())setError(problem instanceof Error?problem.message:'Please try again.');}
  finally{if(live()){locked.current=false;setBusy(false);}}
 };
 const complete=async(live:()=>boolean,data?:CustomerSetup)=>{
  const uid=owner.current;if(!uid||auth.currentUser?.uid!==uid)throw Error('Your account changed. Sign in again to continue.');
  const user=await finishCustomerSession(uid,data?.name,created.current);
  if(!live()||auth.currentUser?.uid!==uid)return;
  onComplete({user,created:created.current,setup:data});
 };
 const inspect=async(live:()=>boolean,newAccount=false)=>{
  const member=auth.currentUser;if(!member)throw Error('Sign in again to continue.');owner.current=member.uid;created.current=created.current||newAccount;setStep('checking');
  const data=await onboardingRequest(member.uid);if(!live()||auth.currentUser?.uid!==member.uid)return;
  created.current=created.current||(data.required&&!data.completed);
  setSetup(data);setName(data.name==='Repaido Member'?'':data.name||member.displayName||'');setEmail(data.email||member.email||'');setSelected(data.categories);setPrimary(data.primary_category);setAdapt(data.adapt_suggestions);
  const needsSetup=newAccount||data.required||editInterests||(mode==='create'&&!data.completed);
  if(needsSetup&&!member.phoneNumber){setPhone('');setStep('method');return;}
  if(needsSetup){setStep(editInterests&&data.completed?'interests':'profile');return;}
  await complete(live,data);
 };
 useEffect(()=>{if(auth.currentUser)void run(live=>inspect(live));},[]);
 const google=()=>run(async live=>{
  const result=await signInWithGoogle('login',true);
  if(!live())return;if(auth.currentUser?.uid!==result.user.id)throw Error('Your account changed. Sign in again to continue.');
  owner.current=result.user.id;await inspect(live,!!result.isNewAccount);
 });
 const send=()=>run(async live=>{
  const linked=!!owner.current;
  if(linked&&auth.currentUser?.uid!==owner.current)throw Error('Your account changed. Sign in again to continue.');
  await sendPhoneOtp(phone,'customer-journey-recaptcha',linked);
  if(!live())return;setCode('');setStep('code');setResendAt(Date.now()+60000);setClock(Date.now());setNotice('Code sent. Check your messages.');
 });
 const verify=(event:FormEvent)=>{event.preventDefault();void run(async live=>{
  const result=await confirmPhoneOtp(code,undefined,undefined,true);
  if(!live())return;if(auth.currentUser?.uid!==result.user.id)throw Error('Your account changed. Sign in again to continue.');
  owner.current=result.user.id;await inspect(live,!!result.isNewAccount);
 });};
 const recover=()=>run(async live=>{owner.current=undefined;await continueWithPhoneAccount();if(!live())return;owner.current=auth.currentUser?.uid;created.current=false;await inspect(live);});
 const save=()=>run(async live=>{
  const uid=owner.current;if(!uid||auth.currentUser?.uid!==uid)throw Error('Your account changed. Sign in again to continue.');
  const data=await onboardingRequest(uid,{name:name.trim(),email:email.trim(),categories:selected,primary_category:primary,adapt_suggestions:adapt,city});
  if(!live())return;setSetup(data);await complete(live,data);
 });
 const toggle=(id:string)=>{setError('');if(selected.includes(id)){const next=selected.filter(c=>c!==id);setSelected(next);if(primary===id)setPrimary(next[0]||'');}else if(selected.length<3){setSelected([...selected,id]);if(!primary)setPrimary(id);}else setNotice('Choose up to three interests. Remove one to choose another.');};
 const titles={method:owner.current?'One last security step':isCreate?'Let’s make it yours':'Welcome to Repaido',code:'Check your messages',profile:'A little about you',interests:'What can we help with?',checking:'Getting your account ready'};
 const descriptions={method:owner.current?'Verify your mobile number to finish your account.':isCreate?'Start with your mobile number. Your everyday help starts here.':'Sign in to book, track visits and pick up where you left off.',code:`Enter the 6-digit code sent to +91 ${phone}.`,profile:'Your name for a warmer welcome. Your email for account updates.',interests:'Pick up to three. We’ll bring these services closer to you.',checking:'Your details stay with your signed-in account.'};
 const progress=step==='profile'?2:step==='interests'?3:step==='code'?1:0;
 return <Modal title={editInterests?'Your Repaido interests':isCreate?'Create your Repaido account':'Sign in to Repaido'} frameless className={`account-journey-dialog account-journey-${step}`} onClose={onClose}>
  <div className="account-journey-header"><RepaidoBrand size="sm"/><button type="button" className="account-journey-close" aria-label="Close sign-in and keep browsing" onClick={onClose}><X size={20}/></button></div>
  <div className="account-journey-layout">
   <aside className="account-journey-story"><AccountJourneyArt/><div><span>A LITTLE CARE. EVERY DAY.</span><h2>Good things<br/>start at home.</h2><p>Repairs, rides and everyday help.<br/>All in your Repaido.</p></div></aside>
   <div className="account-journey-main">
    {isCreate&&<ol className="account-journey-progress" aria-label="Account setup progress">{['Mobile','Verify','About you','Interests'].map((label,index)=><li key={label} aria-current={progress===index?'step':undefined} data-complete={index<progress||undefined}><span aria-hidden="true">{index<progress?<Check size={12}/>:index+1}</span>{label}</li>)}</ol>}
    <div className="account-journey-step" key={step}>
     <h2 ref={heading} tabIndex={-1}>{titles[step]}</h2><p className="account-journey-intro">{descriptions[step]}</p>
     {step==='method'&&<>
      <form onSubmit={event=>{event.preventDefault();void send();}}><label htmlFor="journey-phone">Mobile number</label><div className="account-journey-phone"><span>+91</span><input id="journey-phone" type="tel" inputMode="numeric" autoComplete="tel-national" value={phone} onChange={e=>setPhone(e.target.value.replace(/\D/g,'').slice(0,10))} placeholder="10-digit mobile number" pattern="[6-9][0-9]{9}" required maxLength={10} disabled={busy}/></div><button type="submit" className="account-journey-primary" disabled={busy||!/^[6-9]\d{9}$/.test(phone)}>{busy?'Please wait…':'Continue with mobile'}<ArrowRight size={18}/></button></form>
      {!owner.current&&<><div className="account-journey-or"><span>or</span></div><button type="button" className="account-journey-google" disabled={busy} onClick={()=>void google()}><GoogleMark/>Continue with Google</button><p className="account-journey-switch">{isCreate?'Already with us?':'New to Repaido?'} <button type="button" disabled={busy} onClick={()=>{setMode(isCreate?'signin':'create');setError('');}}>{isCreate?'Sign in':'Create an account'}</button></p></>}
      <p className="account-journey-assurance"><ShieldCheck size={16}/>{owner.current?'Your verified number stays linked to this account.':'New accounts include mobile verification.'}</p>
     </>}
     {step==='code'&&<form onSubmit={verify}><label htmlFor="journey-code">Verification code</label><input id="journey-code" className="account-journey-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} placeholder="000000" onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} disabled={busy}/><button type="submit" className="account-journey-primary" disabled={busy||code.length!==6}>{busy?'Verifying…':'Verify mobile'}<ShieldCheck size={18}/></button><div className="account-journey-code-actions"><button type="button" disabled={busy} onClick={()=>{cancelPhoneVerification();setCode('');setStep('method');setError('');setNotice('');}}><ArrowLeft size={15}/>Change number</button><button type="button" disabled={busy||seconds>0} onClick={()=>void send()}>{seconds?`Resend in ${seconds}s`:'Resend code'}</button></div></form>}
     {step==='profile'&&<form onSubmit={event=>{event.preventDefault();const issue=accountEmailError(email);if(issue){setError(issue);return;}setError('');setStep('interests');}}><label htmlFor="journey-name">Your name</label><input id="journey-name" autoComplete="name" value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={80} required/><label htmlFor="journey-email">Email address</label><input id="journey-email" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} maxLength={254} required/><p className="account-journey-help">For account updates and confirmations. This won’t subscribe you to marketing.</p><button type="submit" className="account-journey-primary" disabled={name.trim().length<2}>Choose my interests<ArrowRight size={18}/></button></form>}
     {step==='interests'&&<>
      <div className="account-interest-grid" role="group" aria-label="Services you are interested in">{setup?.choices.map(choice=><button type="button" key={choice.id} aria-pressed={selected.includes(choice.id)} onClick={()=>toggle(choice.id)} disabled={busy}><span className="account-interest-check" aria-hidden="true">{selected.includes(choice.id)?<Check size={14}/>:<Sparkles size={14}/>}</span><span>{choice.name}</span></button>)}</div>
      {selected.length>1&&<label className="account-primary-interest">Your most-needed service<select value={primary} onChange={e=>setPrimary(e.target.value)} disabled={busy}>{selected.map(id=><option key={id} value={id}>{setup?.choices.find(c=>c.id===id)?.name}</option>)}</select></label>}
      <label className="account-journey-consent"><input type="checkbox" checked={adapt} onChange={e=>setAdapt(e.target.checked)} disabled={busy}/><span>Let my suggestions grow with me<small>Optional: use service browsing, rides and completed bookings, including spend, to improve suggestions and eligible offers. No price increases or marketing subscription.</small></span></label>
      <button type="button" className="account-journey-primary" disabled={busy} onClick={()=>void save()}>{busy?'Saving your choices…':editInterests?'Save my interests':selected.length?'Make Repaido mine':'Continue without interests'}<ArrowRight size={18}/></button>
      <button type="button" className="account-journey-back" disabled={busy} onClick={()=>{setError('');setStep('profile');}}><ArrowLeft size={16}/>Your details</button>
     </>}
     {step==='checking'&&<div className="account-journey-checking"><span className="account-checking-icon"><Phone size={24}/></span>{busy?<p role="status">Checking your account…</p>:<button type="button" className="account-journey-primary" onClick={()=>void run(live=>inspect(live))}>Try again<ArrowRight size={18}/></button>}</div>}
     {error&&<div className="account-journey-error" role="alert">{error}{canContinueWithPhoneAccount()&&<button type="button" disabled={busy} onClick={()=>void recover()}>Continue with this mobile account</button>}</div>}
     {notice&&<p className="account-journey-help" role="status">{notice}</p>}
    </div>
    <button type="button" className="account-journey-browse" onClick={onClose}>Keep exploring for now</button>
   </div>
  </div>
 </Modal>;
}
