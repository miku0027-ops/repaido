import {useEffect, useRef, useState} from 'react';
import {ArrowRight, BriefcaseBusiness, CalendarCheck, CheckCircle2, LogOut, Mail, Receipt, User} from 'lucide-react';

export type AccountEmailStatus = 'missing' | 'unverified' | 'verified';
export type AccountIdentity = {
  name?: string;
  label: string;
  email?: string;
  phone?: string;
  photoURL?: string;
  agentLabel?: string;
};
export type AccountCardProps = {
  identity: AccountIdentity | null;
  emailStatus?: AccountEmailStatus;
  onCompleteEmail?: () => void;
  onSignIn: () => void;
  onSignOut: () => Promise<void>;
  onBookings: () => void;
  onOrders: () => void;
};

// A phone account's internal placeholder is not a customer email address.
export function visibleAccountEmail(value?: string): string | undefined {
  const email = value?.trim();
  return email && !/@repaido\.user$/i.test(email) ? email : undefined;
}

export function AccountCard({identity, emailStatus, onCompleteEmail, onSignIn, onSignOut, onBookings, onOrders}: AccountCardProps) {
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const email = visibleAccountEmail(identity?.email);
  const initials = identity?.name?.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const signOut = async () => {
    if (signingOut) return;
    setSignOutError('');
    setSigningOut(true);
    try { await onSignOut(); }
    catch (error) { if (mounted.current) setSignOutError(error instanceof Error ? error.message : 'Sign out could not finish. Please try again.'); }
    finally { if (mounted.current) setSigningOut(false); }
  };

  return <section className="account-card" aria-label={identity ? 'Your account details' : 'Sign in to your account'}>
    <div className="account-card-brand"><span className="account-card-brand-mark" aria-hidden="true">r.</span><span>YOUR REPAIDO ACCOUNT</span></div>
    {identity ? <>
      <div className="account-card-identity">
        <div className="account-card-avatar" aria-hidden="true">{identity.photoURL ? <img src={identity.photoURL} alt="" referrerPolicy="no-referrer"/> : initials || <User size={27}/>}</div>
        <div className="account-card-name"><h2>{identity.label}</h2><p>{identity.phone || 'Signed in'}</p></div>
      </div>
      {identity.agentLabel && <span className="account-card-role"><BriefcaseBusiness size={16} aria-hidden="true"/>{identity.agentLabel}</span>}
      <div className="account-card-email">
        <Mail size={19} aria-hidden="true"/>
        <div><span className="account-card-field-label">Email address</span><p>{email || 'Add your email for account updates'}</p>
          {emailStatus && <span className={`account-email-status account-email-status--${emailStatus}`}>
            {emailStatus === 'verified' && <CheckCircle2 size={15} aria-hidden="true"/>}
            {emailStatus === 'verified' ? 'Email verified' : emailStatus === 'unverified' ? 'Email verification needed' : 'Email needed'}
          </span>}
        </div>
      </div>
      {onCompleteEmail && <button className="account-card-profile-action" onClick={onCompleteEmail}>{emailStatus === 'missing' ? 'Complete your profile' : emailStatus === 'unverified' ? 'Verify your email' : 'Account details'}<ArrowRight size={18} aria-hidden="true"/></button>}
    </> : <div className="account-card-guest"><div className="account-card-avatar" aria-hidden="true"><User size={27}/></div><h2>A place for your everyday plans.</h2><p>Sign in to keep your bookings, orders and requests together.</p><button className="account-card-sign-in" onClick={onSignIn}>Sign in or create account<ArrowRight size={18} aria-hidden="true"/></button></div>}
    <div className="account-card-shortcuts" aria-label="Account shortcuts"><button onClick={onBookings}><CalendarCheck size={20} aria-hidden="true"/><span>My bookings</span><ArrowRight size={16} aria-hidden="true"/></button><button onClick={onOrders}><Receipt size={20} aria-hidden="true"/><span>My orders</span><ArrowRight size={16} aria-hidden="true"/></button></div>
    {identity && <button className="account-card-sign-out" onClick={() => void signOut()} disabled={signingOut} aria-busy={signingOut}><LogOut size={18} aria-hidden="true"/>{signingOut ? 'Signing out…' : 'Sign out'}</button>}
    {signOutError && <p className="account-card-error" role="alert">{signOutError}</p>}
  </section>;
}
