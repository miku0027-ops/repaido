import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Bell,LockKeyhole,ShieldCheck} from '../../icons';
import {blockedMembers,blockMember,profileSettings,updateSettings,peekCommunityView,rememberCommunityView,dropCommunityView,communityIdentityKey,type CommunitySettings} from '../../services/repaidiansService';

import {PreferenceCheckbox} from '../PreferenceCheckbox';

export function ProfileSettings({children}:{children?:ReactNode}){
  const [settings,setSettings]=useState<CommunitySettings|null>(()=>peekCommunityView<CommunitySettings>('privacy-settings')),[blocked,setBlocked]=useState<{id:string;name:string}[]|null>(null);
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[blockedError,setBlockedError]=useState(''),[saved,setSaved]=useState('');
  const alive=useRef(true),settingsRead=useRef(0),blocksRead=useRef(0),dirty=useRef(false),saving=useRef(false);
  const loadSettings=async()=>{
    const request=++settingsRead.current,owner=communityIdentityKey();setError('');
    try{const config=await profileSettings();if(alive.current&&request===settingsRead.current&&owner===communityIdentityKey()){
      rememberCommunityView('privacy-settings',config.settings);
      if(!dirty.current)setSettings(config.settings);
    }}catch(e){if(alive.current&&request===settingsRead.current&&owner===communityIdentityKey()){
      if([401,402,403,404].includes((e as {status?:number}).status||0)){dropCommunityView('privacy-settings');setSettings(null);dirty.current=false;}
      setError((e as Error).message);
    }}
  };
  const loadBlocked=async()=>{
    const request=++blocksRead.current,owner=communityIdentityKey();setBlockedError('');
    try{const list=await blockedMembers();if(alive.current&&request===blocksRead.current&&owner===communityIdentityKey())setBlocked(list.members);}
    catch(e){if(alive.current&&request===blocksRead.current&&owner===communityIdentityKey())setBlockedError((e as Error).message);}
  };
  useEffect(()=>{alive.current=true;void loadSettings();void loadBlocked();return()=>{alive.current=false;settingsRead.current++;blocksRead.current++;};},[]);
  const edit=(patch:Partial<CommunitySettings>)=>{dirty.current=true;setSettings(value=>value?{...value,...patch}:null);setSaved('');};
  const save=async()=>{
    if(!settings||busy||saving.current)return;const owner=communityIdentityKey();saving.current=true;settingsRead.current++;setBusy('settings');setError('');setSaved('');
    try{const result=await updateSettings(settings);if(alive.current&&owner===communityIdentityKey()){
      rememberCommunityView('privacy-settings',result.settings);setSettings(result.settings);dirty.current=false;setSaved('Privacy and notification settings saved.');
    }}catch(e){if(alive.current&&owner===communityIdentityKey())setError((e as Error).message);}
    finally{saving.current=false;if(alive.current&&owner===communityIdentityKey())setBusy('');}
  };
  return <section className="rp-edit-profile rp-account-settings" aria-labelledby="rp-settings-title">
    <h3 id="rp-settings-title" className="rp-settings-heading"><ShieldCheck size={20}/>Privacy & notifications</h3>
    {error&&<p className="rp-error" role="alert">{error}<button className="rp-secondary" onClick={()=>void loadSettings()}>Retry</button></p>}
    {!settings&&!error&&<p role="status">Checking your saved choices…</p>}
    <form onSubmit={event=>{event.preventDefault();void save();}}>
      <h3><LockKeyhole size={20}/>Who can message you?</h3>
      <label>Allow messages from<select aria-label="Allow messages from" disabled={!settings||!!busy} value={settings?.messagePrivacy??''} onChange={e=>edit({messagePrivacy:e.target.value as CommunitySettings['messagePrivacy']})}>{!settings&&<option value="" disabled>Saved choice pending</option>}<option value="everyone">Everyone in the community</option><option value="following">People I follow</option><option value="nobody">Nobody</option></select></label>
      <p className="rp-fine">This controls incoming messages and story replies. Your existing conversations stay available.</p>
      <h3><Bell size={20}/>Activity notifications</h3>
      {([{key:'likeNotifications',label:'Likes on my publications'},{key:'commentNotifications',label:'Comments on my publications'},{key:'followNotifications',label:'New followers'},{key:'messageNotifications',label:'New message alerts'},{key:'placementNotifications',label:'Connection placements'},{key:'applicationNotifications',label:'Application updates'}] as const).map(item=><label className="rp-setting-toggle" key={item.key}><span>{item.label}</span><PreferenceCheckbox checked={settings?.[item.key]} disabled={!!busy} onChange={e=>edit({[item.key]:e.target.checked})}/></label>)}
      <p className="rp-fine">Turning off a type stops future activity notifications. Tender interests and essential booking updates remain available.</p>
      <button className="rp-primary" disabled={!settings||!!busy}>{busy==='settings'?'Saving…':'Save settings'}</button>{saved&&<p role="status">{saved}</p>}
    </form>
    {children}
    <section className="rp-blocked-members"><h3>Blocked members{blocked&&` · ${blocked.length}`}</h3><p className="rp-fine">Blocked members cannot contact you or see your community activity. Unblocking does not restore past follows.</p>
      {blockedError&&<p className="rp-error" role="alert">{blockedError}<button className="rp-secondary" onClick={()=>void loadBlocked()}>Retry blocked members</button></p>}
      {!blocked&&!blockedError&&<p className="rp-fine" role="status">Checking blocked members…</p>}
      {blocked?.map(member=><div className="rp-blocked-row" key={member.id}><strong>{member.name}</strong><button className="rp-secondary" disabled={!!busy} onClick={async()=>{const owner=communityIdentityKey();blocksRead.current++;setBusy(member.id);setBlockedError('');try{await blockMember(member.id,false);if(alive.current&&owner===communityIdentityKey())setBlocked(rows=>rows?.filter(row=>row.id!==member.id)||[]);}catch(e){if(alive.current&&owner===communityIdentityKey())setBlockedError((e as Error).message);}finally{if(alive.current&&owner===communityIdentityKey())setBusy('');}}}>Unblock</button></div>)}
      {blocked?.length===0&&<p className="rp-fine">You haven’t blocked anyone.</p>}
    </section>
  </section>;
}
