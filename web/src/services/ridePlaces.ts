import {loadGoogleMaps} from './googleMaps';
import type {BusinessLocation} from './localBusiness';
import {createPlaceRequestQueue} from './placeRequestQueue.mjs';

export type PlaceSuggestion={id:string;title:string;description:string;distance?:number;prediction:any};
export type RidePlace=BusinessLocation&{name?:string;postalCode?:string};
type Point={lat:number;lng:number};
const requests=createPlaceRequestQueue();
let placesLibrary:Promise<any>|undefined;
const postalCode=(parts:any[]=[])=>{const part=parts.find(p=>p.types?.includes('postal_code'));return part?.longText||part?.long_name||'';};
const locality=(parts:any[]=[])=>{
 for(const type of ['locality','postal_town','administrative_area_level_3','administrative_area_level_2']){
  const part=parts.find(p=>p.types?.includes(type));if(part)return part.longText||part.long_name||'';
 }
 return '';
};
const coordinates=(location:any):Point=>{
 const lat=typeof location?.lat==='function'?location.lat():location?.lat,lng=typeof location?.lng==='function'?location.lng():location?.lng;
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)throw Error('This place has no usable map pin. Choose a point on the map.');
 return {lat,lng};
};

/** One token per search-to-selection session; details are fetched only on selection.
 * Google ranks text relevance with a nearby bias; a distant exact match is not
 * silently replaced by the nearest road or city centre. Nothing is persisted. */
export async function createRidePlaceSession(){
 placesLibrary??=loadGoogleMaps().then(maps=>maps.importLibrary('places')).catch(error=>{placesLibrary=undefined;throw error;});
 const places=await placesLibrary;
 return {places,token:new places.AutocompleteSessionToken()};
}
export async function suggestRidePlaces(session:Awaited<ReturnType<typeof createRidePlaceSession>>,input:string,origin:Point,signal?:AbortSignal):Promise<PlaceSuggestion[]>{
 if(input.trim().length<2)return [];
 const {suggestions}=await requests.run<any>(()=>session.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({input:input.trim().slice(0,160),sessionToken:session.token,origin,locationBias:{center:origin,radius:30000},region:'in',language:'en'}),{signal});
 return suggestions.filter((s:any)=>s.placePrediction).slice(0,5).map(({placePrediction:p}:any)=>({id:p.placeId,title:p.mainText?.text||p.text.text,description:p.secondaryText?.text||'',distance:p.distanceMeters,prediction:p}));
}
export async function resolveRidePlace(suggestion:PlaceSuggestion,signal?:AbortSignal):Promise<RidePlace>{
 const place=suggestion.prediction.toPlace();
 await requests.run(()=>place.fetchFields({fields:['location','formattedAddress','addressComponents','displayName']}),{signal,kind:'selection'});
 const address=place.formattedAddress||suggestion.description;
 return {...coordinates(place.location),name:place.displayName||suggestion.title,address:address.toLowerCase().startsWith(suggestion.title.toLowerCase())?address:`${suggestion.title}, ${address}`,city:locality(place.addressComponents),postalCode:postalCode(place.addressComponents)};
}
export async function addressForRidePin(point:Point,signal?:AbortSignal):Promise<RidePlace>{
 const maps=await loadGoogleMaps();await maps.importLibrary('geocoding');
 const {results}=await requests.run<any>(()=>new maps.Geocoder().geocode({location:point}),{signal,kind:'selection'});
 const result=results?.[0];if(!result?.formatted_address)throw Error('Add a nearby landmark for this pin.');
 // Keep the user's/GPS point, never snap it to the geocoder's street centroid.
 return {...coordinates(point),address:result.formatted_address,city:locality(result.address_components),postalCode:postalCode(result.address_components)};
}
