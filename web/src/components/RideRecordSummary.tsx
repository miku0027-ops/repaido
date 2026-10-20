import {CheckCircle2,ChevronDown,Headphones,MapPin,Flag,Car,TwoWheeler} from '../icons';
import {money} from '../services/operations';
import type {RideKind} from './RideWorkspace';
import './ride-record-summary.css';

export function RideRecordSummary({kind,id,name,status,at,pickup,dropoff,total}:{kind:RideKind;id:string;name?:string;status:string;at?:number;pickup?:string;dropoff?:string;total?:number}){
 const Icon=kind==='bike'?TwoWheeler:Car,completed=status==='completed';
 return <section className="ride-record-summary" aria-label="Ride details">
  <div className="ride-record-overview"><div><h3>{name||(kind==='bike'?'Bike ride':'Cab ride')}</h3>{at&&<p>{new Date(at*1000).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'})}</p>}{Number.isSafeInteger(total)&&<strong>{money(total!)}</strong>}</div><Icon size={42} aria-hidden="true"/><span className={'ride-record-badge'+(completed?' is-complete':'')}>{completed&&<CheckCircle2 size={18} aria-hidden="true"/>}{status.replaceAll('_',' ')}</span></div>
  <details open className="ride-record-addresses"><summary>Address details<ChevronDown size={20} aria-hidden="true"/></summary><p className="ride-record-reference">Ride ID <span>{id}</span></p><ol><li><MapPin size={22} aria-hidden="true"/><span><small>Pickup</small><strong>{pickup||'Pickup recorded privately'}</strong></span></li><li><Flag size={22} aria-hidden="true"/><span><small>Drop-off</small><strong>{dropoff||'Drop-off recorded privately'}</strong></span></li></ol></details>
  <a className="ride-record-help" href="/?section=support" target="_blank" rel="noopener noreferrer"><Headphones size={26} aria-hidden="true"/><span><strong>Need help?</strong><small>Contact Repaido about this ride</small></span><ChevronDown size={22} aria-hidden="true"/></a>
 </section>;
}
