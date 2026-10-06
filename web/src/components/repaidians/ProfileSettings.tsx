import {useEffect,useRef,useState} from 'react';
import {Bell,LockKeyhole,ShieldCheck} from 'lucide-react';
import {blockedMembers,blockMember,profileSettings,updateSettings,type CommunitySettings} from '../../services/repaidiansService';

export function ProfileSettings(){
  const [settings,setSettings]=useState<CommunitySettings|null>(null),[blocked,setBlocked]=useState<{id:string;name:string}[]|null>(null);
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[saved,setSaved]=useState('');
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const load=async()=>{
    setError('');
    try{const [config,list]=await Promise.all([profileSettings(),blockedMembers()]);if(alive.current){setSettings(config.settings);setBlocked(list.members);}}
    catch(e){if(alive.current)setError((e as Error).message);}
  };
  const save=async()=>{
    if(!settings||busy)return;setBusy('settings');setError('');setSaved('');
    try{const result=await updateSettings(settings);if(alive.current){setSettings(result.settings);setSaved('Privacy and notification settings saved.');}}
    catch(e){if(alive.current)setError((e as Error).message);}
    finally{if(alive.current)setBusy('');}
  };
  return <details className="rp-edit-profile rp-account-settings" onToggle={event=>{if(event.currentTarget.open&&!settings)void load();}}>
    <summary><ShieldCheck size={19}/>Privacy & notifications</summary>
    {error&&<p className="rp-error" role="alert">{error}<button className="rp-secondary" onClick={()=>void load()}>Retry</button></p>}
    {!settings&&!error&&<p role="status">Loading your settings…</p>}
    {settings&&<form onSubmit={event=>{event.preventDefault();void save();}}>
      <h3><LockKeyhole size={19}/>Who can message you?</h3>
      <label>Allow messages from<select aria-label="Allow messages from" value={settings.messagePrivacy} onChange={e=>{setSettings({...settings,messagePrivacy:e.target.value as CommunitySettings['messagePrivacy']});setSaved('');}}><option value="everyone">Everyone in the community</option><option value="following">People I follow</option><option value="nobody">Nobody</option></select></label>
      <p className="rp-fine">This controls incoming messages and story replies. Your existing conversations stay available.</p>
      <h3><Bell size={19}/>Activity notifications</h3>
      {([{key:'likeNotifications',label:'Likes on my publications'},{key:'commentNotifications',label:'Comments on my publications'},{key:'followNotifications',label:'New followers'},{key:'messageNotifications',label:'New message alerts'}] as const).map(item=><label className="rp-setting-toggle" key={item.key}><span>{item.label}</span><input type="checkbox" checked={settings[item.key]} onChange={e=>{setSettings({...settings,[item.key]:e.target.checked});setSaved('');}}/></label>)}
      <p className="rp-fine">Turning off a type stops future activity notifications. Tender interests and essential booking updates remain available.</p>
      <button className="rp-primary" disabled={!!busy}>{busy==='settings'?'Saving…':'Save settings'}</button>{saved&&<p role="status">{saved}</p>}
    </form>}
    {blocked&&<section className="rp-blocked-members"><h3>Blocked members · {blocked.length}</h3><p className="rp-fine">Blocked members cannot contact you or see your community activity. Unblocking does not restore past follows.</p>{blocked.length?blocked.map(member=><div className="rp-blocked-row" key={member.id}><strong>{member.name}</strong><button className="rp-secondary" disabled={!!busy} onClick={async()=>{setBusy(member.id);setError('');try{await blockMember(member.id,false);if(alive.current)setBlocked(rows=>rows?.filter(row=>row.id!==member.id)||[]);}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy('');}}}>Unblock</button></div>):<p className="rp-fine">You haven’t blocked anyone.</p>}</section>}
  </details>;
}
