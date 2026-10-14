import {useEffect,useRef,type ComponentProps} from 'react';
import {HydrationControls} from './ServiceHydration';
import {Modal} from './ui';
import './home-elastic-discovery.css';

export function HomeDiscoveryPreferences({onClose,...controls}:ComponentProps<typeof HydrationControls>&{onClose:()=>void}){
 const content=useRef<HTMLDivElement>(null);
 useEffect(()=>{content.current?.querySelector('details')?.setAttribute('open','');},[]);
 return <Modal title="Discovery settings" className="home-discovery-preferences" onClose={onClose}><div ref={content}><HydrationControls {...controls}/></div></Modal>;
}
