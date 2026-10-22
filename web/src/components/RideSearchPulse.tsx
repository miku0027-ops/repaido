import {Users} from '../icons';
import {GoVehicleArt} from './GoVehicleArt';
import './ride-search-pulse.css';

/** A waiting state, never simulated rider supply or a time-to-match promise. */
export function RideSearchPulse({kind,title,description,compact=false}:{kind:'bike'|'cab'|'shared';title?:string;description?:string;compact?:boolean}){
 return <div className={'ride-search-pulse'+(compact?' is-compact':'')} data-kind={kind} role="status" aria-label={title||'Finding your ride'}>
  <span className="ride-search-rings" aria-hidden="true"><i/><i/><i/></span>
  <strong>{title||'Finding your ride'}</strong>
  <span className="ride-search-core" aria-hidden="true">{kind==='shared'?<Users size={54}/>:<GoVehicleArt kind={kind} size={80}/>}</span>
  <p>{description||'Waiting for an eligible rider to accept your request.'}</p>
 </div>;
}
