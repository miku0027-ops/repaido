// Imported before the Firebase/App graph. The ownership token never remains in
// the URL for analytics, referrers, screenshots or persisted browser storage.
let pending=null;
if(typeof location!=='undefined'&&location.hash.startsWith('#email-verification=')){
  const fragment=location.hash.slice('#email-verification='.length);
  history.replaceState(history.state,'',location.pathname+location.search);
  try{
    if(fragment.length>1000||!/^[A-Za-z0-9_-]+$/.test(fragment))throw Error('invalid');
    const value=JSON.parse(atob(fragment.replaceAll('-','+').replaceAll('_','/')));
    if(typeof value.challenge_id!=='string'||! /^[A-Za-z0-9_-]{24,100}$/.test(value.challenge_id)||typeof value.token!=='string'||! /^[A-Za-z0-9_-]{40,100}$/.test(value.token))throw Error('invalid');
    pending={challenge_id:value.challenge_id,token:value.token};
  }catch{pending={invalid:true};}
}
export function emailVerificationLink(){return pending;}
export function clearEmailVerificationLink(){pending=null;}
