import {Home,ClipboardList,CalendarDays,Wallet,User} from 'lucide-react';
import './agent-workspace.css';

export function WorkerNavigation({tab,onChange}:{tab:string;onChange:(tab:string)=>void}) {
 return <nav className="ops-bottom-nav" aria-label="Worker navigation">
  {[{name:'Home',label:'Home',Icon:Home},{name:'Active Task',label:'Tasks',Icon:ClipboardList},{name:'Calendar',label:'Calendar',Icon:CalendarDays},{name:'Earnings',label:'Earnings',Icon:Wallet},{name:'Profile',label:'Profile',Icon:User}].map(({name,label,Icon})=><button type="button" key={name} aria-current={tab===name?'page':undefined} onClick={()=>onChange(name)}><Icon size={20} strokeWidth={2} aria-hidden="true"/><span>{label}</span></button>)}
 </nav>;
}
