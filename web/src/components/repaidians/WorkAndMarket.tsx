import {useEffect,useId,useRef} from 'react';
import {BriefcaseBusiness,ChevronDown} from '../../icons';
import type {CommunityMember,CommunityOpportunity,OpportunityReference,OpportunitySource} from '../../types/repaidians';
import {CustomContractHub} from '../CustomContracts';
import {PublicContractHistory} from '../PublicContractProgress';
import {Opportunities} from './Opportunities';
import {ProfessionalNetwork} from './ProfessionalNetwork';
import {ProfessionalProfile} from './ProfessionalProfile';
import {WorkHub,WorkPreferences} from './WorkHub';
import {ProfessionalWorkspace} from './ProfessionalWorkspace';
import './work-and-market.css';

export type WorkMarketView='market'|'jobs'|'applications'|'companies'|'contracts'|'tools'|'network'|'background'|'history'|'preferences';

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
  onProfile?:()=>void;
  onSaved?:()=>void;
  onPublish?:(kind:import('../../types/repaidians').StudioKind)=>void;
  onNotifications?:()=>void;
}

const destinations=[
  {view:'market',category:'browse',label:'Market'},
  {view:'jobs',category:'browse',label:'Matching jobs'},
  {view:'companies',category:'browse',label:'Companies'},
  {view:'applications',category:'work',label:'Applications'},
  {view:'contracts',category:'work',label:'Contracts'},
  {view:'history',category:'work',label:'Shared work history'},
  {view:'tools',category:'tools',label:'Overview'},
  {view:'network',category:'tools',label:'Network'},
  {view:'background',category:'tools',label:'Background'},
  {view:'preferences',category:'tools',label:'Preferences'},
] as const;
const categories=[
  {id:'browse',label:'Browse'},
  {id:'work',label:'My work'},
  {id:'tools',label:'Professional tools',shortLabel:'Tools'},
] as const;

export function WorkAndMarket(props:WorkAndMarketProps){
  const {accountKey,member,authenticated,professional,role,city,revision,onView,onOpenMember,onDestination,onManage,onShare,onOpenProject,onSignIn,onDiscoverPeople,onPrivacy}=props;
  const professionalAccess=authenticated&&professional;
  const view=professionalAccess||props.view==='market'||props.view==='contracts'?props.view:'market';
  const destination=destinations.find(item=>item.view===view)!;
  const id=useId(),navigationId=id+'-panel',navigation=useRef<HTMLElement>(null);
  useEffect(()=>{
    const rail=navigation.current,active=rail?.querySelector<HTMLElement>('[data-active=true]');
    if(!rail||!active)return;
    const frame=rail.getBoundingClientRect(),item=active.getBoundingClientRect();
    if(item.left<frame.left)rail.scrollLeft-=frame.left-item.left+4;
    else if(item.right>frame.right)rail.scrollLeft+=item.right-frame.right+4;
  },[accountKey,view]);
  const visibleDestinations=destinations.filter(item=>professionalAccess||item.view==='market'||item.view==='contracts');
  const visibleCategories=categories.filter(category=>visibleDestinations.some(item=>item.category===category.id));
  const navigate=(next:WorkMarketView)=>onView(next);

  const panel=()=>{
    switch(view){
      case 'tools':
        return <ProfessionalWorkspace accountKey={accountKey} onView={navigate} onProfile={props.onProfile||(()=>navigate('background'))} onSaved={props.onSaved||(()=>navigate('market'))} onPublish={props.onPublish||(()=>onManage('career'))} onNotifications={props.onNotifications||(()=>{})} onOpenMember={onOpenMember}/>;
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
    <header className="rp-work-market-heading"><div><h2 id={id+'-title'}>Work &amp; market</h2><p>{professionalAccess?'Find work. Build your network.':'Opportunities and your contracts.'}</p></div><BriefcaseBusiness size={24} aria-hidden="true"/></header>
    <nav ref={navigation} className="rp-work-market-navigation" aria-label="Work and market sections">
      {visibleCategories.map(category=><div key={category.id} className="rp-work-market-category" data-active={destination.category===category.id}>
        <select aria-label={category.label} aria-controls={navigationId} value={destination.category===category.id?view:''} onChange={event=>navigate(event.target.value as WorkMarketView)}>
          <option value="" disabled>{'shortLabel' in category?category.shortLabel:category.label}</option>
          {visibleDestinations.filter(item=>item.category===category.id).map(item=><option key={item.view} value={item.view}>{item.view==='jobs'?'Jobs':item.view==='history'?'Work history':item.label}</option>)}
        </select><ChevronDown size={16} aria-hidden="true"/>
      </div>)}
    </nav>
    <div id={navigationId} className="rp-work-market-content" key={accountKey+':'+view} aria-label={destination.label}>{panel()}</div>
  </section>;
}
