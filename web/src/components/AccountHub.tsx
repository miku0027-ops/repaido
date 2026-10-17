import {useState, type ComponentType, type ReactNode} from 'react';
import {Bell, BookOpen, CalendarCheck, ChevronDown, ChevronRight, CircleHelp, FileText, Home, MapPin, ShieldCheck, ShoppingBag, Groups, HomeRepair, PersonSearch, Storefront, LocalShipping, SwapHoriz, Sell, EventAvailable, ManageAccounts, User, SupportAgent, Payments, FactCheck, WorkOutline, RequestQuote} from '../icons';
import {AccountCard, AccountSignOut, type AccountCardProps} from './AccountCard';
import {AppPolicies, type AppPolicyId} from './AppPolicies';
import './account-hub.css';
import {Modal} from './ui';
import {ContractError} from './customContractUI';
import {CaptainProfileSettings,useCaptain} from './CaptainClub';

type AccountActionProps = {icon: ComponentType<{size?: number; 'aria-hidden'?: boolean}>; label: string; description?: string; onClick: () => void};
function AccountAction({icon: Icon, label, description, onClick}: AccountActionProps) {
  return <button className="account-menu-action" onClick={onClick}><span className="account-menu-icon"><Icon size={20} aria-hidden={true}/></span><span className="account-menu-copy"><strong>{label}</strong>{description && <span>{description}</span>}</span><ChevronRight size={16} aria-hidden="true"/></button>;
}
type AccountCategoryProps = {icon: AccountActionProps['icon']; title: string; description: string; children: ReactNode; initiallyOpen?: boolean};
function AccountCategory({icon: Icon, title, description, children, initiallyOpen}: AccountCategoryProps) {
  return <details className="account-category" open={initiallyOpen || undefined}><summary><span className="account-category-icon"><Icon size={20} aria-hidden={true}/></span><span className="account-category-copy"><strong>{title}</strong><span>{description}</span></span><ChevronDown size={20} className="account-category-chevron" aria-hidden="true"/></summary><div className="account-category-content">{children}</div></details>;
}

export type AccountHubProps = AccountCardProps & {
  city: string;
  largerText: boolean;
  reducedMotion: boolean;
  onLargerText: (enabled: boolean) => void;
  onReducedMotion: (enabled: boolean) => void;
  onHomePlans: () => void;
  onHiring: () => void;
  onContracts: () => void;
  onCommunity: () => void;
  onMarket: () => void;
  onExchange: () => void;
  onSellUsed: () => void;
  onRentals: () => void;
  onLocation: () => void;
  onOffers: () => void;
  onAgentAccount: () => void;
  onShopAccount: () => void;
  onSupport: () => void;
};

