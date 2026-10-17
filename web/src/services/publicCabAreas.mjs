const finite=value=>typeof value==='number'&&Number.isFinite(value);
const point=value=>value&&finite(value.lat)&&finite(value.lng)&&Math.abs(value.lat)<=90&&Math.abs(value.lng)<=180;

/** Public map data contains coarse areas, never a driver or vehicle identity. */
export function parsePublicCabAreas(value){
 if(!value||!finite(value.server_time)||value.server_time<=0||!Array.isArray(value.available_cabs)||value.available_cabs.length>100)throw Error('Cab availability could not be confirmed.');
 const areas=value.available_cabs.map(area=>{
  if(!area||typeof area.id!=='string'||!area.id||area.id.length>128||!point(area.position)||!Number.isInteger(area.available_count)||area.available_count<1||area.available_count>10000||!finite(area.updated_at)||!finite(area.expires_at)||area.updated_at>value.server_time+1||value.server_time-area.updated_at>90||area.expires_at>value.server_time+76||area.expires_at<area.updated_at||!finite(area.approximation_metres)||area.approximation_metres<300||area.approximation_metres>2000)throw Error('Cab availability could not be confirmed.');
  return {id:area.id,position:{lat:area.position.lat,lng:area.position.lng},available_count:area.available_count,updated_at:area.updated_at,expires_at:area.expires_at,approximation_metres:area.approximation_metres};
 });
 if(new Set(areas.map(area=>area.id)).size!==areas.length)throw Error('Cab availability could not be confirmed.');
 return {server_time:value.server_time,available_cabs:areas};
}

/** Monotonic elapsed time avoids extending visibility when a device clock changes. */
export function freshPublicCabAreas(snapshot,receivedAt,now){
 if(!snapshot)return [];
 const serverNow=snapshot.server_time+Math.max(0,now-receivedAt)/1000;
 return snapshot.available_cabs.filter(area=>area.expires_at>serverNow);
}
