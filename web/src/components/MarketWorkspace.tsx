import {useId,type ReactNode} from 'react';
import {Boxes,CarFront,FileCheck2,Recycle,ShoppingBag} from 'lucide-react';
import {BusinessTabs} from './BusinessUI';
import './market-workspace.css';

export type MarketDestination='spares'|'b2b'|'tenders'|'mobility'|'scrap';
const destinations=[
 {id:'spares',label:'Market',accessibleLabel:'Marketplace',Icon:ShoppingBag},
 {id:'b2b',label:'Wholesale',accessibleLabel:'B2B Wholesale',Icon:Boxes},
 {id:'tenders',label:'Contracts',accessibleLabel:'Contracts',Icon:FileCheck2},
 {id:'mobility',label:'Cabs',accessibleLabel:'Cabs & cars',Icon:CarFront},
 {id:'scrap',label:'Scrap',accessibleLabel:'Sell scrap',Icon:Recycle},
] as const;

/** One customer Market shell; its destinations retain their existing data flows. */
export function MarketWorkspace({value,onChange,children}:{value:MarketDestination;onChange:(value:MarketDestination)=>void;children:ReactNode}){
 const id=useId(),panel=id+'-panel';
 return <section className="w-full market-experience market-workspace" aria-label="Repaido Market" data-destination={value}>
  <BusinessTabs className="market-destinations" idPrefix={id} label="Marketplace destination" panelId={panel} value={value} onChange={onChange} items={destinations.map(({Icon,...item})=>({...item,icon:<span className="market-destination-icon" aria-hidden="true"><Icon size={18}/></span>}))}/>
  <div id={panel} role="tabpanel" aria-labelledby={`${id}-${value}`} className="market-destination-panel" key={value}>{children}</div>
 </section>;
}
