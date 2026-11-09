import {Check,MapPin,Search,Calendar,Tag,Send} from '../icons';
import './interaction-motion.css';
type Kind='search'|'location'|'success'|'offer'|'calendar'|'sending';
export function InteractionMotion({kind}:{kind:Kind;active?:boolean}){
 const Icon=kind==='success'?Check:kind==='location'?MapPin:kind==='offer'?Tag:kind==='calendar'?Calendar:kind==='sending'?Send:Search;
 return <span className="interaction-motion" data-kind={kind} aria-hidden="true"><Icon size={24}/></span>;
}
