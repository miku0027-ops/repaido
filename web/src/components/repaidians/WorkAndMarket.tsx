import {useEffect,useId,useState} from 'react';
import {BriefcaseBusiness,Building2,ChevronDown,ClipboardList,Compass,FileClock,FileText,SlidersHorizontal,UserRound,Users} from 'lucide-react';
import type {CommunityMember,CommunityOpportunity,OpportunityReference,OpportunitySource} from '../../types/repaidians';
import {CustomContractHub} from '../CustomContracts';
import {PublicContractHistory} from '../PublicContractProgress';
import {Opportunities} from './Opportunities';
import {ProfessionalNetwork} from './ProfessionalNetwork';
import {ProfessionalProfile} from './ProfessionalProfile';
import {WorkHub,WorkPreferences} from './WorkHub';
import './work-and-market.css';

export type WorkMarketView='market'|'jobs'|'applications'|'companies'|'contracts'|'network'|'background'|'history'|'preferences';

export interface WorkAndMarketProps {
  accountKey:string;
  member:CommunityMember;
  authenticated:boolean;
  professional:boolean;
  role:'customer'|'agent'|'contractor';
  city:string;
  revision:number;
  view:WorkMarketView;
  onView:(view:WorkMarketView)=>void;
  jobId?:string;
  applicationId?:string;
  contractId?:string;
  onOpenMember:(id:string)=>void;
  onDestination:(card:CommunityOpportunity)=>void;
  onManage:(source:OpportunitySource|'applications')=>void;
  onShare:(reference:OpportunityReference)=>void;
  onOpenProject?:(id:string)=>void;
  onSignIn?:()=>void;
  onDiscoverPeople:()=>void;
  onPrivacy?:()=>void;
}

type Category='browse'|'work'|'tools';
const destinations=[
  {view:'market',category:'browse',label:'Market',Icon:Compass},
  {view:'jobs',category:'browse',label:'Matching jobs',Icon:BriefcaseBusiness},
  {view:'companies',category:'browse',label:'Companies',Icon:Building2},
  {view:'applications',category:'work',label:'Applications',Icon:ClipboardList},
  {view:'contracts',category:'work',label:'Contracts',Icon:FileText},
  {view:'history',category:'work',label:'Shared work history',Icon:FileClock},
  {view:'network',category:'tools',label:'Network',Icon:Users},
  {view:'background',category:'tools',label:'Background',Icon:UserRound},
  {view:'preferences',category:'tools',label:'Preferences',Icon:SlidersHorizontal},
] as const;
const categories=[
  {id:'browse',label:'Browse',Icon:Compass},
  {id:'work',label:'My work',Icon:BriefcaseBusiness},
  {id:'tools',label:'Professional tools',Icon:SlidersHorizontal},
] as const;

