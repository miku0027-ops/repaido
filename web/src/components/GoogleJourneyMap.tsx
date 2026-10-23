import {useEffect,useRef,useState} from 'react';
import {loadGoogleMaps} from '../services/googleMaps';
import {MapPin} from '../icons';
import {goVehicleMapSvg,type GoVehicleKind} from './GoVehicleArt';
import {rideMapView} from '../services/rideMapView.mjs';
import './journey-tracking.css';
type Point={lat:number;lng:number};
export type RideCameraPhase='planning'|'searching'|'found'|'empty'|'assigned'|'arrived'|'in_progress';
export function GoogleJourneyMap({position,origin,destination,route=[],nearby=[],nearbyLabel='Available bike nearby · approximate location',positionLabel='Latest vehicle position',mapLabel='Journey map',onPick,rideScreen=false,vehicleKind='bike',cameraPhase}:{position?:Point|null;origin?:Point;destination?:Point;route?:Point[];nearby?:Point[];nearbyLabel?:string;positionLabel?:string;mapLabel?:string;onPick?:(point:Point)=>void;rideScreen?:boolean;vehicleKind?:GoVehicleKind;cameraPhase?:RideCameraPhase}){
 const element=useRef<HTMLDivElement>(null),map=useRef<any>(null),api=useRef<any>(null),overlays=useRef<any[]>([]),pick=useRef(onPick),fitted=useRef('');pick.current=onPick;
 const movingMarker=useRef<any>(null),shownPosition=useRef<Point|null>(null),frame=useRef<number>(0);
 const cameraFrame=useRef(0),cameraKey=useRef(''),lastView=useRef<{center:Point;zoom:number}|null>(null);
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;let click:any,drag:any;setError('');setReady(false);
  const authError=()=>setError('Google Maps authorization failed.');window.addEventListener('repaido:maps-auth-error',authError);
  void loadGoogleMaps().then(maps=>{if(!active||!element.current)return;api.current=maps;fitted.current='';cameraKey.current='';lastView.current=null;map.current=new maps.Map(element.current,{center:origin||{lat:21.4934,lng:86.9135},zoom:onPick?16:14,isFractionalZoomEnabled:true,maxZoom:19,fullscreenControl:!rideScreen,streetViewControl:false,mapTypeControl:false,gestureHandling:rideScreen?'greedy':'cooperative'});click=map.current.addListener('click',(event:any)=>{if(event.latLng)pick.current?.({lat:event.latLng.lat(),lng:event.latLng.lng()});});drag=map.current.addListener('dragstart',()=>cancelAnimationFrame(cameraFrame.current));setReady(true);}).catch(cause=>{if(active)setError(cause.message);});
  return()=>{active=false;click?.remove();drag?.remove();overlays.current.forEach(item=>item.setMap(null));overlays.current=[];cancelAnimationFrame(frame.current);cancelAnimationFrame(cameraFrame.current);movingMarker.current?.setMap(null);movingMarker.current=null;shownPosition.current=null;map.current=null;window.removeEventListener('repaido:maps-auth-error',authError);};
 },[attempt]);
 useEffect(()=>{if(!ready||!element.current)return;const observer=new ResizeObserver(()=>{if(map.current)api.current?.event?.trigger(map.current,'resize');});observer.observe(element.current);return()=>observer.disconnect();},[ready]);
 const pointsKey=JSON.stringify({origin,destination,route,nearby});
 useEffect(()=>{if(!ready||!map.current)return;const maps=api.current,m=map.current;overlays.current.forEach(item=>item.setMap(null));overlays.current=[];
  const pin=(point:Point,title:string,color:string,label?:string)=>{overlays.current.push(new maps.Marker({map:m,position:point,title,label:label?{text:label,color:'#fff',fontSize:'11px',fontWeight:'700'}:undefined,icon:{path:maps.SymbolPath.CIRCLE,scale:label?11:8,fillColor:color,fillOpacity:1,strokeColor:'#fff',strokeWeight:2}}));};
  if(origin)pin(origin,onPick?'Selected location':'Pickup','#15734b','P');if(destination)pin(destination,'Destination','#a84b15','D');
  const icon={url:'data:image/svg+xml,'+encodeURIComponent(goVehicleMapSvg(vehicleKind)),...(maps.Size?{scaledSize:new maps.Size(42,42)}:{}),...(maps.Point?{anchor:new maps.Point(21,21)}:{})};
  nearby.slice(0,30).forEach(point=>overlays.current.push(new maps.Marker({map:m,position:point,title:nearbyLabel,icon})));
  if(route.length)overlays.current.push(new maps.Polyline({map:m,path:route,strokeColor:'#202124',strokeOpacity:.9,strokeWeight:5}));
  if(!cameraPhase){const key=JSON.stringify({origin,destination,route});if(fitted.current!==key){fitted.current=key;const points=[origin,destination,...route].filter(Boolean) as Point[];if(points.length>1){const bounds=new maps.LatLngBounds();points.forEach(p=>bounds.extend(p));m.fitBounds(bounds,32);}else if(origin){if(m.panTo&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.documentElement.classList.contains('reduce-motion'))m.panTo(origin);else m.setCenter(origin);}}}
 },[ready,pointsKey,nearbyLabel,vehicleKind,cameraPhase]);
 // Camera transitions follow real lifecycle changes, never each GPS poll.
 // This keeps user panning intact while live vehicle markers continue moving.
 useEffect(()=>{
  if(!ready||!map.current||!element.current||!cameraPhase)return;
  const key=JSON.stringify({origin,destination,route,cameraPhase,hasPosition:!!position});
  if(cameraKey.current===key)return;
  cameraKey.current=key;
  cancelAnimationFrame(cameraFrame.current);
  const m=map.current,view=rideMapView({phase:cameraPhase,origin,destination,route,position,width:element.current.clientWidth,height:element.current.clientHeight});
  if(!view)return;
  const center=m.getCenter?.(),from={center:center?{lat:center.lat(),lng:center.lng()}:lastView.current?.center||origin||view.center,zoom:m.getZoom?.()??lastView.current?.zoom??14};
  const reduced=()=>document.hidden||matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.matches('.reduce-motion,[data-reduced-motion=true]');
  const apply=(next:{center:Point;zoom:number})=>{if(m.moveCamera)m.moveCamera(next);else{m.setCenter(next.center);m.setZoom?.(next.zoom);}lastView.current=next;};
  const started=performance.now();
  const longitudeDelta=((view.center.lng-from.center.lng+540)%360)-180;
  const move=(now:number)=>{const p=reduced()?1:Math.max(0,Math.min(1,(now-started)/650)),ease=1-Math.pow(1-p,3);apply(p===1?view:{center:{lat:from.center.lat+(view.center.lat-from.center.lat)*ease,lng:((from.center.lng+longitudeDelta*ease+540)%360)-180},zoom:from.zoom+(view.zoom-from.zoom)*ease});if(p<1)cameraFrame.current=requestAnimationFrame(move);};
  if(reduced())apply(view);else cameraFrame.current=requestAnimationFrame(move);
  return()=>cancelAnimationFrame(cameraFrame.current);
 },[ready,cameraPhase,JSON.stringify({origin,destination,route}),!!position]);
 // Interpolate between confirmed readings. Stale/removed GPS clears immediately;
 // no extrapolated position, camera recenter or extra location request is made.
 useEffect(()=>{
  cancelAnimationFrame(frame.current);
  if(!ready||!map.current)return;
  if(!position){movingMarker.current?.setMap(null);movingMarker.current=null;shownPosition.current=null;return;}
  const maps=api.current;
  if(!movingMarker.current||!movingMarker.current.setPosition){
   movingMarker.current?.setMap(null);
   movingMarker.current=new maps.Marker({map:map.current,position,title:positionLabel,label:{text:'R',color:'#202124',fontSize:'10px',fontWeight:'700'},icon:{url:'data:image/svg+xml,'+encodeURIComponent(goVehicleMapSvg(vehicleKind)),...(maps.Size?{scaledSize:new maps.Size(46,46)}:{}),...(maps.Point?{anchor:new maps.Point(23,23)}:{})}});
   shownPosition.current=position;return;
  }
  const marker=movingMarker.current,from=shownPosition.current||position,start=performance.now();
  marker.setTitle?.(positionLabel);
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.matches('.reduce-motion,[data-reduced-motion=true]');
  const move=(now:number)=>{
   const progress=reduced()?1:Math.max(0,Math.min(1,(now-start)/450)),ease=1-Math.pow(1-progress,3);
   const point=progress===1?position:{lat:from.lat+(position.lat-from.lat)*ease,lng:from.lng+(position.lng-from.lng)*ease};
   marker.setPosition(point);shownPosition.current=point;
   if(progress<1)frame.current=requestAnimationFrame(move);
  };
  if(reduced()){marker.setPosition(position);shownPosition.current=position;}else frame.current=requestAnimationFrame(move);
  return()=>cancelAnimationFrame(frame.current);
 },[ready,position?.lat,position?.lng,positionLabel,vehicleKind]);
 return <div className="journey-map google-journey-map" data-camera-phase={cameraPhase||'route'}><div ref={element} className="journey-leaflet" role="region" aria-label={mapLabel}/>{error&&<div className="journey-map-tile-error" role="status"><span>{error}</span><button type="button" onClick={()=>setAttempt(n=>n+1)}>Reload map</button></div>}{!ready&&!error&&<div className="bike-map-loading" role="status"><span className="ride-map-loading-pin" aria-hidden="true"><MapPin size={32}/></span><strong>Loading Google Maps…</strong><small>Your trip details remain available.</small></div>}</div>;
}
