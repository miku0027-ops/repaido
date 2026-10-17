import {ArrowUpRight,Forum} from '../../icons';
import './repaidians.css';
export function RepaidiansFab({onOpen}:{onOpen:()=>void}) {
  return <button className="rp-fab" onClick={onOpen} aria-label="Open Repaidians community"><span className="rp-fab-icon"><Forum size={20} aria-hidden="true"/></span><span><strong>Repaidians</strong><small>Work meets inspiration</small></span><ArrowUpRight size={20} aria-hidden="true"/></button>;
}
