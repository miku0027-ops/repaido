import {useEffect,useId,useRef,useState} from 'react';
import {onIdTokenChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {operation} from '../services/operations';
import './notification-preferences.css';

type Preferences={version:number;saved_searches:boolean;price_drops:boolean;following:boolean;quiet_enabled:boolean;quiet_start:string;quiet_end:string;timezone:string};
const endpoint='/customer-hub/notification-preferences';

export function NotificationPreferences(){
 const [value,setValue]=useState<Preferences|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
 const epoch=useRef(0);
 const loadedAccount=useRef<string|null>(null);
 const fieldId=useId();
 async function load(){
  const request=++epoch.current;setBusy(true);setError('');setStatus('');setValue(null);
  try{const data=await operation<Preferences>(endpoint,{}, {force:true,feedback:false});if(request===epoch.current)setValue(data);}
  catch(e){if(request===epoch.current)setError((e as Error).message);}
  finally{if(request===epoch.current)setBusy(false);}
 }
 useEffect(()=>{const unsubscribe=onIdTokenChanged(auth,user=>{const uid=user?.uid||'';if(loadedAccount.current===uid)return;loadedAccount.current=uid;void load();});return()=>{epoch.current++;loadedAccount.current=null;unsubscribe();};},[]);
 function update<K extends keyof Preferences>(key:K,next:Preferences[K]){setValue(current=>current?{...current,[key]:next}:null);setStatus('');}
 return <section className="notification-preferences" aria-labelledby={fieldId+'-heading'}>
  <h3 id={fieldId+'-heading'}>Saved-item notifications</h3>
  <p>Choose optional updates for your notification inbox. New matches and changes are checked periodically.</p>
  {busy&&!value&&<p role="status">Loading notification preferences…</p>}
  {error&&<p role="alert">{error}</p>}
  {!value&&!busy&&<button type="button" onClick={()=>void load()}>Retry preferences</button>}
  {value&&<form onSubmit={async event=>{
   event.preventDefault();const request=epoch.current;setBusy(true);setError('');setStatus('');
   const {version,...settings}=value;
   try{const saved=await operation<Preferences>(endpoint,{method:'PUT',body:JSON.stringify({...settings,expected_version:version})},{feedback:false});if(request===epoch.current){setValue(saved);setStatus('Notification preferences saved.');}}
   catch(e){if(request===epoch.current)setError((e as Error).message);}
   finally{if(request===epoch.current)setBusy(false);}
  }}>
   <fieldset disabled={busy}>
    <legend>Optional updates</legend>
    <label className="notification-preferences-check"><input type="checkbox" checked={value.saved_searches} onChange={e=>update('saved_searches',e.target.checked)}/><span>New or updated homes matching saved searches</span></label>
    <label className="notification-preferences-check"><input type="checkbox" checked={value.price_drops} onChange={e=>update('price_drops',e.target.checked)}/><span>Lower prices on saved homes, products and marketplace items</span></label>
    <label className="notification-preferences-check"><input type="checkbox" checked={value.following} onChange={e=>update('following',e.target.checked)}/><span>Profile and catalogue updates from followed shops and professionals</span></label>
    <label className="notification-preferences-check"><input type="checkbox" checked={value.quiet_enabled} onChange={e=>update('quiet_enabled',e.target.checked)}/><span>Use quiet hours for these saved-item updates</span></label>
    {value.quiet_enabled&&<div className="notification-preferences-times">
     <label>Quiet hours start<input type="time" required value={value.quiet_start} onChange={e=>update('quiet_start',e.target.value)}/></label>
     <label>Quiet hours end<input type="time" required value={value.quiet_end} onChange={e=>update('quiet_end',e.target.value)}/></label>
     <label>Timezone<input list={fieldId+'-timezones'} required maxLength={80} value={value.timezone} onChange={e=>update('timezone',e.target.value)} placeholder="Asia/Kolkata"/><datalist id={fieldId+'-timezones'}><option value="Asia/Kolkata"/><option value="UTC"/><option value="Europe/London"/><option value="America/New_York"/><option value="Asia/Dubai"/></datalist></label>
    </div>}
    <p className="notification-preferences-note">Quiet hours delay saved-item updates until your chosen time. Booking, payment, safety and other operational updates continue as usual.</p>
    <div className="notification-preferences-actions"><button type="submit">{busy?'Saving…':'Save preferences'}</button><button type="button" onClick={()=>void load()}>Refresh preferences</button></div>
   </fieldset>
  </form>}
  {status&&<p role="status">{status}</p>}
 </section>;
}
