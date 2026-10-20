/** One browser GPS watch per mounted shift. No invented timestamps or positions. */
export function createBikeLocationSession(geo, clock=()=>Date.now()/1000){
 let watch=null,latest=null,pending=null,permissionDenied=false;
 const accept=p=>{const value={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,captured_at:p.timestamp/1000};if(value.accuracy>0&&value.accuracy<=100&&(!latest||value.captured_at>latest.captured_at))latest=value;};
 const start=()=>{if(watch!==null||!geo)return;permissionDenied=false;watch=geo.watchPosition(accept,error=>{if(error.code===1)permissionDenied=true;},{enableHighAccuracy:true,maximumAge:5000,timeout:20000});};
 const stop=()=>{if(watch!==null)geo.clearWatch(watch);watch=null;latest=null;};
 const read=async()=>{
  if(!geo)throw Error('This device cannot provide GPS.');
  if(permissionDenied)throw Error('Location permission is off. Allow precise location in your browser settings.');
  if(latest&&clock()-latest.captured_at>=-5&&clock()-latest.captured_at<20)return latest;
  if(pending)return pending;
  pending=new Promise((resolve,reject)=>geo.getCurrentPosition(p=>{accept(p);resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,captured_at:p.timestamp/1000});},error=>{if(error.code===1)permissionDenied=true;reject(Error(error.code===1?'Location permission is off. Allow precise location in your browser settings.':'Waiting for a precise GPS signal.'));},{enableHighAccuracy:true,maximumAge:5000,timeout:20000})).finally(()=>{pending=null;});
  return pending;
 };
 return {start,stop,read};
}
