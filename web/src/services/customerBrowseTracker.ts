import {useEffect,useState} from 'react';
import {addVisit,readVisits,RETURN_VISIT_MS} from './customerVisits.mjs';

export const BROWSE_HYDRATION_THRESHOLD = 3;
export const BROWSE_CUSTOM_EVENT = 'repaido:browse-activity';
let documentCounted = false;
let memoryCount = 0;
let hiddenAt = 0;
function storage(){try{return localStorage;}catch{return undefined;}}
export function getCustomerBrowseCount(){return Math.max(memoryCount,readVisits(storage()));}
export function recordCustomerBrowse(action = 'visit') {
  if(action !== 'visit' || documentCounted) return {count:getCustomerBrowseCount(),isHydrated:getCustomerBrowseCount()>=3};
  documentCounted = true;
  memoryCount = addVisit(storage(),memoryCount);
  window.dispatchEvent(new Event(BROWSE_CUSTOM_EVENT));
  return {count:memoryCount,isHydrated:memoryCount>=3};
}
export function useCustomerBrowseHydration(){
  const [browseCount,setCount]=useState(getCustomerBrowseCount);
  useEffect(()=>{
    const sync=()=>setCount(getCustomerBrowseCount());
    sync();window.addEventListener(BROWSE_CUSTOM_EVENT,sync);window.addEventListener('storage',sync);
    return()=>{window.removeEventListener(BROWSE_CUSTOM_EVENT,sync);window.removeEventListener('storage',sync);};
  },[]);
  return {browseCount,isHydrated:browseCount>=BROWSE_HYDRATION_THRESHOLD};
}
export function listenCustomerVisits(){
  recordCustomerBrowse();
  const visibility=()=>{
    if(document.hidden)hiddenAt=Date.now();
    else if(hiddenAt){const elapsed=Date.now()-hiddenAt;hiddenAt=0;if(elapsed>=RETURN_VISIT_MS){documentCounted=false;recordCustomerBrowse();}}
  };
  document.addEventListener('visibilitychange',visibility);
  return()=>document.removeEventListener('visibilitychange',visibility);
}
