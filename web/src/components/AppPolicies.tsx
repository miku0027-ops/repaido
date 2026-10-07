import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {ArrowRight,BookOpen,Check,Clock3,Info,Mail,ShieldCheck,WalletCards,X,type LucideIcon} from 'lucide-react';
import {Modal} from './ui';
import './app-policies.css';

export type AppPolicyId = 'privacy' | 'refunds' | 'service-standards' | 'terms' | 'about';
export type AppPoliciesProps = {
  initialPolicy?: AppPolicyId;
  onClose: () => void;
  onContactSupport?: () => void;
};

type Policy = {id:AppPolicyId;label:string;title:string;intro:string;icon:LucideIcon;summary:string[];sections:{title:string;body:ReactNode}[]};

// Operational summaries, grounded in the repository policies documented in
// docs/APP_POLICIES.md. Specific accepted service/contract terms remain attached
// to their own transaction; this menu never invents refund or delivery deadlines.
const policies:Policy[] = [
  {id:'privacy',label:'Privacy',title:'Your information, with clear boundaries',icon:ShieldCheck,
    intro:'Understand what you share, who can see it, and the controls available to you.',
    summary:['Private contact details','Location permission is optional','You control public sharing'],
    sections:[
      {title:'Account and service information',body:<p>Your account uses Firebase sign-in. Your name, verified phone number and contact email support account access, private service communication and work records. Booking addresses, instructions, messages and payment records are used for the relevant service. Your phone, email, exact address, identity documents and bank information are kept out of public professional profiles.</p>},
      {title:'Location and discovery choices',body:<p>Location is requested with your permission for nearby results, route estimates or an enabled work-tracking feature. You can decline device location and choose a supported city or enter an address where the flow allows it. Personalised discovery uses your saved preference controls; it is not a condition of browsing the public directory. Stop optional tracking or change permissions in the app and your device settings.</p>},
      {title:'Public work and private conversations',body:<p>A professional’s public profile and published portfolio are visible to the audience they select. Private contract requests, proposals, conversations and financial reports are restricted to authorised participants. Public contract progress starts off and requires the customer owner’s consent; an update and its media also require the uploader’s sharing consent. Turning off sharing removes access through those public routes.</p>},
      {title:'Storage, providers and device data',body:<p>Repaido uses Google Firebase and Google Cloud for sign-in, hosting and records; configured maps and payment services process the information needed for those features. Firebase Analytics may collect supported app-usage events. Session information and the guest-preview cookie support access on your device. Sign out on shared devices. Protected social media caches are kept in memory and scoped to the current account.</p>},
      {title:'Retention and privacy requests',body:<><p>Private identity-review uploads and visit-evidence photos have a 30-day access expiry in their respective upload flows. Account, work, review, dispute and financial audit records have separate purposes; the app does not promise that every record disappears after 30 days.</p><p>Use the available profile, publication, block and sharing controls to manage your information. To request access, correction or account/data deletion, contact support. Deletion requests need identity and record review; this app does not currently offer an automatic delete-account workflow.</p></>},
    ]},
  {id:'refunds',label:'Refunds & cancellations',title:'Know the status before you pay again',icon:WalletCards,
    intro:'Cancellation, returns and refunds depend on the service or purchase and its verified payment record.',
    summary:['Review your booking controls','Refunds need verified payment','No universal refund deadline'],
    sections:[
      {title:'Cancel or reschedule a visit',body:<p>Use the cancel or reschedule action shown on your booking. Standard field-service bookings allow cancellation before work starts without a platform cancellation fee. Available actions depend on the current work stage. Equipment custody or other outstanding work obligations may need support review before cancellation. Cancellation does not itself confirm that a payment was refunded.</p>},
      {title:'Request a refund or dispute a charge',body:<p>Contact support with the booking, order or contract ID, a description of the issue and the payment reference. A refund is reviewed against the amount actually captured, previous refunds, the agreed scope and any settlement already made. The refund cannot exceed the remaining verified captured balance. Uncertain provider results are reconciled before another refund is submitted.</p>},
      {title:'Pending payments and bank transfers',body:<p>A checkout callback, email, screenshot or bank-transfer reference alone does not confirm a payment. Gateway payments require provider verification. Reported NEFT/RTGS transfers stay pending until independently verified by an authorised reviewer. If a payment outcome is uncertain, check its status or ask support before paying again.</p>},
      {title:'Products, refurbished items and rentals',body:<p>Check the specific product’s condition, inspection disclosures, warranty and return terms before purchase. Refurbished-item terms are supplied with that listing. Rental deposits depend on the recorded return and condition checks. There is no single return window or refund promise covering every product, rental and service in the app.</p>},
      {title:'Membership payments',body:<p>Repaidians Pro uses a one-time payment for one calendar month with manual renewal. The free trial does not start an automatic debit. Shop Prime and other professional plans have their own displayed prices and periods. Send membership refund requests to support; an observed provider-confirmed refund changes the benefits linked to that payment.</p>},
      {title:'Processing and your rights',body:<p>The app distinguishes a requested refund from one processed by the payment provider. The reviewed outcome and provider/bank processing determine when money reaches you; this menu does not promise a fixed number of days. These operational summaries do not limit rights that apply under law.</p>},
    ]},
  {id:'service-standards',label:'Service standards',title:'Clear scope. Visible progress. Accountable work.',icon:Clock3,
    intro:'Service standards explain the work journey. A request or estimate is not a confirmed appointment or a guaranteed delivery time.',
    summary:['Confirmation before activation','Approval for extra work','Issues stay linked to the work'],
    sections:[
      {title:'Request, acceptance and confirmation',body:<p>A submitted request enters matching or professional review. The booking or hire screen shows whether a provider has accepted and whether the scope, time and quote are confirmed. Provider availability, coverage and recorded eligibility affect matching. Catalogue amounts and comparisons are reference estimates until the relevant quote is accepted.</p>},
      {title:'Before the work begins',body:<p>Review the included work, exclusions, scheduled visit, price and current service-specific terms. Standard appointment changes must pass the availability and scheduling checks. Home plans confirm availability and scope before activation. A day-hire price may include separately calculated travel and tax; review the final breakdown before accepting.</p>},
      {title:'Changes, parts and progress',body:<p>Additional work and parts require the relevant quote or scope approval rather than an assumed charge. Work statuses, visit records and customer confirmations distinguish requested, accepted, in-progress and completed work. Contract team counts show accepted people separately from pending offers; a reported progress update is not automatically a customer-confirmed outcome.</p>},
      {title:'Service levels and deadlines',body:<p>Any delivery deadline, service commitment, warranty or remedy belongs to the terms accepted for that service, product or contract. Repaido does not publish a universal guaranteed response time, provider arrival time or platform-uptime SLA in this menu. Review the latest terms in the service or quotation flow before committing.</p>},
      {title:'Raise an issue with context',body:<p>Use the booking’s issue or support action when available, or contact support with the related ID and what happened. Booking, payment, safety and warranty issues can be recorded for review. Reviews and verified work evidence help future discovery, but a review badge or membership badge is not a blanket safety, qualification or statutory-licence guarantee.</p>},
    ]},
  {id:'terms',label:'Terms of use',title:'Use Repaido with accurate information and consent',icon:BookOpen,
    intro:'A practical guide to account use, professional access, agreed work and responsible participation.',
    summary:['Keep account details accurate','Accept the actual transaction terms','Respect privacy and permission'],
    sections:[
      {title:'Your account and contact details',body:<p>Use your own sign-in credentials and keep your contact information accurate. A verified phone number and contact email support private service communication. Never share an OTP, password, bank PIN or full payment-card credentials with another user or include them in a support message.</p>},
      {title:'Customer and professional permissions',body:<p>Customers can discover public work and manage their own service and contract requests. Professional publishing, profile tools and networking require an approved registered professional account; selecting a label or paying for membership does not grant professional approval. Customer-to-contractor contract conversations unlock for the awarded participants. Other messaging routes apply their own recipient, membership and location permissions.</p>},
      {title:'Prices, quotes and accepted terms',body:<p>Review the current price breakdown, work scope, exclusions, product disclosures and service-specific terms in the transaction flow. A reference rate, shortlist score, submitted proposal or payment request is not an accepted final quote. Contract payments are tracked against the accepted contract value; platform collection and contractor payout are separate states.</p>},
      {title:'Free trials and paid plans',body:<p>The current Repaidians trial lasts 60 days from the server-recorded start for the account. It cannot restart by changing devices. After expiry, social access requires an active membership, while account/privacy controls remain available. Paid plan periods and renewal choices are shown before checkout. Payment activation depends on verified provider records.</p>},
      {title:'Community and marketplace conduct',body:<p>Publish only work, photos and information you are authorised to share. Obtain consent before publishing another person or their private premises. Keep credentials, qualifications, reviews, discounts and product condition claims accurate. Use reporting and blocking for unwanted conduct; reports are recorded for authorised review. Keep private work briefs and conversations within their permitted audience.</p>},
      {title:'Which terms apply to a transaction',body:<p>This menu summarises current application behaviour. Versioned service terms, accepted quotations, contract scope and product or rental disclosures are shown in their own flows and retained with the related records where supported. Read those details before accepting; contact support if something is missing or unclear.</p>},
    ]},
  {id:'about',label:'About & contact',title:'Repaido, for your home and your work',icon:Info,
    intro:'Find services, discover professional work and manage clear, private records in one place.',
    summary:['Home services','Work & professional discovery','Products and local commerce'],
    sections:[
      {title:'What you can do here',body:<p>Repaido connects customer service requests with registered professionals and gives contractors and teams a shared work journey. Repaidians brings public portfolios and professional discovery into that experience. Market includes spare parts, refurbished products, rentals and owner-listed exchange or pre-owned items with their own conditions.</p>},
      {title:'Understand the badges',body:<p>Identity or contractor review, active Repaidian membership and paid Shop Prime are separate signals. A paid placement or membership does not establish a licence, a guaranteed outcome or a completed job. Professional claims and product disclosures should be assessed with their actual records and accepted terms.</p>},
      {title:'Contact support',body:<><p>For account, booking, payment or privacy questions, contact <a href="mailto:support@repaido.com">support@repaido.com</a>. Include the related booking, order, shop or contract ID when you have one, plus a short description. Share sensitive documents only through an authorised upload flow when requested.</p><p>Support is not an emergency service. For an immediate danger, contact the appropriate local emergency service.</p></>},
      {title:'Accessibility and feedback',body:<p>Tell support if text, controls, motion or an assistive-technology flow prevents you from using the app. Include the screen and device involved. The app’s theme and text controls, keyboard navigation and reduced-motion support are intended to make everyday use more comfortable.</p>},
    ]},
];