export function WorkAndMarket(props:WorkAndMarketProps){
  const {accountKey,member,authenticated,professional,role,city,revision,onView,onOpenMember,onDestination,onManage,onShare,onOpenProject,onSignIn,onDiscoverPeople,onPrivacy}=props;
  const professionalAccess=authenticated&&professional;
  const view=professionalAccess||props.view==='market'||props.view==='contracts'?props.view:'market';
  const destination=destinations.find(item=>item.view===view)!;
  const [expanded,setExpanded]=useState<Category|null>(destination.category);
  const id=useId(),navigationId=id+'-destinations';
  useEffect(()=>setExpanded(destination.category),[accountKey,destination.category,view]);
  const visibleDestinations=destinations.filter(item=>professionalAccess||item.view==='market'||item.view==='contracts');
  const visibleCategories=categories.filter(category=>visibleDestinations.some(item=>item.category===category.id));
  const navigate=(next:WorkMarketView)=>onView(next);

  const panel=()=>{
    switch(view){
      case 'market':
        return <Opportunities key={accountKey} city={city} revision={revision} onDestination={onDestination} onShare={onShare} onManage={source=>source==='applications'&&professionalAccess?navigate('applications'):onManage(source)}/>;
      case 'jobs':
      case 'applications':
      case 'companies':
        return <WorkHub key={accountKey+':'+view} accountKey={accountKey} view={view} revision={revision} jobId={view==='jobs'?props.jobId:undefined} applicationId={props.applicationId} onOpenProject={onOpenProject} onOpenMember={onOpenMember} onManage={()=>onManage(view==='applications'?'applications':'career')}/>;
      case 'contracts':
        return <CustomContractHub key={accountKey+':'+role} accountKey={accountKey} authenticated={authenticated} mode={role} focusContractId={props.contractId} onSignIn={onSignIn} onOpenProject={onOpenProject} onOpenMember={onOpenMember}/>;
      case 'network':
        return <ProfessionalNetwork key={accountKey} accountKey={accountKey} authenticated={authenticated} onOpenMember={onOpenMember} onDiscover={onDiscoverPeople} onJobs={()=>navigate('jobs')} onCompanies={()=>navigate('companies')}/>;
      case 'background':
        return <div className="rp-work-market-tool"><header className="rp-work-market-panel-heading"><h3>Professional background</h3><p>Manage your experience, qualifications and featured work, and choose who can see them.</p></header><ProfessionalProfile key={accountKey+':'+member.id} accountKey={accountKey} member={member} self authenticated={authenticated} professionalActions={professionalAccess} onOpenMember={onOpenMember} onNetwork={()=>navigate('network')} onJobs={()=>navigate('jobs')} onCompanies={()=>navigate('companies')}/></div>;
      case 'history':
        return <div className="rp-work-market-tool"><header className="rp-work-market-panel-heading"><h3>Shared work history</h3><p>Contract projects appear here when the customer has approved public sharing.</p></header><PublicContractHistory key={accountKey+':'+member.id} contractorId={member.id}/></div>;
      case 'preferences':
        return <div className="rp-work-market-tool"><header className="rp-work-market-panel-heading"><h3>Work preferences</h3><p>Choose how work is discovered, which updates you receive and what placement details you share.</p>{onPrivacy&&<button type="button" className="rp-work-market-privacy" onClick={onPrivacy}>Privacy controls</button>}</header><WorkPreferences key={accountKey} accountKey={accountKey}/></div>;
    }
  };

  return <section className="rp-work-market" aria-labelledby={id+'-title'}>
    <header className="rp-work-market-heading"><div><h2 id={id+'-title'}>Work &amp; market</h2><p>{professionalAccess?'Browse opportunities, follow your work and manage your professional tools.':'Browse published opportunities and manage your custom contracts.'}</p></div><BriefcaseBusiness size={24} aria-hidden="true"/></header>
    <nav className="rp-work-market-navigation" aria-label="Work and market sections">
      <div className="rp-work-market-categories">{visibleCategories.map(category=><button key={category.id} type="button" className="rp-work-market-category" data-active={destination.category===category.id} aria-expanded={expanded===category.id} aria-controls={navigationId} onClick={()=>setExpanded(current=>current===category.id?null:category.id)}><category.Icon size={18} aria-hidden="true"/><span>{category.label}</span><ChevronDown size={16} aria-hidden="true"/></button>)}</div>
      <div id={navigationId} className="rp-work-market-destinations" hidden={!expanded} role="group" aria-label={categories.find(category=>category.id===expanded)?.label||'Work destinations'}>{visibleDestinations.filter(item=>item.category===expanded).map(item=><button key={item.view} type="button" aria-current={view===item.view?'page':undefined} onClick={()=>navigate(item.view)}><item.Icon size={18} aria-hidden="true"/><span>{item.label}</span></button>)}</div>
    </nav>
    <div className="rp-work-market-content" key={accountKey+':'+view} aria-label={destination.label}>{panel()}</div>
  </section>;
}
