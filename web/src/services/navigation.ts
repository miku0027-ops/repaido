import {restoreTab} from './navigationState.mjs';
import {useEffect,useState} from 'react';
export function useSavedTab<T extends string>(key:string,allowed:readonly T[],fallback:T,deepLink?:T){
 const [tab,setTab]=useState<T>(()=>{try{return restoreTab(sessionStorage,key,allowed,fallback,deepLink) as T;}catch{return deepLink||fallback;}});
 useEffect(()=>{try{sessionStorage.setItem(key,tab);if(deepLink&&tab!==deepLink){const url=new URL(location.href);for(const name of ['tab','booking','home-plan','hiring'])url.searchParams.delete(name);history.replaceState(history.state,'',url);}}catch{}window.scrollTo({top:0,left:0,behavior:'instant'});document.getElementById('android-main-content')?.scrollTo({top:0,left:0,behavior:'instant'});},[key,tab]);
 return [tab,setTab] as const;
}
