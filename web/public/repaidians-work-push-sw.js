/* Push-only worker. It does not cache requests or intercept application traffic. */
const database=()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('repaidians-work-push',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('metadata');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});
async function accountFingerprint(value,write=false){
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const transaction=db.transaction('metadata',write?'readwrite':'readonly'),store=transaction.objectStore('metadata');
    const request=write?store.put(value,'active-account'):store.get('active-account');
    let result;request.onsuccess=()=>{result=request.result;};
    transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
  });}finally{db.close();}
}
const fingerprint=async(value)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
  if(event.data?.type!=='repaidians-work-push-account')return;
  if(event.source?.url&&new URL(event.source.url).origin!==self.location.origin)return;
  const value=event.data.fingerprint;if(value!==null&&!/^[a-f0-9]{64}$/.test(value))return;
  event.waitUntil(accountFingerprint(value,true).then(()=>event.ports[0]?.postMessage({ok:true})).catch(()=>event.ports[0]?.postMessage({ok:false})));
});
self.addEventListener('push',event=>{
  let payload={};try{payload=event.data?.json()||{};}catch{return;}
  const data=payload.data||{};
  const expires=Number(data.expires_at||0);if(expires&&expires*1000<Date.now())return;
  if(!['repaidians','mobility'].includes(data.destination)||typeof data.recipient_id!=='string'||data.recipient_id.length>200)return;
  if(data.destination==='mobility'&&!/^[a-f0-9]{64}$/.test(data.business_id||''))return;
  event.waitUntil((async()=>{
    const active=await accountFingerprint();
    if(!active||active!==await fingerprint(data.recipient_id))return;
    // Fetch source details after sign-in. Private pay, terms and full addresses
    // never appear on a lock screen or in a browser notification.
    const ride=data.destination==='mobility';
    const url=ride?(['cab_owner','driver'].includes(data.business_role)?'/worker?mode='+data.business_role+'&shared-ride='+data.business_id:'/?view=rides&shared-ride='+data.business_id):'/?repaidians&community=notifications';
    await self.registration.showNotification(ride?(data.transport_event==='rescheduled'?'Departure time changed':data.transport_event==='departure_reminder'?'Your shared ride departs soon':'Shared ride update'):'Repaidians work update',{
      body:ride?'Open your ride for the departure time, reason and directions.':'Open Repaidians to view your latest work update.',icon:'/favicon-192.png',silent:false,vibrate:ride?[200,100,200]:undefined,
      tag:'repaidians-work-'+String(data.notification_id||'update').slice(0,100),
      data:{url},
    });
  })().catch(()=>{}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();const target=new URL(event.notification.data?.url||'/?repaidians&community=notifications',self.location.origin);
  if(target.origin!==self.location.origin)return;const url=target.href;
  event.waitUntil((async()=>{
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=clients.find(client=>new URL(client.url).origin===self.location.origin);
    if(existing){await existing.navigate(url);return existing.focus();}
    return self.clients.openWindow(url);
  })());
});
