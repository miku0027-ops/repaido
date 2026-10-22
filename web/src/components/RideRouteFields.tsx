import {ArrowDownUp,ChevronDown,Flag,MapPin} from '../icons';
import type {BusinessLocation} from '../services/localBusiness';

/** The same compact, accessible route composer for quick Bike and Cab. */
export function RideRouteFields({pickup,dropoff,onPick,onSwap,kind='bike',disabled=false}:{pickup:BusinessLocation|null;dropoff:BusinessLocation|null;onPick:(stop:'pickup'|'dropoff')=>void;onSwap:()=>void;kind?:string;disabled?:boolean}){
 return <div className="bike-route-fields">
  <button type="button" className="bike-location" disabled={disabled} onClick={()=>onPick('pickup')}><MapPin size={20} aria-hidden="true"/><span><small>Pickup</small><strong>{pickup?.address||'Set pickup on map'}</strong></span></button>
  <button type="button" className="bike-route-swap" aria-label={`Swap ${kind} pickup and drop-off`} disabled={disabled||!pickup||!dropoff} onClick={onSwap}><ArrowDownUp size={20} aria-hidden="true"/></button>
  <button type="button" className="bike-location bike-location-dropoff" disabled={disabled} onClick={()=>onPick('dropoff')}><Flag size={20} aria-hidden="true"/><span><small>Drop-off</small><strong>{dropoff?.address||'Where to?'}</strong></span><ChevronDown size={18} aria-hidden="true"/></button>
 </div>;
}
