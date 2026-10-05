import {useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
export default function PickupMap({position}:{position:{lat:number;lng:number;accuracy:number}}){
 const host=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),marker=useRef<L.Circle|null>(null);const [error,setError]=useState(false);
 useEffect(()=>{if(!host.current)return;const instance=L.map(host.current,{scrollWheelZoom:false}).setView([position.lat,position.lng],16);map.current=instance;
 const tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(instance);tiles.on('tileerror',()=>setError(true));
 marker.current=L.circle([position.lat,position.lng],{radius:Math.max(5,position.accuracy),color:'#102345',fillColor:'#0052ff',fillOpacity:.4,weight:3}).addTo(instance).bindTooltip('Assigned agent · GPS accuracy area');return()=>{instance.remove();map.current=null;marker.current=null;};},[]);
 useEffect(()=>{marker.current?.setLatLng([position.lat,position.lng]).setRadius(Math.max(5,position.accuracy));},[position.lat,position.lng,position.accuracy]);
 return <div><div ref={host} role="region" aria-label="Live pickup map. Agent coordinates and accuracy are also shown as text." style={{height:280,width:'100%',borderRadius:12,position:'relative',zIndex:0}}/><button onClick={()=>map.current?.panTo([position.lat,position.lng])}>Centre on agent</button>{error&&<p role="status">Map tiles are unavailable. Use the coordinates above or retry the map later.</p>}</div>;
}
