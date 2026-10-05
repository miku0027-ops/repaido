export function restoreTab(storage,key,allowed,fallback,deepLink){
 if(deepLink&&allowed.includes(deepLink))return deepLink;
 try{const saved=storage.getItem(key);return allowed.includes(saved)?saved:fallback;}catch{return fallback;}
}
