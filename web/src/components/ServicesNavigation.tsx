import {Check,ChevronRight,HomeRepair,PersonSearch} from '../icons';
import './services-navigation.css';

export function ServicesNavigation({value,onChange}:{value:'Services'|'Hire';onChange:(value:'Services'|'Hire')=>void}){
 return <nav className="services-destinations" aria-label="Services and hiring">
  <button type="button" aria-current={value==='Services'?'page':undefined} onClick={()=>onChange('Services')}><HomeRepair size={18} aria-hidden="true"/><span>Services</span></button>
  <button type="button" className="services-hire-destination" aria-current={value==='Hire'?'page':undefined} onClick={()=>onChange('Hire')}><PersonSearch size={19} aria-hidden="true"/><span>Hire a professional</span>{value==='Hire'?<Check size={16} aria-hidden="true"/>:<ChevronRight size={16} aria-hidden="true"/>}</button>
 </nav>;
}