export function AccountHub(props: AccountHubProps) {
  const captain=useCaptain();
  const [photoSettings,setPhotoSettings]=useState(false);
  const [policy, setPolicy] = useState<AppPolicyId | null>(null);
  return <div className="account-hub">
    <header className="account-hub-heading"><div><p className="account-hub-eyebrow">Your Repaido account</p><h1>Account</h1><p>Bookings, orders and your account details.</p></div><button className="account-hub-location" onClick={props.onLocation}><MapPin size={20} aria-hidden="true"/><span>{props.city}</span><ChevronRight size={16} aria-hidden="true"/></button></header>
    <div className="account-hub-layout"><aside className="account-hub-profile"><AccountCard {...props} hideSignOut gold={captain.gold}/></aside><div className="account-hub-menu">
      <AccountCategory icon={CalendarCheck} title="Bookings & work" description="Visits, home plans and hiring" initiallyOpen>
        <AccountAction icon={HomeRepair} label="My service bookings" description="View your visits and their progress" onClick={props.onBookings}/>
        <AccountAction icon={Home} label="Home plans & calendar" description="Manage your scheduled home services" onClick={props.onHomePlans}/>
        <AccountAction icon={PersonSearch} label="Hiring requests" description="View your professional hiring requests" onClick={props.onHiring}/>
        <AccountAction icon={RequestQuote} label="Custom contract requests" description="Review matches, proposals and accepted work" onClick={props.onContracts}/>
        <AccountAction icon={Groups} label="Repaidians community" description="Explore professional profiles and work" onClick={props.onCommunity}/>
      </AccountCategory>
      <AccountCategory icon={ShoppingBag} title="Market" description="Orders, rentals and your listings">
        <AccountAction icon={Storefront} label="Market · Buy & rent" onClick={props.onMarket}/>
        <AccountAction icon={LocalShipping} label="My orders & tracking" onClick={props.onOrders}/>
        <AccountAction icon={SwapHoriz} label="Let’s exchange" onClick={props.onExchange}/>
        <AccountAction icon={Sell} label="Sell a used item" onClick={props.onSellUsed}/>
        <AccountAction icon={EventAvailable} label="My rentals" onClick={props.onRentals}/>
        <AccountAction icon={ManageAccounts} label="Shop workspace" description="Manage your shop or switch accounts" onClick={props.onShopAccount}/>
      </AccountCategory>
      <AccountCategory icon={ShieldCheck} title="Account & privacy" description="Your details, alerts and reading choices">
        {props.identity && props.onCompleteEmail && <AccountAction icon={ManageAccounts} label="Account details & email" onClick={props.onCompleteEmail}/>}
        {props.identity&&<AccountAction icon={User} label="Profile photo & leaderboard privacy" onClick={()=>setPhotoSettings(true)}/>}
        <AccountAction icon={MapPin} label="Service location" description={props.city} onClick={props.onLocation}/>
        <AccountAction icon={Bell} label="Notifications & offers" description="Choose your offer preferences" onClick={props.onOffers}/>
        <AccountAction icon={WorkOutline} label="Professional account" description="Register or switch to your professional workspace" onClick={props.onAgentAccount}/>
        <AccountAction icon={ShieldCheck} label="Privacy policy" onClick={() => setPolicy('privacy')}/>
        <fieldset className="account-reading-preferences"><legend>Reading & motion</legend><label><input type="checkbox" checked={props.largerText} onChange={event => props.onLargerText(event.target.checked)}/><span>Larger text</span></label><label><input type="checkbox" checked={props.reducedMotion} onChange={event => props.onReducedMotion(event.target.checked)}/><span>Reduce animations</span></label><p>Saved on this device. Your device’s reduced-motion setting is always respected.</p></fieldset>
      </AccountCategory>
      <AccountCategory icon={CircleHelp} title="Help & legal" description="Support, policies and service standards">
        <AccountAction icon={SupportAgent} label="Help & Support Desk" description="Get help with a booking, order or your account" onClick={props.onSupport}/>
        <AccountAction icon={Payments} label="Refunds & cancellations" onClick={() => setPolicy('refunds')}/>
        <AccountAction icon={FactCheck} label="Service standards" onClick={() => setPolicy('service-standards')}/>
        <AccountAction icon={FileText} label="Terms of use" onClick={() => setPolicy('terms')}/>
        <AccountAction icon={BookOpen} label="About Repaido" onClick={() => setPolicy('about')}/>
      </AccountCategory>
    </div></div>
    {props.identity && <footer className="account-hub-footer"><AccountSignOut onSignOut={props.onSignOut}/></footer>}
    {photoSettings&&captain.data&&<CaptainProfileSettings data={captain.data} onClose={()=>setPhotoSettings(false)} onSaved={()=>{setPhotoSettings(false);void captain.refresh();}}/>}
    {photoSettings&&!captain.data&&<Modal title="Profile photo & privacy" onClose={()=>setPhotoSettings(false)}>{captain.error?<ContractError error={captain.error} onRetry={()=>void captain.refresh()}/>:<p role="status">Loading profile settings…</p>}</Modal>}
    {policy && <AppPolicies initialPolicy={policy} onClose={() => setPolicy(null)} onContactSupport={() => { setPolicy(null); props.onSupport(); }}/>}
  </div>;
}
