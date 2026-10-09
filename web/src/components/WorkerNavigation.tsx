import {Home,ClipboardList,CalendarDays,Wallet,User} from 'lucide-react';
import {useEffect,useRef} from 'react';
import './agent-workspace.css';

export function WorkerNavigation({tab,onChange}:{tab:string;onChange:(tab:string)=>void}) {
 const navigation=useRef<HTMLElement>(null);
 useEffect(()=>{
  const nav=navigation.current,workspace=nav?.closest<HTMLElement>('.ops-worker');
  if(!nav||!workspace)return;
  const measure=()=>workspace.style.setProperty('--worker-nav-height',`${nav.getBoundingClientRect().height}px`);
  const observer=new ResizeObserver(measure);observer.observe(nav);measure();
  return()=>observer.disconnect();
 },[]);
 return <nav ref={navigation} className="ops-bottom-nav" aria-label="Worker navigation">
  {[{name:'Home',label:'Home',Icon:Home},{name:'Active Task',label:'Tasks',Icon:ClipboardList},{name:'Calendar',label:'Calendar',Icon:CalendarDays},{name:'Earnings',label:'Earnings',Icon:Wallet},{name:'Profile',label:'Profile',Icon:User}].map(({name,label,Icon})=><button type="button" key={name} aria-current={tab===name?'page':undefined} onClick={()=>onChange(name)}><Icon size={20} strokeWidth={2} aria-hidden="true"/><span>{label}</span></button>)}
 </nav>;
}
