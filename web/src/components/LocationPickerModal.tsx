import {useEffect,useId,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {Modal} from './ui';
import {currentPosition} from '../services/operations';
import './operations.css';

interface Props {
  isOpen:boolean;onClose:()=>void;initialLat?:number;initialLng?:number;title?:string;subtitle?:string;areaOnly?:boolean;confirmLabel?:string;
  addressRequired?:boolean;initialAddress?:string;initialCity?:string;
  onConfirmLocation:(location:{lat:number;lng:number;address:string;city:string})=>void;
}
export function LocationPickerModal({isOpen,onClose,areaOnly=false,addressRequired=false,initialAddress='',initialCity='',confirmLabel,initialLat=21.4934,initialLng=86.9135,title='Confirm service location',subtitle='Tap the map, move the pin, or enter coordinates below.',onConfirmLocation}:Props) {
  const container=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),marker=useRef<L.Marker|null>(null);
  const [lat,setLat]=useState(initialLat),[lng,setLng]=useState(initialLng),[address,setAddress]=useState(initialAddress),[city,setCity]=useState(initialCity);
  const [chosen,setChosen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [attempted,setAttempted]=useState(false),addressInput=useRef<HTMLInputElement>(null),cityInput=useRef<HTMLInputElement>(null),fieldId=useId();
  const needsAddress=addressRequired&&!areaOnly;
  const addressError=needsAddress&&address.trim().length<10?'Add your house or building and street address (at least 10 characters).':'';
  const cityError=needsAddress&&city.trim().length<2?'Enter your city (at least 2 characters).':'';
  const confirm=()=>{
    setAttempted(true);
    if(addressError||cityError){(addressError?addressInput:cityInput).current?.focus();return;}
    onConfirmLocation({lat,lng,address:address.trim(),city:city.trim()});onClose();
  };
  const move=(latitude:number,longitude:number)=>{setLat(latitude);setLng(longitude);setChosen(true);marker.current?.setLatLng([latitude,longitude]);map.current?.panTo([latitude,longitude]);};
  useEffect(()=>{
    if(!isOpen||!container.current)return;
    const instance=L.map(container.current,{center:[initialLat,initialLng],zoom:16});map.current=instance;
    const tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(instance);
    tiles.on('tileerror',()=>setError('Map tiles could not load. Use current location or enter coordinates; your address stays editable.'));
    const icon=L.divIcon({className:'',html:'<span style="display:block;width:24px;height:24px;border:4px solid white;border-radius:50%;background:#123a84;outline:2px solid #123a84"></span>',iconSize:[24,24],iconAnchor:[12,12]});
    const pin=L.marker([initialLat,initialLng],{draggable:true,icon,alt:'Selected service location',title:'Selected service location',keyboard:true}).addTo(instance);marker.current=pin;
    pin.on('dragend',()=>{const p=pin.getLatLng();move(p.lat,p.lng);});instance.on('click',(e:L.LeafletMouseEvent)=>move(e.latlng.lat,e.latlng.lng));
    const id=setTimeout(()=>instance.invalidateSize(),100);
    return()=>{clearTimeout(id);instance.remove();map.current=null;marker.current=null;};
  },[isOpen,initialLat,initialLng]);
  if(!isOpen)return null;
  return <Modal title={title} onClose={onClose}><div className="operations"><p>{subtitle}</p><p className="ops-help">{areaOnly?'Choose the centre of your nearby search. This does not set a booking address.':'This map does not look up addresses. Enter the house, street and city yourself; confirm the pin at the entrance.'}</p>
    <div ref={container} role="region" aria-label="Service location map" style={{height:240,width:'100%',borderRadius:12,overflow:'hidden'}}/>
    <button type="button" disabled={busy} className="ops-secondary" onClick={async()=>{setBusy(true);try{const p=await currentPosition(true);move(p.lat,p.lng);setError(`GPS accuracy: about ${Math.round(p.accuracy)} metres. Check the pin before confirming.`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{busy?'Finding your location…':'Use my current location'}</button>
    <div className="ops-grid"><label>Latitude<input type="number" step="any" min={-90} max={90} value={lat} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&Math.abs(n)<=90)move(n,lng);}}/></label><label>Longitude<input type="number" step="any" min={-180} max={180} value={lng} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&Math.abs(n)<=180)move(lat,n);}}/></label></div>
    {!areaOnly&&<>
      <div><label>House, street and landmark<input ref={addressInput} value={address} onChange={e=>setAddress(e.target.value)} autoComplete="street-address" required={needsAddress} minLength={needsAddress?10:undefined} maxLength={needsAddress?500:undefined} aria-invalid={attempted&&!!addressError} aria-describedby={needsAddress?fieldId+'-address':undefined}/></label>{needsAddress&&<small id={fieldId+'-address'} role={attempted&&addressError?'alert':undefined}>{attempted&&addressError||'Required. Include your house or building and street (at least 10 characters).'}</small>}</div>
      <div><label>City<input ref={cityInput} value={city} onChange={e=>setCity(e.target.value)} autoComplete="address-level2" required={needsAddress} minLength={needsAddress?2:undefined} maxLength={needsAddress?80:undefined} aria-invalid={attempted&&!!cityError} aria-describedby={needsAddress?fieldId+'-city':undefined}/></label>{needsAddress&&<small id={fieldId+'-city'} role={attempted&&cityError?'alert':undefined}>{attempted&&cityError||'Required. Enter the city where your business is based.'}</small>}</div>
    </>}
    <label className="ops-check"><input type="checkbox" checked={chosen} onChange={e=>setChosen(e.target.checked)}/>{areaOnly?'Search around this selected point.':'I have checked that this pin marks my service entrance.'}</label>
    {error&&<p role="status" className="ops-notice">{error}</p>}<button type="button" className="ops-primary" disabled={!chosen} onClick={confirm}>{confirmLabel||(areaOnly?'Find nearby professionals':'Confirm this location')}</button>
  </div></Modal>;
}
