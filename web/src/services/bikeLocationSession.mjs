/** One browser GPS watch per mounted shift. No invented timestamps or positions. */
export function createBikeLocationSession(geo, clock=()=>Date.now()/1000){
 let watch=null,latest=null,pending=null,permissionDenied=false,epoch=0,cancel=null;
 const point=p=>({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,captured_at:p.timestamp/1000});
 const accept=p=>{const value=point(p);if(value.accuracy>0&&value.accuracy<=100&&(!latest||value.captured_at>latest.captured_at))latest=value;};
 const start=()=>{if(watch!==null||!geo)return;permissionDenied=false;const current=epoch;watch=geo.watchPosition(p=>{if(current===epoch)accept(p);},error=>{if(current===epoch&&error.code===1)permissionDenied=true;},{enableHighAccuracy:true,maximumAge:5000,timeout:20000});};
 const stop=()=>{epoch++;if(watch!==null)geo.clearWatch(watch);watch=null;latest=null;cancel?.();cancel=null;pending=null;};
 const read=async()=>{
  if(!geo)throw Error('This browser cannot provide location.');
  if(permissionDenied)throw Error('Location permission is off. Allow precise location in your browser settings.');
  if(latest&&clock()-latest.captured_at>=-5&&clock()-latest.captured_at<20)return latest;
  if(pending)return pending;
  const current=epoch;
  const lookup=new Promise((resolve,reject)=>{
   cancel=()=>reject(Error('Location session ended.'));
   geo.getCurrentPosition(p=>{if(current!==epoch)return;accept(p);resolve(point(p));},error=>{if(current!==epoch)return;if(error.code===1)permissionDenied=true;reject(Error(error.code===1?'Location permission is off. Allow precise location in your browser settings.':'Waiting for a precise location. Check device location settings and retry.'));},{enableHighAccuracy:true,maximumAge:5000,timeout:20000});
  }).finally(()=>{if(pending===lookup){pending=null;cancel=null;}});
  pending=lookup;
  return lookup;
 };
 return {start,stop,read};
}
