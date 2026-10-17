import {useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import {directionsCarSvg} from '../icons/map-icons';
import {MapPin,Minus,Navigation,Plus} from '../icons';
import 'leaflet/dist/leaflet.css';
import type {TransportArea} from './TransportRail';
import type {PublicCabArea} from '../hooks/usePublicCabAreas';

type Departure={id:string;origin?:{lat:number;lng:number};origin_address?:string};
const validPin=(pin?:{lat?:number;lng?:number})=>Number.isFinite(pin?.lat)&&Number.isFinite(pin?.lng)&&Math.abs(pin!.lat!)<=90&&Math.abs(pin!.lng!)<=180;

/** Public coarse availability and meeting points; private journey GPS stays separate. */
export default function PickupAreaMap({area,departures,radiusKm,shared,active,onLocation,cabAreas=[],cabStatus}:{area?:TransportArea;departures:Departure[];radiusKm:number;shared:boolean;active:boolean;onLocation:()=>void;cabAreas?:PublicCabArea[];cabStatus?:'loading'|'ready'|'error'|'paused'}){
 const element=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),[tileError,setTileError]=useState(false);
 const cabLayer=useRef<L.LayerGroup|null>(null);
 const valid=area?.confirmed!==false&&validPin(area);
 const origins=shared?departures.filter(row=>validPin(row.origin)):[];
 const originKey=JSON.stringify(origins.map(row=>[row.id,row.origin?.lat,row.origin?.lng,row.origin_address]));
 useEffect(()=>{
  if(!element.current||!valid||!active)return;
  setTileError(false);
  const m=L.map(element.current,{zoomControl:false,scrollWheelZoom:false,attributionControl:true,keyboard:false,inertia:false,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false});map.current=m;
  cabLayer.current=L.layerGroup().addTo(m);
  m.setView([area!.lat!,area!.lng!],13);
  const tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19}).addTo(m);
  const failed=()=>setTileError(true);tiles.on('tileerror',failed);
  L.circle([area!.lat!,area!.lng!],{radius:radiusKm*1000,color:'#245ec0',weight:1,dashArray:'4 6',fillColor:'#5186dc',fillOpacity:.045,interactive:false}).addTo(m);
  const pickup=L.divIcon({className:'mobility-map-pickup',html:'<span></span>',iconSize:[24,24],iconAnchor:[12,12]});
  L.marker([area!.lat!,area!.lng!],{icon:pickup,keyboard:false,interactive:false}).addTo(m).bindTooltip('Your pickup',{permanent:true,direction:'top',offset:[0,-15],className:'mobility-pickup-tooltip'});
  for(const row of origins){
   const label=document.createElement('span');label.textContent=row.origin_address||'Published shared pickup';
   L.circleMarker([row.origin!.lat,row.origin!.lng],{radius:7,color:'#fff',weight:2,fillColor:'#0b6048',fillOpacity:1}).addTo(m).bindTooltip(label);
  }
  if(origins.length)m.fitBounds(L.latLngBounds([[area!.lat!,area!.lng!],...origins.map(row=>[row.origin!.lat,row.origin!.lng] as [number,number])]),{padding:[45,65],maxZoom:13,animate:false});
  const resize=()=>m.invalidateSize();const observer=new ResizeObserver(resize);observer.observe(element.current);
  return()=>{observer.disconnect();tiles.off('tileerror',failed);m.remove();map.current=null;cabLayer.current=null;};
 },[valid,active,area?.lat,area?.lng,radiusKm,originKey]);
 useEffect(()=>{
  const layer=cabLayer.current;if(!layer)return;layer.clearLayers();
  if(!active||shared)return;
  for(const area of cabAreas){
   const icon=L.divIcon({className:'mobility-map-cab-area',iconSize:[38,34],iconAnchor:[19,17],html:`${directionsCarSvg}<span>${area.available_count>9?'9+':area.available_count}</span>`});
   const label=document.createElement('span');label.textContent=`${area.available_count} ${area.available_count===1?'cab':'cabs'} sharing availability · approximate area within ${area.approximation_metres} m`;
   const marker=L.marker([area.position.lat,area.position.lng],{icon,keyboard:false}).addTo(layer).bindTooltip(label);
   marker.getElement()?.setAttribute('aria-hidden','true');
  }
 },[cabAreas,active,shared,valid,area?.lat,area?.lng,radiusKm,originKey]);
 const cabCount=cabAreas.reduce((count,area)=>count+area.available_count,0);
 const availability=cabStatus==='paused'?'Live availability pauses while offline or away.':cabStatus==='error'?'Live availability is temporarily unavailable.':cabStatus==='loading'?'Checking driver-shared availability…':cabStatus==='ready'?cabCount?`${cabCount} ${cabCount===1?'cab':'cabs'} sharing · approximate areas. Search to review a quote.`:'No drivers are sharing nearby right now. You can still search the catalogue.':'';
 const panKeys:Record<string,[number,number]>={ArrowLeft:[-80,0],ArrowRight:[80,0],ArrowUp:[0,-80],ArrowDown:[0,80]};
 const keyboardMap=(event:React.KeyboardEvent<HTMLDivElement>)=>{const m=map.current;if(!m)return;if(panKeys[event.key]){event.preventDefault();m.panBy(panKeys[event.key],{animate:false});}else if(['+','=','-'].includes(event.key)){event.preventDefault();m.setZoom(m.getZoom()+(event.key==='-'?-1:1),{animate:false});}};
 return <div className="mobility-pickup-map" data-has-pickup={valid}>
  {valid?<><div ref={element} className="mobility-pickup-leaflet" tabIndex={0} onKeyDown={keyboardMap} role="region" aria-label={shared?'Pickup area and published shared meeting points':'Pickup area map'}/><div className="mobility-map-caption"><MapPin size={14} aria-hidden="true"/><span>{shared?'Shared pickup search':'Vehicle pickup search'} · {radiusKm} km</span></div><div className="mobility-map-controls"><button type="button" className="mobility-map-recenter" aria-label="Centre map on your pickup" onClick={()=>map.current?.setView([area!.lat!,area!.lng!],13,{animate:false})}><Navigation size={18} aria-hidden="true"/></button><button type="button" className="mobility-map-zoom" aria-label="Zoom pickup map in" onClick={()=>map.current?.zoomIn(1,{animate:false})}><Plus size={18} aria-hidden="true"/></button><button type="button" className="mobility-map-zoom" aria-label="Zoom pickup map out" onClick={()=>map.current?.zoomOut(1,{animate:false})}><Minus size={18} aria-hidden="true"/></button></div><p className="mobility-map-legend" role="status">{tileError?'Street map unavailable. Your selected pickup is saved.':shared?'Green pins are published meeting points, not live vehicles.':availability||'Your pickup area. Live tracking opens inside your booked ride.'}</p></>:<div className="mobility-map-introduction"><span className="mobility-map-empty-pin" aria-hidden="true"><MapPin size={28}/></span><small>REPAIDO MOVE</small><h3>Your journey starts here.</h3><p>Choose a pickup area to explore nearby rides.</p><button type="button" onClick={onLocation}>Choose pickup area<Navigation size={16} aria-hidden="true"/></button></div>}
 {tileError&&cabStatus&&<p className="sr-only" role="status">{availability}</p>}</div>;
}