export function AppPolicies({initialPolicy='privacy',onClose,onContactSupport}:AppPoliciesProps) {
  const [selected,setSelected]=useState<AppPolicyId>(initialPolicy);
  const content=policies.find(policy=>policy.id===selected)!;
  const Icon=content.icon,id=useId(),heading=useRef<HTMLHeadingElement>(null),body=useRef<HTMLDivElement>(null);
  useEffect(()=>{setSelected(initialPolicy);},[initialPolicy]);
  const choose=(policy:AppPolicyId)=>{setSelected(policy);requestAnimationFrame(()=>{if(body.current)body.current.scrollTop=0;heading.current?.focus({preventScroll:true});});};
  return <Modal title="Repaido policies and help" className="app-policies-dialog" frameless onClose={onClose}>
    <div className="app-policies-shell">
      <header className="app-policies-header"><div><span className="app-policies-eyebrow">REPAIDO · HELP & POLICIES</span><h2>Clarity at every step</h2></div><button type="button" className="app-policies-close" data-autofocus onClick={onClose} aria-label="Close policies"><X size={20} aria-hidden="true"/></button></header>
      <div className="app-policies-layout">
        <nav className="app-policies-nav" aria-label="Policy sections">{policies.map(policy=>{const NavIcon=policy.icon;return <button type="button" key={policy.id} aria-current={selected===policy.id?'page':undefined} aria-controls={id} onClick={()=>choose(policy.id)}><NavIcon size={18} aria-hidden="true"/><span>{policy.label}</span><ArrowRight className="app-policies-nav-arrow" size={15} aria-hidden="true"/></button>;})}</nav>
        <div ref={body} id={id} className="app-policies-scroll" role="region" aria-labelledby={`${id}-heading`}>
          <article className="app-policies-content" key={selected}>
            <div className="app-policies-title-icon" aria-hidden="true"><Icon size={26}/></div><p className="app-policies-category">{content.label}</p><h3 ref={heading} id={`${id}-heading`} tabIndex={-1}>{content.title}</h3><p className="app-policies-intro">{content.intro}</p>
            <ul className="app-policies-summary" aria-label="Key points">{content.summary.map(point=><li key={point}><Check size={16} aria-hidden="true"/>{point}</li>)}</ul>
            <div className="app-policies-sections">{content.sections.map(section=><section key={section.title}><h4>{section.title}</h4>{section.body}</section>)}</div>
            <footer className="app-policies-support"><span className="app-policies-support-icon" aria-hidden="true"><Mail size={20}/></span><div><strong>Need help with your situation?</strong><p>Keep your booking or payment reference handy.</p>{onContactSupport?<button type="button" onClick={onContactSupport}>Contact support <ArrowRight size={15} aria-hidden="true"/></button>:<a href="mailto:support@repaido.com">Email support@repaido.com <ArrowRight size={15} aria-hidden="true"/></a>}</div></footer>
          </article>
        </div>
      </div>
    </div>
  </Modal>;
}
