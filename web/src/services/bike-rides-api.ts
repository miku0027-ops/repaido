import {apiFetch} from './api';
import {operation} from './operations';

export type BikePoint={lat:number;lng:number};
export type BikeAvailability={code:'available'|'service_not_enabled'|'dispatch_unavailable'|'service_area_unavailable'|'routing_unavailable'|'paid_rides_unavailable'|'operations_unavailable';message:string;retryable:boolean};
export type BikePolicy={availability?:BikeAvailability;enabled:boolean;bookings_available:boolean;dispatch_ready?:boolean;promo_enabled:boolean;service_radius_metres:number;free_distance_metres:number;weekly_free_limit:number;promo_months:number;paid_ready:boolean;promo_ready:boolean;routing_ready:boolean;arrival_radius_metres:number;version:number;payment_method?:string;surcharge_cap_bps?:number;promo_ends_at?:number};
export type BikePricing={surcharge_bps?:number;total_paise?:number;customer_total_paise:number;free:boolean};
export type BikeQuote={id:string;vehicle_id:string;vehicle_name:string;rider_name:string;pickup_eta_seconds:number;queued:boolean;available_at:number;distance_metres:number;route_duration_seconds:number;total_eta_seconds?:number;pricing:BikePricing;expires_at:number;terms?:string;cancellation_terms?:string};
export type BikePromotion={eligible:boolean;remaining:number;next_eligible_at?:number;reason:string;message?:string};
export type BikeSearch={availability?:BikeAvailability;quotes:BikeQuote[];promotion:BikePromotion;server_time:number;reason?:string;route?:{points:BikePoint[]}};
export type BikeStop={status?:string;distance_metres?:number|null;valid_until?:number};
export type BikeRide={id:string;request_id?:string;quote_id?:string;state:string;version:number;vehicle_name:string;rider_name:string;passenger_name:string;for_someone_else:boolean;pickup:BikePoint;dropoff:BikePoint;pickup_address:string;dropoff_address:string;pricing:BikePricing;otp?:string;position?:BikePoint&{received_at:number;accuracy?:number};stop_status?:{pickup?:BikeStop;destination?:BikeStop};pickup_eta_seconds?:number;available_at:number;queued:boolean;created_at:number;updated_at:number;expires_at?:number;server_time?:number;allowed_actions?:string[];blockers?:string[];rider_phone?:string;payment_method?:string;failure_reason?:string;failure_message?:string;route?:{points:BikePoint[]};terms?:string;cancellation_terms?:string};
export type BikeBookingInput={quote_id:string;request_id:string;pickup_address:string;dropoff_address:string;rider_name:string;rider_phone:string;for_someone_else:boolean;consent:true};
const quiet={background:true,feedback:false,force:true} as const;

export async function bikePolicy(signal?:AbortSignal):Promise<BikePolicy>{
 const response=await apiFetch('/api/operations/bike-rides/policy',{signal},{background:true,feedback:false});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(body.detail?.message||'Bike rides could not load. Try again.');
 return body;
}
export const searchBikes=(pickup:BikePoint,dropoff:BikePoint,signal?:AbortSignal)=>operation<BikeSearch>('/bike-rides/search',{method:'POST',body:JSON.stringify({pickup:{lat:pickup.lat,lng:pickup.lng},dropoff:{lat:dropoff.lat,lng:dropoff.lng}}),signal},quiet);
export type BikeRidePage={rides:BikeRide[];server_time?:number;next_cursor?:string|null};
export const getBikeRides=(signal?:AbortSignal,after?:string)=>operation<BikeRidePage>('/bike-rides/bookings'+(after?'?after='+encodeURIComponent(after):''),{signal},quiet);
export const getBikeRide=(id:string,signal?:AbortSignal)=>operation<BikeRide>('/bike-rides/bookings/'+encodeURIComponent(id),{signal},quiet);

// Retrying an uncertain response must reuse the caller's request ID. A saved
// receipt is checked before offering another attempt; absence is not success.
export async function bookBike(input:BikeBookingInput):Promise<BikeRide>{
 try{return await operation<BikeRide>('/bike-rides/bookings',{method:'POST',body:JSON.stringify(input)},quiet);}
 catch(error){
  if((error as {status?:number}).status&&(error as {status:number}).status<500)throw error;
  try{const result=await getBikeRides();const receipt=result.rides.find(ride=>ride.request_id===input.request_id);if(receipt)return receipt;}catch{/* Preserve uncertainty and the original request key. */}
  throw error;
 }
}
export const bikeCommand=(ride:BikeRide,action:string,commandId:string,note?:string)=>operation<BikeRide>('/bike-rides/bookings/'+encodeURIComponent(ride.id)+'/commands',{method:'POST',body:JSON.stringify({command_id:commandId,expected_version:ride.version,action,...(note?{note}:{})})},quiet);

export function bikeQuoteExpired(quote:BikeQuote,serverTime:number){return !Number.isFinite(quote.expires_at)||quote.expires_at<=serverTime;}
export function bikeFreshPosition(ride:BikeRide,serverTime:number){const point=ride.position;return point&&Number.isFinite(point.lat)&&Number.isFinite(point.lng)&&Math.abs(point.lat)<=90&&Math.abs(point.lng)<=180&&Number.isFinite(point.received_at)&&serverTime-point.received_at>=-5&&serverTime-point.received_at<=75?point:null;}
export const bikeFinished=(state:string)=>['completed','cancelled','declined','expired','unavailable'].includes(state);
export const bikeRideLabel=(state:string)=>({dispatch_pending:'Finding your rider',unavailable:'No ride reserved',offered:'Waiting for rider',queued:'Next ride requested',accepted:'Rider confirmed',en_route:'Rider on the way',on_the_way:'Rider on the way',arrived:'Rider at pickup',in_progress:'On your way',completion_pending:'Review your arrival',payment_due:'Fare payment',payment_reported:'Awaiting rider receipt',completed:'Ride complete',cancelled:'Ride cancelled',declined:'Rider unavailable',expired:'Request expired',disputed:'Support review'}[state]||state.replaceAll('_',' '));

export function bikeStopInside(ride:BikeRide,stop:'pickup'|'destination',serverTime:number){const value=ride.stop_status?.[stop];return !!bikeFreshPosition(ride,serverTime)&&value?.status==='inside'&&typeof value.valid_until==='number'&&Number.isFinite(value.valid_until)&&value.valid_until>=serverTime;}

export function saveBikeSnapshot(rows:BikeRide[],next:BikeRide){const current=rows.find(ride=>ride.id===next.id);return current&&current.version>next.version?rows:[next,...rows.filter(ride=>ride.id!==next.id)];}

export function mergeBikeSnapshots(previous:BikeRide[],incoming:BikeRide[]){const rows=new Map(previous.map(ride=>[ride.id,ride]));for(const ride of incoming){const prior=rows.get(ride.id);if(!prior||prior.version<=ride.version)rows.set(ride.id,ride);}return [...rows.values()].sort((a,b)=>(b.created_at||0)-(a.created_at||0)||a.id.localeCompare(b.id));}
