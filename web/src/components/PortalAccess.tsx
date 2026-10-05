import {useEffect,useState,type ReactNode} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {sendPhoneOtp,confirmPhoneOtp,signInWithGoogle,logoutUser} from '../services/repaidoService';
import RepaidoBrand from './RepaidoBrand';
import './operations.css';
export default function PortalAccess({shop=false,children}:{shop?:boolean;children:ReactNode}){
 const [ready,setReady]=useState(false),[allowed,setAllowed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[phone,setPhone]=useState(''),[otp,setOtp]=useState(''),[sent,setSent]=useState(false);
 const [accountEmail,setAccountEmail]=useState(''),[accessAttempt,setAccessAttempt]=useState(0);
 useEffect(()=>{let active=true;let sequence=0;
  const unsubscribe=onAuthStateChanged(auth,u=>{const attempt=++sequence;setReady(false);setAllowed(false);setError('');setAccountEmail(u?.email||u?.phoneNumber||'');if(!u){setReady(true);return;}
   void u.getIdTokenResult(true).then(t=>{if(!active||attempt!==sequence||auth.currentUser?.uid!==u.uid)return;const permitted=shop?t.signInProvider==='phone':t.claims.admin===true||t.claims.role==='admin';setAllowed(permitted);if(!shop&&!permitted)setError('This signed-in account does not have company-admin access. Choose an approved Google account, or refresh access after an administrator grants it.');setReady(true);}).catch(()=>{if(!active||attempt!==sequence)return;setError('Unable to refresh your sign-in permissions. Check your connection and retry.');setReady(true);});
  });return()=>{active=false;unsubscribe();};
 },[shop,accessAttempt]);
 const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  if(ready&&allowed)return <>{children}</>;
  return (
    <>
      <div className="auth-bg-motion"><div className="orb orb-1"/><div className="orb orb-2"/><div className="orb orb-3"/></div>
      <main className="operations portal-login relative z-10">
        <section className="portal-intro">
          <RepaidoBrand size="lg"/>
          <span className="ops-eyebrow" style={{color: 'var(--op-blue)', fontSize: '0.9rem', marginBottom: 8}}>{shop?'Shop Workspace':'Company Workspace'}</span>
          <h1 style={{fontSize: '3rem', fontWeight: 900, background: 'linear-gradient(to right, #0f306e, #2563eb)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: 1.1, marginBottom: 24}}>
            {shop?'Partner for Lifetime':'Manage Repaido'}
          </h1>
          <p style={{fontSize: '1.25rem', color: '#334155', fontWeight: 500, lineHeight: 1.6}}>
            {shop?'Unlock endless opportunities for your business. Manage parts orders, scale your shop, and grow together as a lifetime partner of Repaido.':'Review applications, manage bookings and resolve issues with powerful administrative tools.'}
          </p>
          <ol style={{marginTop: 32, gap: 20, fontSize: '1.1rem', color: '#475569'}}>
            <li><strong>1.</strong> {shop?'Verify your secure mobile identity':'Sign in with your company account'}</li>
            <li><strong>2.</strong> {shop?'Submit your shop and business details':'Use an account with admin access'}</li>
            <li><strong>3.</strong> {shop?'Start receiving orders upon activation':'Manage the areas your role allows'}</li>
          </ol>
        </section>
        <section className="portal-login-form">
          <div className="ops-card" style={{border: 'none', background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(12px)', boxShadow: '0 20px 40px -10px rgba(0,0,0,0.1)'}}>
            <h2>{shop?'Shop Partner Sign-in':'Company Administrator Sign-in'}</h2>
            <p>{shop?'Enter the shop owner’s mobile number. After verification, you can sign in or register a new shop.':'Use your approved company account. Contact your Repaido administrator if you need access.'}</p>
            {!ready?<p role="status" style={{fontWeight: 600, color: 'var(--op-blue)'}}>Checking secure sign-in…</p>:shop?
            <form onSubmit={e=>{e.preventDefault();void run(async()=>{if(sent)await confirmPhoneOtp(otp);else{await sendPhoneOtp(phone,'shop-otp');setSent(true);}});}}>
              <label>Mobile number
                <input type="tel" autoComplete="tel" value={phone} required disabled={sent} onChange={e=>setPhone(e.target.value)} placeholder="+91 98765 43210"/>
              </label>
              {sent&&<label>6-digit code from SMS
                <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={otp} onChange={e=>setOtp(e.target.value)}/>
              </label>}
              <button className="ops-primary" disabled={busy} style={{marginTop: 24}}>{busy?'Processing…':sent?'Verify Identity':'Send Verification Code'}</button>
              {sent&&<button type="button" disabled={busy} onClick={()=>{setSent(false);setOtp('');}} className="ops-secondary" style={{marginTop: 12}}>Change number or resend code</button>}
            </form>:
            <button className="ops-primary" disabled={busy} onClick={()=>void run(signInWithGoogle)}>Sign in with Google</button>}
            {accountEmail&&<div className="ops-notice" style={{marginTop: 24}}>Signed in as <strong>{accountEmail}</strong></div>}
            {error&&<p className="ops-error" role="alert">{error}</p>}
            {ready&&auth.currentUser&&!shop&&<button className="ops-secondary" disabled={busy} onClick={()=>setAccessAttempt(n=>n+1)} style={{marginTop: 16}}>Refresh access</button>}
            {auth.currentUser&&!allowed&&<button className="ops-secondary" disabled={busy} onClick={()=>void run(logoutUser)} style={{marginTop: 16}}>Sign out</button>}
            <p className="ops-help" style={{marginTop: 32}}>Signing in does not automatically approve a shop or give admin access. The Repaido team must approve your access.</p>
          </div>
        </section>
      </main>
    </>
  );
}
