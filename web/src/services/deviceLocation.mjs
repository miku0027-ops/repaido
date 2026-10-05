/** Fresh readings only; relaxed accuracy is for registration, never arrival. */
export async function readDeviceLocation(geolocation, {registration=false, secure=true}={}) {
  if (!secure) throw new Error('Location needs a secure connection. Open https://repaido.com/worker.');
  if (!geolocation) throw new Error('This browser cannot provide location. Choose your location on the map or enter coordinates.');
  const read=high=>new Promise((resolve,reject)=>geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:high,maximumAge:0,timeout:15000}));
  try {
    let p;
    try { p=await read(true); }
    catch(e) { if(registration && (e.code===2||e.code===3)) p=await read(false); else throw e; }
    return {lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,captured_at:p.timestamp/1000};
  } catch(e) {
    if(e.code===1) throw new Error('Location permission is off. Allow location for this website in your browser settings and turn on device Location Services, then retry. You can also choose your registration location on the map.');
    if(e.code===3) throw new Error('Finding your location took too long. Move near a window and retry, or choose your registration location on the map.');
    throw new Error('Your device could not find a location. Check Location Services and retry. Registration also supports a map pin or manual coordinates.');
  }
}
