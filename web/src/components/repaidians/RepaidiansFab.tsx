import {Sparkles,ArrowUpRight} from 'lucide-react';
import './repaidians.css';
export function RepaidiansFab({onOpen}:{onOpen:()=>void}) {
  return <button className="rp-fab" onClick={onOpen} aria-label="Open Repaidians community"><span className="rp-fab-icon"><Sparkles size={22} strokeWidth={1.7} aria-hidden="true"/></span><span><strong>Repaidians</strong><small>Work meets inspiration</small></span><ArrowUpRight size={18} aria-hidden="true"/></button>;
}
