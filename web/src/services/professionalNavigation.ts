import type {Professional} from '../components/Hiring';
import type {Service} from '../types';

export const professionalActionEvent='repaido:professional-action';
export type ProfessionalAction={kind:'service'|'home'|'hire';serviceId?:string;professional:Professional};

export function openProfessionalAction(action:ProfessionalAction){
  window.dispatchEvent(new CustomEvent<ProfessionalAction>(professionalActionEvent,{detail:action}));
}

/** Navigation only. The existing booking APIs still check scope, price and eligibility. */
export function listenProfessionalActions({services,onService,onHome,onHire,onUnavailable}:{
  services:Service[];
  onService:(service:Service,professional:{id:string;name:string})=>void;
  onHome:(id:string,professional:{id:string;name:string})=>void;
  onHire:(professional:Professional)=>void;
  onUnavailable:(message:string)=>void;
}){
  const navigate=(event:Event)=>{
    const action=(event as CustomEvent<ProfessionalAction>).detail,p=action?.professional;
    if(!p||typeof p.id!=='string'||typeof p.name!=='string'||!Array.isArray(p.categories))return;
    const person={id:p.id,name:p.name};
    if(action.kind==='service'){
      const service=services.find(item=>item.id===action.serviceId);
      if(service&&p.service_packages?.some(item=>item.id===service.id))onService(service,person);
      else onUnavailable('This package is no longer listed. Refresh the catalogue before requesting it.');
    }else if(action.kind==='home'){
      if(action.serviceId&&p.home_services?.includes(action.serviceId))onHome(action.serviceId,person);
      else onUnavailable('This Home service is no longer on the approved profile. Refresh it to continue.');
    }else if(action.kind==='hire')onHire(p);
  };
  window.addEventListener(professionalActionEvent,navigate);
  return()=>window.removeEventListener(professionalActionEvent,navigate);
}
