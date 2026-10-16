// Retain the purchase identity until an actual provider reconciliation is
// acknowledged. Closing checkout or losing a response is not a new purchase.
const pending=new Map();
const key=uid=>'repaido.market.purchase.v1:'+encodeURIComponent(uid);
export function marketPurchaseIntent(uid){
 if(!uid)throw Error('Sign in to purchase marketplace access.');
 if(pending.has(uid))return pending.get(uid);
 let id;try{id=sessionStorage.getItem(key(uid));}catch{/* In-memory intent still protects this page. */}
 if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))id=crypto.randomUUID();
 pending.set(uid,id);
 try{sessionStorage.setItem(key(uid),id);}catch{/* Do not prevent checkout in privacy mode. */}
 return id;
}
export function acknowledgeMarketPurchase(uid,status){
 if(!['captured','refunded'].includes(status))return;
 pending.delete(uid);try{sessionStorage.removeItem(key(uid));}catch{/* A replay remains safe on the server. */}
}
