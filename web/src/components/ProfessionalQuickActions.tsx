import {ProfessionalProfileActions,type Professional} from './Hiring';
import {openProfessionalAction} from '../services/professionalNavigation';

/** Shared by catalogue, nearby discovery and an assigned professional's profile. */
export function ProfessionalQuickActions({p,category,onNavigate}:{p:Professional;category?:string;onNavigate:()=>void}){
  return <ProfessionalProfileActions p={p} category={category} hireLabel="Check day hire"
    onService={(serviceId,professional)=>{onNavigate();openProfessionalAction({kind:'service',serviceId,professional});}}
    onHome={(serviceId,professional)=>{onNavigate();openProfessionalAction({kind:'home',serviceId,professional});}}
    onHire={professional=>{onNavigate();openProfessionalAction({kind:'hire',professional});}}/>;
}
