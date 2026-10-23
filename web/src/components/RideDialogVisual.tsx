import {GoVehicleArt,type GoVehicleKind} from './GoVehicleArt';

/** A decorative route illustration, not a map or an availability indicator. */
export function RideDialogVisual({kind='cab'}:{kind?:GoVehicleKind}){
 return <span className="ride-dialog-visual" aria-hidden="true">
  <svg className="ride-dialog-route-art" viewBox="0 0 140 100" fill="none"><path d="M15 77h85a22 22 0 0 0 0-44H42a14 14 0 0 1 0-28h67" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" strokeDasharray="4 5"/><circle cx="15" cy="77" r="6" fill="currentColor"/><circle cx="109" cy="5" r="5" stroke="currentColor" strokeWidth="2"/><path d="M102 92h23M113 87h18" stroke="currentColor" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round"/></svg>
  <span className="ride-dialog-vehicle"><GoVehicleArt kind={kind} size={108}/></span>
 </span>;
}
