import {useState} from 'react';
import {ArrowRight,House,Recycle,ShoppingBag,Users,Wrench} from 'lucide-react';
import type {Service} from '../types';
import {Modal} from './ui';
import RepaidoBrand from './RepaidoBrand';
import QuickActionCatalog from './QuickActionCatalog';
import './home-quick-actions.css';

export type QuickMarket = {condition?:'refurbished';search?:string;budget?:number;sell?:boolean;listingId?:string;location?:{lat:number;lng:number}};
export interface HomeQuickActionsProps {
  city:string;
  location?:{lat:number;lng:number};
  onLocation:()=>void;
  onMarket:(section:'spares'|'refurbished'|'preowned',options?:QuickMarket)=>void;
  onHire:()=>void;
  onHome:(service:string,professional?:{id:string;name:string})=>void;
  onService:(service:Service)=>void;
  onCatalogue:()=>void;
  onOpenCart?:()=>void;
}
export type QuickPanel='used'|'refurbished'|'hire'|'repair'|'home';
const tiles=[
  {id:'used' as const,label:'Buy / sell used',Icon:ShoppingBag,note:'Browse owner listings'},
  {id:'refurbished' as const,label:'Refurbished',Icon:Recycle,note:'Current shop inventory'},
  {id:'hire' as const,label:'Quick hire',Icon:Users,note:'Compare listed professionals'},
  {id:'repair' as const,label:'Quick repair',Icon:Wrench,note:'Browse services and prices'},
  {id:'home' as const,label:'Home premium',Icon:House,note:'Explore Home services'}
];

export default function HomeQuickActions(props:HomeQuickActionsProps){
  const [panel,setPanel]=useState<QuickPanel|null>(null);
  const closeAnd=(action:()=>void)=>{setPanel(null);action();};
  return <>
    <nav className="home-quick-rail" aria-label="Quick actions">
      {tiles.map(({id,label,Icon,note})=><button key={id} data-action={id} aria-label={label} onClick={()=>setPanel(id)}>
        <span className="quick-tile-main">
          <span className="quick-tile-icon"><Icon size={19} aria-hidden="true"/></span>
          <span className="quick-tile-copy"><strong>{label}</strong><span className="quick-tile-note">{note}</span></span>
          <span className="quick-tile-arrow"><ArrowRight size={13} aria-hidden="true"/></span>
        </span>
      </button>)}
    </nav>
    {panel&&<Modal title={tiles.find(t=>t.id===panel)!.label} className={`quick-action-modal quick-panel-${panel}`} onClose={()=>setPanel(null)}>
      <div className="quick-modal-header-brand"><RepaidoBrand size="sm"/><span className="quick-modal-tagline">{props.city}</span></div>
      <QuickActionCatalog key={panel} panel={panel} city={props.city} location={props.location}
        onLocation={()=>closeAnd(props.onLocation)}
        onMarket={(section,options)=>closeAnd(()=>props.onMarket(section,options))}
        onHire={()=>closeAnd(props.onHire)} onHome={(id,professional)=>closeAnd(()=>props.onHome(id,professional))}
        onService={service=>closeAnd(()=>props.onService(service))}
        onCatalogue={()=>closeAnd(props.onCatalogue)}
        onOpenCart={props.onOpenCart?()=>closeAnd(props.onOpenCart!):undefined}/>
    </Modal>}
  </>;
}
