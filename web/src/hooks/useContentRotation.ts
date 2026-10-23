import {useEffect,useState} from 'react';

/** Start fresh for changed content; pause without losing the current slide. */
export function useContentRotation(key:string,count:number,enabled:boolean,delay=6000){
 const [cursor,setCursor]=useState({key,step:0});
 const step=cursor.key===key?cursor.step:0;
 useEffect(()=>setCursor(current=>current.key===key?current:{key,step:0}),[key]);
 useEffect(()=>{
  if(!enabled||count<2)return;
  const timer=setTimeout(()=>setCursor({key,step:step+1}),delay);
  return()=>clearTimeout(timer);
 },[key,count,enabled,delay,step]);
 return {index:count?step%count:0,previous:step&&count?(step-1)%count:undefined,step};
}
