import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {ArrowRight,BookOpen,Check,Clock3,Info,Mail,ShieldCheck,WalletCards,X,type LucideIcon} from '../icons';
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
      {title:'Account and service information',body:<p>You sign in with Firebase. Your name, verified phone number and email help you access your account and get private service updates. We use booking addresses, notes, messages and payment records to provide the service. Your public profile does not show your phone, email, exact address, ID documents or bank details.</p>},
      {title:'Location and discovery choices',body:<p>We ask before using your location to find nearby services, estimate a route or track work. You can say no and choose a city or enter an address where that option is offered. You can browse public profiles without turning on personal suggestions. You can stop optional tracking in the app or change location access in your device settings.</p>},
      {title:'Public work and private conversations',body:<p>You choose who can see your profile and shared work. Only people with access can see private project requests, quotes, chats and payment reports. Public project updates are off at first. The customer who owns the project must agree to turn them on. The person who uploads each update or photo must also agree to share it. Turning sharing off removes public access.</p>},
      {title:'Storage, providers and device data',body:<p>Repaido uses Google Firebase and Google Cloud for sign-in and storage. Map and payment services receive the details they need to work. Firebase Analytics may record how the app is used. Sign-in data and a guest cookie help you use the app on your device. Sign out on shared devices. Private social content is kept in memory for the current account only.</p>},
      {title:'Retention and privacy requests',body:<> <p>Access to private ID review files and service-visit photos expires after 30 days. Account, work, review, dispute and payment records are kept for other purposes. They do not all expire after 30 days.</p><p>Use your profile, post, block and sharing settings to manage your information. Contact support to ask for a copy, a correction or deletion of your account or data. We must check your identity and records first. The app does not have an automatic delete-account option.</p> </>},
    ]},
  {id:'refunds',label:'Refunds & cancellations',title:'Know the status before you pay again',icon:WalletCards,
    intro:'Cancellation, returns and refunds depend on the service or purchase and its verified payment record.',
    summary:['Review your booking controls','Refunds need verified payment','No universal refund deadline'],
    sections:[
      {title:'Cancel or reschedule a visit',body:<p>Use the cancel or change-time option on your booking. You can cancel a standard service visit before work starts without a Repaido cancellation fee. The options shown depend on the job's stage. Support may need to check any equipment you hold or work still owed. Cancelling a booking does not mean a payment has been refunded.</p>},
      {title:'Request a refund or dispute a charge',body:<p>Contact support with the booking, order or project ID, the problem and your payment reference. We check the money received, earlier refunds, agreed work and any money already paid out. A refund cannot exceed the verified amount still available. If a payment provider's result is unclear, we check it before sending another refund request.</p>},
      {title:'Pending payments and bank transfers',body:<p>An email, screenshot, checkout message or bank reference does not prove a payment is complete. The payment provider must confirm it. Reported NEFT or RTGS bank transfers stay pending until an approved reviewer checks them. If you are unsure, check the payment status or contact support before paying again.</p>},
      {title:'Products, refurbished items and rentals',body:<p>Before you buy, check the item's condition, inspection details, warranty and return terms. Each refurbished item has its own listed terms. Rental deposits depend on return and condition checks. Return periods and refund rules vary by product, rental and service.</p>},
      {title:'Membership payments',body:<p>Repaidians Pro is a one-time payment for one calendar month. You renew it yourself. The free trial does not start automatic payments. Shop Prime and other work plans show their own prices and periods. Contact support to ask for a membership refund. When the payment provider confirms a refund, the benefits linked to that payment change.</p>},
      {title:'Processing and your rights',body:<p>A refund request is different from a completed refund. The review, payment provider and bank decide when the money reaches you. We do not promise a fixed number of days here. These summaries do not limit your legal rights.</p>},
    ]},
  {id:'service-standards',label:'Service standards',title:'Clear scope. Visible progress. Accountable work.',icon:Clock3,
    intro:'Service standards explain the work journey. A request or estimate is not a confirmed appointment or a guaranteed delivery time.',
    summary:['Confirmation before activation','Approval for extra work','Issues stay linked to the work'],
    sections:[
      {title:'Request, acceptance and confirmation',body:<p>A request is sent for matching or review. Check your booking to see if a professional has accepted and confirmed the work, time and price. Matches depend on availability, service area and who can take the job. Listed prices are estimates until you accept the quote.</p>},
      {title:'Before the work begins',body:<p>Check the included work, extras, visit time, price and service terms. Changes to a standard visit must pass time and availability checks. Home plans need confirmed availability and work details before they start. Day-hire prices may add travel and tax. Check the full price before you accept.</p>},
      {title:'Changes, parts and progress',body:<p>You must approve the quote or work details for extra work and parts before they are charged. The booking shows whether work is requested, accepted, started or complete. Team lists separate people who have joined from pending offers. A progress report does not mean the customer has confirmed the work.</p>},
      {title:'Service levels and deadlines',body:<p>Check the terms you accept for the service, product or project. They explain any deadline, warranty or remedy. This page does not promise a fixed reply time, arrival time or website uptime for every service. Read the current terms before you agree.</p>},
      {title:'Raise an issue with context',body:<p>Use Report a problem or Support on your booking, or contact support with the related ID and what happened. You can report booking, payment, safety and warranty issues for review. Reviews and work photos can help you choose. A review or membership badge does not guarantee safety, training or a required licence.</p>},
    ]},
  {id:'terms',label:'Terms of use',title:'Use Repaido with accurate information and consent',icon:BookOpen,
    intro:'A practical guide to account use, professional access, agreed work and responsible participation.',
    summary:['Keep account details accurate','Accept the actual transaction terms','Respect privacy and permission'],
    sections:[
      {title:'Your account and contact details',body:<p>Use your own account and keep your contact details up to date. Your verified phone and email help with private service messages. Never share a sign-in code, password, bank PIN or full card details with another user or in a support message.</p>},
      {title:'Customer and professional permissions',body:<p>Customers can view public work and manage their own requests. Repaido must approve a registered work account before it can use professional posting, profile and networking tools. Choosing a role or paying for membership does not give that approval. Project chats open for the customer and chosen contractor. Other chats have their own rules for recipients, membership and location.</p>},
      {title:'Prices, quotes and accepted terms',body:<p>Check the price breakdown, included work, extras, product details and terms before you agree. A listed rate, ranking, proposal or payment request is not a final quote you have accepted. Project payments are tracked against the agreed total. Money collected by Repaido and money paid to a contractor are shown separately.</p>},
      {title:'Free trials and paid plans',body:<p>The Repaidians trial lasts 60 days from the start date saved for your account. Changing devices does not restart it. After the trial, you need an active membership for social features. Account and privacy settings stay available. Check the plan period and renewal choice before paying. Benefits start after the payment provider confirms payment.</p>},
      {title:'Community and marketplace conduct',body:<p>Share only work, photos and details you have permission to share. Ask before posting another person or their private property. Be honest about your skills, qualifications, reviews, discounts and item condition. Report or block unwanted contact. Approved reviewers can check reports. Keep private work details and chats within the group allowed to see them.</p>},
      {title:'Which terms apply to a transaction',body:<p>This page gives a summary. Each service, quote, project, product or rental has its own terms shown where you use it. Where supported, those terms are saved with the record. Read them before accepting. Contact support if anything is missing or unclear.</p>},
    ]},
  {id:'about',label:'About & contact',title:'Repaido, for your home and your work',icon:Info,
    intro:'Find services, discover professional work and manage clear, private records in one place.',
    summary:['Home services','Work & professional discovery','Products and local commerce'],
    sections:[
      {title:'What you can do here',body:<p>Find home services and registered professionals on Repaido. Contractors can plan work with their teams. On Repaidians, share your work and find people to work with. In Market, buy parts or refurbished items, rent equipment, exchange items or buy used goods. Check the terms for each listing.</p>},
      {title:'Understand the badges',body:<p>ID review, contractor approval, Repaidian membership and Shop Prime each mean different things. Paid promotion or membership does not prove a licence, guarantee a result or show that a job is finished. Check work records, product details and the terms you accept.</p>},
      {title:'Contact support',body:<><p>For account, booking, payment or privacy questions, contact <a href="mailto:support@repaido.com">support@repaido.com</a>. Include the related booking, order, shop or contract ID when you have one, plus a short description. Share sensitive documents only through an authorised upload flow when requested.</p><p>Support is not an emergency service. For an immediate danger, contact the appropriate local emergency service.</p></>},
      {title:'Accessibility and feedback',body:<p>Tell support if text, buttons, movement or assistive tools make the app hard to use. Include the screen and device. You can change the theme and text size, use a keyboard and turn on reduced motion.</p>},
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
        <nav className="app-policies-nav" aria-label="Policy sections">{policies.map(policy=>{const NavIcon=policy.icon;return <button type="button" key={policy.id} aria-current={selected===policy.id?'page':undefined} aria-controls={id} onClick={()=>choose(policy.id)}><NavIcon size={18} aria-hidden="true"/><span>{policy.label}</span><ArrowRight className="app-policies-nav-arrow" size={16} aria-hidden="true"/></button>;})}</nav>
        <div ref={body} id={id} className="app-policies-scroll" role="region" aria-labelledby={`${id}-heading`}>
          <article className="app-policies-content" key={selected}>
            <div className="app-policies-title-icon" aria-hidden="true"><Icon size={26}/></div><p className="app-policies-category">{content.label}</p><h3 ref={heading} id={`${id}-heading`} tabIndex={-1}>{content.title}</h3><p className="app-policies-intro">{content.intro}</p>
            <ul className="app-policies-summary" aria-label="Key points">{content.summary.map(point=><li key={point}><Check size={16} aria-hidden="true"/>{point}</li>)}</ul>
            <div className="app-policies-sections">{content.sections.map(section=><section key={section.title}><h4>{section.title}</h4>{section.body}</section>)}</div>
            <footer className="app-policies-support"><span className="app-policies-support-icon" aria-hidden="true"><Mail size={20}/></span><div><strong>Need help with your situation?</strong><p>Keep your booking or payment reference handy.</p>{onContactSupport?<button type="button" onClick={onContactSupport}>Contact support <ArrowRight size={16} aria-hidden="true"/></button>:<a href="mailto:support@repaido.com">Email support@repaido.com <ArrowRight size={16} aria-hidden="true"/></a>}</div></footer>
          </article>
        </div>
      </div>
    </div>
  </Modal>;
}
