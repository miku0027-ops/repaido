import {loadGoogleMaps} from './googleMaps';
import type {BusinessLocation} from './localBusiness';

export type PlaceSuggestion={id:string;title:string;description:string;distance?:number;prediction:any};
export type RidePlace=BusinessLocation&{name?:string};
type Point={lat:number;lng:number};
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

/** One token per search-to-selection session. Only selected place fields are billed.
 * Google ranks text relevance with a nearby bias; a distant exact match is not
 * silently replaced by the nearest road or city centre. Nothing is persisted. */
export async function createRidePlaceSession(){
 const maps=await loadGoogleMaps(),places=await maps.importLibrary('places');
 return {places,token:new places.AutocompleteSessionToken()};
}
export async function suggestRidePlaces(session:Awaited<ReturnType<typeof createRidePlaceSession>>,input:string,origin:Point):Promise<PlaceSuggestion[]>{
 const {suggestions}=await session.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({input,sessionToken:session.token,origin,locationBias:{center:origin,radius:30000},region:'in',language:'en'});
 return suggestions.filter((s:any)=>s.placePrediction).slice(0,5).map(({placePrediction:p}:any)=>({id:p.placeId,title:p.mainText?.text||p.text.text,description:p.secondaryText?.text||'',distance:p.distanceMeters,prediction:p}));
}
export async function resolveRidePlace(suggestion:PlaceSuggestion):Promise<RidePlace>{
 const place=suggestion.prediction.toPlace();
 await place.fetchFields({fields:['location','formattedAddress','addressComponents','displayName']});
 const address=place.formattedAddress||suggestion.description;
 return {...coordinates(place.location),name:place.displayName||suggestion.title,address:address.toLowerCase().startsWith(suggestion.title.toLowerCase())?address:`${suggestion.title}, ${address}`,city:locality(place.addressComponents)};
}
export async function addressForRidePin(point:Point):Promise<RidePlace>{
 const maps=await loadGoogleMaps();await maps.importLibrary('geocoding');
 const {results}=await new maps.Geocoder().geocode({location:point});
 const result=results?.[0];if(!result?.formatted_address)throw Error('Add a nearby landmark for this pin.');
 // Keep the user's/GPS point, never snap it to the geocoder's street centroid.
 return {...coordinates(point),address:result.formatted_address,city:locality(result.address_components)};
}
