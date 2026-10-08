import {useState, type ComponentType, type ReactNode} from 'react';
import {Bell, BookOpen, BriefcaseBusiness, CalendarDays, CalendarCheck, ChevronDown, ChevronRight, CircleHelp, FileCheck2, FileText, Headphones, Home, MapPin, Package, Receipt, Repeat2, ShieldCheck, ShoppingBag, Store, Users, Wrench} from 'lucide-react';
import {AccountCard, AccountSignOut, type AccountCardProps} from './AccountCard';
import {AppPolicies, type AppPolicyId} from './AppPolicies';
import './account-hub.css';

type AccountActionProps = {icon: ComponentType<{size?: number; 'aria-hidden'?: boolean}>; label: string; description?: string; onClick: () => void};
function AccountAction({icon: Icon, label, description, onClick}: AccountActionProps) {
  return <button className="account-menu-action" onClick={onClick}><span className="account-menu-icon"><Icon size={20} aria-hidden={true}/></span><span className="account-menu-copy"><strong>{label}</strong>{description && <span>{description}</span>}</span><ChevronRight size={18} aria-hidden="true"/></button>;
}
type AccountCategoryProps = {icon: AccountActionProps['icon']; title: string; description: string; children: ReactNode; initiallyOpen?: boolean};
function AccountCategory({icon: Icon, title, description, children, initiallyOpen}: AccountCategoryProps) {
  return <details className="account-category" open={initiallyOpen || undefined}><summary><span className="account-category-icon"><Icon size={21} aria-hidden={true}/></span><span className="account-category-copy"><strong>{title}</strong><span>{description}</span></span><ChevronDown size={20} className="account-category-chevron" aria-hidden="true"/></summary><div className="account-category-content">{children}</div></details>;
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
  const [policy, setPolicy] = useState<AppPolicyId | null>(null);
  return <div className="account-hub">
    <header className="account-hub-heading"><div><p className="account-hub-eyebrow">MADE FOR YOUR EVERYDAY</p><h1>Your space.</h1><p>Everything you need, in one place.</p></div><button className="account-hub-location" onClick={props.onLocation}><MapPin size={18} aria-hidden="true"/><span>{props.city}</span><ChevronRight size={16} aria-hidden="true"/></button></header>
    <div className="account-hub-layout"><aside className="account-hub-profile"><AccountCard {...props} hideSignOut/></aside><div className="account-hub-menu">
      <AccountCategory icon={CalendarCheck} title="Bookings & work" description="Visits, home plans and hiring" initiallyOpen>
        <AccountAction icon={Wrench} label="My service bookings" description="View your visits and their progress" onClick={props.onBookings}/>
        <AccountAction icon={Home} label="Home plans & calendar" description="Manage your scheduled home services" onClick={props.onHomePlans}/>
        <AccountAction icon={BriefcaseBusiness} label="Hiring requests" description="View your professional hiring requests" onClick={props.onHiring}/>
        <AccountAction icon={FileText} label="Custom contract requests" description="Review matches, proposals and accepted work" onClick={props.onContracts}/>
        <AccountAction icon={Users} label="Repaidians community" description="Explore professional profiles and work" onClick={props.onCommunity}/>
      </AccountCategory>
      <AccountCategory icon={ShoppingBag} title="Market" description="Orders, rentals and your listings">
        <AccountAction icon={Store} label="Market · Buy & rent" onClick={props.onMarket}/>
        <AccountAction icon={Receipt} label="My orders & tracking" onClick={props.onOrders}/>
        <AccountAction icon={Repeat2} label="Let’s exchange" onClick={props.onExchange}/>
        <AccountAction icon={Package} label="Sell a used item" onClick={props.onSellUsed}/>
        <AccountAction icon={CalendarDays} label="My rentals" onClick={props.onRentals}/>
        <AccountAction icon={Store} label="Shop Partner / B2B Merchant Portal" description="Manage your shop or switch accounts" onClick={props.onShopAccount}/>
      </AccountCategory>
      <AccountCategory icon={ShieldCheck} title="Account & privacy" description="Your details, alerts and reading choices">
        {props.identity && props.onCompleteEmail && <AccountAction icon={FileCheck2} label="Account details & email" onClick={props.onCompleteEmail}/>}
        <AccountAction icon={MapPin} label="Service location" description={props.city} onClick={props.onLocation}/>
        <AccountAction icon={Bell} label="Notifications & offers" description="Choose your offer preferences" onClick={props.onOffers}/>
        <AccountAction icon={BriefcaseBusiness} label="Agent / specialist account" description="Register or switch to your professional workspace" onClick={props.onAgentAccount}/>
        <AccountAction icon={ShieldCheck} label="Privacy policy" onClick={() => setPolicy('privacy')}/>
        <fieldset className="account-reading-preferences"><legend>Reading & motion</legend><label><input type="checkbox" checked={props.largerText} onChange={event => props.onLargerText(event.target.checked)}/><span>Larger text</span></label><label><input type="checkbox" checked={props.reducedMotion} onChange={event => props.onReducedMotion(event.target.checked)}/><span>Reduce animations</span></label><p>Saved on this device. Your device’s reduced-motion setting is always respected.</p></fieldset>
      </AccountCategory>
      <AccountCategory icon={CircleHelp} title="Help & legal" description="Support, policies and service standards">
        <AccountAction icon={Headphones} label="Help & Support Desk" description="Get help with a booking, order or your account" onClick={props.onSupport}/>
        <AccountAction icon={Receipt} label="Refunds & cancellations" onClick={() => setPolicy('refunds')}/>
        <AccountAction icon={FileCheck2} label="Service standards" onClick={() => setPolicy('service-standards')}/>
        <AccountAction icon={FileText} label="Terms of use" onClick={() => setPolicy('terms')}/>
        <AccountAction icon={BookOpen} label="About Repaido" onClick={() => setPolicy('about')}/>
      </AccountCategory>
    </div></div>
    {props.identity && <footer className="account-hub-footer"><AccountSignOut onSignOut={props.onSignOut}/></footer>}
    {policy && <AppPolicies initialPolicy={policy} onClose={() => setPolicy(null)} onContactSupport={() => { setPolicy(null); props.onSupport(); }}/>}
  </div>;
}
