import {useEffect,useId,useRef,useState} from 'react';
import {PlaceSearch} from './PlaceSearch';
import {addressForRidePin} from '../services/ridePlaces';
import {GoogleJourneyMap} from './GoogleJourneyMap';
import {Modal} from './ui';
import {currentPosition} from '../services/operations';
import './operations.css';

interface Props {
  isOpen:boolean;onClose:()=>void;initialLat?:number;initialLng?:number;title?:string;subtitle?:string;areaOnly?:boolean;confirmLabel?:string;className?:string;
  publicPlace?:boolean;addressRequired?:boolean;initialAddress?:string;initialCity?:string;
  helpText?:string;pinConfirmationLabel?:string;locationLabel?:string;
  onConfirmLocation:(location:{lat:number;lng:number;address:string;city:string})=>void;
}
export function LocationPickerModal({isOpen,onClose,areaOnly=false,publicPlace=false,addressRequired=false,initialAddress='',initialCity='',confirmLabel,helpText,pinConfirmationLabel,locationLabel='service location',initialLat=21.4934,initialLng=86.9135,title='Confirm service location',subtitle='Search for a place, then check the pin at the entrance.',onConfirmLocation,className}:Props) {
  const [lat,setLat]=useState(initialLat),[lng,setLng]=useState(initialLng),[address,setAddress]=useState(initialAddress),[city,setCity]=useState(initialCity);
  const [searchPending,setSearchPending]=useState(false),[searchReset,setSearchReset]=useState(0);
  const reverse=useRef<AbortController|null>(null);
  const [chosen,setChosen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [attempted,setAttempted]=useState(false),addressInput=useRef<HTMLInputElement>(null),cityInput=useRef<HTMLInputElement>(null),fieldId=useId();
  const session=useRef(0),locationRequest=useRef(0);
  const needsAddress=addressRequired&&!areaOnly;
  const addressError=needsAddress&&address.trim().length<10?(publicPlace?'Add the street and a nearby landmark (at least 10 characters).':'Add your house or building and street address (at least 10 characters).'):'';
  const cityError=needsAddress&&city.trim().length<2?'Enter your city (at least 2 characters).':'';
  const confirm=()=>{
    if(busy||searchPending||!chosen)return;
    setAttempted(true);
    if(addressError||cityError){(addressError?addressInput:cityInput).current?.focus();return;}
    onConfirmLocation({lat,lng,address:address.trim(),city:city.trim()});onClose();
  };
  const cancelLookup=()=>{locationRequest.current++;reverse.current?.abort();setBusy(false);};
  const move=(latitude:number,longitude:number)=>{
    cancelLookup();setSearchReset(value=>value+1);setSearchPending(false);setLat(latitude);setLng(longitude);setChosen(true);
  };
  const resolvePin=async(latitude:number,longitude:number,accuracy?:number)=>{
    move(latitude,longitude);setAddress('');setCity('');setBusy(true);setError('');
    const request=locationRequest.current,revision=session.current,controller=new AbortController();reverse.current=controller;
    try{const value=await addressForRidePin({lat:latitude,lng:longitude},controller.signal);
      if(request===locationRequest.current&&revision===session.current){setAddress(value.address);setCity(value.city);}
    }catch{if(request===locationRequest.current&&revision===session.current)setError('Pin selected. Add the address below if the place name is unavailable.');}
    finally{if(request===locationRequest.current&&revision===session.current){setBusy(false);if(accuracy!==undefined)setError(`GPS accuracy: about ${Math.round(accuracy)} metres. Check the pin before confirming.`);}}
  };
  const locate=async()=>{
    cancelLookup();setSearchReset(value=>value+1);setSearchPending(false);
    const revision=session.current,request=locationRequest.current;
    const current=()=>session.current===revision&&locationRequest.current===request;
    setBusy(true);setError('');
    try{const p=await currentPosition(true);if(current())await resolvePin(p.lat,p.lng,p.accuracy);}
    catch(e){if(current()){setError((e as Error).message);setBusy(false);}}
  };
  useEffect(()=>{
    if(!isOpen)return;
    session.current++;locationRequest.current++;reverse.current?.abort();setSearchReset(value=>value+1);setSearchPending(false);
    // The picker can stay mounted between openings. Its controls and map must
    // begin from the same supplied point, with fresh explicit confirmation.
    setLat(initialLat);setLng(initialLng);setAddress(initialAddress);setCity(initialCity);setChosen(false);setError('');setBusy(false);setAttempted(false);
    return()=>{session.current++;locationRequest.current++;reverse.current?.abort();};
  },[isOpen,initialLat,initialLng,initialAddress,initialCity,locationLabel]);
  if(!isOpen)return null;
  return <Modal title={title} className={className} onClose={onClose}><div className="operations"><p>{subtitle}</p><p className="ops-help">{helpText||(areaOnly?'Choose the centre of your nearby search. This does not set a booking address.':publicPlace?'Search for the public spot and check its exact pin.':'Choose a suggestion to fill the address. Add your house or flat number and check the entrance pin.')}</p>
    <PlaceSearch key={searchReset} near={{lat,lng}} onPending={setSearchPending} onInteraction={()=>{cancelLookup();setChosen(false);}} onSelect={value=>{cancelLookup();setLat(value.lat);setLng(value.lng);setAddress(value.address);setCity(value.city);setChosen(false);setError('Check the entrance pin, then confirm below.');}}/>
    <div style={{height:240}}><GoogleJourneyMap origin={{lat,lng}} onPick={point=>void resolvePin(point.lat,point.lng)} showLocate locationControl={{onLocate:()=>void locate(),busy,disabled:busy}} mapLabel={`${locationLabel} map`}/></div>
    <button type="button" disabled={busy} className="ops-secondary" onClick={()=>void locate()}>{busy?'Finding your location…':'Use my current location'}</button>
    <details><summary>Coordinates · advanced</summary><div className="ops-grid"><label>Latitude<input type="number" step="any" min={-90} max={90} value={lat} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&Math.abs(n)<=90)move(n,lng);}}/></label><label>Longitude<input type="number" step="any" min={-180} max={180} value={lng} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&Math.abs(n)<=180)move(lat,n);}}/></label></div></details>
    {!areaOnly&&<>
      <div><label>{publicPlace?'Street and public landmark':'House, street and landmark'}<input ref={addressInput} value={address} onChange={e=>{cancelLookup();setSearchReset(value=>value+1);setSearchPending(false);setAddress(e.target.value);}} autoComplete="street-address" required={needsAddress} minLength={needsAddress?10:undefined} maxLength={needsAddress?500:undefined} aria-invalid={attempted&&!!addressError} aria-describedby={needsAddress?fieldId+'-address':undefined}/></label>{needsAddress&&<small id={fieldId+'-address'} role={attempted&&addressError?'alert':undefined}>{attempted&&addressError||(publicPlace?'Required. Add the street and a public landmark (at least 10 characters).':'Required. Include your house or building and street (at least 10 characters).')}</small>}</div>
      <div><label>City<input ref={cityInput} value={city} onChange={e=>{cancelLookup();setSearchReset(value=>value+1);setSearchPending(false);setCity(e.target.value);}} autoComplete="address-level2" required={needsAddress} minLength={needsAddress?2:undefined} maxLength={needsAddress?80:undefined} aria-invalid={attempted&&!!cityError} aria-describedby={needsAddress?fieldId+'-city':undefined}/></label>{needsAddress&&<small id={fieldId+'-city'} role={attempted&&cityError?'alert':undefined}>{attempted&&cityError||(publicPlace?'Required. Enter the city of the reported spot.':'Required. Enter the city where your business is based.')}</small>}</div>
    </>}
    <label className="ops-check"><input type="checkbox" checked={chosen} onChange={e=>setChosen(e.target.checked)}/>{pinConfirmationLabel||(areaOnly?'Search around this selected point.':publicPlace?'I have checked that this pin marks the reported spot.':'I have checked that this pin marks my service entrance.')}</label>
    {error&&<p role="status" className="ops-notice">{error}</p>}<button type="button" className="ops-primary" disabled={!chosen||busy||searchPending} onClick={confirm}>{confirmLabel||(areaOnly?'Find nearby professionals':'Confirm this location')}</button>
  </div></Modal>;
}
