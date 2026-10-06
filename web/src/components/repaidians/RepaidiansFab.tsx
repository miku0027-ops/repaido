import {Users,ArrowUpRight} from 'lucide-react';
import './repaidians.css';
export function RepaidiansFab({onOpen}:{onOpen:()=>void}) {
  return <button className="rp-fab" onClick={onOpen} aria-label="Open Repaidians community"><span className="rp-fab-icon"><Users size={20} aria-hidden="true"/></span><span><strong>Repaidians</strong><small>The people behind the work</small></span><ArrowUpRight size={16} aria-hidden="true"/></button>;
}
