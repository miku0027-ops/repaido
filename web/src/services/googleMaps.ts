import {apiFetch} from './api';
// Only a referrer-restricted Maps JavaScript key may be returned here. Routing
// credentials stay on the server; they must never enter this loader.
let pending:Promise<any>|undefined;
export function loadGoogleMaps():Promise<any>{
 const win=window as any;
 if(win.google?.maps?.Map)return Promise.resolve(win.google.maps);
 if(pending)return pending;
 pending=(async()=>{
  const response=await apiFetch('/api/operations/bike-rides/map-config',{}, {background:true,feedback:false});
  const config=await response.json();
  if(!response.ok||!config.browser_key)throw Error('Google Maps is not configured yet. Trip details and location controls remain available.');
  return await new Promise((resolve,reject)=>{
   const script=document.createElement('script');let done=false;
   const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);delete win.repaidoGoogleMapsReady;if(error){script.remove();reject(error);}else resolve(win.google.maps);};
   const timer=setTimeout(()=>finish(Error('Google Maps could not connect.')),20000);
   win.repaidoGoogleMapsReady=()=>finish();
   win.gm_authFailure=()=>{finish(Error('Google Maps authorization failed.'));window.dispatchEvent(new Event('repaido:maps-auth-error'));};
   script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key:config.browser_key,callback:'repaidoGoogleMapsReady',loading:'async',v:'quarterly',region:'IN',language:'en'});
   script.async=true;script.onerror=()=>finish(Error('Google Maps could not load.'));document.head.appendChild(script);
  });
 })().catch(error=>{pending=undefined;throw error;});
 return pending;
}
