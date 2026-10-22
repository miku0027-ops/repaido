const valid=point=>point&&Number.isFinite(point.lat)&&Math.abs(point.lat)<=90&&Number.isFinite(point.lng)&&Math.abs(point.lng)<=180;
export function validateRideStops(pickup,dropoff,maxDistanceMetres=Infinity,requireAddress=false){
 if(!valid(pickup))return {ready:false,field:'pickup',message:'Choose your pickup to continue.'};
 if(requireAddress&&(!pickup.address||pickup.address.trim().length<10))return {ready:false,field:'pickup',message:'Confirm the pickup street and landmark on the map.'};
 if(!valid(dropoff))return {ready:false,field:'dropoff',message:'Choose your drop-off to continue.'};
 if(requireAddress&&(!dropoff.address||dropoff.address.trim().length<10))return {ready:false,field:'dropoff',message:'Confirm the drop-off street and landmark on the map.'};
 const radians=value=>value*Math.PI/180;
 const a=Math.sin(radians(dropoff.lat-pickup.lat)/2)**2+Math.cos(radians(pickup.lat))*Math.cos(radians(dropoff.lat))*Math.sin(radians(dropoff.lng-pickup.lng)/2)**2;
 const distance=6371000*2*Math.atan2(Math.sqrt(Math.min(1,a)),Math.sqrt(Math.max(0,1-a)));
 if(distance<2)return {ready:false,field:'dropoff',message:'Choose a drop-off different from your pickup.'};
 if(distance>maxDistanceMetres)return {ready:false,field:'dropoff',message:`Choose stops within ${maxDistanceMetres/1000} km. Road distance is checked next.`};
 return {ready:true,message:'Stops ready · slide to check availability.'};
}

// The cab API requires five minutes' notice and a reservation window. Keep
// that actual booking window visible; never label it as a promised arrival ETA.
export function soonestCabWindow(now=Date.now()){
 const starts_at=Math.ceil(now/60000)*60+600;
 return {starts_at,ends_at:starts_at+7200};
}
export function cabWindowValid(window,now=Date.now()){
 return !!window&&Number.isFinite(window.starts_at)&&Number.isFinite(window.ends_at)&&window.starts_at>=now/1000+300&&window.starts_at<=now/1000+180*86400&&window.ends_at>=window.starts_at+900&&window.ends_at<=window.starts_at+30*86400;
}
