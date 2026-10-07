import {useEffect,useState} from 'react';
import {BadgeCheck} from 'lucide-react';
import './repaidian-badge.css';

/** Membership is granted and expired by the server; roles alone never grant a badge. */
export interface RepaidianBadgeMetadata {
  label:'Repaidian';kind:'membership';professionalType:'agent'|'contractor';
  status:'active';source:'trial'|'paid';startsAt:number;endsAt:number;
}

export function RepaidianBadge({badge,variant='tag',className=''}:{badge?:RepaidianBadgeMetadata|null;variant?:'avatar'|'tag';className?:string}) {
  const [clock,setClock]=useState(Date.now);
  const eligible=!!badge&&badge.status==='active'&&badge.kind==='membership'&&['trial','paid'].includes(badge.source)&&Number.isFinite(badge.endsAt)&&Number.isFinite(new Date(badge.endsAt).getTime());
  const expiryAt=eligible?badge.endsAt:0;
  useEffect(()=>{
    if(!eligible)return;
    let timer:ReturnType<typeof setTimeout>|undefined,live=true;
    const check=()=>{
      if(!live)return;
      const now=Date.now();setClock(previous=>Math.max(previous,now));
      if(now<expiryAt)timer=setTimeout(check,Math.min(expiryAt-now+1,2147483647));
    };
    check();return()=>{live=false;clearTimeout(timer);};
  },[eligible,expiryAt]);
  // The browser clock can only hide an expired cached label; it never grants membership.
  if(!eligible||Math.max(clock,Date.now())>=expiryAt)return null;
  const expiry=new Date(expiryAt).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',year:'numeric'});
  const description='Repaidian membership badge'+(badge.source==='trial'?' · complimentary access':' · active membership')+(expiry?' · until '+expiry:'');
  return <span className={['repaidian-badge','repaidian-badge-'+variant,className].filter(Boolean).join(' ')} role="img" aria-label={description} title={description}>
    <span className="repaidian-badge-seal" aria-hidden="true"><BadgeCheck strokeWidth={2.3}/></span>
    {variant==='tag'&&<span className="repaidian-badge-label" aria-hidden="true">Repaidian</span>}
  </span>;
}
