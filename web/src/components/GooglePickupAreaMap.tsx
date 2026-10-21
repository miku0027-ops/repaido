import {MapPin} from '../icons';
import {GoogleJourneyMap} from './GoogleJourneyMap';
import type {PublicCabArea} from '../hooks/usePublicCabAreas';
import type {TransportArea} from './TransportRail';

/** Only public approximate areas are shown before a booking is accepted. */
export default function GooglePickupAreaMap({area,departures,shared,onLocation,cabAreas=[],cabStatus}:{area?:TransportArea;departures:{id:string;origin?:{lat:number;lng:number}}[];shared:boolean;onLocation:()=>void;cabAreas?:PublicCabArea[];cabStatus?:'loading'|'ready'|'error'|'paused'}){
 const valid=area?.confirmed!==false&&Number.isFinite(area?.lat)&&Number.isFinite(area?.lng);
 const points=shared?departures.map(row=>row.origin).filter((point):point is {lat:number;lng:number}=>!!point&&Number.isFinite(point.lat)&&Number.isFinite(point.lng)):cabAreas.map(row=>row.position);
 const count=cabAreas.reduce((sum,row)=>sum+row.available_count,0);
 const note=!valid?'Choose your pickup to check local availability.':shared?'Pins show published meeting points, not live vehicles.':cabStatus==='ready'?count?`${count} ${count===1?'cab is':'cabs are'} sharing availability · approximate areas.`:'No drivers are sharing nearby right now. Search to check listed cabs.':cabStatus==='error'?'Live cab availability is temporarily unavailable. You can still check listed cabs.':cabStatus==='paused'?'Live availability pauses while you are away.':'Checking driver-shared availability…';
 return <div className="go-pickup-map">
  <GoogleJourneyMap origin={valid?{lat:area!.lat!,lng:area!.lng!}:undefined} nearby={points} nearbyLabel={shared?'Published shared meeting point':'Cab sharing availability · approximate area'} mapLabel="Repaido Go pickup map"/>
  <button type="button" className="go-map-pickup" onClick={onLocation}><MapPin size={17} aria-hidden="true"/>{valid?'Change pickup':'Set pickup'}</button>
  <p className="go-map-note" role="status">{note}</p>
 </div>;
}
