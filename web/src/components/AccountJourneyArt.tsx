import {useId} from 'react';
import {Check,Sparkles,Wrench} from '../icons';

export function AccountJourneyArt({celebrate=false}:{celebrate?:boolean}){
 const id=useId().replaceAll(':','');
 return <div className={`account-journey-art${celebrate?' is-celebrating':''}`} aria-hidden="true">
  <span className="account-art-orbit"/>
  <svg className="account-art-house" viewBox="0 0 260 210" fill="none">
   <defs><linearGradient id={id+'wall'} x1="67" y1="65" x2="192" y2="180" gradientUnits="userSpaceOnUse"><stop stopColor="#fff"/><stop offset="1" stopColor="#dce9ff"/></linearGradient><linearGradient id={id+'roof'} x1="45" y1="54" x2="195" y2="133" gradientUnits="userSpaceOnUse"><stop stopColor="#4d8cff"/><stop offset="1" stopColor="#0640bb"/></linearGradient><linearGradient id={id+'door'} x1="127" y1="107" x2="162" y2="173" gradientUnits="userSpaceOnUse"><stop stopColor="#ffe9a0"/><stop offset="1" stopColor="#f6be32"/></linearGradient></defs>
   <ellipse cx="135" cy="188" rx="83" ry="13" fill="#234c9c" opacity=".15"/>
   <path d="M68 91 135 56l67 38v73l-67 34-67-38Z" fill={'url(#'+id+'wall)'}/>
   <path d="m135 127 67-33v73l-67 34Z" fill="#b5cef6"/>
   <path d="m43 99 91-73 91 76-24 13-67-57-66 55Z" fill={'url(#'+id+'roof)'}/>
   <path d="m134 26 91 76-24 13-67-57Z" fill="#163e9a"/>
   <path d="m114 133 21-11 25 14v52l-25 13-21-12Z" fill={'url(#'+id+'door)'}/>
   <path d="m135 145 25-9v52l-25 13Z" fill="#f4bd39"/>
   <path d="m80 117 20 11v25l-20-11Z" fill="#447bd2"/>
   <path d="m171 126 18-9v26l-18 9Z" fill="#4778c1"/>
   <path d="m149 160 1 11" stroke="#836018" strokeWidth="3" strokeLinecap="round"/>
  </svg>
  <span className="account-art-tile account-art-tools"><Wrench size={23}/></span>
  <span className="account-art-tile account-art-spark"><Sparkles size={22}/></span>
  <span className="account-art-tile account-art-check"><Check size={23}/></span>
  <i className="account-art-dot one"/><i className="account-art-dot two"/><i className="account-art-dot three"/>
 </div>;
}
