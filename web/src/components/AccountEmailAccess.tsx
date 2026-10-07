import {useRef,useState} from 'react';
import {Mail,ShieldCheck} from 'lucide-react';
import {Modal} from './ui';
import {EmailProfileCompletion} from './EmailProfileCompletion';
import type {useAccountProfile} from '../hooks/useAccountProfile';
import {emailVerificationLink,clearEmailVerificationLink} from '../services/emailVerificationLink.mjs';
import './account-email-access.css';

export function AccountEmailNotice({account,onOpen}:{account:ReturnType<typeof useAccountProfile>;onOpen:()=>void}){
  if(!account.profile?.email_required)return null;
  return <aside className="account-email-notice"><Mail size={20} aria-hidden="true"/><div><strong>Complete your account</strong><p>Add your private email for new bookings, registrations and account updates.</p></div><button type="button" onClick={onOpen}>Add email</button></aside>;
}
export function AccountEmailAccess({account,onClose,onSignIn}:{account:ReturnType<typeof useAccountProfile>;onClose:()=>void;onSignIn:()=>void}){
  const link=emailVerificationLink();
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const actor=useRef(account.profile?.id);actor.current=account.profile?.id;
  return <Modal title="Private account details" onClose={onClose}>
    {link&&!confirmed&&<section className="email-link-confirmation"><ShieldCheck size={24} aria-hidden="true"/><h3>Confirm your email</h3>
      {'invalid' in link?<p role="alert">This verification link is invalid. Request a new link from your account below.</p>:<>
        <p>Confirm this link while signed in to the account that requested it.</p>
        <button type="button" disabled={busy||!account.profile} onClick={async()=>{
          const uid=actor.current;setBusy(true);setError('');
          try{await account.confirmVerification(link.challenge_id,link.token);if(actor.current===uid){clearEmailVerificationLink();setConfirmed(true);}}
          catch(problem){if(actor.current===uid)setError(problem instanceof Error?problem.message:'Verification failed. Please retry.');}
          finally{if(actor.current===uid)setBusy(false);}
        }}>{busy?'Confirming…':'Confirm email ownership'}</button>
      </>}
      {error&&error!==account.error&&<p role="alert">{error}</p>}
    </section>}
    {confirmed&&<p role="status">Your email ownership is verified.</p>}
    {account.profile||account.loading||account.error?<EmailProfileCompletion account={account}/>:<div className="email-profile-guest"><p>Sign in to add or verify your private account email.</p><button type="button" onClick={onSignIn}>Sign in</button></div>}
  </Modal>;
}
