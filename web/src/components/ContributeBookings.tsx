import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Car,Leaf,Plus,Recycle,HomeRepair,PersonSearch,ReceiptLong,Flag,Redeem,LocalShipping,EventAvailable} from '../icons';
import {BusinessRecords,useBusinessRecords} from './LocalBusiness';
import {CleanupWorkspace} from './CleanupWorkspace';
import {CaptainClub} from './CaptainClub';
import './customer-management.css';
export type BookingService='visits'|'home'|'hiring'|'contracts'|'rides'|'contribute';
const services=[{id:'visits',label:'Visits',Icon:HomeRepair},{id:'home',label:'Home plans',Icon:EventAvailable},{id:'hiring',label:'Hiring',Icon:PersonSearch},{id:'contracts',label:'Contracts',Icon:ReceiptLong},{id:'rides',label:'Rides',Icon:Car},{id:'contribute',label:'Contribute',Icon:Leaf}] as const;
function revealBookingService(container:HTMLDivElement,item:HTMLElement|null){
 if(!item)return;const parent=container.getBoundingClientRect(),child=item.getBoundingClientRect();if(child.left<parent.left+5)container.scrollBy({left:child.left-parent.left-5,behavior:'instant'});else if(child.right>parent.right-5)container.scrollBy({left:child.right-parent.right+5,behavior:'instant'});
}
export function CustomerBookingNavigation({value,onChange}:{value:BookingService;onChange:(value:BookingService)=>void}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const el=ref.current;if(!el)return;const ensure=()=>revealBookingService(el,el.querySelector<HTMLElement>('[aria-pressed=true]'));ensure();const resize=new ResizeObserver(ensure);resize.observe(el);el.querySelectorAll('button').forEach(button=>resize.observe(button));return()=>resize.disconnect();},[value]);
 return <div ref={ref} className="customer-home-plans-switch customer-booking-navigation" role="group" aria-label="Booking service type" onFocusCapture={event=>revealBookingService(event.currentTarget,(event.target as HTMLElement).closest('button'))}>{services.map(({id,label,Icon})=><button type="button" key={id} aria-pressed={value===id} data-service={id} onClick={()=>onChange(id)}><Icon size={20} aria-hidden="true"/><span className="booking-navigation-label">{label}</span></button>)}</div>;
}
export function ContributeBookings({onSignIn,onArrangePickup}:{onSignIn:()=>void;onArrangePickup:()=>void}){
 const [tab,setTab]=useState(()=>{const value=new URLSearchParams(location.search).get('contribution');return value==='reports'||value==='rewards'?value:'collections';});
 return <section className="contribution-bookings" aria-label="Your contributions"><header className="contribution-heading"><div><span><Leaf size={14} aria-hidden="true"/>REPAIDO · CONTRIBUTE</span><h2>Your efforts. Real impact.</h2><p>Follow pickups, cleanup reports and your rewards.</p></div><button type="button" onClick={onArrangePickup}><Plus size={16} aria-hidden="true"/>Arrange pickup</button></header><div className="contribution-tabs" role="group" aria-label="Contribution records">{[{id:'collections',label:'Pickups',Icon:LocalShipping},{id:'reports',label:'Reports',Icon:Flag},{id:'rewards',label:'Points & rewards',Icon:Redeem}].map(({id,label,Icon})=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>setTab(id)}><Icon size={20} aria-hidden="true"/>{label}</button>)}</div>{tab==='collections'?<><div className="contribution-lifecycle-note"><Recycle size={18} aria-hidden="true"/><span>Collection, weighed quote, payment and evidence — one record.</span></div><CustomerCollections onSignIn={onSignIn}/></>:tab==='reports'?<CleanupWorkspace mode="customer" onSignIn={onSignIn}/>:<CaptainClub onSignIn={onSignIn}/>}<details className="contribution-guide"><summary>What counts as a contribution?<ArrowRight size={14} aria-hidden="true"/></summary><p>Scrap points follow your confirmed payment receipt. Cleanup points follow independent verification. Your records keep the evidence and payment status together.</p></details></section>;
}
function CustomerCollections({onSignIn}:{onSignIn:()=>void}){const records=useBusinessRecords('scrap');return <BusinessRecords kind="scrap" records={records} onSignIn={onSignIn} heading="Your scrap collections" initialRecordId={new URLSearchParams(location.search).get('scrap-collection')||''}/>;}
